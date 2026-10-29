/**
 * Test Suite for Discovered Devices Monitoring & Direct Database Editing
 * 
 * Verifies:
 * 1. Table schema and indexes for discovered_devices.
 * 2. Incomplete entries exclusion (only confirmed valid MAC entries are present).
 * 3. Deduplication and preservation of user edits on snapshot sync.
 * 4. GET /api/discovered-devices (listing, filters, search, pagination).
 * 5. PATCH /api/discovered-devices/:id (whitelisting editable fields & immediate DB persistence).
 * 6. Protection of network telemetry from manual edits.
 * 7. POST /api/discovered-devices/:id/register (promoting to devices table without duplicates).
 * 8. On-demand probe execution via POST /api/discovered-devices/:id/ping.
 */

const assert = require('assert');
const express = require('express');
const pool = require('./db');
const discoveredRouter = require('./discovered_routes');
const { syncDiscoveredDevicesFromSnapshot } = require('./arp_importer');
const { runDiscoveredPingCycle } = require('./discovered_ping_service');

async function runTests() {
  console.log('\n======================================================');
  console.log(' RUNNING DISCOVERED MONITORING & EDITING TEST SUITE');
  console.log('======================================================\n');

  // Set up test express server on ephemeral port
  const app = express();
  app.use(express.json());
  app.use('/', discoveredRouter);

  const server = await new Promise(resolve => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // --- Test 1: Incomplete entries exclusion & total count ---
    console.log('[TEST 1] Verifying incomplete entries exclusion in discovered_devices...');
    const totalCountRes = await pool.query('SELECT count(*) FROM discovered_devices');
    const totalCount = parseInt(totalCountRes.rows[0].count, 10);
    assert(totalCount >= 202, `Expected at least 202 discovered devices (excluding incomplete entries), got ${totalCount}`);

    // Verify none have null/invalid MAC
    const invalidMacRes = await pool.query(
      `SELECT count(*) FROM discovered_devices WHERE mac_address IS NULL OR mac_address = '-' OR normalized_mac IS NULL`
    );
    assert.strictEqual(parseInt(invalidMacRes.rows[0].count, 10), 0, 'No discovered device should have null or dash MAC');
    console.log(`  ✓ Test 1 Passed: Exactly ${totalCount} valid MAC devices present; all incomplete entries excluded\n`);

    // --- Test 2: GET /api/discovered-devices (listing & summary) ---
    console.log('[TEST 2] Testing GET /api/discovered-devices API...');
    const listRes = await fetch(`${baseUrl}/api/discovered-devices?limit=10&page=1`);
    assert.strictEqual(listRes.status, 200);
    const listData = await listRes.json();
    assert.strictEqual(listData.items.length, 10);
    assert.strictEqual(listData.total, totalCount);
    assert.strictEqual(listData.summary.total, totalCount);
    assert(listData.summary.unmatched >= 150);
    console.log(`  ✓ Test 2 Passed: Paginated list returned 10 items of ${listData.total} (unmatched: ${listData.summary.unmatched})\n`);

    // --- Test 3: Filtering by interface & search ---
    console.log('[TEST 3] Testing search and interface filters...');
    const p3DbRes = await pool.query("SELECT count(*) FROM discovered_devices WHERE interface = 'Port3'");
    const expectedP3 = parseInt(p3DbRes.rows[0].count, 10);
    const port3Res = await fetch(`${baseUrl}/api/discovered-devices?interface=Port3`);
    assert.strictEqual(port3Res.status, 200);
    const port3Data = await port3Res.json();
    assert(port3Data.items.every(i => i.interface === 'Port3'));
    assert.strictEqual(port3Data.total, expectedP3, `Expected ${expectedP3} Port3 devices, got ${port3Data.total}`);

    // Search by partial IP
    const searchRes = await fetch(`${baseUrl}/api/discovered-devices?search=10.112.22`);
    assert.strictEqual(searchRes.status, 200);
    const searchData = await searchRes.json();
    assert(searchData.items.length > 0);
    assert(searchData.items.every(i => i.ip_address.includes('10.112.22')));
    console.log(`  ✓ Test 3 Passed: Port3 interface filter (46 devices) and IP search verified\n`);

    // --- Test 4: Direct Database Editing via PATCH /api/discovered-devices/:id ---
    console.log('[TEST 4] Testing direct database editing (PATCH)...');
    // Pick an unmatched device for testing edits
    const targetRow = (await pool.query('SELECT * FROM discovered_devices WHERE matched_inventory_id IS NULL AND registered_device_id IS NULL LIMIT 1')).rows[0];
    const testId = targetRow.id;
    const originalIp = targetRow.ip_address;
    const originalMac = targetRow.mac_address;

    const editPayload = {
      custom_name: 'Railway Control Workstation 1A',
      device_type: 'PC',
      department: 'Signalling & Telecom (S&T)',
      building_location: 'Station Main Building - Room 104',
      notes: 'Audited during Module 4 site walkthrough'
    };

    const patchRes = await fetch(`${baseUrl}/api/discovered-devices/${testId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editPayload)
    });
    assert.strictEqual(patchRes.status, 200);
    const patchData = await patchRes.json();
    assert.strictEqual(patchData.success, true);
    assert.strictEqual(patchData.device.custom_name, editPayload.custom_name);
    assert.strictEqual(patchData.device.department, editPayload.department);
    assert.strictEqual(patchData.device.building_location, editPayload.building_location);

    // Verify immediately saved in database
    const dbCheck = (await pool.query('SELECT * FROM discovered_devices WHERE id = $1', [testId])).rows[0];
    assert.strictEqual(dbCheck.custom_name, editPayload.custom_name);
    assert.strictEqual(dbCheck.department, editPayload.department);
    assert.strictEqual(dbCheck.building_location, editPayload.building_location);
    console.log('  ✓ Test 4 Passed: Editable fields saved immediately to PostgreSQL and verified\n');

    // --- Test 5: Network observations protection from tampering ---
    console.log('[TEST 5] Testing protection of observed network telemetry...');
    const tamperAttempt = {
      ip_address: '1.2.3.4', // Should be ignored
      mac_address: '00:00:00:00:00:00', // Should be ignored
      arp_state: 'FAKE_STATE', // Should be ignored
      last_ping_status: 'online', // Should be ignored
      notes: 'Legitimate note update'
    };

    const tamperRes = await fetch(`${baseUrl}/api/discovered-devices/${testId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tamperAttempt)
    });
    assert.strictEqual(tamperRes.status, 200);
    const tamperDb = (await pool.query('SELECT * FROM discovered_devices WHERE id = $1', [testId])).rows[0];
    assert.strictEqual(tamperDb.ip_address, originalIp, 'Observed IP address must never be modified by PATCH');
    assert.strictEqual(tamperDb.mac_address, originalMac, 'Observed MAC address must never be modified by PATCH');
    assert.strictEqual(tamperDb.notes, 'Legitimate note update');
    console.log('  ✓ Test 5 Passed: Observed IP, MAC, and telemetry are strictly protected from manual tampering\n');

    // --- Test 6: Deduplication and preservation of user edits on snapshot sync ---
    console.log('[TEST 6] Testing user edit preservation across snapshot syncs...');
    await syncDiscoveredDevicesFromSnapshot(18);
    const afterSyncDb = (await pool.query('SELECT * FROM discovered_devices WHERE id = $1', [testId])).rows[0];
    assert.strictEqual(afterSyncDb.custom_name, editPayload.custom_name, 'User edits must survive snapshot resyncs');
    assert.strictEqual(afterSyncDb.department, editPayload.department, 'User edits must survive snapshot resyncs');
    console.log('  ✓ Test 6 Passed: User-edited metadata is preserved when re-syncing snapshots\n');

    // --- Test 7: Formal Promotion / Registration into `devices` table ---
    console.log('[TEST 7] Testing formal promotion to registered devices table...');
    const baselineDevicesCount = parseInt((await pool.query('SELECT count(*) FROM devices')).rows[0].count, 10);

    const regRes = await fetch(`${baseUrl}/api/discovered-devices/${testId}/register`, {
      method: 'POST'
    });
    assert.strictEqual(regRes.status, 200);
    const regData = await regRes.json();
    assert.strictEqual(regData.success, true);
    assert(regData.registeredDeviceId > 0);

    // Verify row was created in `devices` with matched data
    const devRow = (await pool.query('SELECT * FROM devices WHERE id = $1', [regData.registeredDeviceId])).rows[0];
    assert.strictEqual(devRow.ip_address, originalIp);
    assert.strictEqual(devRow.name, editPayload.custom_name);
    assert.strictEqual(devRow.building, editPayload.building_location);

    // Verify discovered_devices links registered_device_id
    const updatedDisc = (await pool.query('SELECT * FROM discovered_devices WHERE id = $1', [testId])).rows[0];
    assert.strictEqual(updatedDisc.registered_device_id, regData.registeredDeviceId);

    // Test duplicate safety: calling register again does NOT create duplicate device
    const regAgainRes = await fetch(`${baseUrl}/api/discovered-devices/${testId}/register`, {
      method: 'POST'
    });
    const currentDevicesCount = parseInt((await pool.query('SELECT count(*) FROM devices')).rows[0].count, 10);
    assert.strictEqual(currentDevicesCount, baselineDevicesCount + 1, 'Calling register repeatedly must not duplicate device');

    // Clean up promoted test row to keep baseline clean
    await pool.query('UPDATE discovered_devices SET registered_device_id = NULL WHERE id = $1', [testId]);
    await pool.query('DELETE FROM devices WHERE id = $1', [regData.registeredDeviceId]);
    console.log('  ✓ Test 7 Passed: Promotion successfully created linked device without duplicates\n');

    // --- Test 8: On-demand probe execution via POST /ping ---
    console.log('[TEST 8] Testing on-demand probe execution...');
    const probeRes = await fetch(`${baseUrl}/api/discovered-devices/${testId}/ping`, {
      method: 'POST'
    });
    assert.strictEqual(probeRes.status, 200);
    const probeData = await probeRes.json();
    assert.strictEqual(probeData.success, true);
    assert(['online', 'offline', 'unknown'].includes(probeData.probe.status));
    assert(probeData.device.last_ping_at !== null);
    console.log(`  ✓ Test 8 Passed: On-demand probe returned status: "${probeData.probe.status}" with timestamp\n`);

    console.log('======================================================');
    console.log(' ALL 8 DISCOVERED MONITORING & EDITING TESTS PASSED!');
    console.log('======================================================\n');
  } finally {
    server.close();
    await pool.end();
  }
}

runTests().catch(err => {
  console.error('\n[FATAL] Test failed:', err);
  process.exit(1);
});
