require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const assert = require('assert');
const pool = require('./db');
const {
  recordPollAttempt,
  recordPollFailure,
  recordPollSuccessDuplicate,
  recordPollSuccessNew,
  getPersistedPollerStatus,
  runArpPollingCycle
} = require('./sophos_arp_service');

async function runTests() {
  console.log('====================================================');
  console.log('TEST SUITE: Three Separate Timestamps for Sophos Poller');
  console.log('====================================================\n');

  // Step 0: Ensure table exists and baseline status is read
  const initial = await getPersistedPollerStatus();
  console.log('Baseline Poller State:', {
    last_attempt_at: initial.last_attempt_at,
    last_success_at: initial.last_success_at,
    snapshot_created_at: initial.snapshot_created_at,
    polling_status: initial.polling_status
  });
  assert(initial.last_attempt_at, 'Baseline last_attempt_at must be populated');
  assert(initial.last_success_at, 'Baseline last_success_at must be populated');
  assert(initial.snapshot_created_at, 'Baseline snapshot_created_at must be populated');

  const baselineAttempt = new Date(initial.last_attempt_at).getTime();
  const baselineSuccess = new Date(initial.last_success_at).getTime();
  const baselineSnapshot = new Date(initial.snapshot_created_at).getTime();

  // Test 1: Record a new polling attempt
  console.log('\n--- Test 1: Poll Attempt Initiated ---');
  await new Promise(r => setTimeout(r, 100)); // slight tick
  await recordPollAttempt();
  const afterAttempt = await getPersistedPollerStatus();
  const attemptTime = new Date(afterAttempt.last_attempt_at).getTime();
  const successTime = new Date(afterAttempt.last_success_at).getTime();
  const snapTime = new Date(afterAttempt.snapshot_created_at).getTime();

  assert(attemptTime >= baselineAttempt, 'last_attempt_at must be updated on poll attempt');
  assert.strictEqual(successTime, baselineSuccess, 'last_success_at must remain UNCHANGED during attempt');
  assert.strictEqual(snapTime, baselineSnapshot, 'snapshot_created_at must remain UNCHANGED during attempt');
  assert.strictEqual(afterAttempt.polling_status, 'in_progress', 'status must be in_progress');
  console.log('✓ Test 1 Passed: Only last_attempt_at updated, status is in_progress');

  // Test 2: Extraction failure (e.g. timeout / connection failure)
  console.log('\n--- Test 2: Extraction/Validation Failure ---');
  await new Promise(r => setTimeout(r, 100));
  await recordPollFailure('Simulated connection timeout to https://192.168.40.1:4444', 15000);
  const afterFail = await getPersistedPollerStatus();

  assert.strictEqual(afterFail.polling_status, 'failed', 'polling_status must be failed');
  assert.strictEqual(afterFail.last_error, 'Simulated connection timeout to https://192.168.40.1:4444');
  assert.strictEqual(new Date(afterFail.last_success_at).getTime(), baselineSuccess, 'last_success_at must NOT update on failure');
  assert.strictEqual(new Date(afterFail.snapshot_created_at).getTime(), baselineSnapshot, 'snapshot_created_at must NOT update on failure');
  console.log('✓ Test 2 Passed: Failure records error & updates status; last_success_at and snapshot_created_at preserved');

  // Test 3: Successful extraction with identical data (Duplicate skipped)
  console.log('\n--- Test 3: Successful Extraction with Identical Data (Duplicate Skipped) ---');
  await new Promise(r => setTimeout(r, 100));
  await recordPollAttempt();
  await new Promise(r => setTimeout(r, 100));
  await recordPollSuccessDuplicate(545, 517, 3200);
  const afterDup = await getPersistedPollerStatus();
  const dupSuccessTime = new Date(afterDup.last_success_at).getTime();
  const dupSnapTime = new Date(afterDup.snapshot_created_at).getTime();

  assert(dupSuccessTime > baselineSuccess, 'last_success_at MUST update on successful duplicate extraction');
  assert.strictEqual(dupSnapTime, baselineSnapshot, 'snapshot_created_at MUST NOT update when duplicate snapshot skipped');
  assert.strictEqual(afterDup.polling_status, 'success_duplicate', 'polling_status must be success_duplicate');
  assert.strictEqual(afterDup.last_error, null, 'last_error must be cleared on success');
  console.log('✓ Test 3 Passed: last_success_at updated, snapshot_created_at unchanged, status is success_duplicate');

  // Test 4: Successful extraction with distinct snapshot created
  console.log('\n--- Test 4: Successful Extraction with New Distinct Snapshot ---');
  await new Promise(r => setTimeout(r, 100));
  await recordPollAttempt();
  await new Promise(r => setTimeout(r, 100));
  const testSnapshotId = initial.last_snapshot_id || 94;
  await recordPollSuccessNew(testSnapshotId, 550, 520, 4500);
  const afterNew = await getPersistedPollerStatus();
  const newSuccessTime = new Date(afterNew.last_success_at).getTime();
  const newSnapTime = new Date(afterNew.snapshot_created_at).getTime();

  assert(newSuccessTime >= dupSuccessTime, 'last_success_at MUST update on new snapshot');
  assert(newSnapTime > baselineSnapshot, 'snapshot_created_at MUST update on new snapshot creation');
  assert.strictEqual(afterNew.polling_status, 'success_new', 'polling_status must be success_new');
  assert.strictEqual(afterNew.last_snapshot_id, testSnapshotId);
  console.log('✓ Test 4 Passed: All three timestamps updated, status is success_new');

  // Test 5: Backend restart / persistence check from direct raw DB query
  console.log('\n--- Test 5: Database Persistence & Raw Table Query ---');
  const dbRes = await pool.query('SELECT * FROM sophos_poller_status WHERE id = 1');
  assert.strictEqual(dbRes.rows.length, 1);
  const dbRow = dbRes.rows[0];
  assert.strictEqual(new Date(dbRow.last_attempt_at).toISOString(), new Date(afterNew.last_attempt_at).toISOString());
  assert.strictEqual(new Date(dbRow.last_success_at).toISOString(), new Date(afterNew.last_success_at).toISOString());
  assert.strictEqual(new Date(dbRow.snapshot_created_at).toISOString(), new Date(afterNew.snapshot_created_at).toISOString());
  assert.strictEqual(dbRow.polling_status, 'success_new');
  console.log('✓ Test 5 Passed: All timestamps and metadata persisted identically in database');

  // Test 6: Verify Overview Route endpoint returns the new contract
  console.log('\n--- Test 6: Overview Route Response Schema Verification ---');
  let ovData;
  try {
    const overviewRes = await fetch('http://localhost:5001/api/overview/unified-summary');
    if (overviewRes.ok) {
      const parsed = await overviewRes.json();
      if ('last_attempt_at' in parsed) {
        ovData = parsed;
      }
    }
  } catch (e) {
    // fallback to isolated express test below
  }

  if (!ovData) {
    console.log('Testing route handler with fresh express instance...');
    const express = require('express');
    const ovRouter = require('./overview_routes');
    const app = express();
    app.use(ovRouter);
    const testServer = await new Promise(res => {
      const s = app.listen(5098, () => res(s));
    });
    try {
      const res = await fetch('http://localhost:5098/api/overview/unified-summary');
      ovData = await res.json();
    } finally {
      await new Promise(r => testServer.close(r));
    }
  }

  assert('last_attempt_at' in ovData, 'Overview API must expose last_attempt_at');
  assert('last_success_at' in ovData, 'Overview API must expose last_success_at');
  assert('snapshot_created_at' in ovData, 'Overview API must expose snapshot_created_at');
  assert('polling_status' in ovData, 'Overview API must expose polling_status');
  assert('polling_error' in ovData, 'Overview API must expose polling_error');
  console.log('API Response Sample:', {
    last_attempt_at: ovData.last_attempt_at,
    last_success_at: ovData.last_success_at,
    snapshot_created_at: ovData.snapshot_created_at,
    polling_status: ovData.polling_status,
    polling_error: ovData.polling_error
  });
  console.log('✓ Test 6 Passed: GET /api/overview/unified-summary exposes all 3 timestamps and polling status');

  // Restore initial state for clean environment
  await pool.query(
    `UPDATE sophos_poller_status
     SET last_attempt_at = $1,
         last_success_at = $2,
         snapshot_created_at = $3,
         polling_status = 'idle',
         last_error = NULL,
         last_snapshot_id = $4,
         total_entries = 545,
         entries_with_mac = 517,
         updated_at = NOW()
     WHERE id = 1`,
    [new Date(baselineAttempt).toISOString(), new Date(baselineSuccess).toISOString(), new Date(baselineSnapshot).toISOString(), initial.last_snapshot_id]
  );
  console.log('\nRestored baseline poller status.');
  console.log('====================================================');
  console.log('ALL TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================');
}

runTests()
  .then(async () => {
    await pool.end();
  })
  .catch(async (err) => {
    console.error('TEST FAILED:', err);
    try { await pool.end(); } catch (e) {}
    process.exit(1);
  });
