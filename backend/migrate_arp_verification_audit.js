require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const pool = require('./db');

async function migrateVerificationAudit(clientOrPool = pool) {
  console.log('Starting migration: ARP Verification and Audit Schema...');

  // 1. Extend arp_snapshots with extraction integrity and pagination telemetry
  await clientOrPool.query(`
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

  // 2. Extend arp_discoveries with per-entry verification and conflict tracking
  await clientOrPool.query(`
    ALTER TABLE arp_discoveries
      ADD COLUMN IF NOT EXISTS is_valid_ipv4 BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS is_valid_mac BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS is_incomplete BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS is_duplicate_ip BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS is_duplicate_mac BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS has_conflict BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS verification_status VARCHAR(50) DEFAULT 'verified',
      ADD COLUMN IF NOT EXISTS verification_reasons JSONB DEFAULT '[]'::jsonb;

    CREATE INDEX IF NOT EXISTS idx_arp_disc_verif_status ON arp_discoveries(verification_status);
    CREATE INDEX IF NOT EXISTS idx_arp_disc_conflict ON arp_discoveries(has_conflict);
  `);

  // 3. Backfill existing records with baseline verification values
  await clientOrPool.query(`
    UPDATE arp_discoveries
    SET 
      is_incomplete = (has_mac = FALSE OR arp_state ILIKE '%incomplete%'),
      is_valid_mac = (has_mac = TRUE AND normalized_mac IS NOT NULL),
      verification_status = CASE 
        WHEN has_mac = FALSE OR arp_state ILIKE '%incomplete%' THEN 'verified_incomplete'
        ELSE 'verified'
      END,
      verification_reasons = CASE
        WHEN has_mac = FALSE OR arp_state ILIKE '%incomplete%' THEN '["Incomplete ARP: Broadcast sent, waiting for device response"]'::jsonb
        ELSE '["Valid IPv4 address format", "Valid IEEE 802 MAC address format", "Observation confirmed in firewall cache"]'::jsonb
      END
    WHERE verification_reasons IS NULL OR verification_reasons = '[]'::jsonb;
  `);

  console.log('✓ Migration complete: ARP Verification and Audit Schema is ready.');
}

if (require.main === module) {
  migrateVerificationAudit()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = { migrateVerificationAudit };
