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
        dev.contact_person,
        dev.contact_phone,
        p.ping_status,
        p.ping_latency,
        p.ping_checked_at
      FROM mac_inventory inv
      LEFT JOIN latest_arp arp ON arp.normalized_mac = inv.normalized_mac
      LEFT JOIN devices dev ON (
        (inv.device_id IS NOT NULL AND dev.id = inv.device_id)
        OR (inv.normalized_mac IS NOT NULL AND dev.mac_address IS NOT NULL AND LOWER(REGEXP_REPLACE(dev.mac_address, '[^a-fA-F0-9]', '', 'g')) = inv.normalized_mac)
      )
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
        (i.contact_person && i.contact_person.toLowerCase().includes(cleanSearch)) ||
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
    if (!linkedDevice && item.normalized_mac) {
      const devRes = await pool.query(
        "SELECT * FROM devices WHERE mac_address IS NOT NULL AND LOWER(REGEXP_REPLACE(mac_address, '[^a-fA-F0-9]', '', 'g')) = $1 LIMIT 1",
        [item.normalized_mac]
      );
      if (devRes.rows.length > 0) linkedDevice = devRes.rows[0];
    }
    if (linkedDevice) {
      item.contact_person = linkedDevice.contact_person;
      item.contact_phone = linkedDevice.contact_phone;
      item.linked_device_name = linkedDevice.name;
      item.registered_ip = linkedDevice.ip_address;
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
// ---------------------------------------------------------------------
// 5c. GET /api/arp/snapshots/:id/audit
// Returns extraction integrity telemetry, page tracking breakdown, and verification statistics
// ---------------------------------------------------------------------
router.get('/api/arp/snapshots/:id/audit', async (req, res) => {
  try {
    let snapshotId;
    if (req.params.id === 'latest') {
      const latestRes = await pool.query('SELECT id FROM arp_snapshots ORDER BY id DESC LIMIT 1');
      if (latestRes.rows.length === 0) {
        return res.status(404).json({ error: 'No ARP snapshots found' });
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

    const statsRes = await pool.query(
      `SELECT
        COUNT(*) AS total_count,
        COUNT(*) FILTER (WHERE verification_status = 'verified') AS verified_count,
        COUNT(*) FILTER (WHERE verification_status = 'verified_incomplete') AS incomplete_count,
        COUNT(*) FILTER (WHERE verification_status = 'flagged') AS flagged_count,
        COUNT(*) FILTER (WHERE verification_status = 'rejected') AS rejected_count,
        COUNT(*) FILTER (WHERE has_conflict = TRUE) AS conflict_count,
        COUNT(*) FILTER (WHERE is_duplicate_ip = TRUE) AS duplicate_ip_count,
        COUNT(*) FILTER (WHERE is_duplicate_mac = TRUE) AS duplicate_mac_count,
        COUNT(*) FILTER (WHERE has_mac = TRUE) AS with_mac_count,
        COUNT(*) FILTER (WHERE matched_inventory_id IS NOT NULL) AS matched_inventory_count
       FROM arp_discoveries
       WHERE snapshot_id = $1`,
      [snapshotId]
    );

    const counts = statsRes.rows[0];

    res.json({
      snapshotId,
      snapshotName: snapshot.snapshot_name,
      importedAt: snapshot.imported_at,
      sourceDevice: snapshot.source_device,
      extractionStatus: snapshot.extraction_status || 'complete',
      telemetry: {
        totalPagesDetected: snapshot.total_pages_detected || 1,
        pagesVisited: snapshot.pages_visited || 1,
        paginationCompleted: Boolean(snapshot.pagination_completed),
        pageRows: snapshot.page_rows_json || [],
        totalRawEntries: snapshot.total_raw_entries || snapshot.total_entries,
        validIpCount: snapshot.valid_ip_count || counts.total_count,
        validMacCount: snapshot.valid_mac_count || counts.with_mac_count,
        incompleteCount: snapshot.incomplete_count || counts.incomplete_count,
        invalidCount: snapshot.invalid_count || counts.rejected_count,
        duplicateCount: snapshot.duplicate_count || 0,
        extractionDurationMs: snapshot.extraction_duration_ms || 0,
        integrityWarnings: snapshot.integrity_warnings || []
      },
      audit: {
        totalDiscoveries: parseInt(counts.total_count, 10),
        verified: parseInt(counts.verified_count, 10),
        verifiedIncomplete: parseInt(counts.incomplete_count, 10),
        flaggedConflicts: parseInt(counts.flagged_count, 10),
        rejected: parseInt(counts.rejected_count, 10),
        hasConflictTotal: parseInt(counts.conflict_count, 10),
        duplicateIps: parseInt(counts.duplicate_ip_count, 10),
        duplicateMacs: parseInt(counts.duplicate_mac_count, 10),
        matchedInventory: parseInt(counts.matched_inventory_count, 10)
      }
    });
  } catch (err) {
    console.error('Fetch snapshot audit failed:', err.message);
    res.status(500).json({ error: 'Could not fetch snapshot audit report' });
  }
});

// Helper for CSV escaping
const escapeCsv = (val) => {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

// Prevent browser/proxy caching of dynamic snapshot exports
const setNoCacheHeaders = (res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
};

// ---------------------------------------------------------------------
// 5d. GET /api/arp/snapshots/:id/raw-export
// Export raw, untouched firewall extraction records
// ---------------------------------------------------------------------
router.get('/api/arp/snapshots/:id/raw-export', async (req, res) => {
  try {
    setNoCacheHeaders(res);

    let snapshotId;
    if (req.params.id === 'latest') {
      const latestRes = await pool.query('SELECT id, snapshot_name, imported_at, raw_payload_json FROM arp_snapshots ORDER BY id DESC LIMIT 1');
      if (latestRes.rows.length === 0) return res.status(404).json({ error: 'No snapshots found' });
      snapshotId = latestRes.rows[0].id;
    } else {
      snapshotId = Number(req.params.id);
      if (!Number.isInteger(snapshotId) || snapshotId < 1) return res.status(400).json({ error: 'Invalid snapshot ID' });
    }

    const snapRes = await pool.query('SELECT * FROM arp_snapshots WHERE id = $1', [snapshotId]);
    if (snapRes.rows.length === 0) return res.status(404).json({ error: 'Snapshot not found' });
    const snapshot = snapRes.rows[0];

    let rawRecords = snapshot.raw_payload_json;
    if (!rawRecords || !Array.isArray(rawRecords) || rawRecords.length === 0) {
      // Reconstruct raw records from discoveries
      const discRes = await pool.query(
        'SELECT ip_address AS ip, mac_address AS mac, interface, arp_state AS state FROM arp_discoveries WHERE snapshot_id = $1 ORDER BY id ASC',
        [snapshotId]
      );
      rawRecords = discRes.rows;
    }

    const format = (req.query.format || 'csv').toLowerCase();
    const dateStr = new Date(snapshot.imported_at).toISOString().slice(0, 10);

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="sophos_raw_extraction_${snapshotId}_${dateStr}.json"`);
      return res.json({
        type: 'RAW_SOPHOS_FIREWALL_EXTRACTION',
        snapshotId,
        snapshotName: snapshot.snapshot_name,
        extractedAt: snapshot.imported_at,
        totalRawEntries: rawRecords.length,
        rawRecords
      });
    }

    // CSV format (with UTF-8 BOM for Microsoft Excel)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sophos_raw_extraction_${snapshotId}_${dateStr}.csv"`);
    let csv = '\uFEFF' + ['Raw IP Address', 'Raw MAC Address', 'Interface', 'Firewall ARP State'].join(',') + '\r\n';
    for (const r of rawRecords) {
      csv += [
        escapeCsv(r.ip || r.ip_address || ''),
        escapeCsv(r.mac || r.mac_address || '-'),
        escapeCsv(r.interface || 'Unknown'),
        escapeCsv(r.state || r.arp_state || 'UNKNOWN')
      ].join(',') + '\r\n';
    }
    res.send(csv);
  } catch (err) {
    console.error('Raw export failed:', err.message);
    res.status(500).json({ error: 'Failed to export raw extraction' });
  }
});

// ---------------------------------------------------------------------
// 5e. GET /api/arp/snapshots/:id/verified-export
// Export validated snapshot entries with full audit classifications & reasons
// ---------------------------------------------------------------------
async function handleVerifiedExport(req, res) {
  try {
    setNoCacheHeaders(res);

    let snapshotId;
    let latestPollAt = null;
    if (req.params.id === 'latest') {
      const latestRes = await pool.query('SELECT id, snapshot_name, imported_at FROM arp_snapshots ORDER BY id DESC LIMIT 1');
      if (latestRes.rows.length === 0) return res.status(404).json({ error: 'No snapshots found' });
      snapshotId = latestRes.rows[0].id;
      const pollerRes = await pool.query('SELECT last_success_at, last_snapshot_id FROM sophos_poller_status WHERE id = 1').catch(() => ({ rows: [] }));
      if (pollerRes.rows[0]?.last_success_at) {
        latestPollAt = pollerRes.rows[0].last_success_at;
      }
    } else {
      snapshotId = Number(req.params.id);
      if (!Number.isInteger(snapshotId) || snapshotId < 1) return res.status(400).json({ error: 'Invalid snapshot ID' });
      const pollerRes = await pool.query('SELECT last_success_at, last_snapshot_id FROM sophos_poller_status WHERE id = 1').catch(() => ({ rows: [] }));
      if (pollerRes.rows[0]?.last_snapshot_id === snapshotId && pollerRes.rows[0]?.last_success_at) {
        latestPollAt = pollerRes.rows[0].last_success_at;
      }
    }

    const snapRes = await pool.query('SELECT * FROM arp_snapshots WHERE id = $1', [snapshotId]);
    if (snapRes.rows.length === 0) return res.status(404).json({ error: 'Snapshot not found' });
    const snapshot = snapRes.rows[0];

    const entriesRes = await pool.query(
      `SELECT
        d.ip_address,
        d.mac_address,
        d.normalized_mac,
        d.interface,
        d.arp_state,
        d.verification_status,
        d.has_conflict,
        d.is_duplicate_ip,
        d.is_duplicate_mac,
        d.is_incomplete,
        d.verification_reasons,
        d.match_status AS inventory_match_status,
        inv.device_name AS inventory_device_name,
        COALESCE(inv.department_location, dd.department, dd.building_location) AS department_location,
        inv.expected_ip AS inventory_expected_ip,
        reg.id AS registered_device_id,
        COALESCE(reg.name, dd.custom_name) AS registered_device_name,
        COALESCE(reg.device_type, dd.device_type) AS registered_device_type,
        reg.contact_person AS registered_contact_person,
        reg.contact_phone AS registered_contact_phone,
        COALESCE(p.status, dd.last_ping_status) AS ping_status,
        COALESCE(p.latency_ms, dd.last_ping_latency) AS ping_latency,
        COALESCE(p.checked_at, dd.last_ping_at) AS ping_checked_at,
        d.discovered_at
       FROM arp_discoveries d
       LEFT JOIN mac_inventory inv ON inv.id = d.matched_inventory_id
       LEFT JOIN discovered_devices dd ON dd.ip_address = d.ip_address
       LEFT JOIN devices reg ON (
         (d.normalized_mac IS NOT NULL AND reg.mac_address IS NOT NULL AND LOWER(REGEXP_REPLACE(reg.mac_address, '[^a-fA-F0-9]', '', 'g')) = d.normalized_mac)
         OR (inv.device_id IS NOT NULL AND reg.id = inv.device_id)
       )
       LEFT JOIN LATERAL (
         SELECT status, latency_ms, checked_at
         FROM status_history
         WHERE device_id = reg.id
         ORDER BY checked_at DESC
         LIMIT 1
       ) p ON true
       WHERE d.snapshot_id = $1
       ORDER BY d.ip_address ASC, d.id ASC`,
      [snapshotId]
    );

    const format = (req.query.format || 'csv').toLowerCase();
    const dateStr = new Date(snapshot.imported_at).toISOString().slice(0, 10);

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="sophos_verified_snapshot_${snapshotId}_${dateStr}.json"`);
      return res.json({
        type: 'VALIDATED_ARP_SNAPSHOT_AUDIT',
        snapshot,
        latestPollAt: latestPollAt || snapshot.imported_at,
        totalEntries: entriesRes.rows.length,
        entries: entriesRes.rows
      });
    }

    // Default to CSV (with UTF-8 BOM for Microsoft Excel)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sophos_verified_snapshot_${snapshotId}_${dateStr}.csv"`);

    const headers = [
      'IP Address',
      'MAC Address',
      'Normalized MAC',
      'Interface',
      'ARP Cache State',
      'Verification Status',
      'Conflict Detected',
      'Duplicate IP Flag',
      'Duplicate MAC Flag',
      'Incomplete ARP Flag',
      'Verification Reasons',
      'Inventory Match Status',
      'MAC Inventory Device Name',
      'Department / Location',
      'Inventory Expected IP',
      'Registered Node Name',
      'Contact Person',
      'Registered Node Type',
      'Decoupled Ping Reachability',
      'Ping Latency (ms)',
      'Ping Last Checked At',
      'Snapshot Created At',
      'Latest Poll Verified At'
    ];

    const effectivePollTime = latestPollAt || snapshot.imported_at;
    const effectivePollTimeStr = effectivePollTime ? new Date(effectivePollTime).toLocaleString() : '';

    let csvContent = '\uFEFF' + headers.join(',') + '\r\n';
    for (const row of entriesRes.rows) {
      const reasonsStr = Array.isArray(row.verification_reasons)
        ? row.verification_reasons.join('; ')
        : (row.verification_reasons ? JSON.stringify(row.verification_reasons) : '');

      const cols = [
        escapeCsv(row.ip_address),
        escapeCsv(row.mac_address),
        escapeCsv(row.normalized_mac),
        escapeCsv(row.interface),
        escapeCsv(row.arp_state),
        escapeCsv(row.verification_status),
        escapeCsv(row.has_conflict ? 'YES' : 'NO'),
        escapeCsv(row.is_duplicate_ip ? 'YES' : 'NO'),
        escapeCsv(row.is_duplicate_mac ? 'YES' : 'NO'),
        escapeCsv(row.is_incomplete ? 'YES' : 'NO'),
        escapeCsv(reasonsStr),
        escapeCsv(row.inventory_match_status),
        escapeCsv(row.inventory_device_name),
        escapeCsv(row.department_location),
        escapeCsv(row.inventory_expected_ip),
        escapeCsv(row.registered_device_name),
        escapeCsv(row.registered_contact_person || ''),
        escapeCsv(row.registered_device_type),
        escapeCsv(row.ping_status ? row.ping_status.toUpperCase() : 'UNKNOWN / NOT PROBED'),
        escapeCsv(row.ping_latency !== null && row.ping_latency !== undefined ? row.ping_latency : ''),
        escapeCsv(row.ping_checked_at ? new Date(row.ping_checked_at).toLocaleString() : ''),
        escapeCsv(row.discovered_at ? new Date(row.discovered_at).toLocaleString() : ''),
        escapeCsv(effectivePollTimeStr)
      ];
      csvContent += cols.join(',') + '\r\n';
    }

    res.send(csvContent);
  } catch (err) {
    console.error('Verified export failed:', err.message);
    res.status(500).json({ error: 'Could not export verified snapshot' });
  }
}
router.get('/api/arp/snapshots/:id/verified-export', handleVerifiedExport);

// ---------------------------------------------------------------------
// 5f. GET /api/arp/snapshots/compare/export
// Download snapshot delta comparison as CSV or JSON
// ---------------------------------------------------------------------
router.get('/api/arp/snapshots/compare/export', async (req, res) => {
  try {
    setNoCacheHeaders(res);

    let { base_id, target_id, format } = req.query;
    if (!base_id || !target_id) {
      const snapsRes = await pool.query('SELECT id FROM arp_snapshots ORDER BY id DESC LIMIT 2');
      if (snapsRes.rows.length < 2) return res.status(400).json({ error: 'At least two snapshots required' });
      target_id = snapsRes.rows[0].id;
      base_id = snapsRes.rows[1].id;
    }

    const { compareSnapshots } = require('./sophos_arp_service');
    const diff = await compareSnapshots(Number(base_id), Number(target_id));
    const exportFormat = (format || 'csv').toLowerCase();
    const dateStr = new Date().toISOString().slice(0, 10);

    if (exportFormat === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="snapshot_comparison_${base_id}_vs_${target_id}_${dateStr}.json"`);
      return res.json(diff);
    }

    // CSV format
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="snapshot_comparison_${base_id}_vs_${target_id}_${dateStr}.csv"`);

    let csv = '\uFEFF' + ['Delta Category', 'IP Address', 'MAC Address', 'Interface', 'Previous Value', 'Current Value', 'Observed At / Note'].join(',') + '\r\n';

    for (const item of (diff.newMacs || [])) {
      csv += ['NEW_DISCOVERY', escapeCsv(item.ip_address), escapeCsv(item.mac_address), escapeCsv(item.interface), '-', 'Observed in target', escapeCsv(item.discovered_at || '')].join(',') + '\r\n';
    }
    for (const item of (diff.changedIpToMac || [])) {
      csv += ['IP_TO_MAC_CHANGE', escapeCsv(item.ip_address), escapeCsv(item.current_mac), escapeCsv(item.current_interface), escapeCsv(item.previous_mac), escapeCsv(item.current_mac), escapeCsv(item.observed_at || '')].join(',') + '\r\n';
    }
    for (const item of (diff.changedMacToIp || [])) {
      csv += ['MAC_TO_IP_CHANGE', escapeCsv(item.current_ip), escapeCsv(item.mac_address), escapeCsv(item.current_interface), escapeCsv(item.previous_ip), escapeCsv(item.current_ip), escapeCsv(item.observed_at || '')].join(',') + '\r\n';
    }
    for (const item of (diff.interfaceChanges || [])) {
      csv += ['INTERFACE_CHANGE', escapeCsv(item.ip_address), escapeCsv(item.mac_address), escapeCsv(item.current_interface), escapeCsv(item.previous_interface), escapeCsv(item.current_interface), escapeCsv(item.observed_at || '')].join(',') + '\r\n';
    }
    for (const item of (diff.arpStateChanges || [])) {
      csv += ['ARP_STATE_CHANGE', escapeCsv(item.ip_address), escapeCsv(item.mac_address), escapeCsv(item.interface), escapeCsv(item.previous_state), escapeCsv(item.current_state), escapeCsv(item.observed_at || '')].join(',') + '\r\n';
    }
    for (const item of (diff.unobserved || [])) {
      csv += ['UNOBSERVED', escapeCsv(item.ip_address), escapeCsv(item.mac_address), escapeCsv(item.interface), 'Present in base snapshot', 'Unobserved in target', escapeCsv(item.note)].join(',') + '\r\n';
    }

    res.send(csv);
  } catch (err) {
    console.error('Comparison export failed:', err.message);
    res.status(500).json({ error: 'Could not export comparison diff' });
  }
});

// ---------------------------------------------------------------------
// 5g. GET /api/arp/snapshots/:id/export (Legacy compatibility)
// ---------------------------------------------------------------------
router.get('/api/arp/snapshots/:id/export', handleVerifiedExport);

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
// List discoveries with comprehensive verification, inventory, and ping reachability filters
// ---------------------------------------------------------------------
router.get('/api/arp/discoveries', async (req, res) => {
  try {
    const {
      snapshot_id,
      match_status,
      interface: iface,
      arp_state,
      search,
      verification_status,
      has_conflict,
      ping_status,
      registered_match
    } = req.query;

    let targetSnapshotId = snapshot_id ? Number(snapshot_id) : null;
    if (!targetSnapshotId) {
      const latestSnapRes = await pool.query('SELECT id FROM arp_snapshots ORDER BY id DESC LIMIT 1');
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
        d.is_valid_ipv4,
        d.is_valid_mac,
        d.is_incomplete,
        d.is_duplicate_ip,
        d.is_duplicate_mac,
        d.has_conflict,
        d.verification_status,
        d.verification_reasons,
        d.discovered_at,
        inv.device_name AS inventory_device_name,
        inv.department_location AS inventory_location,
        inv.site_station AS inventory_site,
        inv.expected_ip AS inventory_expected_ip,
        reg.id AS registered_device_id,
        reg.name AS registered_device_name,
        reg.device_type AS registered_device_type,
        reg.contact_person AS registered_contact_person,
        reg.contact_phone AS registered_contact_phone,
        p.status AS ping_status,
        p.latency_ms AS ping_latency,
        p.checked_at AS ping_checked_at,
        s.snapshot_name
      FROM arp_discoveries d
      JOIN arp_snapshots s ON s.id = d.snapshot_id
      LEFT JOIN mac_inventory inv ON inv.id = d.matched_inventory_id
      LEFT JOIN devices reg ON (
        (d.normalized_mac IS NOT NULL AND reg.mac_address IS NOT NULL AND LOWER(REGEXP_REPLACE(reg.mac_address, '[^a-fA-F0-9]', '', 'g')) = d.normalized_mac)
        OR (inv.device_id IS NOT NULL AND reg.id = inv.device_id)
      )
      LEFT JOIN LATERAL (
        SELECT status, latency_ms, checked_at
        FROM status_history
        WHERE device_id = reg.id
        ORDER BY checked_at DESC
        LIMIT 1
      ) p ON true
      WHERE d.snapshot_id = $1
      ORDER BY d.ip_address ASC, d.id ASC
    `;

    const result = await pool.query(query, [targetSnapshotId]);
    let items = result.rows;

    // Clean and validate query parameters
    const cleanSearch = (search && search !== 'undefined' && search !== 'null' && search.trim()) ? search.trim().toLowerCase() : null;
    const cleanMatch = (match_status && match_status !== 'ALL' && match_status !== 'undefined' && match_status !== 'null') ? match_status : null;
    const cleanIface = (iface && iface !== 'ALL' && iface !== 'undefined' && iface !== 'null') ? iface : null;
    const cleanState = (arp_state && arp_state !== 'ALL' && arp_state !== 'undefined' && arp_state !== 'null') ? arp_state : null;
    const cleanVerif = (verification_status && verification_status !== 'ALL' && verification_status !== 'undefined' && verification_status !== 'null') ? verification_status : null;
    const cleanPing = (ping_status && ping_status !== 'ALL' && ping_status !== 'undefined' && ping_status !== 'null') ? ping_status.toUpperCase() : null;

    if (cleanSearch) {
      items = items.filter(i =>
        (i.ip_address && i.ip_address.toLowerCase().includes(cleanSearch)) ||
        (i.mac_address && i.mac_address.toLowerCase().includes(cleanSearch)) ||
        (i.normalized_mac && i.normalized_mac.toLowerCase().includes(cleanSearch)) ||
        (i.interface && i.interface.toLowerCase().includes(cleanSearch)) ||
        (i.inventory_device_name && i.inventory_device_name.toLowerCase().includes(cleanSearch)) ||
        (i.registered_device_name && i.registered_device_name.toLowerCase().includes(cleanSearch)) ||
        (i.registered_contact_person && i.registered_contact_person.toLowerCase().includes(cleanSearch)) ||
        (i.inventory_location && i.inventory_location.toLowerCase().includes(cleanSearch))
      );
    }

    if (cleanVerif) {
      items = items.filter(i => (i.verification_status || '').toLowerCase() === cleanVerif.toLowerCase());
    }

    if (has_conflict && has_conflict !== 'ALL') {
      const conflictBool = has_conflict === 'true' || has_conflict === true;
      items = items.filter(i => Boolean(i.has_conflict) === conflictBool);
    }

    if (registered_match && registered_match !== 'ALL') {
      const isReg = registered_match === 'yes' || registered_match === 'true';
      items = items.filter(i => Boolean(i.registered_device_id) === isReg);
    }

    if (cleanPing) {
      if (cleanPing === 'UNKNOWN') {
        items = items.filter(i => !i.ping_status || i.ping_status.toUpperCase() === 'UNKNOWN');
      } else {
        items = items.filter(i => (i.ping_status || '').toUpperCase() === cleanPing);
      }
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
    const verifiedCount = result.rows.filter(i => i.verification_status === 'verified').length;
    const incompleteCount = result.rows.filter(i => i.verification_status === 'verified_incomplete').length;
    const flaggedCount = result.rows.filter(i => i.verification_status === 'flagged').length;
    const rejectedCount = result.rows.filter(i => i.verification_status === 'rejected').length;
    const matchedCount = result.rows.filter(i => i.match_status === 'matched').length;
    const unmatchedCount = result.rows.filter(i => i.match_status === 'unmatched').length;
    const noMacCount = result.rows.filter(i => i.match_status === 'no_mac').length;

    res.json({
      items,
      filteredCount: items.length,
      summary: {
        total_entries: totalCount,
        verified: verifiedCount,
        verified_incomplete: incompleteCount,
        flagged: flaggedCount,
        rejected: rejectedCount,
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
