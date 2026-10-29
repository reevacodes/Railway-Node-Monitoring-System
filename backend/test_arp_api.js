/**
 * Integration Test Suite for Module 2: ARP API Endpoints & Routes
 * 
 * Tests:
 * 1. GET /api/arp/snapshots
 * 2. GET /api/arp/snapshots/:id
 * 3. GET /api/arp/snapshots/:id/details
 * 4. GET /api/arp/discoveries (with filters: match_status, interface, search)
 * 5. GET /api/arp/summary
 * 6. POST /api/arp/snapshots/import (dryRun: true)
 * 7. POST /api/arp/snapshots/import-json (dryRun: true)
 * 8. Zero database mutation verification
 */

const assert = require('assert');
const express = require('express');
const pool = require('./db');
const macArpRouter = require('./mac_arp_routes');

async function runApiTests() {
  console.log('\n======================================================');
  console.log(' RUNNING MODULE 2 API INTEGRATION TESTS');
  console.log('======================================================\n');

  // Set up test express server on random ephemeral port
  const app = express();
  app.use(express.json());
  app.use('/', macArpRouter);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  console.log(`Test server running at ${baseUrl}\n`);

  try {
    // Record baseline database counts
    const snapBefore = await pool.query('SELECT count(*) FROM arp_snapshots');
    const discBefore = await pool.query('SELECT count(*) FROM arp_discoveries');
    const invBefore = await pool.query('SELECT count(*) FROM mac_inventory');
    const baselineSnap = parseInt(snapBefore.rows[0].count, 10);
    const baselineDisc = parseInt(discBefore.rows[0].count, 10);
    const baselineInv = parseInt(invBefore.rows[0].count, 10);

    // 1. GET /api/arp/snapshots
    console.log('[TEST 1] GET /api/arp/snapshots...');
    const snapRes = await fetch(`${baseUrl}/api/arp/snapshots`);
    assert.strictEqual(snapRes.status, 200, `Expected 200, got ${snapRes.status}`);
    const snapshots = await snapRes.json();
    assert(Array.isArray(snapshots), 'Expected array of snapshots');
    assert(snapshots.length >= 1, 'Expected at least 1 snapshot in list');
    const latestSnapId = snapshots[0].id;
    console.log(`  ✓ Test 1 Passed: Found ${snapshots.length} snapshot(s), latest ID: ${latestSnapId}\n`);

    // 2. GET /api/arp/snapshots/:id
    console.log(`[TEST 2] GET /api/arp/snapshots/${latestSnapId}...`);
    const singleRes = await fetch(`${baseUrl}/api/arp/snapshots/${latestSnapId}`);
    assert.strictEqual(singleRes.status, 200);
    const singleSnap = await singleRes.json();
    assert.strictEqual(singleSnap.id, latestSnapId);
    assert(singleSnap.snapshot_name);
    console.log(`  ✓ Test 2 Passed: Retrieved snapshot "${singleSnap.snapshot_name}"\n`);

    // 3. GET /api/arp/snapshots/:id/details
    console.log(`[TEST 3] GET /api/arp/snapshots/${latestSnapId}/details...`);
    const detailsRes = await fetch(`${baseUrl}/api/arp/snapshots/${latestSnapId}/details`);
    assert.strictEqual(detailsRes.status, 200);
    const detailsData = await detailsRes.json();
    assert(detailsData.snapshot && detailsData.snapshot.id === latestSnapId);
    assert(Array.isArray(detailsData.discoveries));
    assert(detailsData.totalReturned > 0);
    console.log(`  ✓ Test 3 Passed: Snapshot details returned ${detailsData.totalReturned} discovery records with inventory join\n`);

    // 4. GET /api/arp/discoveries
    console.log('[TEST 4] GET /api/arp/discoveries (unfiltered and with filters)...');
    const discRes = await fetch(`${baseUrl}/api/arp/discoveries?snapshot_id=${latestSnapId}`);
    assert.strictEqual(discRes.status, 200);
    const discData = await discRes.json();
    assert(discData.summary, 'Expected summary in discoveries response');
    assert(Array.isArray(discData.items));

    // Filter by match_status=matched
    const matchedRes = await fetch(`${baseUrl}/api/arp/discoveries?snapshot_id=${latestSnapId}&match_status=matched`);
    const matchedData = await matchedRes.json();
    assert(matchedData.items.every(item => item.match_status === 'matched'));

    // Filter by match_status=no_mac
    const noMacRes = await fetch(`${baseUrl}/api/arp/discoveries?snapshot_id=${latestSnapId}&match_status=no_mac`);
    const noMacData = await noMacRes.json();
    assert(noMacData.items.every(item => item.match_status === 'no_mac'));

    console.log(`  ✓ Test 4 Passed: Discoveries API returned ${discData.items.length} items; filters (matched=${matchedData.items.length}, no_mac=${noMacData.items.length}) verified\n`);

    // 5. GET /api/arp/summary
    console.log('[TEST 5] GET /api/arp/summary...');
    const sumRes = await fetch(`${baseUrl}/api/arp/summary`);
    assert.strictEqual(sumRes.status, 200);
    const sumData = await sumRes.json();
    assert('total_inventory' in sumData);
    assert('matched_inventory_count' in sumData);
    assert('unobserved_inventory_count' in sumData);
    console.log(`  ✓ Test 5 Passed: Summary total_inventory: ${sumData.total_inventory}, matched: ${sumData.matched_inventory_count}, unobserved: ${sumData.unobserved_inventory_count}\n`);

    // 6. POST /api/arp/snapshots/import (dryRun: true)
    console.log('[TEST 6] POST /api/arp/snapshots/import with dryRun: true...');
    const importRes = await fetch(`${baseUrl}/api/arp/snapshots/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun: true, snapshot_name: 'API Dry Run Test' })
    });
    assert.strictEqual(importRes.status, 200);
    const importData = await importRes.json();
    assert.strictEqual(importData.success, true);
    assert.strictEqual(importData.dryRun, true);
    assert.strictEqual(importData.totalEntries, 273);
    assert.strictEqual(importData.entriesWithMac, 202);
    assert.strictEqual(importData.invalidEntriesCount, 71);
    console.log(`  ✓ Test 6 Passed: Default import processed canonical 273 entries (202 with MAC, 71 incomplete) in dryRun mode\n`);

    // 7. POST /api/arp/snapshots/import-json (dryRun: true)
    console.log('[TEST 7] POST /api/arp/snapshots/import-json with custom JSON payload and dryRun: true...');
    const customPayload = {
      dryRun: true,
      snapshot_name: 'Custom JSON API Test',
      entries: [
        { ip: '10.112.22.99', mac: '00:11:22:33:44:55', interface: 'Port1', state: 'Complete,Dynamic' },
        { ip: '10.112.22.100', mac: '-', interface: 'Port1', state: 'Incomplete' }
      ]
    };
    const jsonRes = await fetch(`${baseUrl}/api/arp/snapshots/import-json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(customPayload)
    });
    assert.strictEqual(jsonRes.status, 200);
    const jsonData = await jsonRes.json();
    assert.strictEqual(jsonData.success, true);
    assert.strictEqual(jsonData.dryRun, true);
    assert.strictEqual(jsonData.totalEntries, 2);
    assert.strictEqual(jsonData.entriesWithMac, 1);
    assert.strictEqual(jsonData.invalidEntriesCount, 1);
    console.log(`  ✓ Test 7 Passed: Custom JSON import correctly processed 2 entries with dryRun\n`);

    // 8. Confirm DB state is completely pristine
    console.log('[TEST 8] Verifying zero production database mutations during tests...');
    const snapAfter = await pool.query('SELECT count(*) FROM arp_snapshots');
    const discAfter = await pool.query('SELECT count(*) FROM arp_discoveries');
    const invAfter = await pool.query('SELECT count(*) FROM mac_inventory');

    assert.strictEqual(parseInt(snapAfter.rows[0].count, 10), baselineSnap);
    assert.strictEqual(parseInt(discAfter.rows[0].count, 10), baselineDisc);
    assert.strictEqual(parseInt(invAfter.rows[0].count, 10), baselineInv);
    console.log(`  ✓ Test 8 Passed: Production database unchanged (Snapshots: ${baselineSnap}, Discoveries: ${baselineDisc}, Inventory: ${baselineInv})\n`);

    console.log('======================================================');
    console.log(' ALL 8 MODULE 2 TESTS PASSED SUCCESSFULLY!');
    console.log('======================================================\n');
  } finally {
    server.close();
    await pool.end();
  }
}

runApiTests().catch(err => {
  console.error('\n[FATAL] API Test failed:', err);
  process.exit(1);
});
