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

  // Detect duplicate IPs and MACs within snapshot
  const seenIps = new Set();
  const seenMacs = new Set();
  let duplicateCount = 0;
  for (const item of parsedEntries) {
    if (item.ip_address) {
      if (seenIps.has(item.ip_address)) duplicateCount++;
      else seenIps.add(item.ip_address);
    }
    if (item.normalized_mac) {
      if (seenMacs.has(item.normalized_mac)) duplicateCount++;
      else seenMacs.add(item.normalized_mac);
    }
  }

  return {
    metadata,
    entries: parsedEntries,
    rawEntries,
    stats: {
      total: parsedEntries.length,
      withMac: entriesWithMac,
      incomplete: incompleteCount,
      invalidIp: invalidIpCount,
      duplicateCount
    },
    telemetry: {
      duplicateCount,
      totalRawEntries: rawEntries.length
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

    // 1. Fetch current MAC inventory and registered devices lookup maps
    const invRes = await client.query(
      'SELECT id, normalized_mac, device_name, department_location, expected_ip FROM mac_inventory WHERE normalized_mac IS NOT NULL'
    );
    const invMap = new Map();
    invRes.rows.forEach(row => {
      invMap.set(row.normalized_mac, row);
    });

    const devRes = await client.query(
      'SELECT id, name, ip_address, mac_address FROM devices'
    );
    const devByIp = new Map();
    const devByMac = new Map();
    devRes.rows.forEach(row => {
      if (row.ip_address) devByIp.set(row.ip_address, row);
      if (row.mac_address) {
        const norm = normalizeMac(row.mac_address);
        if (norm) devByMac.set(norm, row);
      }
    });

    // Compute intra-snapshot duplicate IPs and duplicate MACs
    const ipCountMap = new Map();
    const macToIpsMap = new Map();
    for (const e of entries) {
      if (e.ip_address) {
        ipCountMap.set(e.ip_address, (ipCountMap.get(e.ip_address) || 0) + 1);
      }
      if (e.normalized_mac) {
        if (!macToIpsMap.has(e.normalized_mac)) {
          macToIpsMap.set(e.normalized_mac, new Set());
        }
        if (e.ip_address) {
          macToIpsMap.get(e.normalized_mac).add(e.ip_address);
        }
      }
    }

    // Telemetry and integrity metadata
    const rawList = options.rawPayload || parsed.rawEntries || null;
    const telem = options.telemetry || {};
    const totalRawEntries = telem.totalRawEntries || (rawList ? rawList.length : entries.length);
    const validIpCount = telem.validIpCount !== undefined ? telem.validIpCount : entries.filter(e => e.is_valid_ip).length;
    const validMacCount = telem.validMacCount !== undefined ? telem.validMacCount : entries.filter(e => e.has_mac).length;
    const incompleteCount = telem.incompleteCount !== undefined ? telem.incompleteCount : entries.filter(e => !e.has_mac || (e.arp_state && e.arp_state.toLowerCase().includes('incomplete'))).length;
    const invalidCount = telem.invalidCount !== undefined ? telem.invalidCount : entries.filter(e => !e.is_valid_ip).length;
    const duplicateCount = telem.duplicateCount !== undefined ? telem.duplicateCount : Math.max(0, totalRawEntries - entries.length);
    const extractionDurationMs = telem.durationMs || 0;
    const totalPagesDetected = telem.totalPagesDetected || 1;
    const pagesVisited = telem.pagesVisited || 1;
    const paginationCompleted = telem.paginationCompleted !== undefined ? telem.paginationCompleted : true;
    const pageRowsJson = JSON.stringify(telem.pageRows || []);
    const integrityWarningsJson = JSON.stringify(telem.warnings || []);
    const rawPayloadJson = rawList ? JSON.stringify(rawList.slice(0, 5000)) : null;
    const extractionStatus = options.extractionStatus || (telem.status || (telem.warnings && telem.warnings.length > 0 ? 'complete_with_warnings' : 'complete'));

    // 2. Insert arp_snapshots row with complete extraction and audit telemetry
    const snapInsert = await client.query(
      `INSERT INTO arp_snapshots
        (snapshot_name, source_device, total_entries, notes,
         extraction_status, total_pages_detected, pages_visited, pagination_completed,
         page_rows_json, total_raw_entries, valid_ip_count, valid_mac_count,
         incomplete_count, invalid_count, duplicate_count, extraction_duration_ms,
         integrity_warnings, raw_payload_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       RETURNING id, imported_at`,
      [
        snapshotName,
        sourceDevice,
        entries.length,
        notes,
        extractionStatus,
        totalPagesDetected,
        pagesVisited,
        paginationCompleted,
        pageRowsJson,
        totalRawEntries,
        validIpCount,
        validMacCount,
        incompleteCount,
        invalidCount,
        duplicateCount,
        extractionDurationMs,
        integrityWarningsJson,
        rawPayloadJson
      ]
    );
    const snapshotId = snapInsert.rows[0].id;
    const importedAt = snapInsert.rows[0].imported_at;

    let entriesWithMac = 0;
    let unmatchedCount = 0;
    let invalidEntriesCount = 0;
    const matchedInventoryIds = new Set();

    // Prepare discovery records with match evaluation & individual entry verification
    const discoveryRows = entries.map(e => {
      let matchStatus = 'unmatched';
      let matchedInvId = null;

      const isValidIpv4 = Boolean(e.is_valid_ip && e.ip_address);
      const isValidMac = Boolean(e.has_mac && e.normalized_mac && e.normalized_mac.length === 12);
      const isIncomplete = Boolean(!e.has_mac || (e.arp_state && e.arp_state.toLowerCase().includes('incomplete')));
      const isDuplicateIp = isValidIpv4 && ((ipCountMap.get(e.ip_address) || 0) > 1);
      const mappedIps = isValidMac ? (macToIpsMap.get(e.normalized_mac) || new Set()) : new Set();
      const isDuplicateMac = isValidMac && (mappedIps.size > 1);

      const invItem = isValidMac ? invMap.get(e.normalized_mac) : null;
      const regDev = (isValidIpv4 && devByIp.get(e.ip_address)) || (isValidMac && devByMac.get(e.normalized_mac)) || null;

      let ipMismatch = false;
      if (invItem && invItem.expected_ip && isValidIpv4 && invItem.expected_ip !== e.ip_address) {
        ipMismatch = true;
      }

      const hasConflict = isDuplicateIp || isDuplicateMac || ipMismatch;

      // Classify verification status
      let verificationStatus = 'verified';
      if (!isValidIpv4) {
        verificationStatus = 'rejected';
      } else if (hasConflict) {
        verificationStatus = 'flagged';
      } else if (isIncomplete) {
        verificationStatus = 'verified_incomplete';
      } else if (isValidMac) {
        verificationStatus = 'verified';
      } else {
        verificationStatus = 'flagged';
      }

      // Compile human-readable verification reasons
      const reasons = [];
      if (isValidIpv4) {
        reasons.push(`Valid IPv4 format (${e.ip_address})`);
      } else {
        reasons.push(`Invalid IPv4 address format: '${e.ip_address || 'empty'}'`);
      }

      if (isIncomplete) {
        reasons.push('Incomplete ARP: Broadcast query sent, awaiting device response (normal for dormant/offline devices)');
      } else if (isValidMac) {
        reasons.push(`Valid IEEE 802 MAC format (${e.mac_address})`);
      } else {
        reasons.push(`Invalid or missing MAC format: '${e.mac_address || 'none'}'`);
      }

      if (invItem) {
        reasons.push(`Matches official inventory: ${invItem.device_name} (${invItem.department_location || 'General'})`);
        if (ipMismatch) {
          reasons.push(`Inventory IP conflict: Discovered ${e.ip_address} differs from expected IP ${invItem.expected_ip}`);
        }
      } else if (isValidMac) {
        reasons.push('Unmatched: MAC not found in official inventory (not registered)');
      }

      if (regDev) {
        reasons.push(`Matches registered node: ${regDev.name} [ID #${regDev.id}]`);
      }

      if (isDuplicateIp) {
        reasons.push(`Duplicate IP warning: Address ${e.ip_address} observed ${ipCountMap.get(e.ip_address)} times in extraction`);
      }

      if (isDuplicateMac) {
        reasons.push(`Duplicate MAC warning: Hardware address ${e.mac_address} mapped to multiple IPs (${Array.from(mappedIps).join(', ')})`);
      }

      if (e.interface && e.interface !== 'Unknown') {
        reasons.push(`Observed on firewall interface ${e.interface}`);
      }

      // Legacy match_status support for existing UI & analytics
      if (!isValidIpv4) {
        matchStatus = 'invalid_ip';
        invalidEntriesCount++;
      } else if (!isValidMac && isIncomplete) {
        matchStatus = 'no_mac';
        invalidEntriesCount++;
      } else if (!isValidMac) {
        matchStatus = 'no_mac';
        invalidEntriesCount++;
      } else {
        entriesWithMac++;
        if (invItem) {
          matchStatus = 'matched';
          matchedInvId = invItem.id;
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
        match_status: matchStatus,
        is_valid_ipv4: isValidIpv4,
        is_valid_mac: isValidMac,
        is_incomplete: isIncomplete,
        is_duplicate_ip: isDuplicateIp,
        is_duplicate_mac: isDuplicateMac,
        has_conflict: hasConflict,
        verification_status: verificationStatus,
        verification_reasons: JSON.stringify(reasons)
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
          `($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3}, $${paramIdx+4}, $${paramIdx+5}, $${paramIdx+6}, $${paramIdx+7}, $${paramIdx+8}, $${paramIdx+9}, $${paramIdx+10}, $${paramIdx+11}, $${paramIdx+12}, $${paramIdx+13}, $${paramIdx+14}, $${paramIdx+15}, $${paramIdx+16}, $${paramIdx+17})`
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
          row.match_status,
          row.is_valid_ipv4,
          row.is_valid_mac,
          row.is_incomplete,
          row.is_duplicate_ip,
          row.is_duplicate_mac,
          row.has_conflict,
          row.verification_status,
          row.verification_reasons
        );
        paramIdx += 18;
      }

      const query = `
        INSERT INTO arp_discoveries
          (snapshot_id, ip_address, mac_address, normalized_mac,
           interface, arp_state, is_router_entry, has_mac,
           matched_inventory_id, match_status,
           is_valid_ipv4, is_valid_mac, is_incomplete,
           is_duplicate_ip, is_duplicate_mac, has_conflict,
           verification_status, verification_reasons)
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
    SELECT d.*,
           m.device_name AS inventory_device_name,
           m.site_station AS inventory_site,
           m.department_location AS inventory_department,
           m.device_type AS inventory_device_type,
           m.expected_ip AS inventory_expected_ip,
           dev.id AS registered_device_id,
           dev.name AS registered_device_name,
           dev.ip_address AS registered_ip,
           dev.mac_address AS registered_mac,
           dev.building AS registered_building,
           dev.room AS registered_room,
           dev.port_number AS registered_port,
           dev.contact_person AS registered_contact_person,
           dev.contact_phone AS registered_contact_phone,
           p.status AS ping_status,
           p.latency_ms AS ping_latency,
           p.checked_at AS ping_checked_at
    FROM arp_discoveries d
    LEFT JOIN mac_inventory m ON d.matched_inventory_id = m.id
    LEFT JOIN devices dev ON (
      (d.normalized_mac IS NOT NULL AND dev.mac_address IS NOT NULL AND LOWER(REGEXP_REPLACE(dev.mac_address, '[^a-fA-F0-9]', '', 'g')) = d.normalized_mac)
      OR (m.device_id IS NOT NULL AND dev.id = m.device_id)
    )
    LEFT JOIN LATERAL (
      SELECT status, latency_ms, checked_at
      FROM status_history
      WHERE device_id = dev.id
      ORDER BY checked_at DESC
      LIMIT 1
    ) p ON true
    WHERE d.snapshot_id = $1
  `;
  const params = [snapshotId];

  if (filter.verificationStatus && filter.verificationStatus !== 'ALL') {
    params.push(filter.verificationStatus);
    query += ` AND d.verification_status = $${params.length}`;
  }

  if (filter.hasConflict !== undefined && filter.hasConflict !== null && filter.hasConflict !== 'ALL') {
    params.push(filter.hasConflict === 'true' || filter.hasConflict === true);
    query += ` AND d.has_conflict = $${params.length}`;
  }

  if (filter.matchStatus && filter.matchStatus !== 'ALL') {
    params.push(filter.matchStatus);
    query += ` AND d.match_status = $${params.length}`;
  }

  if (filter.interface && filter.interface !== 'ALL') {
    params.push(filter.interface);
    query += ` AND d.interface = $${params.length}`;
  }

  if (filter.arpState && filter.arpState !== 'ALL') {
    params.push(filter.arpState);
    query += ` AND d.arp_state ILIKE $${params.length}`;
  }

  query += ` ORDER BY d.ip_address ASC, d.id ASC`;

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

