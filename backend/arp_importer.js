/**
 * Sophos ARP Snapshot Importer
 * 
 * Safely parses, validates, and imports Sophos ARP / Neighbor snapshots
 * into the PostgreSQL database (`arp_snapshots` and `arp_discoveries`).
 * Matches discovered devices against `mac_inventory` on normalized MAC.
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
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

function parseCSVOrCLI(rawText) {
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return null;

  const entries = [];
  const firstLineNorm = lines[0].toLowerCase();

  if (firstLineNorm.includes('ip') || firstLineNorm.includes('mac') || firstLineNorm.includes('interface')) {
    const rawHeaders = parseCSVLine(lines[0]);
    const header = rawHeaders.map(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g, '_'));
    const ipIdx = header.findIndex(h => h === 'ip_address' || h === 'ip' || h.includes('ip'));
    const macIdx = header.findIndex(h => h === 'mac_address' || h === 'mac' || h.includes('mac') || h.includes('lladdr'));
    const ifaceIdx = header.findIndex(h => h.includes('interface') || h.includes('dev') || h.includes('port'));
    const stateIdx = header.findIndex(h => h.includes('state') || h.includes('status'));
    const routerIdx = header.findIndex(h => h.includes('router'));

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      if (cols.length <= 1) continue;

      entries.push({
        ip: cols[ipIdx] || '',
        mac: cols[macIdx] || '',
        interface: cols[ifaceIdx] || 'Unknown',
        state: (cols[stateIdx] || 'UNKNOWN').toUpperCase(),
        is_router_entry: routerIdx !== -1 ? (cols[routerIdx] || '').toLowerCase() === 'yes' : false
      });
    }
  } else {
    // Linux / Sophos CLI "ip neigh show" format
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

      entries.push({
        ip,
        mac: rawMac,
        interface: iface,
        state,
        is_router_entry: isRouter
      });
    }
  }

  return entries.length > 0 ? entries : null;
}

/**
 * Parses and validates an ARP snapshot from:
 * - A file path (canonical: sophos-arp-test/arp-snapshot.json or CSV)
 * - A JSON string or CSV string
 * - A JavaScript object
 * 
 * @param {string|object} input 
 * @returns {object} { metadata, entries, stats }
 */
function parseArpSnapshot(input) {
  let rawData;
  let sourceFilePath = null;

  if (typeof input === 'object' && input !== null) {
    rawData = input;
  } else if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        rawData = JSON.parse(trimmed);
      } catch (err) {
        throw new Error(`Failed to parse ARP snapshot JSON string: ${err.message}`);
      }
    } else {
      sourceFilePath = path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
      if (fs.existsSync(sourceFilePath)) {
        const fileContent = fs.readFileSync(sourceFilePath, 'utf8');
        try {
          rawData = JSON.parse(fileContent);
        } catch (jsonErr) {
          const csvEntries = parseCSVOrCLI(fileContent);
          if (csvEntries) {
            rawData = { entries: csvEntries, source: 'CSV File Export' };
          } else {
            throw new Error(`Failed to read/parse snapshot at ${sourceFilePath}: ${jsonErr.message}`);
          }
        }
      } else {
        // Not a file, check if raw string is CSV or CLI content
        const csvEntries = parseCSVOrCLI(trimmed);
        if (csvEntries) {
          rawData = { entries: csvEntries, source: 'Raw Text Input' };
        } else {
          throw new Error(`ARP snapshot file not found or invalid format: ${trimmed.substring(0, 50)}`);
        }
      }
    }
  } else {
    throw new Error('Invalid input: expected file path, JSON string, or object');
  }

  // Extract metadata and entries
  let rawEntries = [];
  let metadata = {
    sourceFilePath,
    extractedAt: null,
    source: 'Sophos IPv4 Neighbor Cache',
    totalEntries: 0
  };

  if (Array.isArray(rawData)) {
    rawEntries = rawData;
    metadata.totalEntries = rawEntries.length;
  } else if (rawData && typeof rawData === 'object') {
    metadata.extractedAt = rawData.extractedAt || null;
    metadata.source = rawData.source || 'Sophos IPv4 Neighbor Cache';
    if (Array.isArray(rawData.entries)) {
      rawEntries = rawData.entries;
      metadata.totalEntries = rawData.totalEntries || rawEntries.length;
    } else {
      throw new Error('Invalid snapshot structure: missing "entries" array');
    }
  }

  const parsedEntries = [];
  let entriesWithMac = 0;
  let incompleteCount = 0;
  let invalidIpCount = 0;

  for (let i = 0; i < rawEntries.length; i++) {
    const item = rawEntries[i];
    if (!item || typeof item !== 'object') continue;

    const rawIpStr = (item.ip !== undefined && item.ip !== null)
      ? item.ip.toString().trim()
      : (item.ip_address !== undefined && item.ip_address !== null ? item.ip_address.toString().trim() : '');
    const rawIp = rawIpStr.length > 0 ? rawIpStr : null;

    const rawMac = (item.mac || item.mac_address || '').toString().trim();
    const iface = (item.interface || item.iface || 'Unknown').toString().trim();
    const state = (item.state || item.arp_state || 'UNKNOWN').toString().trim();
    const isRouter = Boolean(
      item.is_router_entry || 
      (typeof state === 'string' && state.toLowerCase().includes('router'))
    );

    // Validate IPv4
    const isValidIp = rawIp !== null && net.isIPv4(rawIp);
    if (!isValidIp) {
      invalidIpCount++;
    }

    // Normalize and validate MAC
    // Incomplete entries have mac: '-' or empty, state: 'Incomplete'
    const isExplicitIncomplete = rawMac === '-' || state.toLowerCase().includes('incomplete');
    const normMac = isExplicitIncomplete ? null : normalizeMac(rawMac);
    const hasMac = Boolean(normMac);

    let macAddress = null;
    let normalizedMac = null;
    let arpState = state || 'UNKNOWN';

    if (hasMac) {
      macAddress = formatMac(normMac);
      normalizedMac = normMac;
      entriesWithMac++;
    } else {
      incompleteCount++;
      if (rawMac === '-' && (!state || state === 'UNKNOWN')) {
        arpState = 'Incomplete';
      }
    }

    parsedEntries.push({
      ip_address: rawIp,
      mac_address: macAddress,
      normalized_mac: normalizedMac,
      interface: iface || 'Unknown',
      arp_state: arpState,
      is_router_entry: isRouter,
      has_mac: hasMac,
      is_valid_ip: isValidIp
    });
  }

  return {
    metadata,
    entries: parsedEntries,
    stats: {
      total: parsedEntries.length,
      withMac: entriesWithMac,
      incomplete: incompleteCount,
      invalidIp: invalidIpCount
    }
  };
}

/**
 * Imports an ARP snapshot into the database using a transaction.
 * 
 * @param {string|object} input - Snapshot file path, JSON string, or object
 * @param {object} options
 * @param {string} [options.snapshotName] - Custom snapshot name
 * @param {string} [options.sourceDevice='Sophos XGS2100'] - Source device name
 * @param {string} [options.notes] - Additional notes
 * @param {object} [options.client] - Existing pg.Client (for testing/custom tx)
 * @param {boolean} [options.dryRun=false] - If true, rolls back transaction
 * @returns {Promise<object>} Import result summary
 */
async function importArpSnapshot(input, options = {}) {
  const parsed = parseArpSnapshot(input);
  const { entries, metadata, stats } = parsed;

  const defaultName = metadata.extractedAt 
    ? `Sophos Snapshot ${new Date(metadata.extractedAt).toLocaleString()}`
    : `Sophos Snapshot ${new Date().toLocaleString()}`;

  const snapshotName = options.snapshotName || defaultName;
  const sourceDevice = options.sourceDevice || metadata.source || 'Sophos XGS2100';
  const notes = options.notes || `Imported ${entries.length} entries (${stats.withMac} with MAC, ${stats.incomplete} incomplete)`;
  const dryRun = Boolean(options.dryRun);

  const isExternalClient = Boolean(options.client);
  const client = options.client || await pool.connect();

  try {
    if (!isExternalClient) {
      await client.query('BEGIN');
    }

    // 1. Fetch current MAC inventory lookup map (read-only, does not mutate inventory)
    const invRes = await client.query(
      'SELECT id, normalized_mac, device_name, department_location FROM mac_inventory WHERE normalized_mac IS NOT NULL'
    );
    const invMap = new Map();
    invRes.rows.forEach(row => {
      invMap.set(row.normalized_mac, row);
    });

    // 2. Insert arp_snapshots row
    const snapInsert = await client.query(
      `INSERT INTO arp_snapshots
        (snapshot_name, source_device, total_entries, notes)
       VALUES ($1, $2, $3, $4)
       RETURNING id, imported_at`,
      [snapshotName, sourceDevice, entries.length, notes]
    );
    const snapshotId = snapInsert.rows[0].id;
    const importedAt = snapInsert.rows[0].imported_at;

    let entriesWithMac = 0;
    let unmatchedCount = 0;
    let invalidEntriesCount = 0;
    const matchedInventoryIds = new Set();

    // Prepare discovery records with match evaluation
    const discoveryRows = entries.map(e => {
      let matchStatus = 'unmatched';
      let matchedInvId = null;

      if (!e.is_valid_ip) {
        matchStatus = 'invalid_ip';
        invalidEntriesCount++;
      } else if (!e.has_mac) {
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

      return {
        snapshot_id: snapshotId,
        ip_address: e.ip_address,
        mac_address: e.mac_address,
        normalized_mac: e.normalized_mac,
        interface: e.interface,
        arp_state: e.arp_state,
        is_router_entry: e.is_router_entry,
        has_mac: e.has_mac,
        matched_inventory_id: matchedInvId,
        match_status: matchStatus
      };
    });

    // 3. Batch insert discoveries in chunks of 50
    const CHUNK_SIZE = 50;
    for (let i = 0; i < discoveryRows.length; i += CHUNK_SIZE) {
      const chunk = discoveryRows.slice(i, i + CHUNK_SIZE);
      const valuePlaceholders = [];
      const params = [];
      let paramIdx = 1;

      for (const row of chunk) {
        valuePlaceholders.push(
          `($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3}, $${paramIdx+4}, $${paramIdx+5}, $${paramIdx+6}, $${paramIdx+7}, $${paramIdx+8}, $${paramIdx+9})`
        );
        params.push(
          row.snapshot_id,
          row.ip_address,
          row.mac_address,
          row.normalized_mac,
          row.interface,
          row.arp_state,
          row.is_router_entry,
          row.has_mac,
          row.matched_inventory_id,
          row.match_status
        );
        paramIdx += 10;
      }

      const query = `
        INSERT INTO arp_discoveries
          (snapshot_id, ip_address, mac_address, normalized_mac,
           interface, arp_state, is_router_entry, has_mac,
           matched_inventory_id, match_status)
        VALUES ${valuePlaceholders.join(', ')}
      `;
      await client.query(query, params);
    }

    const matchedInventoryCount = matchedInventoryIds.size;

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

    // 5. Upsert eligible discoveries into persistent discovered_devices table
    await syncDiscoveredDevicesFromSnapshot(snapshotId, client);

    if (dryRun) {
      if (!isExternalClient) {
        await client.query('ROLLBACK');
      }
    } else if (!isExternalClient) {
      await client.query('COMMIT');
    }

    return {
      success: true,
      snapshotId,
      snapshotName,
      sourceDevice,
      importedAt,
      dryRun,
      totalEntries: entries.length,
      entriesWithMac,
      matchedInventoryCount,
      unmatchedCount,
      invalidEntriesCount,
      totalInventoryRecords: invRes.rows.length,
      unobservedInventoryCount: Math.max(0, invRes.rows.length - matchedInventoryCount)
    };
  } catch (err) {
    if (!isExternalClient) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {
        // Ignore rollback failure if already closed
      }
    }
    throw err;
  } finally {
    if (!isExternalClient) {
      client.release();
    }
  }
}

/**
 * Gets the latest snapshot summary along with inventory coverage metrics.
 */
async function getLatestSnapshotSummary() {
  const latestRes = await pool.query(
    'SELECT * FROM arp_snapshots ORDER BY imported_at DESC, id DESC LIMIT 1'
  );
  if (latestRes.rows.length === 0) {
    return null;
  }
  const snap = latestRes.rows[0];

  const invCountRes = await pool.query('SELECT count(*) FROM mac_inventory');
  const totalInventory = parseInt(invCountRes.rows[0].count, 10);

  return {
    ...snap,
    total_inventory: totalInventory,
    unobserved_inventory_count: Math.max(0, totalInventory - snap.matched_inventory_count)
  };
}

/**
 * Gets full details and discovery entries for a specific snapshot.
 * 
 * @param {number} snapshotId 
 * @param {object} [filter] Optional filter options { matchStatus, interface }
 */
async function getSnapshotDetails(snapshotId, filter = {}) {
  const snapRes = await pool.query('SELECT * FROM arp_snapshots WHERE id = $1', [snapshotId]);
  if (snapRes.rows.length === 0) {
    return null;
  }
  const snapshot = snapRes.rows[0];

  let query = `
    SELECT d.*, m.device_name, m.site_station, m.department_location, m.device_type
    FROM arp_discoveries d
    LEFT JOIN mac_inventory m ON d.matched_inventory_id = m.id
    WHERE d.snapshot_id = $1
  `;
  const params = [snapshotId];

  if (filter.matchStatus) {
    params.push(filter.matchStatus);
    query += ` AND d.match_status = $${params.length}`;
  }

  if (filter.interface) {
    params.push(filter.interface);
    query += ` AND d.interface = $${params.length}`;
  }

  query += ` ORDER BY d.ip_address ASC`;

  const discoveriesRes = await pool.query(query, params);

  return {
    snapshot,
    discoveries: discoveriesRes.rows,
    totalReturned: discoveriesRes.rows.length
  };
}

/**
 * Synchronizes eligible discoveries (valid IPv4 and valid MAC) from a snapshot
 * into the discovered_devices table.
 * Preserves user-assigned custom_name, device_type, department, building_location, notes,
 * ping telemetry, and registered_device_id.
 */
async function syncDiscoveredDevicesFromSnapshot(snapshotId, client) {
  const db = client || pool;

  // Auto-assign firewall discovered IP to registered devices that have matching MAC but no IP yet
  try {
    await db.query(
      `UPDATE devices dev
       SET ip_address = d.ip_address
       FROM arp_discoveries d
       WHERE d.snapshot_id = $1
         AND d.has_mac = TRUE
         AND d.normalized_mac IS NOT NULL
         AND dev.mac_address IS NOT NULL
         AND dev.ip_address IS NULL
         AND UPPER(REPLACE(REPLACE(dev.mac_address, ':', ''), '-', '')) = d.normalized_mac
         AND NOT EXISTS (SELECT 1 FROM devices d2 WHERE d2.ip_address = d.ip_address AND d2.id != dev.id)`,
      [snapshotId]
    );
  } catch (syncErr) {
    console.warn('Warning during registered device IP auto-assignment:', syncErr.message);
  }

  const discRes = await db.query(
    `SELECT d.ip_address, d.mac_address, d.normalized_mac, d.interface, d.arp_state,
            d.matched_inventory_id, dev.id AS registered_device_id
     FROM arp_discoveries d
     LEFT JOIN devices dev ON (
       (dev.ip_address IS NOT NULL AND dev.ip_address = d.ip_address)
       OR (d.normalized_mac IS NOT NULL AND dev.mac_address IS NOT NULL AND UPPER(REPLACE(REPLACE(dev.mac_address, ':', ''), '-', '')) = d.normalized_mac)
     )
     WHERE d.snapshot_id = $1 AND d.has_mac = TRUE AND d.normalized_mac IS NOT NULL`,
    [snapshotId]
  );

  for (const row of discRes.rows) {
    await db.query(
      `INSERT INTO discovered_devices
        (ip_address, mac_address, normalized_mac, interface, arp_state,
         snapshot_id, matched_inventory_id, registered_device_id, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (ip_address) DO UPDATE SET
         mac_address = EXCLUDED.mac_address,
         normalized_mac = EXCLUDED.normalized_mac,
         interface = EXCLUDED.interface,
         arp_state = EXCLUDED.arp_state,
         snapshot_id = EXCLUDED.snapshot_id,
         matched_inventory_id = EXCLUDED.matched_inventory_id,
         registered_device_id = COALESCE(discovered_devices.registered_device_id, EXCLUDED.registered_device_id),
         last_seen_at = NOW(),
         updated_at = NOW()`,
      [
        row.ip_address,
        row.mac_address,
        row.normalized_mac,
        row.interface,
        row.arp_state,
        snapshotId,
        row.matched_inventory_id,
        row.registered_device_id
      ]
    );
  }

  return { syncedCount: discRes.rows.length };
}

// CLI Execution support
if (require.main === module) {
  (async () => {
    try {
      const args = process.argv.slice(2);
      const dryRun = args.includes('--dry-run');
      const fileArg = args.find(a => !a.startsWith('--'));

      const defaultPath = path.resolve(__dirname, '../sophos-arp-test/arp-snapshot.json');
      const targetFile = fileArg || defaultPath;

      console.log(`\n======================================================`);
      console.log(` Sophos ARP Snapshot Importer (CLI)`);
      console.log(` Target File: ${targetFile}`);
      console.log(` Mode:        ${dryRun ? 'DRY-RUN (Transaction will ROLLBACK)' : 'LIVE IMPORT (Transaction will COMMIT)'}`);
      console.log(`======================================================\n`);

      const result = await importArpSnapshot(targetFile, { dryRun });

      console.log(`Import Result Summary:`);
      console.log(`------------------------------------------------------`);
      console.log(` Snapshot ID:             ${result.snapshotId}`);
      console.log(` Snapshot Name:           ${result.snapshotName}`);
      console.log(` Total Entries Processed: ${result.totalEntries}`);
      console.log(` Entries with MAC:        ${result.entriesWithMac}`);
      console.log(` Incomplete / No MAC:     ${result.invalidEntriesCount}`);
      console.log(` Matched Inventory Items: ${result.matchedInventoryCount} (out of ${result.totalInventoryRecords} total)`);
      console.log(` Unmatched Discovered:    ${result.unmatchedCount}`);
      console.log(` Unobserved Inventory:    ${result.unobservedInventoryCount}`);
      console.log(` Status:                  ${result.dryRun ? 'Rolled back (DRY-RUN)' : 'Successfully Committed'}`);
      console.log(`------------------------------------------------------\n`);

      process.exit(0);
    } catch (err) {
      console.error('\n[ERROR] ARP Import failed:', err.message);
      process.exit(1);
    } finally {
      await pool.end();
    }
  })();
}

module.exports = {
  parseArpSnapshot,
  importArpSnapshot,
  getLatestSnapshotSummary,
  getSnapshotDetails,
  syncDiscoveredDevicesFromSnapshot
};

