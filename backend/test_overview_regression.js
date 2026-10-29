/**
 * Automated Test Suite for Phase 3: Unified Overview Dashboard API
 *
 * Verifies:
 * 1. GET /api/overview/unified-summary metrics accuracy and deduplication (209 total: 26 reg + 183 unmanaged)
 * 2. Ping reachability summation consistency (responding + no_reply + unknown = 209)
 * 3. Freshness threshold enforcement
 * 4. Latest ARP poll metadata panel data
 * 5. GET /api/overview/unified-devices listing, deduplicated total, pagination
 * 6. Category filters (MANAGED: 26, UNMANAGED: 183, INVENTORY_MATCHED: 27, NEWLY_DISCOVERED: 58)
 * 7. Reachability filters (ONLINE, OFFLINE, UNKNOWN)
 * 8. Search query matching and empty result handling
 */

require('dotenv').config();
const http = require('http');
const express = require('express');
const pool = require('./db');
const overviewRouter = require('./overview_routes');

async function runOverviewTests() {
  console.log('\n======================================================');
  console.log(' RUNNING PHASE 3 OVERVIEW UNIFIED DASHBOARD TESTS');
  console.log('======================================================\n');

  const app = express();
  app.use(express.json());
  app.use('/', overviewRouter);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test API server running at ${baseUrl}\n`);

  try {
    // -------------------------------------------------------------
    // Query Live Database State for Verification
    // -------------------------------------------------------------
    const [dbReg, dbUnmanaged, dbLatestSnap, dbDiscMatch] = await Promise.all([
      pool.query('SELECT count(*) FROM devices'),
      pool.query('SELECT count(*) FROM discovered_devices WHERE registered_device_id IS NULL'),
      pool.query('SELECT * FROM arp_snapshots ORDER BY imported_at DESC, id DESC LIMIT 1'),
      pool.query('SELECT count(matched_inventory_id) as matched_inv, count(registered_device_id) as matched_reg FROM discovered_devices')
    ]);
    const expectedRegCount = parseInt(dbReg.rows[0].count, 10);
    const expectedUnmanagedCount = parseInt(dbUnmanaged.rows[0].count, 10);
    const expectedTotalAssets = expectedRegCount + expectedUnmanagedCount;
    const latestSnapDb = dbLatestSnap.rows[0];
    const expectedMatchedInv = parseInt(dbDiscMatch.rows[0].matched_inv, 10);
    const expectedMatchedReg = parseInt(dbDiscMatch.rows[0].matched_reg, 10);

    // -------------------------------------------------------------
    // [TEST 1] GET /api/overview/unified-summary
    // -------------------------------------------------------------
    console.log('[TEST 1] Testing Unified Summary Metrics & Deduplication...');
    const sumRes = await fetch(`${baseUrl}/api/overview/unified-summary`);
    const summary = await sumRes.json();

    if (summary.registered_devices_count !== expectedRegCount) {
      throw new Error(`Expected ${expectedRegCount} registered devices, got ${summary.registered_devices_count}`);
    }
    if (latestSnapDb && summary.latest_arp_raw_count !== latestSnapDb.total_entries) {
      throw new Error(`Expected ${latestSnapDb.total_entries} latest ARP raw entries, got ${summary.latest_arp_raw_count}`);
    }
    if (latestSnapDb && summary.valid_mac_devices_count !== latestSnapDb.entries_with_mac) {
      throw new Error(`Expected ${latestSnapDb.entries_with_mac} valid MAC devices, got ${summary.valid_mac_devices_count}`);
    }
    if (summary.unmanaged_discovered_count !== expectedUnmanagedCount) {
      throw new Error(`Expected ${expectedUnmanagedCount} unmanaged discovered devices, got ${summary.unmanaged_discovered_count}`);
    }
    if (summary.total_unique_observed_assets !== expectedTotalAssets) {
      throw new Error(`Expected ${expectedTotalAssets} total unique assets (${expectedRegCount} + ${expectedUnmanagedCount}), got ${summary.total_unique_observed_assets}`);
    }
    if (summary.matched_to_inventory_count !== expectedMatchedInv) {
      throw new Error(`Expected ${expectedMatchedInv} matched to inventory, got ${summary.matched_to_inventory_count}`);
    }
    if (summary.matched_to_registered_count !== expectedMatchedReg) {
      throw new Error(`Expected ${expectedMatchedReg} matched to registered, got ${summary.matched_to_registered_count}`);
    }

    // Verify reachability sum
    const reachabilitySum = summary.ping_responding_count + summary.ping_no_reply_count + summary.ping_unknown_stale_count;
    if (reachabilitySum !== summary.total_unique_observed_assets) {
      throw new Error(`Reachability sum (${reachabilitySum}) does not equal total assets (${summary.total_unique_observed_assets})`);
    }

    console.log(`  ✓ Test 1 Passed: Deduplicated total unique assets = ${summary.total_unique_observed_assets} (${summary.registered_devices_count} Managed + ${summary.unmanaged_discovered_count} Unmanaged)`);
    console.log(`    Reachability: ${summary.ping_responding_count} Online, ${summary.ping_no_reply_count} No Reply, ${summary.ping_unknown_stale_count} Unknown/Stale (Sum = ${reachabilitySum})\n`);

    // -------------------------------------------------------------
    // [TEST 2] Latest ARP Poll Metadata Panel
    // -------------------------------------------------------------
    console.log('[TEST 2] Verifying Latest ARP Poll Panel Metadata...');
    const snap = summary.latest_snapshot;
    if (!snap || snap.id !== latestSnapDb.id || snap.total_entries !== latestSnapDb.total_entries || snap.entries_with_mac !== latestSnapDb.entries_with_mac) {
      throw new Error('Latest snapshot metadata incorrect in summary response');
    }
    console.log(`  ✓ Test 2 Passed: Snapshot #${snap.id} (${snap.name}) metadata verified (${snap.total_entries} raw, ${snap.entries_with_mac} valid MAC, ${snap.incomplete_entries} incomplete)\n`);

    // -------------------------------------------------------------
    // [TEST 3] GET /api/overview/unified-devices Pagination
    // -------------------------------------------------------------
    console.log('[TEST 3] Testing Unified Devices Paginated List...');
    const devRes = await fetch(`${baseUrl}/api/overview/unified-devices?page=1&limit=25`);
    const devData = await devRes.json();

    if (devData.total !== expectedTotalAssets) {
      throw new Error(`Expected ${expectedTotalAssets} total unified devices, got ${devData.total}`);
    }
    if (devData.items.length !== Math.min(25, expectedTotalAssets)) {
      throw new Error(`Expected ${Math.min(25, expectedTotalAssets)} items on page 1, got ${devData.items.length}`);
    }
    if (devData.totalPages !== Math.ceil(expectedTotalAssets / 25)) {
      throw new Error(`Expected ${Math.ceil(expectedTotalAssets / 25)} totalPages, got ${devData.totalPages}`);
    }
    console.log(`  ✓ Test 3 Passed: ${devData.items.length} items returned on page 1 of ${devData.totalPages} pages (total: ${devData.total})\n`);

    // -------------------------------------------------------------
    // [TEST 4] Classification Filters (MANAGED vs UNMANAGED)
    // -------------------------------------------------------------
    console.log('[TEST 4] Testing Classification Filters (MANAGED vs UNMANAGED)...');
    const managedRes = await fetch(`${baseUrl}/api/overview/unified-devices?filter=MANAGED&limit=500`);
    const managedData = await managedRes.json();
    if (managedData.total !== expectedRegCount) {
      throw new Error(`Expected exactly ${expectedRegCount} managed devices, got ${managedData.total}`);
    }
    const badManaged = managedData.items.filter(d => d.classification !== 'managed');
    if (badManaged.length > 0) throw new Error('Found non-managed device in MANAGED filter');

    const unmanagedRes = await fetch(`${baseUrl}/api/overview/unified-devices?filter=UNMANAGED&limit=500`);
    const unmanagedData = await unmanagedRes.json();
    if (unmanagedData.total !== expectedUnmanagedCount) {
      throw new Error(`Expected exactly ${expectedUnmanagedCount} unmanaged devices, got ${unmanagedData.total}`);
    }
    const badUnmanaged = unmanagedData.items.filter(d => d.classification !== 'unmanaged');
    if (badUnmanaged.length > 0) throw new Error('Found non-unmanaged device in UNMANAGED filter');

    console.log(`  ✓ Test 4 Passed: MANAGED (${managedData.total}) and UNMANAGED (${unmanagedData.total}) cleanly segregated\n`);

    // -------------------------------------------------------------
    // [TEST 5] Inventory Matched and Newly Discovered Filters
    // -------------------------------------------------------------
    console.log('[TEST 5] Testing INVENTORY_MATCHED and NEWLY_DISCOVERED Filters...');
    const invRes = await fetch(`${baseUrl}/api/overview/unified-devices?filter=INVENTORY_MATCHED&limit=500`);
    const invData = await invRes.json();
    if (invData.total !== expectedMatchedInv) {
      throw new Error(`Expected ${expectedMatchedInv} inventory matched devices, got ${invData.total}`);
    }

    const newRes = await fetch(`${baseUrl}/api/overview/unified-devices?filter=NEWLY_DISCOVERED&limit=500`);
    const newData = await newRes.json();
    if (newData.total !== summary.newly_discovered_endpoints_count) {
      throw new Error(`Expected ${summary.newly_discovered_endpoints_count} newly discovered endpoint observations, got ${newData.total}`);
    }
    console.log(`  ✓ Test 5 Passed: INVENTORY_MATCHED (${invData.total}) and NEWLY_DISCOVERED (${newData.total}) verified\n`);

    // -------------------------------------------------------------
    // [TEST 6] Reachability Filters (ONLINE, OFFLINE, UNKNOWN & Parity)
    // -------------------------------------------------------------
    console.log('[TEST 6] Testing Reachability Status Filters (ONLINE vs OFFLINE vs UNKNOWN)...');
    // Fetch summary and filters concurrently to prevent timestamp drift across freshness boundary
    const [currentSumRes, onlineRes, offlineRes, unknownRes] = await Promise.all([
      fetch(`${baseUrl}/api/overview/unified-summary`),
      fetch(`${baseUrl}/api/overview/unified-devices?filter=ONLINE&limit=200`),
      fetch(`${baseUrl}/api/overview/unified-devices?filter=OFFLINE&limit=200`),
      fetch(`${baseUrl}/api/overview/unified-devices?filter=UNKNOWN&limit=200`)
    ]);
    const currentSummary = await currentSumRes.json();
    const onlineData = await onlineRes.json();
    const offlineData = await offlineRes.json();
    const unknownData = await unknownRes.json();

    const badOnline = onlineData.items.filter(d => d.effective_ping_status !== 'online');
    if (badOnline.length > 0) throw new Error('Found non-online device in ONLINE filter');

    const badOffline = offlineData.items.filter(d => d.effective_ping_status !== 'offline');
    if (badOffline.length > 0) throw new Error('Found non-offline device in OFFLINE filter');

    const badUnknown = unknownData.items.filter(d => d.effective_ping_status !== 'unknown');
    if (badUnknown.length > 0) throw new Error('Found non-unknown device in UNKNOWN filter');

    // Strict parity check between summary numbers and device filter totals
    if (onlineData.total !== currentSummary.ping_responding_count) {
      throw new Error(`Reachability mismatch: ONLINE devices (${onlineData.total}) != summary (${currentSummary.ping_responding_count})`);
    }
    if (offlineData.total !== currentSummary.ping_no_reply_count) {
      throw new Error(`Reachability mismatch: OFFLINE devices (${offlineData.total}) != summary (${currentSummary.ping_no_reply_count})`);
    }
    if (unknownData.total !== currentSummary.ping_unknown_stale_count) {
      throw new Error(`Reachability mismatch: UNKNOWN devices (${unknownData.total}) != summary (${currentSummary.ping_unknown_stale_count})`);
    }

    const devicesReachabilitySum = onlineData.total + offlineData.total + unknownData.total;
    if (devicesReachabilitySum !== currentSummary.total_unique_observed_assets) {
      throw new Error(`Reachability sum (${devicesReachabilitySum}) != total assets (${currentSummary.total_unique_observed_assets})`);
    }

    console.log(`  ✓ Test 6 Passed: Reachability filters verified (ONLINE: ${onlineData.total}, OFFLINE: ${offlineData.total}, UNKNOWN: ${unknownData.total}, Sum: ${devicesReachabilitySum} matches total)\n`);

    // -------------------------------------------------------------
    // [TEST 7] Search and Empty Result Handling
    // -------------------------------------------------------------
    console.log('[TEST 7] Testing Search on Unified Devices & Empty Results...');
    const searchRes = await fetch(`${baseUrl}/api/overview/unified-devices?search=Airtel`);
    const searchData = await searchRes.json();
    if (searchData.total === 0 || !searchData.items[0].name.includes('Airtel')) {
      throw new Error('Search failed for "Airtel"');
    }

    const emptyRes = await fetch(`${baseUrl}/api/overview/unified-devices?search=nonexistent-query-railway-xyz`);
    const emptyData = await emptyRes.json();
    if (emptyData.total !== 0 || emptyData.items.length !== 0 || emptyData.totalPages !== 1) {
      throw new Error('Empty search result not handled cleanly');
    }
    console.log(`  ✓ Test 7 Passed: Search matched "${searchData.items[0].name}" and empty query returned 0 items cleanly\n`);

    console.log('======================================================');
    console.log(' ALL 7 PHASE 3 OVERVIEW TESTS PASSED SUCCESSFULLY!    ');
    console.log('======================================================\n');
  } finally {
    server.close();
    await pool.end();
  }
}

runOverviewTests().catch((err) => {
  console.error('\n[FATAL] Overview Test failed:', err);
  process.exit(1);
});
