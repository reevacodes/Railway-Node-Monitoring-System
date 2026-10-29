require('dotenv').config();
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Starting migration: discovered_devices table...');
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS discovered_devices (
        id SERIAL PRIMARY KEY,
        ip_address VARCHAR(45) NOT NULL UNIQUE,
        mac_address VARCHAR(50),
        normalized_mac VARCHAR(32),
        interface VARCHAR(50),
        arp_state VARCHAR(30),
        custom_name VARCHAR(100),
        device_type VARCHAR(50) DEFAULT 'PC',
        department VARCHAR(150),
        building_location VARCHAR(150),
        notes TEXT,
        is_monitored BOOLEAN DEFAULT TRUE,
        last_ping_status VARCHAR(10) CHECK (last_ping_status IN ('online', 'offline', 'unknown')),
        last_ping_latency INT,
        last_ping_at TIMESTAMPTZ,
        last_seen_at TIMESTAMPTZ DEFAULT NOW(),
        snapshot_id INT REFERENCES arp_snapshots(id) ON DELETE SET NULL,
        matched_inventory_id INT REFERENCES mac_inventory(id) ON DELETE SET NULL,
        registered_device_id INT REFERENCES devices(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_disc_dev_ip ON discovered_devices(ip_address);
      CREATE INDEX IF NOT EXISTS idx_disc_dev_mac ON discovered_devices(normalized_mac);
      CREATE INDEX IF NOT EXISTS idx_disc_dev_status ON discovered_devices(last_ping_status);
      CREATE INDEX IF NOT EXISTS idx_disc_dev_iface ON discovered_devices(interface);
    `);

    await client.query('COMMIT');
    console.log('Migration successful: discovered_devices table ready.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  migrate();
}

module.exports = { migrate };
