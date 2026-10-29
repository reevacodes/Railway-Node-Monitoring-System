require('dotenv').config();
const pool = require('./db');

async function migrate() {
  try {
    console.log('Starting migration: Physical Location Management columns...');

    await pool.query(`
      ALTER TABLE devices
      ADD COLUMN IF NOT EXISTS building VARCHAR(100),
      ADD COLUMN IF NOT EXISTS floor VARCHAR(50),
      ADD COLUMN IF NOT EXISTS room VARCHAR(100),
      ADD COLUMN IF NOT EXISTS rack VARCHAR(100),
      ADD COLUMN IF NOT EXISTS rack_position VARCHAR(50),
      ADD COLUMN IF NOT EXISTS port_number VARCHAR(50),
      ADD COLUMN IF NOT EXISTS parent_device_id INT REFERENCES devices(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS parent_device_name VARCHAR(100),
      ADD COLUMN IF NOT EXISTS location_notes TEXT,
      ADD COLUMN IF NOT EXISTS location_verification VARCHAR(20) DEFAULT 'unverified',
      ADD COLUMN IF NOT EXISTS location_verified_at TIMESTAMPTZ;
    `);

    console.log('Migration completed successfully: All location columns verified.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
