const express = require('express');
const pool = require('./db');
const { pingDevice } = require('./ping_util');
const { runDiscoveredPingCycle, getStatus } = require('./discovered_ping_service');

const router = express.Router();

// Allowed device types whitelist
const ALLOWED_DEVICE_TYPES = [
  'PC',
  'Server',
  'Printer',
  'Switch',
  'Router',
  'Access Point',
  'CCTV Camera',
  'IP Phone',
  'IoT Device',
  'Gateway',
  'Other'
];

/**
 * 1. GET /api/discovered-devices
 * List discovered devices with filtering, pagination, and summary metrics.
 */
router.get('/api/discovered-devices', async (req, res) => {
  try {
    const {
      search,
      interface: iface,
      ping_status,
      match_status,
      page = 1,
      limit = 50,
      sort_field = 'id',
      sort_dir = 'asc'
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(200, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    // Base query joining mac_inventory and devices
    let baseQuery = `
      FROM discovered_devices dd
      LEFT JOIN mac_inventory inv ON inv.id = dd.matched_inventory_id
      LEFT JOIN devices dev ON dev.id = dd.registered_device_id
      WHERE 1=1
    `;
    const params = [];

    // Search filter
    if (search && search !== 'undefined' && search !== 'null' && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      const pIdx = params.length;
      baseQuery += ` AND (
        LOWER(dd.ip_address) LIKE $${pIdx} OR
        LOWER(COALESCE(dd.mac_address, '')) LIKE $${pIdx} OR
        LOWER(COALESCE(dd.custom_name, '')) LIKE $${pIdx} OR
        LOWER(COALESCE(dd.department, '')) LIKE $${pIdx} OR
        LOWER(COALESCE(dd.building_location, '')) LIKE $${pIdx} OR
        LOWER(COALESCE(inv.device_name, '')) LIKE $${pIdx} OR
        LOWER(COALESCE(dev.name, '')) LIKE $${pIdx}
      )`;
    }

    // Interface filter
    if (iface && iface !== 'ALL' && iface !== 'undefined' && iface !== 'null') {
      params.push(iface);
      baseQuery += ` AND dd.interface = $${params.length}`;
    }

    // Ping status filter
    if (ping_status && ping_status !== 'ALL' && ping_status !== 'undefined' && ping_status !== 'null') {
      const pStatus = ping_status.toLowerCase();
      if (pStatus === 'unknown') {
        baseQuery += ` AND (dd.last_ping_status IS NULL OR dd.last_ping_status = 'unknown')`;
      } else {
        params.push(pStatus);
        baseQuery += ` AND dd.last_ping_status = $${params.length}`;
      }
    }

    // Match status filter
    if (match_status && match_status !== 'ALL' && match_status !== 'undefined' && match_status !== 'null') {
      if (match_status === 'unmatched') {
        baseQuery += ` AND dd.matched_inventory_id IS NULL AND dd.registered_device_id IS NULL`;
      } else if (match_status === 'matched_inventory') {
        baseQuery += ` AND dd.matched_inventory_id IS NOT NULL`;
      } else if (match_status === 'registered_device') {
        baseQuery += ` AND dd.registered_device_id IS NOT NULL`;
      } else if (match_status === 'matched') {
        baseQuery += ` AND (dd.matched_inventory_id IS NOT NULL OR dd.registered_device_id IS NOT NULL)`;
      }
    }

    // Count total matching
    const countRes = await pool.query(`SELECT count(*) ${baseQuery}`, params);
    const totalMatching = parseInt(countRes.rows[0].count, 10);

    // Sorting whitelist
    const sortFieldMap = {
      id: 'dd.id',
      ip_address: 'dd.ip_address',
      mac_address: 'dd.mac_address',
      interface: 'dd.interface',
      arp_state: 'dd.arp_state',
      custom_name: 'dd.custom_name',
      last_ping_status: 'dd.last_ping_status',
      last_ping_latency: 'dd.last_ping_latency',
      last_ping_at: 'dd.last_ping_at',
      last_seen_at: 'dd.last_seen_at'
    };
    const orderCol = sortFieldMap[sort_field] || 'dd.id';
    const orderDir = (sort_dir && sort_dir.toLowerCase() === 'desc') ? 'DESC' : 'ASC';

    // Fetch items with pagination
    const selectQuery = `
      SELECT
        dd.id,
        dd.ip_address,
        dd.mac_address,
        dd.normalized_mac,
        dd.interface,
        dd.arp_state,
        dd.custom_name,
        dd.device_type,
        dd.department,
        dd.building_location,
        dd.notes,
        dd.is_monitored,
        dd.last_ping_status,
        dd.last_ping_latency,
        dd.last_ping_at,
        dd.last_seen_at,
        dd.snapshot_id,
        dd.matched_inventory_id,
        dd.registered_device_id,
        dd.created_at,
        dd.updated_at,
        inv.device_name AS inventory_device_name,
        inv.department_location AS inventory_location,
        inv.device_type AS inventory_device_type,
        dev.name AS registered_device_name,
        dev.building AS registered_building,
        dev.room AS registered_room,
        CASE
          WHEN dd.registered_device_id IS NOT NULL THEN 'registered_device'
          WHEN dd.matched_inventory_id IS NOT NULL THEN 'matched_inventory'
          ELSE 'unmatched'
        END AS derived_match_status
      ${baseQuery}
      ORDER BY ${orderCol} ${orderDir}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const itemsRes = await pool.query(selectQuery, [...params, limitNum, offset]);

    // Aggregate summary across all discovered_devices
    const summaryRes = await pool.query(`
      SELECT
        count(*) AS total,
        count(*) FILTER (WHERE last_ping_status = 'online') AS online,
        count(*) FILTER (WHERE last_ping_status = 'offline') AS offline,
        count(*) FILTER (WHERE last_ping_status IS NULL OR last_ping_status = 'unknown') AS unknown,
        count(*) FILTER (WHERE matched_inventory_id IS NULL AND registered_device_id IS NULL) AS unmatched,
        count(*) FILTER (WHERE matched_inventory_id IS NOT NULL) AS matched_inventory,
        count(*) FILTER (WHERE registered_device_id IS NOT NULL) AS registered_devices
      FROM discovered_devices
    `);
    const summaryRow = summaryRes.rows[0];

    // Interfaces breakdown
    const ifaceRes = await pool.query(`
      SELECT interface, count(*) FROM discovered_devices GROUP BY interface ORDER BY interface
    `);

    res.json({
      items: itemsRes.rows,
      total: totalMatching,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(totalMatching / limitNum) || 1,
      summary: {
        total: parseInt(summaryRow.total, 10),
        online: parseInt(summaryRow.online, 10),
        offline: parseInt(summaryRow.offline, 10),
        unknown: parseInt(summaryRow.unknown, 10),
        unmatched: parseInt(summaryRow.unmatched, 10),
        matched_inventory: parseInt(summaryRow.matched_inventory, 10),
        registered_devices: parseInt(summaryRow.registered_devices, 10)
      },
      interfaces: ifaceRes.rows,
      allowedDeviceTypes: ALLOWED_DEVICE_TYPES
    });
  } catch (err) {
    console.error('Fetch discovered-devices failed:', err.message);
    res.status(500).json({ error: 'Could not fetch discovered devices' });
  }
});

/**
 * 2. GET /api/discovered-devices/:id
 * Single discovered device details.
 */
router.get('/api/discovered-devices/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid device ID' });
  }

  try {
    const query = `
      SELECT
        dd.*,
        inv.device_name AS inventory_device_name,
        inv.department_location AS inventory_location,
        inv.device_type AS inventory_device_type,
        dev.name AS registered_device_name,
        dev.building AS registered_building,
        dev.room AS registered_room,
        CASE
          WHEN dd.registered_device_id IS NOT NULL THEN 'registered_device'
          WHEN dd.matched_inventory_id IS NOT NULL THEN 'matched_inventory'
          ELSE 'unmatched'
        END AS derived_match_status
      FROM discovered_devices dd
      LEFT JOIN mac_inventory inv ON inv.id = dd.matched_inventory_id
      LEFT JOIN devices dev ON dev.id = dd.registered_device_id
      WHERE dd.id = $1
    `;
    const result = await pool.query(query, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Discovered device not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Fetch discovered device failed:', err.message);
    res.status(500).json({ error: 'Could not fetch discovered device' });
  }
});

/**
 * 3. PATCH /api/discovered-devices/:id
 * Direct database editing with strict server-side field whitelisting.
 * Network observations (IP, MAC, ARP state, last ping results) are protected from accidental edits.
 */
router.patch('/api/discovered-devices/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid device ID' });
  }

  const {
    custom_name,
    device_type,
    department,
    building_location,
    notes,
    is_monitored
  } = req.body || {};

  try {
    // Check if device exists
    const checkRes = await pool.query('SELECT * FROM discovered_devices WHERE id = $1', [id]);
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ error: 'Discovered device not found' });
    }
    const current = checkRes.rows[0];

    // Build update dynamically from whitelisted fields only
    const updates = [];
    const params = [];

    if (custom_name !== undefined) {
      params.push(custom_name ? String(custom_name).trim().slice(0, 100) : null);
      updates.push(`custom_name = $${params.length}`);
    }

    if (device_type !== undefined) {
      const typeStr = String(device_type).trim().slice(0, 50);
      params.push(typeStr || 'PC');
      updates.push(`device_type = $${params.length}`);
    }

    if (department !== undefined) {
      params.push(department ? String(department).trim().slice(0, 150) : null);
      updates.push(`department = $${params.length}`);
    }

    if (building_location !== undefined) {
      params.push(building_location ? String(building_location).trim().slice(0, 150) : null);
      updates.push(`building_location = $${params.length}`);
    }

    if (notes !== undefined) {
      params.push(notes ? String(notes).trim() : null);
      updates.push(`notes = $${params.length}`);
    }

    if (is_monitored !== undefined) {
      params.push(Boolean(is_monitored));
      updates.push(`is_monitored = $${params.length}`);
    }

    if (updates.length === 0) {
      return res.json({ success: true, message: 'No changes provided', device: current });
    }

    updates.push('updated_at = NOW()');
    params.push(id);

    const updateQuery = `
      UPDATE discovered_devices
      SET ${updates.join(', ')}
      WHERE id = $${params.length}
      RETURNING *
    `;

    const result = await pool.query(updateQuery, params);
    res.json({
      success: true,
      message: 'Discovered device details updated successfully',
      device: result.rows[0]
    });
  } catch (err) {
    console.error('Update discovered device failed:', err.message);
    res.status(500).json({ error: err.message || 'Could not update discovered device' });
  }
});

/**
 * 4. POST /api/discovered-devices/:id/register
 * Formally promotes a discovered device into the official `devices` table.
 * Links `registered_device_id` without creating duplicates.
 */
router.post('/api/discovered-devices/:id/register', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid device ID' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Fetch discovered device
    const discRes = await client.query('SELECT * FROM discovered_devices WHERE id = $1', [id]);
    if (discRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Discovered device not found' });
    }
    const item = discRes.rows[0];

    // 2. Check if already linked or already exists in `devices` by IP
    let registeredDevId = item.registered_device_id;
    let devName = item.custom_name || `Discovered Node ${item.ip_address}`;
    let building = item.building_location || null;
    let devType = item.device_type || 'PC';
    let notes = item.notes || `Promoted from Sophos discovery on ${new Date().toLocaleDateString()}`;

    if (!registeredDevId) {
      const existingDev = await client.query('SELECT id FROM devices WHERE ip_address = $1', [item.ip_address]);
      if (existingDev.rows.length > 0) {
        registeredDevId = existingDev.rows[0].id;
      } else {
        // Insert new row in `devices`
        const insertDev = await client.query(
          `INSERT INTO devices
            (name, ip_address, mac_address, device_type, building, notes)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [devName, item.ip_address, item.mac_address, devType, building, notes]
        );
        registeredDevId = insertDev.rows[0].id;
      }
    }

    // 3. Update discovered_devices with link
    const updateDisc = await client.query(
      `UPDATE discovered_devices
       SET registered_device_id = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [registeredDevId, id]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `Device "${devName}" successfully linked to monitored devices.`,
      registeredDeviceId: registeredDevId,
      device: updateDisc.rows[0]
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Register discovered device failed:', err.message);
    res.status(500).json({ error: err.message || 'Could not register discovered device' });
  } finally {
    client.release();
  }
});

/**
 * 5. POST /api/discovered-devices/:id/ping
 * Instant on-demand probe for a single discovered device.
 */
router.post('/api/discovered-devices/:id/ping', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid device ID' });
  }

  try {
    const discRes = await pool.query('SELECT id, ip_address FROM discovered_devices WHERE id = $1', [id]);
    if (discRes.rows.length === 0) {
      return res.status(404).json({ error: 'Discovered device not found' });
    }
    const item = discRes.rows[0];

    const probe = await pingDevice(item.ip_address);

    const updateRes = await pool.query(
      `UPDATE discovered_devices SET
        last_ping_status = $1,
        last_ping_latency = $2,
        last_ping_at = NOW(),
        updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [
        probe.status,
        probe.status === 'online' ? probe.latency_ms : null,
        id
      ]
    );

    res.json({
      success: true,
      probe,
      device: updateRes.rows[0]
    });
  } catch (err) {
    console.error('Instant ping failed:', err.message);
    res.status(500).json({ error: 'Probe execution failed' });
  }
});

/**
 * 6. POST /api/discovered-devices/ping-all
 * Triggers a manual full monitoring cycle across eligible discovered devices.
 */
router.post('/api/discovered-devices/ping-all', async (req, res) => {
  try {
    const status = getStatus();
    if (status.isInProgress) {
      return res.status(409).json({ error: 'Ping cycle is already running in background' });
    }

    // Run cycle in background
    runDiscoveredPingCycle()
      .then(result => console.log('[DiscoveredPing] Manual cycle finished:', result))
      .catch(err => console.error('[DiscoveredPing] Manual cycle failed:', err.message));

    res.json({
      success: true,
      message: 'Discovered devices ping cycle started in background.'
    });
  } catch (err) {
    console.error('Trigger ping-all failed:', err.message);
    res.status(500).json({ error: 'Could not trigger ping cycle' });
  }
});

module.exports = router;
