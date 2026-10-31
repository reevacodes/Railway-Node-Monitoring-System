require('dotenv').config();
const pool = require('./db');

async function migrateOffice() {
  try {
    console.log('Migrating devices table: adding office column...');
    
    await pool.query(`
      ALTER TABLE devices
      ADD COLUMN IF NOT EXISTS office VARCHAR(50);
    `);

    // Assign existing 27 devices to their verified office:
    // NIA Office: 192.168.41.x telecom/substation subnet
    await pool.query(`
      UPDATE devices
      SET office = 'NIA'
      WHERE ip_address LIKE '192.168.41.%';
    `);

    // Control Office: Cabins, Section Controller, HOR Cell, CMI, Dispatch
    await pool.query(`
      UPDATE devices
      SET office = 'CONTROL'
      WHERE id IN (4, 10, 12, 22, 25)
         OR LOWER(room) LIKE '%cabin%'
         OR LOWER(room) LIKE '%controller%'
         OR LOWER(name) LIKE '%control%'
         OR building = 'Railway Control Office';
    `);

    // DRM Office: DRM Office Complex, Sr. DSTE, IT Room, Engineering Planning/Drawing
    await pool.query(`
      UPDATE devices
      SET office = 'DRM'
      WHERE office IS NULL;
    `);

    const result = await pool.query(`
      SELECT office, COUNT(*) as count 
      FROM devices 
      GROUP BY office 
      ORDER BY office;
    `);

    console.log('Office migration completed successfully. Office counts:');
    console.table(result.rows);
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrateOffice();
