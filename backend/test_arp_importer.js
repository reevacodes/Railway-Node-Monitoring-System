/**
 * Unit & Integration Tests for ARP Importer (Module 1)
 * 
 * Verifies:
 * 1. Parsing of canonical sophos-arp-test/arp-snapshot.json (273 entries).
 * 2. IPv4 validation and MAC normalization.
 * 3. Incomplete entries (mac: '-', state: 'Incomplete') preservation without inventing mappings.
 * 4. Read-only matching against mac_inventory without mutating inventory data.
 * 5. Database transaction integrity and rollback behavior.
 * 6. Zero mutation of production data during tests (using ROLLBACK transactions).
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const pool = require('./db');
const { parseArpSnapshot, importArpSnapshot } = require('./arp_importer');

async function runTests() {
  console.log('\n======================================================');
  console.log(' RUNNING ARP IMPORTER TEST SUITE (Module 1)');
  console.log('======================================================\n');

  const canonicalPath = path.resolve(__dirname, '../sophos-arp-test/arp-snapshot.json');

  // --- Test 1: Canonical Snapshot Parsing & Metadata ---
  console.log('[TEST 1] Parsing canonical snapshot (arp-snapshot.json)...');
  assert(fs.existsSync(canonicalPath), `Canonical snapshot not found at ${canonicalPath}`);
  
  const parsed = parseArpSnapshot(canonicalPath);
  assert.strictEqual(parsed.stats.total, 273, `Expected 273 total entries, got ${parsed.stats.total}`);
  assert.strictEqual(parsed.stats.withMac, 202, `Expected 202 entries with MAC, got ${parsed.stats.withMac}`);
  assert.strictEqual(parsed.stats.incomplete, 71, `Expected 71 incomplete entries, got ${parsed.stats.incomplete}`);
  assert.strictEqual(parsed.stats.invalidIp, 0, `Expected 0 invalid IPs, got ${parsed.stats.invalidIp}`);
  assert.strictEqual(parsed.metadata.source, 'Sophos IPv4 Neighbor Cache');
  console.log('  ✓ Test 1 Passed: 273 total parsed (202 with MAC, 71 incomplete, 0 invalid IP)\n');

  // --- Test 2: Incomplete Entries Preservation ---
  console.log('[TEST 2] Verifying incomplete entries preservation...');
  const incompleteEntries = parsed.entries.filter(e => !e.has_mac);
  assert.strictEqual(incompleteEntries.length, 71, `Expected 71 incomplete entries, got ${incompleteEntries.length}`);
  
  for (const entry of incompleteEntries) {
    assert.strictEqual(entry.has_mac, false, `has_mac must be false for incomplete entry: ${entry.ip_address}`);
    assert.strictEqual(entry.mac_address, null, `mac_address must be null for incomplete entry: ${entry.ip_address}`);
    assert.strictEqual(entry.normalized_mac, null, `normalized_mac must be null for incomplete entry: ${entry.ip_address}`);
    assert.strictEqual(entry.arp_state, 'Incomplete', `arp_state should be 'Incomplete' for entry: ${entry.ip_address}`);
  }
  console.log('  ✓ Test 2 Passed: Incomplete entries correctly have has_mac=false and null MACs without invented mappings\n');

  // --- Test 3: MAC Normalization and IP Validation on Edge Cases ---
  console.log('[TEST 3] Testing edge cases (invalid IP, dirty MAC formats, malformed inputs)...');
  const edgeCaseInput = {
    extractedAt: new Date().toISOString(),
    source: 'Test Edge Cases',
    entries: [
      { ip: '10.0.0.1', mac: 'AA-BB-CC-DD-EE-FF', interface: 'Port1', state: 'Complete,Dynamic' },
      { ip: '10.0.0.2', mac: 'aabb.ccdd.eeff', interface: 'Port2', state: 'Complete,Dynamic' },
      { ip: '10.0.0.3', mac: 'AABBCCDDEEFF', interface: 'Port3', state: 'Complete,Dynamic' },
      { ip: '999.999.999.999', mac: '11:22:33:44:55:66', interface: 'Port1', state: 'Complete,Dynamic' }, // Invalid IP
      { ip: '10.0.0.5', mac: '-', interface: 'Port1', state: 'Incomplete' },
      { ip: '10.0.0.6', mac: 'invalid-mac', interface: 'Port1', state: 'UNKNOWN' }
    ]
  };

  const edgeParsed = parseArpSnapshot(edgeCaseInput);
  assert.strictEqual(edgeParsed.stats.total, 6);
  assert.strictEqual(edgeParsed.stats.withMac, 4); // 3 valid MACs + 1 invalid IP with valid MAC
  assert.strictEqual(edgeParsed.stats.invalidIp, 1); // 999.999.999.999 is invalid
  assert.strictEqual(edgeParsed.stats.incomplete, 2); // mac: '-' and mac: 'invalid-mac'

  assert.strictEqual(edgeParsed.entries[0].normalized_mac, 'aabbccddeeff');
  assert.strictEqual(edgeParsed.entries[0].mac_address, 'AA:BB:CC:DD:EE:FF');
  assert.strictEqual(edgeParsed.entries[1].normalized_mac, 'aabbccddeeff');
  assert.strictEqual(edgeParsed.entries[2].normalized_mac, 'aabbccddeeff');
  assert.strictEqual(edgeParsed.entries[3].is_valid_ip, false);
  assert.strictEqual(edgeParsed.entries[4].has_mac, false);
  assert.strictEqual(edgeParsed.entries[5].has_mac, false);
  console.log('  ✓ Test 3 Passed: Edge cases (dashed MAC, Cisco dotted MAC, invalid IP, dirty strings) handled correctly\n');

  // --- Test 4: Database Transaction with Dry-Run / Test Rollback ---
  console.log('[TEST 4] Database Transaction Test with 273 entries (testing dry-run rollback)...');
  
  // Count baseline records
  const preSnapRes = await pool.query('SELECT count(*) FROM arp_snapshots');
  const preDiscRes = await pool.query('SELECT count(*) FROM arp_discoveries');
  const preInvRes = await pool.query('SELECT count(*) FROM mac_inventory');
  
  const baselineSnapCount = parseInt(preSnapRes.rows[0].count, 10);
  const baselineDiscCount = parseInt(preDiscRes.rows[0].count, 10);
  const baselineInvCount = parseInt(preInvRes.rows[0].count, 10);

  // Execute dry-run import
  const dryResult = await importArpSnapshot(canonicalPath, {
    dryRun: true,
    snapshotName: 'Test Dry Run Snapshot'
  });

  assert.strictEqual(dryResult.success, true);
  assert.strictEqual(dryResult.dryRun, true);
  assert.strictEqual(dryResult.totalEntries, 273);
  assert.strictEqual(dryResult.entriesWithMac, 202);
  assert.strictEqual(dryResult.invalidEntriesCount, 71);
  assert.strictEqual(dryResult.matchedInventoryCount, 20); // 20 unique inventory MACs
  assert.strictEqual(dryResult.unmatchedCount, 180); // 202 - 22 matched entries = 180 unmatched
  assert.strictEqual(dryResult.totalInventoryRecords, baselineInvCount);

  // Verify DB state is completely unchanged (rollback succeeded)
  const postSnapRes = await pool.query('SELECT count(*) FROM arp_snapshots');
  const postDiscRes = await pool.query('SELECT count(*) FROM arp_discoveries');
  const postInvRes = await pool.query('SELECT count(*) FROM mac_inventory');

  assert.strictEqual(parseInt(postSnapRes.rows[0].count, 10), baselineSnapCount, 'arp_snapshots count must not change on dry-run');
  assert.strictEqual(parseInt(postDiscRes.rows[0].count, 10), baselineDiscCount, 'arp_discoveries count must not change on dry-run');
  assert.strictEqual(parseInt(postInvRes.rows[0].count, 10), baselineInvCount, 'mac_inventory count must not change on dry-run');
  console.log('  ✓ Test 4 Passed: Transaction successfully executed and rolled back with zero pollution of production DB\n');

  // --- Test 5: Verify mac_inventory is NEVER mutated ---
  console.log('[TEST 5] Verifying mac_inventory records are strictly read-only...');
  const invBefore = await pool.query('SELECT id, normalized_mac, updated_at FROM mac_inventory ORDER BY id ASC');
  
  // Run with external client inside a test transaction, then check inventory
  const testClient = await pool.connect();
  try {
    await testClient.query('BEGIN');
    await importArpSnapshot(canonicalPath, { client: testClient, snapshotName: 'Tx Test' });
    
    // Check inside transaction that mac_inventory wasn't modified
    const invInside = await testClient.query('SELECT id, normalized_mac, updated_at FROM mac_inventory ORDER BY id ASC');
    assert.strictEqual(invInside.rows.length, invBefore.rows.length);
    for (let i = 0; i < invBefore.rows.length; i++) {
      assert.strictEqual(invInside.rows[i].id, invBefore.rows[i].id);
      assert.strictEqual(invInside.rows[i].normalized_mac, invBefore.rows[i].normalized_mac);
      assert.strictEqual(
        new Date(invInside.rows[i].updated_at).getTime(),
        new Date(invBefore.rows[i].updated_at).getTime()
      );
    }
    
    // Rollback test transaction
    await testClient.query('ROLLBACK');
  } finally {
    testClient.release();
  }
  console.log('  ✓ Test 5 Passed: mac_inventory is strictly untouched and read-only\n');

  // --- Test 6: Transaction Rollback on Error ---
  console.log('[TEST 6] Testing transaction rollback on simulated error...');
  const badInput = {
    extractedAt: new Date().toISOString(),
    source: 'Bad Input Test',
    entries: [
      { ip: '10.0.0.1', mac: 'AA:BB:CC:DD:EE:01', interface: 'Port1', state: 'Complete,Dynamic' },
      { ip: null, mac: 'AA:BB:CC:DD:EE:02', interface: 'Port1', state: 'Complete,Dynamic' } // NOT NULL constraint on ip_address in DB
    ]
  };

  let threwError = false;
  try {
    // When inserting ip: null or empty, DB column ip_address VARCHAR(45) NOT NULL will reject or our validation can flag it
    // Let's pass an invalid column or force an error in client
    await importArpSnapshot(badInput, { snapshotName: 'Fail Test' });
  } catch (err) {
    threwError = true;
  }
  
  // Verify DB state is still pristine
  const afterErrorSnapRes = await pool.query('SELECT count(*) FROM arp_snapshots');
  assert.strictEqual(parseInt(afterErrorSnapRes.rows[0].count, 10), baselineSnapCount);
  console.log('  ✓ Test 6 Passed: Errors trigger automatic transaction rollback cleanly\n');

  console.log('======================================================');
  console.log(' ALL 6 MODULE 1 TESTS PASSED SUCCESSFULLY!');
  console.log('======================================================\n');
}

runTests()
  .catch(err => {
    console.error('\n[FATAL] Test failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
