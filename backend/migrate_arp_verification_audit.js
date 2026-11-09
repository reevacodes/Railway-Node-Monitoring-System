
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const pool = require('./db');

async function migrateVerificationAudit(clientOrPool = pool) {
  let client;
  let transactionStarted = false;

  try {
    // Use a dedicated connection so all migration steps share one transaction.
    client = clientOrPool === pool
      ? await pool.connect()
      : clientOrPool;

    console.log('Starting migration: ARP Verification and Audit Schema...');

    await client.query('BEGIN');
    transactionStarted = true;

    // 1. Extend arp_snapshots with extraction integrity and pagination telemetry.
    await client.query(`
      ALTER TABLE arp_snapshots
        ADD COLUMN IF NOT EXISTS extraction_status VARCHAR(50) DEFAULT 'complete',
        ADD COLUMN IF NOT EXISTS total_pages_detected INT DEFAULT 1,
        ADD COLUMN IF NOT EXISTS pages_visited INT DEFAULT 1,
        ADD COLUMN IF NOT EXISTS pagination_completed BOOLEAN DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS page_rows_json JSONB DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS total_raw_entries INT DEFAULT 0,
        ADD COLUMN IF NOT EXISTS valid_ip_count INT DEFAULT 0,
        ADD COLUMN IF NOT EXISTS valid_mac_count INT DEFAULT 0,
        ADD COLUMN IF NOT EXISTS incomplete_count INT DEFAULT 0,
        ADD COLUMN IF NOT EXISTS invalid_count INT DEFAULT 0,
        ADD COLUMN IF NOT EXISTS duplicate_count INT DEFAULT 0,
        ADD COLUMN IF NOT EXISTS extraction_duration_ms INT DEFAULT 0,
        ADD COLUMN IF NOT EXISTS integrity_warnings JSONB DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS raw_payload_json JSONB DEFAULT NULL;
    `);

    console.log('✓ arp_snapshots columns confirmed.');

    // 2. Extend arp_discoveries with per-entry verification and conflict tracking.
    await client.query(`
      ALTER TABLE arp_discoveries
        ADD COLUMN IF NOT EXISTS is_valid_ipv4 BOOLEAN DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS is_valid_mac BOOLEAN DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS is_incomplete BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS is_duplicate_ip BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS is_duplicate_mac BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS has_conflict BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS verification_status VARCHAR(50) DEFAULT 'verified',
        ADD COLUMN IF NOT EXISTS verification_reasons JSONB DEFAULT '[]'::jsonb;
    `);

    // 3. Create indexes.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_arp_disc_verif_status
        ON arp_discoveries(verification_status);

      CREATE INDEX IF NOT EXISTS idx_arp_disc_conflict
        ON arp_discoveries(has_conflict);
    `);

    console.log('✓ arp_discoveries columns and indexes confirmed.');

    // 4. Backfill existing records with baseline verification values.
    await client.query(`
      UPDATE arp_discoveries
      SET
        is_incomplete = (
          has_mac = FALSE OR arp_state ILIKE '%incomplete%'
        ),
        is_valid_mac = (
          has_mac = TRUE AND normalized_mac IS NOT NULL
        ),
        verification_status = CASE
          WHEN has_mac = FALSE OR arp_state ILIKE '%incomplete%'
            THEN 'verified_incomplete'
          ELSE 'verified'
        END,
        verification_reasons = CASE
          WHEN has_mac = FALSE OR arp_state ILIKE '%incomplete%'
            THEN '["Incomplete ARP: Broadcast sent, waiting for device response"]'::jsonb
          ELSE '["Baseline ARP observation: MAC present and normalized"]'::jsonb
        END
      WHERE verification_reasons IS NULL
         OR verification_reasons = '[]'::jsonb;
    `);

    await client.query('COMMIT');
    transactionStarted = false;

    console.log('✓ Migration complete: ARP Verification and Audit Schema is ready.');
  } catch (err) {
    if (client && transactionStarted) {
      try {
        await client.query('ROLLBACK');
        console.error('Migration transaction rolled back.');
      } catch (rollbackError) {
        console.error('Rollback failed:', rollbackError);
      }
    }

    throw err;
  } finally {
    if (client && client !== clientOrPool) {
      client.release();
    }
  }
}

if (require.main === module) {
  migrateVerificationAudit()
    .then(() => pool.end())
    .catch(async (err) => {
      console.error('Migration failed:', err);
      await pool.end();
      process.exitCode = 1;
    });
}

module.exports = { migrateVerificationAudit };
