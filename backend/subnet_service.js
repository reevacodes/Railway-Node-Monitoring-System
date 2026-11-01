/**
 * Subnet & Office Management Service
 * Railway Node Monitoring System
 */

const pool = require('./db');
const {
  isValidIpv4,
  maskToCidr,
  cidrToMask,
  getSubnetDetails,
  doSubnetsOverlap,
  isIpInSubnet,
  matchIpToSubnets,
} = require('./subnet_util');

/**
 * Get all offices with subnet counts
 */
async function getAllOffices() {
  const query = `
    SELECT
      o.id,
      o.name,
      o.code,
      o.description,
      o.created_at,
      o.updated_at,
      COUNT(s.id) AS total_subnets,
      COUNT(s.id) FILTER (WHERE s.is_active = TRUE) AS active_subnets
    FROM offices o
    LEFT JOIN subnets s ON s.office_id = o.id
    GROUP BY o.id
    ORDER BY o.name ASC
  `;
  const res = await pool.query(query);
  return res.rows.map((r) => ({
    ...r,
    total_subnets: parseInt(r.total_subnets, 10),
    active_subnets: parseInt(r.active_subnets, 10),
  }));
}

/**
 * Create a new office (allows dynamic scaling beyond DRM, Control, NIA)
 */
async function createOffice({ name, code, description }) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('Office name is required');
  }
  const cleanName = name.trim();
  const cleanCode = (code && typeof code === 'string' && code.trim())
    ? code.trim().toUpperCase()
    : cleanName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10).toUpperCase();

  const query = `
    INSERT INTO offices (name, code, description)
    VALUES ($1, $2, $3)
    RETURNING *
  `;
  const res = await pool.query(query, [cleanName, cleanCode, description ? description.trim() : null]);
  return res.rows[0];
}

/**
 * Helper to fetch all devices with latest ping reachability
 */
async function getDeviceReachabilityMap() {
  // 1. Registered devices with latest status
  const regQuery = `
    WITH latest_st AS (
      SELECT DISTINCT ON (device_id) device_id, status, latency_ms, checked_at
      FROM status_history
      ORDER BY device_id, checked_at DESC
    )
    SELECT
      d.id,
      d.name,
      d.ip_address,
      d.mac_address,
      d.device_type,
      d.building,
      d.room,
      COALESCE(ls.status, 'unknown') AS ping_status,
      ls.latency_ms,
      ls.checked_at AS last_ping_at,
      'managed' AS classification
    FROM devices d
    LEFT JOIN latest_st ls ON ls.device_id = d.id
    WHERE d.ip_address IS NOT NULL AND TRIM(d.ip_address) != ''
  `;

  // 2. Discovered devices (unmanaged)
  const discQuery = `
    SELECT
      id,
      COALESCE(custom_name, 'Discovered Node ' || ip_address) AS name,
      ip_address,
      mac_address,
      COALESCE(device_type, 'Node') AS device_type,
      department,
      building_location AS building,
      COALESCE(last_ping_status, 'unknown') AS ping_status,
      last_ping_latency AS latency_ms,
      last_ping_at,
      'unmanaged' AS classification
    FROM discovered_devices
    WHERE registered_device_id IS NULL
      AND ip_address IS NOT NULL AND TRIM(ip_address) != ''
  `;

  const [regRes, discRes] = await Promise.all([
    pool.query(regQuery),
    pool.query(discQuery),
  ]);

  return {
    registered: regRes.rows,
    discovered: discRes.rows,
    all: [...regRes.rows, ...discRes.rows],
  };
}

/**
 * Get all subnets with dynamic device counts and reachability stats
 */
async function getAllSubnets(filter = {}) {
  let query = `
    SELECT
      s.id,
      s.office_id,
      o.name AS office_name,
      o.code AS office_code,
      s.subnet_name,
      s.network_address,
      s.cidr_prefix,
      s.subnet_mask,
      s.gateway_ip,
      s.description,
      s.is_active,
      s.created_at,
      s.updated_at
    FROM subnets s
    JOIN offices o ON o.id = s.office_id
  `;

  const whereClauses = [];
  const params = [];

  if (filter.office_id) {
    params.push(Number(filter.office_id));
    whereClauses.push(`s.office_id = $${params.length}`);
  } else if (filter.office_code) {
    params.push(filter.office_code.toUpperCase());
    whereClauses.push(`UPPER(o.code) = $${params.length}`);
  }

  if (filter.is_active !== undefined) {
    params.push(filter.is_active === true || filter.is_active === 'true');
    whereClauses.push(`s.is_active = $${params.length}`);
  }

  if (whereClauses.length > 0) {
    query += ` WHERE ${whereClauses.join(' AND ')}`;
  }

  query += ` ORDER BY o.name ASC, s.network_address ASC, s.cidr_prefix ASC`;

  const res = await pool.query(query, params);
  const subnets = res.rows;

  // Enrich with subnet mathematical calculations & device statistics
  const { all: devicesList } = await getDeviceReachabilityMap();

  return subnets.map((sub) => {
    let details = {};
    try {
      details = getSubnetDetails(sub.network_address, sub.cidr_prefix);
    } catch {
      details = {
        usableIpRange: 'Invalid Configuration',
        totalUsableHosts: 0,
        firstUsableIp: null,
        lastUsableIp: null,
      };
    }

    // Match devices belonging to this subnet
    const matchingDevices = devicesList.filter((dev) =>
      isIpInSubnet(dev.ip_address, sub.network_address, sub.cidr_prefix)
    );

    const onlineDevices = matchingDevices.filter(
      (d) => (d.ping_status || '').toLowerCase() === 'online'
    );
    const offlineDevices = matchingDevices.filter(
      (d) => (d.ping_status || '').toLowerCase() === 'offline'
    );
    const unknownDevices = matchingDevices.filter(
      (d) => !['online', 'offline'].includes((d.ping_status || '').toLowerCase())
    );

    const managedCount = matchingDevices.filter((d) => d.classification === 'managed').length;
    const unmanagedCount = matchingDevices.filter((d) => d.classification === 'unmanaged').length;

    return {
      ...sub,
      usable_ip_range: details.usableIpRange,
      total_usable_hosts: details.totalUsableHosts,
      first_usable_ip: details.firstUsableIp,
      last_usable_ip: details.lastUsableIp,
      assigned_devices_count: matchingDevices.length,
      managed_devices_count: managedCount,
      unmanaged_devices_count: unmanagedCount,
      online_count: onlineDevices.length,
      offline_count: offlineDevices.length,
      unknown_count: unknownDevices.length,
      utilization_percentage:
        details.totalUsableHosts > 0
          ? Math.min(100, Math.round((matchingDevices.length / details.totalUsableHosts) * 100))
          : 0,
    };
  });
}

/**
 * Get single subnet by ID with full details
 */
async function getSubnetById(id) {
  const query = `
    SELECT
      s.*,
      o.name AS office_name,
      o.code AS office_code
    FROM subnets s
    JOIN offices o ON o.id = s.office_id
    WHERE s.id = $1
  `;
  const res = await pool.query(query, [id]);
  if (res.rows.length === 0) return null;

  const sub = res.rows[0];
  const details = getSubnetDetails(sub.network_address, sub.cidr_prefix);
  const { all: devicesList } = await getDeviceReachabilityMap();
  const matchingDevices = devicesList.filter((dev) =>
    isIpInSubnet(dev.ip_address, sub.network_address, sub.cidr_prefix)
  );

  return {
    ...sub,
    usable_ip_range: details.usableIpRange,
    total_usable_hosts: details.totalUsableHosts,
    first_usable_ip: details.firstUsableIp,
    last_usable_ip: details.lastUsableIp,
    assigned_devices: matchingDevices,
    assigned_devices_count: matchingDevices.length,
  };
}

/**
 * Validate and check for overlap against active subnets
 */
async function checkSubnetOverlap(networkAddress, cidrPrefix, excludeSubnetId = null) {
  const activeSubnetsRes = await pool.query(
    `SELECT s.id, s.subnet_name, s.network_address, s.cidr_prefix, o.name as office_name
     FROM subnets s
     JOIN offices o ON o.id = s.office_id
     WHERE s.is_active = TRUE ${excludeSubnetId ? 'AND s.id != $1' : ''}`,
    excludeSubnetId ? [excludeSubnetId] : []
  );

  for (const existing of activeSubnetsRes.rows) {
    if (doSubnetsOverlap(networkAddress, cidrPrefix, existing.network_address, existing.cidr_prefix)) {
      return {
        overlapping: true,
        conflictingSubnet: existing,
        message: `Network ${networkAddress}/${cidrPrefix} overlaps with active subnet "${existing.subnet_name}" (${existing.network_address}/${existing.cidr_prefix}) in ${existing.office_name}.`,
      };
    }
  }

  return { overlapping: false };
}

/**
 * Create a new Subnet
 */
async function createSubnet(payload) {
  const {
    office_id,
    subnet_name,
    network_address,
    cidr_prefix,
    subnet_mask,
    gateway_ip,
    description,
    is_active = true,
  } = payload;

  if (!office_id) throw new Error('Office selection is required');
  if (!subnet_name || !subnet_name.trim()) throw new Error('Subnet name is required');
  if (!network_address || !isValidIpv4(network_address.trim())) {
    throw new Error('Valid IPv4 network address is required');
  }

  // Derive CIDR prefix
  let prefix = Number(cidr_prefix);
  if (isNaN(prefix) || prefix < 8 || prefix > 30) {
    if (subnet_mask && isValidIpv4(subnet_mask.trim())) {
      prefix = maskToCidr(subnet_mask.trim());
      if (prefix < 8 || prefix > 30) {
        throw new Error('Invalid subnet mask format');
      }
    } else {
      throw new Error('Valid CIDR prefix (8–30) or subnet mask is required');
    }
  }

  // Calculate canonical network details & normalize boundary
  const details = getSubnetDetails(network_address.trim(), prefix);
  const normalizedNet = details.networkAddress;
  const canonicalMask = details.subnetMask;

  // Validate optional Gateway IP
  let cleanGateway = null;
  if (gateway_ip && typeof gateway_ip === 'string' && gateway_ip.trim()) {
    cleanGateway = gateway_ip.trim();
    if (!isValidIpv4(cleanGateway)) {
      throw new Error(`Gateway IP "${cleanGateway}" is not a valid IPv4 address`);
    }
    if (!isIpInSubnet(cleanGateway, normalizedNet, prefix)) {
      throw new Error(`Gateway IP "${cleanGateway}" must be within the subnet range (${details.usableIpRange})`);
    }
  }

  // Overlap verification if active
  const activeStatus = Boolean(is_active);
  if (activeStatus) {
    const overlap = await checkSubnetOverlap(normalizedNet, prefix);
    if (overlap.overlapping) {
      const err = new Error(overlap.message);
      err.code = 'OVERLAPPING_SUBNET';
      err.conflictingSubnet = overlap.conflictingSubnet;
      throw err;
    }
  }

  const query = `
    INSERT INTO subnets
      (office_id, subnet_name, network_address, cidr_prefix, subnet_mask, gateway_ip, description, is_active)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `;
  const res = await pool.query(query, [
    Number(office_id),
    subnet_name.trim(),
    normalizedNet,
    prefix,
    canonicalMask,
    cleanGateway,
    description ? description.trim() : null,
    activeStatus,
  ]);

  return getSubnetById(res.rows[0].id);
}

/**
 * Update an existing Subnet
 */
async function updateSubnet(id, payload) {
  const existing = await pool.query('SELECT * FROM subnets WHERE id = $1', [id]);
  if (existing.rows.length === 0) {
    throw new Error('Subnet not found');
  }
  const curr = existing.rows[0];

  const office_id = payload.office_id !== undefined ? Number(payload.office_id) : curr.office_id;
  const subnet_name = payload.subnet_name !== undefined ? payload.subnet_name.trim() : curr.subnet_name;
  const netAddr = payload.network_address !== undefined ? payload.network_address.trim() : curr.network_address;

  let prefix = payload.cidr_prefix !== undefined ? Number(payload.cidr_prefix) : curr.cidr_prefix;
  if (payload.subnet_mask !== undefined && payload.cidr_prefix === undefined) {
    prefix = maskToCidr(payload.subnet_mask.trim());
  }

  const details = getSubnetDetails(netAddr, prefix);
  const normalizedNet = details.networkAddress;
  const canonicalMask = details.subnetMask;

  let cleanGateway = curr.gateway_ip;
  if (payload.gateway_ip !== undefined) {
    cleanGateway = (payload.gateway_ip && payload.gateway_ip.trim()) ? payload.gateway_ip.trim() : null;
    if (cleanGateway) {
      if (!isValidIpv4(cleanGateway)) {
        throw new Error(`Gateway IP "${cleanGateway}" is not a valid IPv4 address`);
      }
      if (!isIpInSubnet(cleanGateway, normalizedNet, prefix)) {
        throw new Error(`Gateway IP "${cleanGateway}" must be within the subnet range (${details.usableIpRange})`);
      }
    }
  }

  const is_active = payload.is_active !== undefined ? Boolean(payload.is_active) : curr.is_active;

  // Overlap verification if active
  if (is_active) {
    const overlap = await checkSubnetOverlap(normalizedNet, prefix, id);
    if (overlap.overlapping) {
      const err = new Error(overlap.message);
      err.code = 'OVERLAPPING_SUBNET';
      err.conflictingSubnet = overlap.conflictingSubnet;
      throw err;
    }
  }

  const query = `
    UPDATE subnets SET
      office_id = $1,
      subnet_name = $2,
      network_address = $3,
      cidr_prefix = $4,
      subnet_mask = $5,
      gateway_ip = $6,
      description = $7,
      is_active = $8,
      updated_at = NOW()
    WHERE id = $9
    RETURNING *
  `;
  await pool.query(query, [
    office_id,
    subnet_name,
    normalizedNet,
    prefix,
    canonicalMask,
    cleanGateway,
    payload.description !== undefined ? (payload.description ? payload.description.trim() : null) : curr.description,
    is_active,
    id,
  ]);

  return getSubnetById(id);
}

/**
 * Toggle active status
 */
async function toggleSubnetActive(id) {
  const existing = await pool.query('SELECT * FROM subnets WHERE id = $1', [id]);
  if (existing.rows.length === 0) throw new Error('Subnet not found');
  const curr = existing.rows[0];
  const newStatus = !curr.is_active;

  if (newStatus) {
    const overlap = await checkSubnetOverlap(curr.network_address, curr.cidr_prefix, id);
    if (overlap.overlapping) {
      const err = new Error(overlap.message);
      err.code = 'OVERLAPPING_SUBNET';
      err.conflictingSubnet = overlap.conflictingSubnet;
      throw err;
    }
  }

  await pool.query('UPDATE subnets SET is_active = $1, updated_at = NOW() WHERE id = $2', [newStatus, id]);
  return getSubnetById(id);
}

/**
 * Delete Subnet (with safety against removing subnets with active assigned devices)
 */
async function deleteSubnet(id, force = false) {
  const sub = await getSubnetById(id);
  if (!sub) throw new Error('Subnet not found');

  if (sub.assigned_devices_count > 0 && !force) {
    const err = new Error(
      `Cannot delete subnet "${sub.subnet_name}" because ${sub.assigned_devices_count} devices are currently operating within its IP range. Deactivate it or reassign devices first.`
    );
    err.code = 'HAS_ASSIGNED_DEVICES';
    err.deviceCount = sub.assigned_devices_count;
    throw err;
  }

  await pool.query('DELETE FROM subnets WHERE id = $1', [id]);
  return { success: true, deletedSubnet: sub };
}

/**
 * Classify any arbitrary IPv4 address into Office and Subnet
 */
async function classifyIp(ip) {
  if (!isValidIpv4(ip)) {
    return {
      matched: false,
      ip,
      office: null,
      subnet: null,
      label: 'Invalid IP Address',
    };
  }

  const activeSubnets = await pool.query(`
    SELECT s.*, o.name AS office_name, o.code AS office_code
    FROM subnets s
    JOIN offices o ON o.id = s.office_id
    WHERE s.is_active = TRUE
    ORDER BY s.cidr_prefix DESC
  `);

  const match = matchIpToSubnets(ip, activeSubnets.rows);
  if (match) {
    return {
      matched: true,
      ip,
      office: {
        id: match.office_id,
        name: match.office_name,
        code: match.office_code,
      },
      subnet: {
        id: match.id,
        name: match.subnet_name,
        network_address: match.network_address,
        cidr_prefix: match.cidr_prefix,
        subnet_mask: match.subnet_mask,
        gateway_ip: match.gateway_ip,
        usable_ip_range: match.usableIpRange,
      },
      label: `${match.office_name} (${match.network_address}/${match.cidr_prefix})`,
    };
  }

  return {
    matched: false,
    ip,
    office: null,
    subnet: null,
    label: 'Unassigned / Unknown Network',
  };
}

/**
 * Build complete hierarchy for Network Topology:
 * Office -> Subnets -> Device Groups -> Devices
 */
async function getTopologyHierarchy() {
  const offices = await getAllOffices();
  const subnets = await getAllSubnets({ is_active: true });
  const { all: allDevices } = await getDeviceReachabilityMap();

  // Create unassigned bucket
  const unassignedDevices = [];

  const hierarchy = offices.map((off) => {
    const officeSubnets = subnets.filter((s) => s.office_id === off.id);
    let officeTotalDevices = 0;
    let officeOnline = 0;
    let officeOffline = 0;

    const subnetsWithDevices = officeSubnets.map((sub) => {
      const devInSub = allDevices.filter((d) =>
        isIpInSubnet(d.ip_address, sub.network_address, sub.cidr_prefix)
      );

      officeTotalDevices += devInSub.length;
      const onlineCount = devInSub.filter((d) => d.ping_status === 'online').length;
      const offlineCount = devInSub.filter((d) => d.ping_status === 'offline').length;
      officeOnline += onlineCount;
      officeOffline += offlineCount;

      // Group devices by device_type (e.g. Switches, Routers, PCs, etc.)
      const groups = {};
      devInSub.forEach((dev) => {
        const type = dev.device_type || 'Other Nodes';
        let category = 'Access Workstations & PCs';
        const lt = type.toLowerCase();
        if (lt.includes('router') || lt.includes('firewall') || lt.includes('gateway')) {
          category = 'Core Gateways & Routers';
        } else if (lt.includes('switch')) {
          category = 'Distribution & Edge Switches';
        } else if (lt.includes('server') || lt.includes('signaling') || lt.includes('cctv')) {
          category = 'Signaling, Telecom & Servers';
        } else if (lt.includes('point') || lt.includes('wifi') || lt.includes('wireless')) {
          category = 'Access Points & Wireless';
        }

        if (!groups[category]) groups[category] = [];
        groups[category].push(dev);
      });

      return {
        ...sub,
        device_count: devInSub.length,
        online_count: onlineCount,
        offline_count: offlineCount,
        unknown_count: devInSub.length - onlineCount - offlineCount,
        device_groups: Object.entries(groups).map(([group_name, items]) => ({
          group_name,
          count: items.length,
          devices: items,
        })),
      };
    });

    return {
      office_id: off.id,
      office_name: off.name,
      office_code: off.code,
      description: off.description,
      total_devices: officeTotalDevices,
      online_devices: officeOnline,
      offline_devices: officeOffline,
      subnets: subnetsWithDevices,
    };
  });

  // Track unassigned devices that don't match any active subnet
  allDevices.forEach((dev) => {
    const isMatched = subnets.some((s) =>
      isIpInSubnet(dev.ip_address, s.network_address, s.cidr_prefix)
    );
    if (!isMatched) {
      unassignedDevices.push(dev);
    }
  });

  return {
    offices: hierarchy,
    unassigned: {
      count: unassignedDevices.length,
      online_count: unassignedDevices.filter((d) => d.ping_status === 'online').length,
      offline_count: unassignedDevices.filter((d) => d.ping_status === 'offline').length,
      devices: unassignedDevices,
    },
    total_network_assets: allDevices.length,
  };
}

module.exports = {
  getAllOffices,
  createOffice,
  getAllSubnets,
  getSubnetById,
  createSubnet,
  updateSubnet,
  toggleSubnetActive,
  deleteSubnet,
  classifyIp,
  getTopologyHierarchy,
  checkSubnetOverlap,
};
