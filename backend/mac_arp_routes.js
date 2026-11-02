const express = require('express');
const fs = require('fs');
const path = require('path');
const pool = require('./db');
const { importInventoryFromCSV, normalizeMac } = require('./inventory_service');
const {
  importArpSnapshot,
  getLatestSnapshotSummary,
  getSnapshotDetails
} = require('./arp_importer');

const router = express.Router();

// ---------------------------------------------------------------------
// 1. GET /api/mac-inventory
// List inventory with latest ARP discovery and linked ping reachability
// ---------------------------------------------------------------------
router.get('/api/mac-inventory', async (req, res) => {
  try {
    const { search, department, match_status, arp_state, interface: iface } = req.query;

    // Latest discovery subquery per normalized_mac
    // Distinct on normalized_mac ordered by discovered_at desc
    const query = `
      WITH latest_arp AS (
        SELECT DISTINCT ON (d.normalized_mac)
          d.id AS discovery_id,
          d.normalized_mac,
          d.ip_address AS discovered_ip,
          d.interface AS discovered_interface,
          d.arp_state,
          d.discovered_at,
          s.snapshot_name
        FROM arp_discoveries d
        JOIN arp_snapshots s ON s.id = d.snapshot_id
        WHERE d.normalized_mac IS NOT NULL
        ORDER BY d.normalized_mac, d.discovered_at DESC, d.id DESC
      ),
      latest_device_status AS (
        SELECT DISTINCT ON (device_id)
          device_id,
          status AS ping_status,
          latency_ms AS ping_latency,
          checked_at AS ping_checked_at
        FROM status_history
        ORDER BY device_id, checked_at DESC, id DESC
      )
      SELECT
        inv.id,
        inv.mac_address,
        inv.normalized_mac,
        inv.raw_mac_entry,
        inv.device_name,
        inv.site_station,
        inv.department_location,
        inv.device_type,
        inv.vlan_id,
        inv.expected_ip,
        inv.notes,
        inv.is_multi_mac,
        inv.multi_mac_group_id,
        inv.device_id,
        inv.created_at,
        inv.updated_at,
        -- ARP discovery info
        arp.discovered_ip,
        arp.discovered_interface,
        arp.arp_state,
        arp.discovered_at,
        arp.snapshot_name,
        CASE
          WHEN arp.discovered_ip IS NOT NULL THEN 'matched'
          ELSE 'unobserved'
        END AS match_status,
        -- Registered device & ping monitoring info (if linked)
        dev.name AS linked_device_name,
        dev.ip_address AS registered_ip,
        dev.building AS registered_building,
        dev.room AS registered_room,
        dev.rack AS registered_rack,
        dev.port_number AS registered_port,
        dev.location_verification,
        p.ping_status,
        p.ping_latency,
        p.ping_checked_at
      FROM mac_inventory inv
      LEFT JOIN latest_arp arp ON arp.normalized_mac = inv.normalized_mac
      LEFT JOIN devices dev ON dev.id = inv.device_id
      LEFT JOIN latest_device_status p ON p.device_id = dev.id
      ORDER BY inv.id ASC
    `;

    const result = await pool.query(query);
    let items = result.rows;

    // Clean and validate query parameters
    const cleanSearch = (search && search !== 'undefined' && search !== 'null' && search.trim()) ? search.trim().toLowerCase() : null;
    const cleanDept = (department && department !== 'ALL' && department !== 'undefined' && department !== 'null') ? department : null;
    const cleanMatch = (match_status && match_status !== 'ALL' && match_status !== 'undefined' && match_status !== 'null') ? match_status : null;
    const cleanState = (arp_state && arp_state !== 'ALL' && arp_state !== 'undefined' && arp_state !== 'null') ? arp_state : null;
    const cleanIface = (iface && iface !== 'ALL' && iface !== 'undefined' && iface !== 'null') ? iface : null;

    // Apply in-memory filtering for flexible combination
    if (cleanSearch) {
      items = items.filter(i =>
        (i.device_name && i.device_name.toLowerCase().includes(cleanSearch)) ||
        (i.mac_address && i.mac_address.toLowerCase().includes(cleanSearch)) ||
        (i.normalized_mac && i.normalized_mac.toLowerCase().includes(cleanSearch)) ||
        (i.department_location && i.department_location.toLowerCase().includes(cleanSearch)) ||
        (i.discovered_ip && i.discovered_ip.includes(cleanSearch)) ||
        (i.expected_ip && i.expected_ip.includes(cleanSearch)) ||
        (i.registered_ip && i.registered_ip.includes(cleanSearch))
      );
    }

    if (cleanDept) {
      items = items.filter(i => i.department_location === cleanDept);
    }

    if (cleanMatch) {
      items = items.filter(i => i.match_status === cleanMatch);
    }

    if (cleanState) {
      items = items.filter(i => i.arp_state === cleanState);
    }

    if (cleanIface) {
      items = items.filter(i => i.discovered_interface === cleanIface);
    }

    // Compute aggregate metrics
    const totalCount = result.rows.length;
    const matchedCount = result.rows.filter(i => i.match_status === 'matched').length;
    const unobservedCount = totalCount - matchedCount;
    const multiMacCount = result.rows.filter(i => i.is_multi_mac).length;

    // Extract unique filter lists
    const departments = Array.from(new Set(result.rows.map(i => i.department_location).filter(Boolean))).sort();
    const interfaces = Array.from(new Set(result.rows.map(i => i.discovered_interface).filter(Boolean))).sort();
    const arpStates = Array.from(new Set(result.rows.map(i => i.arp_state).filter(Boolean))).sort();

    res.json({
      items,
      filteredCount: items.length,
      summary: {
        total_inventory: totalCount,
        matched_in_arp: matchedCount,
        unobserved: unobservedCount,
        multi_mac_count: multiMacCount
      },
      filters: {
        departments,
        interfaces,
        arpStates
      }
    });
  } catch (err) {
    console.error('Fetch mac-inventory failed:', err.message);
    res.status(500).json({ error: 'Could not fetch MAC inventory' });
  }
});

// ---------------------------------------------------------------------
// 2. GET /api/mac-inventory/:id
// Single inventory device details + multi-MAC siblings + history
// ---------------------------------------------------------------------
router.get('/api/mac-inventory/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid inventory ID' });
  }

  try {
    const invRes = await pool.query('SELECT * FROM mac_inventory WHERE id = $1', [id]);
    if (invRes.rows.length === 0) {
      return res.status(404).json({ error: 'Inventory record not found' });
    }
    const item = invRes.rows[0];

    // Multi-MAC siblings
    let siblings = [];
    if (item.is_multi_mac && item.multi_mac_group_id) {
      const sibRes = await pool.query(
        'SELECT id, mac_address, device_name, department_location FROM mac_inventory WHERE multi_mac_group_id = $1 AND id != $2',
        [item.multi_mac_group_id, id]
      );
      siblings = sibRes.rows;
    }

    // Discovery history
    const discRes = await pool.query(
      `SELECT d.*, s.snapshot_name, s.imported_at
       FROM arp_discoveries d
       JOIN arp_snapshots s ON s.id = d.snapshot_id
       WHERE d.normalized_mac = $1
       ORDER BY d.discovered_at DESC, d.id DESC`,
      [item.normalized_mac]
    );

    // Linked device (if any)
    let linkedDevice = null;
    if (item.device_id) {
      const devRes = await pool.query('SELECT * FROM devices WHERE id = $1', [item.device_id]);
      if (devRes.rows.length > 0) linkedDevice = devRes.rows[0];
    }

    res.json({
      inventory: item,
      multi_mac_siblings: siblings,
      discoveries: discRes.rows,
      linked_device: linkedDevice
    });
  } catch (err) {
    console.error('Fetch inventory details failed:', err.message);
    res.status(500).json({ error: 'Could not fetch inventory details' });
  }
});

// ---------------------------------------------------------------------
// 3. POST /api/mac-inventory/import
// Import or sync inventory from CSV
// ---------------------------------------------------------------------
router.post('/api/mac-inventory/import', async (req, res) => {
  try {
    let csvText = req.body && req.body.csv_text;
    let filename = (req.body && req.body.filename) || 'inventory.csv';

    if (!csvText) {
      const defaultPath = path.resolve(__dirname, '../data/inventory.csv');
      if (fs.existsSync(defaultPath)) {
        csvText = fs.readFileSync(defaultPath, 'utf8');
      } else {
        return res.status(400).json({ error: 'No CSV content provided and data/inventory.csv not found' });
      }
    }

    const summary = await importInventoryFromCSV(csvText, filename);
    res.json(summary);
  } catch (err) {
    console.error('Inventory import failed:', err.message);
    res.status(500).json({ error: err.message || 'Inventory import failed' });
  }
});

// ---------------------------------------------------------------------
// 4. GET /api/arp/snapshots
// List of all snapshots
// ---------------------------------------------------------------------
router.get('/api/arp/snapshots', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM arp_snapshots ORDER BY imported_at DESC, id DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Fetch snapshots failed:', err.message);
    res.status(500).json({ error: 'Could not fetch snapshots' });
  }
});

// ---------------------------------------------------------------------
// 4b. GET /api/arp/snapshots/compare
// Compare two snapshots to detect new MACs, changed mappings, unobserved devices
// ---------------------------------------------------------------------
router.get('/api/arp/snapshots/compare', async (req, res) => {
  try {
    let { base_id, target_id } = req.query;

    if (!base_id || !target_id) {
      // Default: base is previous snapshot, target is latest snapshot
      const snapsRes = await pool.query(
        'SELECT id FROM arp_snapshots ORDER BY imported_at DESC, id DESC LIMIT 2'
      );
      if (snapsRes.rows.length < 2) {
        return res.status(400).json({ error: 'At least two snapshots are required for comparison' });
      }
      target_id = snapsRes.rows[0].id;
      base_id = snapsRes.rows[1].id;
    }

    const { compareSnapshots } = require('./sophos_arp_service');
    const comparison = await compareSnapshots(Number(base_id), Number(target_id));
    res.json(comparison);
  } catch (err) {
    console.error('Snapshot comparison failed:', err.message);
    res.status(500).json({ error: err.message || 'Snapshot comparison failed' });
  }
});

// ---------------------------------------------------------------------
// 5. GET /api/arp/snapshots/:id
// Single snapshot details
// ---------------------------------------------------------------------
router.get('/api/arp/snapshots/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid snapshot ID' });
  }

  try {
    const result = await pool.query('SELECT * FROM arp_snapshots WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Snapshot not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Fetch snapshot failed:', err.message);
    res.status(500).json({ error: 'Could not fetch snapshot' });
  }
});

// ---------------------------------------------------------------------
// 5b. GET /api/arp/snapshots/:id/details
// Snapshot details with full discovery records and inventory joins
// ---------------------------------------------------------------------
router.get('/api/arp/snapshots/:id/details', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid snapshot ID' });
  }

  try {
    const { match_status, interface: iface } = req.query;
    const details = await getSnapshotDetails(id, { matchStatus: match_status, interface: iface });
    if (!details) {
      return res.status(404).json({ error: 'Snapshot not found' });
    }
    res.json(details);
  } catch (err) {
    console.error('Fetch snapshot details failed:', err.message);
    res.status(500).json({ error: 'Could not fetch snapshot details' });
  }
});

// ---------------------------------------------------------------------
// 5c. GET /api/arp/snapshots/:id/export
// Download snapshot entries as CSV or JSON file (supports :id as 'latest' or integer)
// ---------------------------------------------------------------------
router.get('/api/arp/snapshots/:id/export', async (req, res) => {
  try {
    let snapshotId;
    if (req.params.id === 'latest') {
      const latestRes = await pool.query('SELECT id, snapshot_name, imported_at FROM arp_snapshots ORDER BY id DESC LIMIT 1');
      if (latestRes.rows.length === 0) {
        return res.status(404).json({ error: 'No ARP snapshots found in database' });
      }
      snapshotId = latestRes.rows[0].id;
    } else {
      snapshotId = Number(req.params.id);
      if (!Number.isInteger(snapshotId) || snapshotId < 1) {
        return res.status(400).json({ error: 'Invalid snapshot ID' });
      }
    }

    const snapRes = await pool.query('SELECT * FROM arp_snapshots WHERE id = $1', [snapshotId]);
    if (snapRes.rows.length === 0) {
      return res.status(404).json({ error: 'Snapshot not found' });
    }
    const snapshot = snapRes.rows[0];

    const entriesRes = await pool.query(
      `SELECT 
        d.ip_address,
        d.mac_address,
        d.interface,
        d.arp_state,
        CASE
          WHEN inv.id IS NOT NULL AND reg.id IS NOT NULL THEN 'Matched (Inventory & Registered)'
          WHEN reg.id IS NOT NULL THEN 'Matched (Registered Node)'
          WHEN inv.id IS NOT NULL THEN 'Matched (MAC Inventory)'
          WHEN d.has_mac = false THEN 'No MAC'
          ELSE 'Unmatched / Discovered'
        END AS overall_status,
        d.match_status AS mac_inventory_match,
        inv.device_name AS mac_inventory_name,
        inv.department_location,
        reg.name AS registered_device_name,
        reg.device_type AS registered_device_type,
        d.discovered_at
       FROM arp_discoveries d
       LEFT JOIN mac_inventory inv ON inv.id = d.matched_inventory_id
       LEFT JOIN devices reg ON (
         (reg.ip_address IS NOT NULL AND reg.ip_address = d.ip_address)
         OR (reg.mac_address IS NOT NULL AND LOWER(REPLACE(reg.mac_address, ':', '')) = d.normalized_mac)
       )
       WHERE d.snapshot_id = $1
       ORDER BY d.ip_address ASC, d.id ASC`,
      [snapshotId]
    );

    const format = (req.query.format || 'csv').toLowerCase();
    const dateStr = new Date(snapshot.imported_at).toISOString().slice(0, 10);

    if (format === 'json') {
      const filename = `sophos_arp_snapshot_${snapshotId}_${dateStr}.json`;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.json({
        snapshot,
        totalEntries: entriesRes.rows.length,
        entries: entriesRes.rows,
      });
    }

    // Default to CSV
    const filename = `sophos_arp_snapshot_${snapshotId}_${dateStr}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const headers = [
      'IP Address',
      'MAC Address',
      'Interface',
      'ARP State',
      'Overall Status',
      'MAC Inventory Match',
      'MAC Inventory Device Name',
      'Department / Location',
      'Registered Device Name',
      'Device Type',
      'Discovered At',
    ];

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    let csvContent = headers.join(',') + '\r\n';
    for (const row of entriesRes.rows) {
      const cols = [
        escapeCsv(row.ip_address),
        escapeCsv(row.mac_address),
        escapeCsv(row.interface),
        escapeCsv(row.arp_state),
        escapeCsv(row.overall_status),
        escapeCsv(row.mac_inventory_match),
        escapeCsv(row.mac_inventory_name),
        escapeCsv(row.department_location),
        escapeCsv(row.registered_device_name),
        escapeCsv(row.registered_device_type),
        escapeCsv(row.discovered_at ? new Date(row.discovered_at).toLocaleString() : ''),
      ];
      csvContent += cols.join(',') + '\r\n';
    }

    res.send(csvContent);
  } catch (err) {
    console.error('Export snapshot failed:', err.message);
    res.status(500).json({ error: 'Could not export snapshot' });
  }
});

// ---------------------------------------------------------------------
// 6. POST /api/arp/snapshots/import
// Import an ARP snapshot (canonical JSON, uploaded content, or CSV)
// ---------------------------------------------------------------------
router.post('/api/arp/snapshots/import', async (req, res) => {
  try {
    let rawContent = req.body && (req.body.snapshot_content || req.body.content || req.body.json);
    let snapshotName = req.body && (req.body.filename || req.body.snapshot_name || req.body.name);
    let dryRun = Boolean(req.body && (req.body.dryRun || req.body.dry_run || req.query.dry_run === 'true'));

    // Default to canonical snapshot file if no raw content provided
    let inputSource = rawContent;
    if (!inputSource) {
      const canonicalPath = path.resolve(__dirname, '../sophos-arp-test/arp-snapshot.json');
      if (fs.existsSync(canonicalPath)) {
        inputSource = canonicalPath;
      } else {
        const fallbackPath = path.resolve(__dirname, '../data/arp-ipv4-parsed.csv');
        if (fs.existsSync(fallbackPath)) {
          inputSource = fallbackPath;
        } else {
          return res.status(400).json({ error: 'No snapshot content provided and default snapshot files not found' });
        }
      }
    }

    const summary = await importArpSnapshot(inputSource, {
      snapshotName: snapshotName || undefined,
      dryRun
    });
    res.json(summary);
  } catch (err) {
    console.error('ARP import failed:', err.message);
    res.status(500).json({ error: err.message || 'ARP snapshot import failed' });
  }
});

// ---------------------------------------------------------------------
// 6b. POST /api/arp/snapshots/import-json
// Dedicated endpoint to import JSON snapshot payload or canonical file
// ---------------------------------------------------------------------
router.post('/api/arp/snapshots/import-json', async (req, res) => {
  try {
    const jsonPayload = req.body && (req.body.entries ? req.body : req.body.snapshot_json);
    const snapshotName = req.body && req.body.snapshot_name;
    const dryRun = Boolean(req.body && (req.body.dryRun || req.body.dry_run || req.query.dry_run === 'true'));

    let inputSource = jsonPayload;
    if (!inputSource) {
      const canonicalPath = path.resolve(__dirname, '../sophos-arp-test/arp-snapshot.json');
      if (fs.existsSync(canonicalPath)) {
        inputSource = canonicalPath;
      } else {
        return res.status(400).json({ error: 'No JSON payload provided and canonical arp-snapshot.json not found' });
      }
    }

    const summary = await importArpSnapshot(inputSource, {
      snapshotName: snapshotName || undefined,
      dryRun
    });
    res.json(summary);
  } catch (err) {
    console.error('ARP JSON import failed:', err.message);
    res.status(500).json({ error: err.message || 'ARP JSON import failed' });
  }
});

// ---------------------------------------------------------------------
// 7. GET /api/arp/discoveries
// List discoveries with filters
// ---------------------------------------------------------------------
router.get('/api/arp/discoveries', async (req, res) => {
  try {
    const { snapshot_id, match_status, interface: iface, arp_state, search } = req.query;

    let targetSnapshotId = snapshot_id ? Number(snapshot_id) : null;
    if (!targetSnapshotId) {
      const latestSnapRes = await pool.query('SELECT id FROM arp_snapshots ORDER BY imported_at DESC LIMIT 1');
      if (latestSnapRes.rows.length > 0) {
        targetSnapshotId = latestSnapRes.rows[0].id;
      }
    }

    if (!targetSnapshotId) {
      return res.json({ items: [], summary: null });
    }

    const query = `
      SELECT
        d.id,
        d.snapshot_id,
        d.ip_address,
        d.mac_address,
        d.normalized_mac,
        d.interface,
        d.arp_state,
        d.is_router_entry,
        d.has_mac,
        d.match_status,
        d.discovered_at,
        inv.device_name AS inventory_device_name,
        inv.department_location AS inventory_location,
        inv.site_station AS inventory_site,
        inv.expected_ip AS inventory_expected_ip,
        s.snapshot_name
      FROM arp_discoveries d
      JOIN arp_snapshots s ON s.id = d.snapshot_id
      LEFT JOIN mac_inventory inv ON inv.id = d.matched_inventory_id
      WHERE d.snapshot_id = $1
      ORDER BY d.id ASC
    `;

    const result = await pool.query(query, [targetSnapshotId]);
    let items = result.rows;

    // Clean and validate query parameters
    const cleanSearch = (search && search !== 'undefined' && search !== 'null' && search.trim()) ? search.trim().toLowerCase() : null;
    const cleanMatch = (match_status && match_status !== 'ALL' && match_status !== 'undefined' && match_status !== 'null') ? match_status : null;
    const cleanIface = (iface && iface !== 'ALL' && iface !== 'undefined' && iface !== 'null') ? iface : null;
    const cleanState = (arp_state && arp_state !== 'ALL' && arp_state !== 'undefined' && arp_state !== 'null') ? arp_state : null;

    if (cleanSearch) {
      items = items.filter(i =>
        (i.ip_address && i.ip_address.toLowerCase().includes(cleanSearch)) ||
        (i.mac_address && i.mac_address.toLowerCase().includes(cleanSearch)) ||
        (i.normalized_mac && i.normalized_mac.toLowerCase().includes(cleanSearch)) ||
        (i.interface && i.interface.toLowerCase().includes(cleanSearch)) ||
        (i.inventory_device_name && i.inventory_device_name.toLowerCase().includes(cleanSearch)) ||
        (i.inventory_location && i.inventory_location.toLowerCase().includes(cleanSearch))
      );
    }

    if (cleanMatch) {
      items = items.filter(i => i.match_status === cleanMatch);
    }

    if (cleanIface) {
      items = items.filter(i => i.interface === cleanIface);
    }

    if (cleanState) {
      if (cleanState.toLowerCase() === 'complete') {
        items = items.filter(i => (i.arp_state || '').toLowerCase().startsWith('complete'));
      } else {
        items = items.filter(i => (i.arp_state || '').toLowerCase() === cleanState.toLowerCase());
      }
    }

    const totalCount = result.rows.length;
    const matchedCount = result.rows.filter(i => i.match_status === 'matched').length;
    const unmatchedCount = result.rows.filter(i => i.match_status === 'unmatched').length;
    const noMacCount = result.rows.filter(i => i.match_status === 'no_mac').length;

    res.json({
      items,
      filteredCount: items.length,
      summary: {
        total_entries: totalCount,
        matched: matchedCount,
        unmatched: unmatchedCount,
        no_mac_failed: noMacCount
      }
    });
  } catch (err) {
    console.error('Fetch discoveries failed:', err.message);
    res.status(500).json({ error: 'Could not fetch ARP discoveries' });
  }
});

// ---------------------------------------------------------------------
// 8. GET /api/arp/summary
// High-level summary of latest snapshot and inventory correlation
// ---------------------------------------------------------------------
router.get('/api/arp/summary', async (req, res) => {
  try {
    const summary = await getLatestSnapshotSummary();
    res.json(summary || { total_inventory: 0, matched_inventory_count: 0, unobserved_inventory_count: 0 });
  } catch (err) {
    console.error('Fetch ARP summary failed:', err.message);
    res.status(500).json({ error: 'Could not fetch ARP summary' });
  }
});



// ---------------------------------------------------------------------
// 10. GET /api/arp/poller/status
// Operational status of automated Sophos ARP poller
// ---------------------------------------------------------------------
router.get('/api/arp/poller/status', async (req, res) => {
  try {
    const { getPersistedPollerStatus } = require('./sophos_arp_service');
    res.json(await getPersistedPollerStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------
// 11. POST /api/arp/poller/poll-now
// Trigger an on-demand ARP collection cycle
// ---------------------------------------------------------------------
router.post('/api/arp/poller/poll-now', async (req, res) => {
  try {
    const { runArpPollingCycle } = require('./sophos_arp_service');
    const result = await runArpPollingCycle();
    res.json(result);
  } catch (err) {
    console.error('On-demand ARP poll failed:', err.message);
    res.status(500).json({ error: err.message || 'On-demand poll failed' });
  }
});

module.exports = router;
