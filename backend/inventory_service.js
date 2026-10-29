const fs = require('fs');
const path = require('path');
const pool = require('./db');

function normalizeMac(mac) {
  if (!mac || typeof mac !== 'string') return null;
  const cleaned = mac.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  return cleaned.length === 12 ? cleaned : null;
}

function formatMac(normalized) {
  if (!normalized || normalized.length !== 12) return normalized;
  return normalized.match(/.{1,2}/g).join(':').toUpperCase();
}

/**
 * Normalizes CSV / Spreadsheet column header names:
 * - Strips UTF-8 BOM (\uFEFF)
 * - Trims whitespace
 * - Converts to lowercase
 * - Replaces spaces, slashes, dashes, parentheses with underscores
 */
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

/**
 * Finds index of a column by matching known aliases/variants
 */
function findColIdx(normalizedHeaders, aliases) {
  for (let i = 0; i < normalizedHeaders.length; i++) {
    const h = normalizedHeaders[i];
    if (aliases.some(a => h === a || h.includes(a))) {
      return i;
    }
  }
  return -1;
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let inQuotes = false;
  let current = '';

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(current.trim());
      current = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      row.push(current.trim());
      if (row.some(cell => cell.length > 0)) rows.push(row);
      row = [];
      current = '';
    } else {
      current += char;
    }
  }
  if (current.length > 0 || row.length > 0) {
    row.push(current.trim());
    if (row.some(cell => cell.length > 0)) rows.push(row);
  }
  return rows;
}

async function importInventoryFromCSV(csvText, sourceName = 'inventory.csv') {
  const client = await pool.connect();
  const macRegex = /([0-9A-Fa-f]{2}[:-][0-9A-Fa-f]{2}[:-][0-9A-Fa-f]{2}[:-][0-9A-Fa-f]{2}[:-][0-9A-Fa-f]{2}[:-][0-9A-Fa-f]{2})/g;

  const rows = parseCSV(csvText);
  if (rows.length < 2) {
    throw new Error('CSV file has no data rows');
  }

  // 1. Normalize Column Headers
  const rawHeaders = rows[0];
  const headers = rawHeaders.map(normalizeHeader);

  const macIdx = findColIdx(headers, ['mac_address', 'mac', 'physical_address', 'hardware_address', 'ethernet_address']);
  const nameIdx = findColIdx(headers, ['device_name', 'device', 'name', 'hostname', 'asset_name', 'make', 'model']);
  const siteIdx = findColIdx(headers, ['site_station', 'site', 'station', 'building', 'office_site']);
  const deptIdx = findColIdx(headers, ['department_location', 'department', 'location', 'cabin', 'room', 'section', 'office']);
  const typeIdx = findColIdx(headers, ['device_type', 'type', 'role', 'category']);
  const vlanIdx = findColIdx(headers, ['vlan_id', 'vlan']);
  const expIpIdx = findColIdx(headers, ['expected_ip', 'ip_address', 'ip', 'static_ip', 'expected_ip_optional']);
  const notesIdx = findColIdx(headers, ['notes', 'remarks', 'comment', 'description']);

  let importedCount = 0;
  let updatedCount = 0;
  let multiMacRowCount = 0;
  let groupSequence = Date.now();

  try {
    await client.query('BEGIN');

    // Fetch existing registered devices for linking without overwriting
    const devicesRes = await client.query('SELECT id, mac_address FROM devices WHERE mac_address IS NOT NULL');
    const deviceMacMap = new Map();
    devicesRes.rows.forEach(d => {
      const norm = normalizeMac(d.mac_address);
      if (norm) deviceMacMap.set(norm, d.id);
    });

    for (let rIdx = 1; rIdx < rows.length; rIdx++) {
      let row = rows[rIdx];

      // Keep data: If row has fewer columns than header, pad with empty strings (don't drop)
      if (row.length < headers.length) {
        row = row.concat(new Array(headers.length - row.length).fill(''));
      }

      // Collect any extra columns not in standard schema to preserve in notes
      const extraData = [];
      if (row.length > headers.length) {
        for (let e = headers.length; e < row.length; e++) {
          if (row[e] && row[e].trim()) extraData.push(row[e].trim());
        }
      }

      const rawMacCell = macIdx !== -1 ? (row[macIdx] || '').trim() : '';
      const rawMatches = rawMacCell.match(macRegex) || [];

      // Deduplicate normalized MACs within the same row
      const uniqueRowMacs = [];
      const seenInRow = new Set();
      for (const m of rawMatches) {
        const norm = normalizeMac(m);
        if (norm && !seenInRow.has(norm)) {
          seenInRow.add(norm);
          uniqueRowMacs.push({ raw: m, norm });
        }
      }

      const deviceName = (nameIdx !== -1 && row[nameIdx]) ? row[nameIdx].trim() : 'PC';
      const siteStation = (siteIdx !== -1 && row[siteIdx]) ? row[siteIdx].trim() : 'Jammu Tawi (JAT)';
      const deptLocation = (deptIdx !== -1 && row[deptIdx]) ? row[deptIdx].trim() : 'General Office';
      const deviceType = (typeIdx !== -1 && row[typeIdx]) ? row[typeIdx].trim() : 'PC';
      const vlanId = (vlanIdx !== -1 && row[vlanIdx]) ? row[vlanIdx].trim() : null;
      const expectedIp = (expIpIdx !== -1 && row[expIpIdx]) ? row[expIpIdx].trim() : null;
      
      let baseNotes = (notesIdx !== -1 && row[notesIdx]) ? row[notesIdx].trim() : '';
      if (extraData.length > 0) {
        baseNotes = baseNotes ? `${baseNotes} | Extra data: ${extraData.join(', ')}` : `Extra data: ${extraData.join(', ')}`;
      }
      const notes = baseNotes || null;

      // KEEP THE DATA: If row has NO matching MAC address, do NOT discard it!
      if (uniqueRowMacs.length === 0) {
        // Store row even without a MAC so no asset inventory row is deleted/lost
        const existingNoMac = await client.query(
          `SELECT id FROM mac_inventory
           WHERE device_name = $1 AND department_location = $2 AND normalized_mac IS NULL`,
          [deviceName, deptLocation]
        );

        if (existingNoMac.rows.length > 0) {
          await client.query(
            `UPDATE mac_inventory SET
              raw_mac_entry = $1,
              site_station = $2,
              device_type = $3,
              vlan_id = $4,
              expected_ip = $5,
              notes = $6,
              updated_at = NOW()
            WHERE id = $7`,
            [rawMacCell || null, siteStation, deviceType, vlanId, expectedIp, notes, existingNoMac.rows[0].id]
          );
          updatedCount++;
        } else {
          await client.query(
            `INSERT INTO mac_inventory
              (mac_address, normalized_mac, raw_mac_entry, device_name, site_station,
               department_location, device_type, vlan_id, expected_ip, notes,
               is_multi_mac, multi_mac_group_id, device_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
              rawMacCell || null,
              null,
              rawMacCell || null,
              deviceName,
              siteStation,
              deptLocation,
              deviceType,
              vlanId,
              expectedIp,
              notes,
              false,
              null,
              null
            ]
          );
          importedCount++;
        }
        continue;
      }

      const isMultiMac = uniqueRowMacs.length > 1;
      let multiGroupId = null;
      if (isMultiMac) {
        multiMacRowCount++;
        multiGroupId = ++groupSequence;
      }

      for (const macObj of uniqueRowMacs) {
        const formatted = formatMac(macObj.norm);
        const linkedDeviceId = deviceMacMap.get(macObj.norm) || null;

        // Check if normalized_mac already exists in mac_inventory
        const existing = await client.query(
          'SELECT id, device_id FROM mac_inventory WHERE normalized_mac = $1',
          [macObj.norm]
        );

        if (existing.rows.length > 0) {
          const invId = existing.rows[0].id;
          await client.query(
            `UPDATE mac_inventory SET
              mac_address = $1,
              raw_mac_entry = $2,
              device_name = $3,
              site_station = $4,
              department_location = $5,
              device_type = $6,
              vlan_id = $7,
              expected_ip = $8,
              notes = $9,
              is_multi_mac = $10,
              multi_mac_group_id = COALESCE($11, multi_mac_group_id),
              device_id = COALESCE(device_id, $12),
              updated_at = NOW()
            WHERE id = $13`,
            [
              formatted,
              rawMacCell,
              deviceName,
              siteStation,
              deptLocation,
              deviceType,
              vlanId,
              expectedIp,
              notes,
              isMultiMac,
              multiGroupId,
              linkedDeviceId,
              invId
            ]
          );
          updatedCount++;
        } else {
          await client.query(
            `INSERT INTO mac_inventory
              (mac_address, normalized_mac, raw_mac_entry, device_name, site_station,
               department_location, device_type, vlan_id, expected_ip, notes,
               is_multi_mac, multi_mac_group_id, device_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
              formatted,
              macObj.norm,
              rawMacCell,
              deviceName,
              siteStation,
              deptLocation,
              deviceType,
              vlanId,
              expectedIp,
              notes,
              isMultiMac,
              multiGroupId,
              linkedDeviceId
            ]
          );
          importedCount++;
        }
      }
    }

    await client.query('COMMIT');

    const totalInInventoryRes = await client.query('SELECT count(*) FROM mac_inventory');
    const totalInInventory = Number(totalInInventoryRes.rows[0].count);

    return {
      success: true,
      totalRowsProcessed: rows.length - 1,
      newlyImported: importedCount,
      updated: updatedCount,
      multiMacRows: multiMacRowCount,
      totalInventoryRecords: totalInInventory,
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Inventory import failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  normalizeMac,
  formatMac,
  normalizeHeader,
  importInventoryFromCSV
};
