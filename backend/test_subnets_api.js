/**
 * Subnets & Office Management Test Suite
 * Railway Node Monitoring System
 */

const pool = require('./db');
const express = require('express');
const subnetRouter = require('./subnet_routes');

async function runTestSuite() {
  console.log('\n======================================================');
  console.log(' RUNNING SUBNET MANAGEMENT & DYNAMIC IP TEST SUITE');
  console.log('======================================================\n');

  const app = express();
  app.use(express.json());
  app.use('/', subnetRouter);

  let server;
  const port = 50660;

  await new Promise((resolve) => {
    server = app.listen(port, () => {
      console.log(`Test API server running at http://127.0.0.1:${port}\n`);
      resolve();
    });
  });

  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // [TEST 1] GET /api/offices
    console.log('[TEST 1] Testing GET /api/offices...');
    const offRes = await fetch(`${baseUrl}/api/offices`);
    if (!offRes.ok) throw new Error(`HTTP ${offRes.status}`);
    const offices = await offRes.json();
    console.log(`  ✓ Found ${offices.length} offices: ${offices.map(o => o.name).join(', ')}`);
    if (offices.length < 3) throw new Error('Expected at least DRM, Control, NIA offices');

    // [TEST 2] GET /api/subnets (preconfigured initial subnets)
    console.log('\n[TEST 2] Testing GET /api/subnets...');
    const subRes = await fetch(`${baseUrl}/api/subnets`);
    if (!subRes.ok) throw new Error(`HTTP ${subRes.status}`);
    const subnets = await subRes.json();
    console.log(`  ✓ Found ${subnets.length} total configured subnets`);
    const drm40 = subnets.find(s => s.network_address === '192.168.40.0' && s.cidr_prefix === 24);
    if (!drm40) throw new Error('Missing 192.168.40.0/24 subnet');
    console.log(`  ✓ DRM 40.x: Usable range "${drm40.usable_ip_range}", Capacity ${drm40.total_usable_hosts}, Assigned ${drm40.assigned_devices_count} nodes`);

    // [TEST 3] GET /api/subnets/classify-ip
    console.log('\n[TEST 3] Testing Automatic IP Classification...');
    const testIps = [
      { ip: '192.168.40.160', expOffice: 'DRM Office', expNet: '192.168.40.0/24' },
      { ip: '192.168.41.205', expOffice: 'DRM Office', expNet: '192.168.41.0/24' },
      { ip: '192.168.50.120', expOffice: 'Control Office', expNet: '192.168.50.0/24' },
      { ip: '192.168.51.100', expOffice: 'Control Office', expNet: '192.168.51.0/24' },
      { ip: '192.168.20.50', expOffice: 'NIA Office', expNet: '192.168.20.0/24' },
      { ip: '192.168.21.80', expOffice: 'NIA Office', expNet: '192.168.21.0/24' },
      { ip: '10.112.22.45', expOffice: null, expNet: null }, // Unassigned
    ];

    for (const t of testIps) {
      const cRes = await fetch(`${baseUrl}/api/subnets/classify-ip?ip=${t.ip}`);
      const data = await cRes.json();
      if (t.expOffice) {
        if (!data.matched || data.office.name !== t.expOffice) {
          throw new Error(`Expected ${t.ip} -> ${t.expOffice}, got ${JSON.stringify(data)}`);
        }
        console.log(`  ✓ ${t.ip} -> ${data.office.name} -> ${data.subnet.network_address}/${data.subnet.cidr_prefix}`);
      } else {
        if (data.matched) {
          throw new Error(`Expected ${t.ip} to be unassigned, got matched`);
        }
        console.log(`  ✓ ${t.ip} -> ${data.label} (Clean unassigned handling)`);
      }
    }

    // [TEST 4] Adding new future office & subnet series
    console.log('\n[TEST 4] Testing Future Scalability: Adding New Office & IP Series...');
    const newOffRes = await fetch(`${baseUrl}/api/offices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Loco Shed Control',
        code: 'LOCO',
        description: 'Locomotive Maintenance & Shed Command'
      })
    });
    const newOffice = await newOffRes.json();
    console.log(`  ✓ Successfully created dynamic office: ${newOffice.name} (ID: ${newOffice.id})`);

    // Add DRM 42.x series (future expansion test)
    const drmOffice = offices.find(o => o.code === 'DRM');
    const newSubRes = await fetch(`${baseUrl}/api/subnets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        office_id: drmOffice.id,
        subnet_name: 'DRM Future Expansion LAN (42.x)',
        network_address: '192.168.42.0',
        cidr_prefix: 24,
        gateway_ip: '192.168.42.1',
        description: 'New 42.x series added dynamically by admin'
      })
    });
    const newSub = await newSubRes.json();
    console.log(`  ✓ Added new subnet ${newSub.network_address}/${newSub.cidr_prefix} to ${drmOffice.name}`);

    // Verify IP in 42.x immediately matches
    const class42 = await (await fetch(`${baseUrl}/api/subnets/classify-ip?ip=192.168.42.15`)).json();
    if (!class42.matched || class42.office.name !== 'DRM Office') {
      throw new Error(`Failed to match 192.168.42.15 to newly added subnet`);
    }
    console.log(`  ✓ Verified automatic detection on newly created 42.x series: ${class42.label}`);

    // [TEST 5] Testing Subnet Overlap Prevention
    console.log('\n[TEST 5] Testing Overlap Detection & Prevention...');
    // Try to create an overlapping /24 or /23 active subnet
    const overlapRes = await fetch(`${baseUrl}/api/subnets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        office_id: drmOffice.id,
        subnet_name: 'Conflicting Overlapping Subnet',
        network_address: '192.168.40.128',
        cidr_prefix: 25, // inside 192.168.40.0/24
        is_active: true
      })
    });
    if (overlapRes.status !== 409) {
      throw new Error(`Expected HTTP 409 Conflict for overlapping subnet, got ${overlapRes.status}`);
    }
    const overlapErr = await overlapRes.json();
    console.log(`  ✓ Overlap successfully blocked with error: "${overlapErr.error}"`);

    // [TEST 6] Testing Topology Hierarchy API
    console.log('\n[TEST 6] Testing Topology Hierarchy API...');
    const topoRes = await fetch(`${baseUrl}/api/subnets/topology-hierarchy`);
    const topo = await topoRes.json();
    console.log(`  ✓ Topology hierarchy returned ${topo.offices.length} offices, ${topo.total_network_assets} total network assets`);
    console.log(`  ✓ Unassigned network devices: ${topo.unassigned.count}`);
    const drmTopo = topo.offices.find(o => o.office_code === 'DRM');
    console.log(`  ✓ DRM Office subnets in topology: ${drmTopo.subnets.map(s => `${s.subnet_name} (${s.device_count} nodes)`).join(', ')}`);

    // [TEST 7] Clean up temporary test entries
    console.log('\n[TEST 7] Cleaning up temporary test entries...');
    await fetch(`${baseUrl}/api/subnets/${newSub.id}?force=true`, { method: 'DELETE' });
    await pool.query('DELETE FROM offices WHERE id = $1', [newOffice.id]);
    console.log('  ✓ Cleaned up test office and subnet.');

    console.log('\n======================================================');
    console.log(' ALL 7 SUBNET API & CLASSIFICATION TESTS PASSED!    ');
    console.log('======================================================\n');
  } finally {
    server.close();
    await pool.end();
  }
}

runTestSuite().catch((err) => {
  console.error('\nTest suite failed:', err);
  process.exit(1);
});
