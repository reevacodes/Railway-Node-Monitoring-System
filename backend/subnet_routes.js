/**
 * REST API Endpoints for Subnet & Office Management
 * Railway Node Monitoring System
 */

const express = require('express');
const router = express.Router();
const subnetService = require('./subnet_service');
const { getSubnetDetails, maskToCidr, cidrToMask } = require('./subnet_util');

// --------------------------------------------------
// 1. Offices Endpoints
// --------------------------------------------------

/**
 * GET /api/offices
 * List all configured offices with subnet counts
 */
router.get('/api/offices', async (req, res) => {
  try {
    const offices = await subnetService.getAllOffices();
    res.json(offices);
  } catch (err) {
    console.error('Fetch offices failed:', err.message);
    res.status(500).json({ error: 'Could not fetch offices' });
  }
});

/**
 * POST /api/offices
 * Register a new office (allows dynamic scaling)
 */
router.post('/api/offices', async (req, res) => {
  try {
    const { name, code, description } = req.body;
    const newOffice = await subnetService.createOffice({ name, code, description });
    res.status(201).json(newOffice);
  } catch (err) {
    console.error('Create office failed:', err.message);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An office with this name or code already exists' });
    }
    res.status(400).json({ error: err.message || 'Could not create office' });
  }
});

// --------------------------------------------------
// 2. Subnet Preview & Classification Helper Endpoints
// --------------------------------------------------

/**
 * GET /api/subnets/preview
 * Instant calculation of usable IP range, mask, and host capacity
 */
router.get('/api/subnets/preview', (req, res) => {
  try {
    const { network, cidr, mask } = req.query;
    let prefix = Number(cidr);
    if (isNaN(prefix) || prefix < 8 || prefix > 30) {
      if (mask) {
        prefix = maskToCidr(mask);
      }
    }
    if (!network || isNaN(prefix) || prefix < 8 || prefix > 30) {
      return res.status(400).json({ error: 'Valid network address and CIDR prefix (8–30) required' });
    }
    const details = getSubnetDetails(network, prefix);
    res.json(details);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/subnets/classify-ip
 * Dynamically identifies office and subnet for any given IPv4 address
 */
router.get('/api/subnets/classify-ip', async (req, res) => {
  try {
    const ip = req.query.ip;
    if (!ip) {
      return res.status(400).json({ error: 'IP address query parameter is required' });
    }
    const classification = await subnetService.classifyIp(ip);
    res.json(classification);
  } catch (err) {
    console.error('Classify IP failed:', err.message);
    res.status(500).json({ error: 'Could not classify IP address' });
  }
});

/**
 * GET /api/subnets/topology-hierarchy
 * Structured office -> subnet -> device groups hierarchy for Network Topology
 */
router.get('/api/subnets/topology-hierarchy', async (req, res) => {
  try {
    const hierarchy = await subnetService.getTopologyHierarchy();
    res.json(hierarchy);
  } catch (err) {
    console.error('Topology hierarchy failed:', err.message);
    res.status(500).json({ error: 'Could not generate topology hierarchy' });
  }
});

// --------------------------------------------------
// 3. Subnets CRUD Endpoints
// --------------------------------------------------

/**
 * GET /api/subnets
 * List subnets with device counts, utilization, and reachability
 */
router.get('/api/subnets', async (req, res) => {
  try {
    const { office_id, office_code, is_active, search } = req.query;
    let subnets = await subnetService.getAllSubnets({
      office_id,
      office_code,
      is_active,
    });

    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim().toLowerCase();
      subnets = subnets.filter(
        (s) =>
          s.subnet_name.toLowerCase().includes(q) ||
          s.network_address.toLowerCase().includes(q) ||
          (s.office_name && s.office_name.toLowerCase().includes(q)) ||
          (s.gateway_ip && s.gateway_ip.toLowerCase().includes(q)) ||
          (s.usable_ip_range && s.usable_ip_range.toLowerCase().includes(q))
      );
    }

    res.json(subnets);
  } catch (err) {
    console.error('Fetch subnets failed:', err.message);
    res.status(500).json({ error: 'Could not fetch subnets' });
  }
});

/**
 * GET /api/subnets/:id
 * Retrieve single subnet details
 */
router.get('/api/subnets/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid subnet ID' });
    }

    const subnet = await subnetService.getSubnetById(id);
    if (!subnet) {
      return res.status(404).json({ error: 'Subnet not found' });
    }
    res.json(subnet);
  } catch (err) {
    console.error('Fetch subnet failed:', err.message);
    res.status(500).json({ error: 'Could not fetch subnet' });
  }
});

/**
 * POST /api/subnets
 * Create a new subnet with overlap check & IP validation
 */
router.post('/api/subnets', async (req, res) => {
  try {
    const created = await subnetService.createSubnet(req.body);
    res.status(201).json(created);
  } catch (err) {
    console.error('Create subnet error:', err.message);
    if (err.code === 'OVERLAPPING_SUBNET') {
      return res.status(409).json({
        error: err.message,
        code: err.code,
        conflictingSubnet: err.conflictingSubnet,
      });
    }
    res.status(400).json({ error: err.message || 'Could not create subnet' });
  }
});

/**
 * PUT /api/subnets/:id
 * Update an existing subnet with overlap verification
 */
router.put('/api/subnets/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid subnet ID' });
    }

    const updated = await subnetService.updateSubnet(id, req.body);
    res.json(updated);
  } catch (err) {
    console.error('Update subnet error:', err.message);
    if (err.code === 'OVERLAPPING_SUBNET') {
      return res.status(409).json({
        error: err.message,
        code: err.code,
        conflictingSubnet: err.conflictingSubnet,
      });
    }
    res.status(400).json({ error: err.message || 'Could not update subnet' });
  }
});

/**
 * PATCH /api/subnets/:id/toggle
 * Toggle active / inactive status
 */
router.patch('/api/subnets/:id/toggle', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid subnet ID' });
    }

    const toggled = await subnetService.toggleSubnetActive(id);
    res.json(toggled);
  } catch (err) {
    console.error('Toggle subnet error:', err.message);
    if (err.code === 'OVERLAPPING_SUBNET') {
      return res.status(409).json({
        error: err.message,
        code: err.code,
        conflictingSubnet: err.conflictingSubnet,
      });
    }
    res.status(400).json({ error: err.message || 'Could not toggle subnet status' });
  }
});

/**
 * DELETE /api/subnets/:id
 * Delete a subnet (safeguards against deleting subnets with active assigned devices)
 */
router.delete('/api/subnets/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid subnet ID' });
    }

    const force = req.query.force === 'true';
    const result = await subnetService.deleteSubnet(id, force);
    res.json(result);
  } catch (err) {
    console.error('Delete subnet error:', err.message);
    if (err.code === 'HAS_ASSIGNED_DEVICES') {
      return res.status(409).json({
        error: err.message,
        code: err.code,
        deviceCount: err.deviceCount,
      });
    }
    res.status(400).json({ error: err.message || 'Could not delete subnet' });
  }
});

module.exports = router;
