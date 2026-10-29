const pool = require('./db');
const { normalizeMac, formatMac } = require('./inventory_service');

function parseCSVLine(line) {
  const parts = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current.trim());
  return parts;
}

function normalizeHeader(name) {
  if (!name || typeof name !== 'string') return '';
  return name
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function parseArpSnapshot(rawText) {
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) {
    throw new Error('Snapshot content is empty');
  }

  const entries = [];
  const firstLineNorm = normalizeHeader(lines[0]);

  // Format 1: CSV with headers (e.g. ip_address,mac_address,interface,state,has_mac,router_entry)
  if (firstLineNorm.includes('ip') || firstLineNorm.includes('mac') || firstLineNorm.includes('interface')) {
    const rawHeaders = parseCSVLine(lines[0]);
    const header = rawHeaders.map(normalizeHeader);
    const ipIdx = header.findIndex(h => h === 'ip_address' || h === 'ip' || h.includes('ip'));
    const macIdx = header.findIndex(h => h === 'mac_address' || h === 'mac' || h.includes('mac') || h.includes('lladdr'));
    const ifaceIdx = header.findIndex(h => h.includes('interface') || h.includes('dev') || h.includes('port'));
    const stateIdx = header.findIndex(h => h.includes('state') || h.includes('status'));
    const routerIdx = header.findIndex(h => h.includes('router'));

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      if (cols.length <= 1) continue;

      const ip = cols[ipIdx] || '';
      const rawMac = cols[macIdx] || '';
      const iface = cols[ifaceIdx] || 'Unknown';
      const state = (cols[stateIdx] || 'UNKNOWN').toUpperCase();
      const isRouter = routerIdx !== -1 ? (cols[routerIdx] || '').toLowerCase() === 'yes' : false;

      const norm = normalizeMac(rawMac);
      const hasMac = Boolean(norm);

      entries.push({
        ip_address: ip,
        mac_address: hasMac ? formatMac(norm) : null,
        normalized_mac: norm,
        interface: iface || 'Unknown',
        arp_state: state || (hasMac ? 'REACHABLE' : 'FAILED'),
        has_mac: hasMac,
        is_router_entry: isRouter
      });
    }
  } else {
    // Format 2: Linux / Sophos CLI "ip neigh show" format
    // Example: "10.112.22.157 dev Port3 lladdr 40:c2:ba:bd:82:11 REACHABLE"
    // Example: "192.168.40.16 dev Port1 FAILED"
    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length < 2) continue;

      const ip = parts[0];
      let iface = 'Unknown';
      let rawMac = null;
      let state = 'UNKNOWN';
      let isRouter = false;

      for (let j = 1; j < parts.length; j++) {
        if (parts[j] === 'dev' && parts[j + 1]) {
          iface = parts[j + 1];
        } else if (parts[j] === 'lladdr' && parts[j + 1]) {
          rawMac = parts[j + 1];
        } else if (['REACHABLE', 'STALE', 'DELAY', 'PROBE', 'PERMANENT', 'INCOMPLETE', 'FAILED', 'NOARP'].includes(parts[j].toUpperCase())) {
          state = parts[j].toUpperCase();
        } else if (parts[j].toLowerCase() === 'router') {
          isRouter = true;
        }
      }

      const norm = normalizeMac(rawMac);
      const hasMac = Boolean(norm);

      entries.push({
        ip_address: ip,
        mac_address: hasMac ? formatMac(norm) : null,
        normalized_mac: norm,
        interface: iface,
        arp_state: state,
        has_mac: hasMac,
        is_router_entry: isRouter
      });
    }
  }

  return entries;
}

async function importArpSnapshot(rawContent, snapshotName = 'Sophos XGS2100 Snapshot') {
  const entries = parseArpSnapshot(rawContent);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Load entire MAC inventory into lookup map
    const invRes = await client.query('SELECT id, normalized_mac, device_name, department_location FROM mac_inventory');
    const invMap = new Map();
    invRes.rows.forEach(row => {
      invMap.set(row.normalized_mac, row);
    });

    // 2. Insert snapshot metadata
    const snapInsert = await client.query(
      `INSERT INTO arp_snapshots
        (snapshot_name, source_device, total_entries, notes)
       VALUES ($1, 'Sophos XGS2100', $2, $3)
       RETURNING id`,
      [snapshotName, entries.length, `Imported ${entries.length} neighbor entries`]
    );
    const snapshotId = snapInsert.rows[0].id;

    let entriesWithMac = 0;
    let matchedInventoryCount = 0;
    let unmatchedCount = 0;
    let invalidEntriesCount = 0;
    const matchedInventoryIds = new Set();

    // 3. Insert each discovery row
    for (const e of entries) {
      let matchStatus = 'unmatched';
      let matchedInvId = null;

      if (!e.has_mac) {
        matchStatus = 'no_mac';
        invalidEntriesCount++;
      } else {
        entriesWithMac++;
        if (invMap.has(e.normalized_mac)) {
          matchStatus = 'matched';
          matchedInvId = invMap.get(e.normalized_mac).id;
          matchedInventoryIds.add(matchedInvId);
        } else {
          unmatchedCount++;
        }
      }

      await client.query(
        `INSERT INTO arp_discoveries
          (snapshot_id, ip_address, mac_address, normalized_mac,
           interface, arp_state, is_router_entry, has_mac,
           matched_inventory_id, match_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          snapshotId,
          e.ip_address,
          e.mac_address,
          e.normalized_mac,
          e.interface,
          e.arp_state,
          e.is_router_entry,
          e.has_mac,
          matchedInvId,
          matchStatus
        ]
      );
    }

    matchedInventoryCount = matchedInventoryIds.size;

    // 4. Update snapshot summary metrics
    await client.query(
      `UPDATE arp_snapshots SET
        entries_with_mac = $1,
        matched_inventory_count = $2,
        unmatched_count = $3,
        invalid_entries_count = $4
       WHERE id = $5`,
      [
        entriesWithMac,
        matchedInventoryCount,
        unmatchedCount,
        invalidEntriesCount,
        snapshotId
      ]
    );

    await client.query('COMMIT');

    return {
      success: true,
      snapshotId,
      snapshotName,
      totalEntries: entries.length,
      entriesWithMac,
      matchedInventoryCount,
      unmatchedCount,
      invalidEntriesCount,
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Import ARP snapshot failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

async function getLatestSnapshotSummary() {
  const latestSnapRes = await pool.query(
    'SELECT * FROM arp_snapshots ORDER BY imported_at DESC LIMIT 1'
  );
  if (latestSnapRes.rows.length === 0) {
    return null;
  }
  const snap = latestSnapRes.rows[0];

  const totalInvRes = await pool.query('SELECT count(*) FROM mac_inventory');
  const totalInventory = Number(totalInvRes.rows[0].count);

  return {
    ...snap,
    total_inventory: totalInventory,
    unobserved_inventory_count: Math.max(0, totalInventory - snap.matched_inventory_count)
  };
}

module.exports = {
  parseArpSnapshot,
  importArpSnapshot,
  getLatestSnapshotSummary
};
