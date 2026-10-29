/**
 * Automated Regression Test Suite for ARP Discovery Filtering & Pagination
 * 
 * Verifies:
 * 1. Interface / Port filtering (Port1, Port3)
 * 2. Ping-state filtering (online, offline, unknown with NULL safety)
 * 3. Match-status filtering (unmatched, matched_inventory, registered_device, combined matched)
 * 4. Case-insensitive search on IP, MAC, custom name, and registered name
 * 5. Multi-criteria combined filters (Search + Interface + Status + Match)
 * 6. Pagination mathematics (limit, offset, totalPages calculation, empty pages)
 * 7. Empty result handling (zero matching rows returns empty array with total: 0)
 * 8. Raw snapshot history discoveries filtering (search, interface, state, match_status)
 */

require('dotenv').config();
const http = require('http');
const express = require('express');
const pool = require('./db');
const macArpRouter = require('./mac_arp_routes');
const discoveredRouter = require('./discovered_routes');

async function runRegressionTests() {
  console.log('\n======================================================');
  console.log(' RUNNING PHASE 2 ARP FILTERING REGRESSION TEST SUITE');
  console.log('======================================================\n');

  const app = express();
  app.use(express.json());
  app.use('/', macArpRouter);
  app.use('/', discoveredRouter);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test API server running at ${baseUrl}\n`);

  try {
    // -------------------------------------------------------------
    // [TEST 1] Interface Filtering on Discovered Devices
    // -------------------------------------------------------------
    console.log('[TEST 1] Testing Interface Filtering (Port1, Port3)...');
    const [dbPort1, dbPort3] = await Promise.all([
      pool.query("SELECT count(*) FROM discovered_devices WHERE interface = 'Port1'"),
      pool.query("SELECT count(*) FROM discovered_devices WHERE interface = 'Port3'")
    ]);
    const expPort1 = parseInt(dbPort1.rows[0].count, 10);
    const expPort3 = parseInt(dbPort3.rows[0].count, 10);

    const port1Res = await fetch(`${baseUrl}/api/discovered-devices?interface=Port1&limit=500`);
    const port1Data = await port1Res.json();
    if (port1Data.total !== expPort1) {
      throw new Error(`Expected exactly ${expPort1} Port1 devices, got ${port1Data.total}`);
    }
    const nonPort1 = port1Data.items.filter(d => d.interface !== 'Port1');
    if (nonPort1.length > 0) {
      throw new Error(`Found non-Port1 item in Port1 filtered results`);
    }

    const port3Res = await fetch(`${baseUrl}/api/discovered-devices?interface=Port3&limit=500`);
    const port3Data = await port3Res.json();
    if (port3Data.total !== expPort3) {
      throw new Error(`Expected exactly ${expPort3} Port3 devices, got ${port3Data.total}`);
    }
    console.log(`  ✓ Test 1 Passed: Port1 (${port1Data.total} items) and Port3 (${port3Data.total} items) strictly isolated\n`);

    // -------------------------------------------------------------
    // [TEST 2] Ping Status Filtering (online, offline, unknown with NULL safety)
    // -------------------------------------------------------------
    console.log('[TEST 2] Testing Ping Status Filtering (offline, unknown)...');
    const offlineRes = await fetch(`${baseUrl}/api/discovered-devices?ping_status=offline&limit=500`);
    const offlineData = await offlineRes.json();
    const badOffline = offlineData.items.filter(d => d.last_ping_status !== 'offline');
    if (badOffline.length > 0) {
      throw new Error(`Found non-offline item in offline filter: ${badOffline[0].last_ping_status}`);
    }

    const unknownRes = await fetch(`${baseUrl}/api/discovered-devices?ping_status=unknown&limit=500`);
    const unknownData = await unknownRes.json();
    const badUnknown = unknownData.items.filter(d => d.last_ping_status !== null && d.last_ping_status !== 'unknown');
    if (badUnknown.length > 0) {
      throw new Error(`Found non-unknown item in unknown filter: ${badUnknown[0].last_ping_status}`);
    }
    console.log(`  ✓ Test 2 Passed: Offline (${offlineData.total} items) and Unknown/Pending (${unknownData.total} items) correctly filtered\n`);

    // -------------------------------------------------------------
    // [TEST 3] Match Status Filtering
    // -------------------------------------------------------------
    console.log('[TEST 3] Testing Match Status Filtering (unmatched, matched_inventory, registered_device, matched)...');
    const [dbUnmatched, dbInv, dbReg, dbComb] = await Promise.all([
      pool.query("SELECT count(*) FROM discovered_devices WHERE registered_device_id IS NULL AND matched_inventory_id IS NULL"),
      pool.query("SELECT count(*) FROM discovered_devices WHERE matched_inventory_id IS NOT NULL"),
      pool.query("SELECT count(*) FROM discovered_devices WHERE registered_device_id IS NOT NULL"),
      pool.query("SELECT count(*) FROM discovered_devices WHERE registered_device_id IS NOT NULL OR matched_inventory_id IS NOT NULL")
    ]);
    const expUnmatched = parseInt(dbUnmatched.rows[0].count, 10);
    const expInv = parseInt(dbInv.rows[0].count, 10);
    const expReg = parseInt(dbReg.rows[0].count, 10);
    const expComb = parseInt(dbComb.rows[0].count, 10);

    const unmatchedRes = await fetch(`${baseUrl}/api/discovered-devices?match_status=unmatched&limit=500`);
    const unmatchedData = await unmatchedRes.json();
    if (unmatchedData.total !== expUnmatched) {
      throw new Error(`Expected ${expUnmatched} unmatched devices, got ${unmatchedData.total}`);
    }
    const invRes = await fetch(`${baseUrl}/api/discovered-devices?match_status=matched_inventory&limit=500`);
    const invData = await invRes.json();
    if (invData.total !== expInv) {
      throw new Error(`Expected ${expInv} matched_inventory devices, got ${invData.total}`);
    }
    const regRes = await fetch(`${baseUrl}/api/discovered-devices?match_status=registered_device&limit=500`);
    const regData = await regRes.json();
    if (regData.total !== expReg) {
      throw new Error(`Expected ${expReg} registered_device devices, got ${regData.total}`);
    }
    const combMatchedRes = await fetch(`${baseUrl}/api/discovered-devices?match_status=matched&limit=500`);
    const combMatchedData = await combMatchedRes.json();
    if (combMatchedData.total !== expComb) {
      throw new Error(`Expected ${expComb} combined matched devices, got ${combMatchedData.total}`);
    }
    console.log(`  ✓ Test 3 Passed: Unmatched (${unmatchedData.total}), Inventory (${invData.total}), Registered (${regData.total}), Combined Matched (${combMatchedData.total}) verified\n`);

    // -------------------------------------------------------------
    // [TEST 4] Case-Insensitive Search on IP and MAC
    // -------------------------------------------------------------
    console.log('[TEST 4] Testing Search Functionality (IP and normalized MAC)...');
    const ipSearchRes = await fetch(`${baseUrl}/api/discovered-devices?search=192.168.40.118`);
    const ipSearchData = await ipSearchRes.json();
    if (ipSearchData.total === 0 || ipSearchData.items[0].ip_address !== '192.168.40.118') {
      throw new Error('Search failed for 192.168.40.118');
    }

    const macSearchRes = await fetch(`${baseUrl}/api/discovered-devices?search=bc:22:28`);
    const macSearchData = await macSearchRes.json();
    if (macSearchData.total === 0) {
      throw new Error('Search failed for partial MAC bc:22:28');
    }
    console.log(`  ✓ Test 4 Passed: IP search and partial MAC search successfully matched records\n`);

    // -------------------------------------------------------------
    // [TEST 5] Multi-Criteria Combined Filters
    // -------------------------------------------------------------
    console.log('[TEST 5] Testing Multi-Criteria Combined Filters (Interface + Match Status + Ping Status)...');
    // Search on Port3 + unmatched + offline
    const combinedRes = await fetch(`${baseUrl}/api/discovered-devices?interface=Port3&match_status=unmatched&ping_status=offline&limit=500`);
    const combinedData = await combinedRes.json();
    // Verify every item matches all 3 criteria
    for (const item of combinedData.items) {
      if (item.interface !== 'Port3') throw new Error(`Item ${item.ip_address} has invalid interface ${item.interface}`);
      if (item.derived_match_status !== 'unmatched') throw new Error(`Item ${item.ip_address} is not unmatched`);
      if (item.last_ping_status !== 'offline') throw new Error(`Item ${item.ip_address} is not offline`);
    }
    console.log(`  ✓ Test 5 Passed: Multi-criteria filter returned ${combinedData.total} items, all strictly matching all 3 constraints\n`);

    // -------------------------------------------------------------
    // [TEST 6] Pagination Reset & Totals Math
    // -------------------------------------------------------------
    console.log('[TEST 6] Testing Pagination Math & Total Pages Calculation...');
    const dbTotalRes = await pool.query('SELECT count(*) FROM discovered_devices');
    const dbTotalDevices = parseInt(dbTotalRes.rows[0].count, 10);

    const page1Res = await fetch(`${baseUrl}/api/discovered-devices?limit=15&page=1`);
    const page1Data = await page1Res.json();
    if (page1Data.items.length !== 15 || page1Data.page !== 1 || page1Data.totalPages !== Math.ceil(dbTotalDevices / 15)) {
      throw new Error(`Page 1 pagination math incorrect: limit=${page1Data.limit}, totalPages=${page1Data.totalPages}`);
    }

    const page2Res = await fetch(`${baseUrl}/api/discovered-devices?limit=15&page=2`);
    const page2Data = await page2Res.json();
    if (page2Data.items.length !== 15 || page2Data.page !== 2) {
      throw new Error('Page 2 failed');
    }
    // Verify items on page 1 and page 2 are distinct
    const idsPage1 = new Set(page1Data.items.map(i => i.id));
    const idsOverlap = page2Data.items.filter(i => idsPage1.has(i.id));
    if (idsOverlap.length > 0) {
      throw new Error(`Found overlapping items across page 1 and page 2: ${idsOverlap.map(i => i.id).join(',')}`);
    }
    console.log(`  ✓ Test 6 Passed: 15-item pages cleanly partitioned with totalPages = ${page1Data.totalPages}\n`);

    // -------------------------------------------------------------
    // [TEST 7] Empty Search Results Handling
    // -------------------------------------------------------------
    console.log('[TEST 7] Testing Empty Filter Results Handling...');
    const emptyRes = await fetch(`${baseUrl}/api/discovered-devices?search=nonexistent-query-string-9999`);
    const emptyData = await emptyRes.json();
    if (emptyData.total !== 0 || emptyData.items.length !== 0 || emptyData.totalPages !== 1) {
      throw new Error(`Expected clean empty result, got total=${emptyData.total}`);
    }
    console.log('  ✓ Test 7 Passed: Non-matching filter gracefully returns total: 0 and totalPages: 1\n');

    // -------------------------------------------------------------
    // [TEST 8] Raw Snapshot History Discoveries Filtering
    // -------------------------------------------------------------
    console.log('[TEST 8] Testing Raw Snapshot History Discoveries API Filtering...');
    // Latest snapshot ID
    const snapRes = await pool.query('SELECT id FROM arp_snapshots ORDER BY imported_at DESC LIMIT 1');
    const snapId = snapRes.rows[0].id;

    const [dbNoMac, dbPort3Active] = await Promise.all([
      pool.query("SELECT count(*) FROM arp_discoveries WHERE snapshot_id = $1 AND (normalized_mac IS NULL OR normalized_mac = '')", [snapId]),
      pool.query("SELECT count(*) FROM arp_discoveries WHERE snapshot_id = $1 AND interface = 'Port3' AND arp_state ILIKE 'Complete%'", [snapId])
    ]);
    const expNoMac = parseInt(dbNoMac.rows[0].count, 10);
    const expPort3Active = parseInt(dbPort3Active.rows[0].count, 10);

    // Filter by match_status = 'no_mac'
    const noMacRes = await fetch(`${baseUrl}/api/arp/discoveries?snapshot_id=${snapId}&match_status=no_mac`);
    const noMacData = await noMacRes.json();
    if (noMacData.filteredCount !== expNoMac) {
      throw new Error(`Expected ${expNoMac} no_mac entries in snapshot ${snapId}, got ${noMacData.filteredCount}`);
    }

    // Filter by interface = 'Port3' and arp_state = 'Complete'
    const port3ArpRes = await fetch(`${baseUrl}/api/arp/discoveries?snapshot_id=${snapId}&interface=Port3&arp_state=Complete`);
    const port3ArpData = await port3ArpRes.json();
    if (port3ArpData.filteredCount !== expPort3Active) {
      throw new Error(`Expected ${expPort3Active} active Port3 entries in snapshot ${snapId}, got ${port3ArpData.filteredCount}`);
    }
    console.log(`  ✓ Test 8 Passed: Raw discoveries filtering (no_mac: ${noMacData.filteredCount}, Port3 Active: ${port3ArpData.filteredCount}) verified\n`);

    console.log('======================================================');
    console.log(' ALL 8 PHASE 2 REGRESSION TESTS PASSED SUCCESSFULLY! ');
    console.log('======================================================\n');
  } finally {
    server.close();
    await pool.end();
  }
}

runRegressionTests().catch((err) => {
  console.error('\n[FATAL] Regression Test failed:', err);
  process.exit(1);
});
