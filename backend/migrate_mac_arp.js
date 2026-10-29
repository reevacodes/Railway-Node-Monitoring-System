require('dotenv').config();
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Starting migration: MAC Inventory and Sophos ARP Discovery tables...');
    await client.query('BEGIN');

    // 1. MAC Inventory table
    await client.query(`
      CREATE TABLE IF NOT EXISTS mac_inventory (
        id SERIAL PRIMARY KEY,
        mac_address VARCHAR(50) NOT NULL,
        normalized_mac VARCHAR(32) NOT NULL,
        raw_mac_entry TEXT,
        device_name VARCHAR(100),
        site_station VARCHAR(100),
        department_location VARCHAR(150),
        device_type VARCHAR(50) DEFAULT 'PC',
        vlan_id VARCHAR(50),
        expected_ip VARCHAR(50),
        notes TEXT,
        is_multi_mac BOOLEAN DEFAULT FALSE,
        multi_mac_group_id INT,
        device_id INT REFERENCES devices(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_mac_inv_norm ON mac_inventory(normalized_mac);
      CREATE INDEX IF NOT EXISTS idx_mac_inv_dept ON mac_inventory(department_location);
    `);

    // 2. ARP Snapshots table
    await client.query(`
      CREATE TABLE IF NOT EXISTS arp_snapshots (
        id SERIAL PRIMARY KEY,
        snapshot_name VARCHAR(150) NOT NULL,
        source_device VARCHAR(100) DEFAULT 'Sophos XGS2100',
        imported_at TIMESTAMPTZ DEFAULT NOW(),
        total_entries INT DEFAULT 0,
        entries_with_mac INT DEFAULT 0,
        matched_inventory_count INT DEFAULT 0,
        unmatched_count INT DEFAULT 0,
        invalid_entries_count INT DEFAULT 0,
        notes TEXT
      );
    `);

    // 3. ARP Discoveries table
    await client.query(`
      CREATE TABLE IF NOT EXISTS arp_discoveries (
        id SERIAL PRIMARY KEY,
        snapshot_id INT REFERENCES arp_snapshots(id) ON DELETE CASCADE,
        ip_address VARCHAR(45) NOT NULL,
        mac_address VARCHAR(50),
        normalized_mac VARCHAR(32),
        interface VARCHAR(50),
        arp_state VARCHAR(30),
        is_router_entry BOOLEAN DEFAULT FALSE,
        has_mac BOOLEAN DEFAULT TRUE,
        matched_inventory_id INT REFERENCES mac_inventory(id) ON DELETE SET NULL,
        match_status VARCHAR(30) DEFAULT 'unmatched',
        discovered_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_arp_disc_norm ON arp_discoveries(normalized_mac);
      CREATE INDEX IF NOT EXISTS idx_arp_disc_ip ON arp_discoveries(ip_address);
      CREATE INDEX IF NOT EXISTS idx_arp_disc_snap ON arp_discoveries(snapshot_id);
      CREATE INDEX IF NOT EXISTS idx_arp_disc_match ON arp_discoveries(match_status);
    `);

    await client.query('COMMIT');
    console.log('Migration completed successfully: Tables created.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
