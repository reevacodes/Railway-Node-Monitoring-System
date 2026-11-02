require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const pool = require('./db');

async function migratePollerStatus(clientOrPool = pool) {
  console.log('Migrating: Ensuring sophos_poller_status table exists...');
  
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS sophos_poller_status (
      id INT PRIMARY KEY DEFAULT 1,
      last_attempt_at TIMESTAMPTZ,
      last_success_at TIMESTAMPTZ,
      snapshot_created_at TIMESTAMPTZ,
      polling_status VARCHAR(50) DEFAULT 'idle',
      last_error TEXT,
      last_duration_ms INT,
      last_snapshot_id INT REFERENCES arp_snapshots(id) ON DELETE SET NULL,
      total_entries INT,
      entries_with_mac INT,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT single_row CHECK (id = 1)
    );
  `);

  // Initialize row 1 if not exists, seeding with latest snapshot info if available
  const existing = await clientOrPool.query('SELECT * FROM sophos_poller_status WHERE id = 1');
  if (existing.rows.length === 0) {
    const latestSnap = await clientOrPool.query(
      'SELECT id, imported_at, total_entries, entries_with_mac FROM arp_snapshots ORDER BY imported_at DESC, id DESC LIMIT 1'
    );
    if (latestSnap.rows.length > 0) {
      const snap = latestSnap.rows[0];
      await clientOrPool.query(
        `INSERT INTO sophos_poller_status 
          (id, last_attempt_at, last_success_at, snapshot_created_at, polling_status, last_snapshot_id, total_entries, entries_with_mac, updated_at)
         VALUES (1, $1, $1, $1, 'idle', $2, $3, $4, NOW())`,
        [snap.imported_at, snap.id, snap.total_entries, snap.entries_with_mac]
      );
      console.log(`Initialized sophos_poller_status with latest snapshot #${snap.id} (${snap.imported_at})`);
    } else {
      await clientOrPool.query(
        `INSERT INTO sophos_poller_status (id, polling_status, updated_at) VALUES (1, 'idle', NOW())`
      );
      console.log('Initialized empty sophos_poller_status row');
    }
  } else {
    // If snapshot_created_at is null but snapshots exist, populate it
    if (!existing.rows[0].snapshot_created_at) {
      const latestSnap = await clientOrPool.query(
        'SELECT id, imported_at FROM arp_snapshots ORDER BY imported_at DESC, id DESC LIMIT 1'
      );
      if (latestSnap.rows.length > 0) {
        await clientOrPool.query(
          'UPDATE sophos_poller_status SET snapshot_created_at = $1 WHERE id = 1',
          [latestSnap.rows[0].imported_at]
        );
      }
    }
  }

  console.log('Migration complete: sophos_poller_status ready.');
}

if (require.main === module) {
  migratePollerStatus()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = { migratePollerStatus };
