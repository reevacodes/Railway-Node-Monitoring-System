require('dotenv').config();
const pool = require('./db');

async function migrateOffice() {
  const client = await pool.connect();
  try {
    console.log('Migrating devices table: adding office column...');

    // DDL outside transaction — idempotent, safe to run unconditionally
    await client.query(`
      ALTER TABLE devices
      ADD COLUMN IF NOT EXISTS office VARCHAR(50);
    `);

    await client.query('BEGIN');

    // ── PASS 1: Correct any previously wrong assignments ────────────────────
    // If this migration was run before with the buggy mapping, fix those rows.
    // Only touch rows whose current value is provably wrong for their IP.

    // 192.168.41.x was wrongly set to 'NIA' — correct to 'DRM'
    const fix41 = await client.query(`
      UPDATE devices
      SET office = 'DRM'
      WHERE ip_address LIKE '192.168.41.%'
        AND office = 'NIA';
    `);
    if (fix41.rowCount > 0)
      console.log(`  ↺ Corrected ${fix41.rowCount} device(s): 192.168.41.x NIA→DRM`);

    // 192.168.50.x / 51.x wrongly defaulted to 'DRM' — correct to 'CONTROL'
    const fix50 = await client.query(`
      UPDATE devices
      SET office = 'CONTROL'
      WHERE (ip_address LIKE '192.168.50.%' OR ip_address LIKE '192.168.51.%')
        AND office = 'DRM';
    `);
    if (fix50.rowCount > 0)
      console.log(`  ↺ Corrected ${fix50.rowCount} device(s): 192.168.50-51.x DRM→CONTROL`);

    // 192.168.20.x / 21.x wrongly defaulted to 'DRM' — correct to 'NIA'
    const fix20 = await client.query(`
      UPDATE devices
      SET office = 'NIA'
      WHERE (ip_address LIKE '192.168.20.%' OR ip_address LIKE '192.168.21.%')
        AND office = 'DRM';
    `);
    if (fix20.rowCount > 0)
      console.log(`  ↺ Corrected ${fix20.rowCount} device(s): 192.168.20-21.x DRM→NIA`);

    // ── PASS 2: Assign office to devices not yet assigned (office IS NULL) ──

    // DRM: 192.168.40.x and 192.168.41.x
    const drm = await client.query(`
      UPDATE devices
      SET office = 'DRM'
      WHERE office IS NULL
        AND (ip_address LIKE '192.168.40.%' OR ip_address LIKE '192.168.41.%');
    `);
    console.log(`  + DRM assigned (new): ${drm.rowCount} device(s)`);

    // CONTROL: 192.168.50.x and 192.168.51.x
    const ctrl = await client.query(`
      UPDATE devices
      SET office = 'CONTROL'
      WHERE office IS NULL
        AND (ip_address LIKE '192.168.50.%' OR ip_address LIKE '192.168.51.%');
    `);
    console.log(`  + CONTROL assigned (new): ${ctrl.rowCount} device(s)`);

    // NIA: 192.168.20.x and 192.168.21.x
    const nia = await client.query(`
      UPDATE devices
      SET office = 'NIA'
      WHERE office IS NULL
        AND (ip_address LIKE '192.168.20.%' OR ip_address LIKE '192.168.21.%');
    `);
    console.log(`  + NIA assigned (new): ${nia.rowCount} device(s)`);

    // ── PASS 3: Warn about anything still unresolved ─────────────────────────
    const unassigned = await client.query(`
      SELECT id, name, ip_address FROM devices WHERE office IS NULL;
    `);
    if (unassigned.rows.length > 0) {
      console.warn(`  ⚠ ${unassigned.rows.length} device(s) remain unassigned (office left NULL):`);
      unassigned.rows.forEach(d =>
        console.warn(`    - ID ${d.id}: ${d.name} (${d.ip_address})`)
      );
    }

    await client.query('COMMIT');

    const summary = await client.query(`
      SELECT office, COUNT(*) AS count
      FROM devices
      GROUP BY office
      ORDER BY office;
    `);
    console.log('Office migration completed. Office distribution:');
    console.table(summary.rows);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed — rolled back:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrateOffice();
