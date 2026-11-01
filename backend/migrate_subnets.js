/**
 * Database Migration & Seeding for Dynamic Subnet Management
 * Railway Node Monitoring System
 */

const pool = require('./db');
const { getSubnetDetails } = require('./subnet_util');

async function migrateSubnets() {
  const client = await pool.connect();
  try {
    console.log('[Migration] Starting offices and subnets table migration...');
    await client.query('BEGIN');

    // 1. Create offices table
    await client.query(`
      CREATE TABLE IF NOT EXISTS offices (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        code VARCHAR(50) NOT NULL UNIQUE,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('  ✓ Table "offices" confirmed.');

    // 2. Create subnets table
    await client.query(`
      CREATE TABLE IF NOT EXISTS subnets (
        id SERIAL PRIMARY KEY,
        office_id INT NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
        subnet_name VARCHAR(100) NOT NULL,
        network_address VARCHAR(45) NOT NULL,
        cidr_prefix INT NOT NULL CHECK (cidr_prefix >= 8 AND cidr_prefix <= 30),
        subnet_mask VARCHAR(45) NOT NULL,
        gateway_ip VARCHAR(45),
        description TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('  ✓ Table "subnets" confirmed.');

    // 3. Create indexes for fast lookup
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_subnets_office_id ON subnets(office_id);
      CREATE INDEX IF NOT EXISTS idx_subnets_active ON subnets(is_active);
      CREATE INDEX IF NOT EXISTS idx_subnets_network ON subnets(network_address, cidr_prefix);
    `);
    console.log('  ✓ Indexes created.');

    // 4. Seed initial offices (DRM, Control, NIA)
    const initialOffices = [
      {
        name: 'DRM Office',
        code: 'DRM',
        description: 'Divisional Railway Manager Office Complex (Administrative & Operational Divisions)',
      },
      {
        name: 'Control Office',
        code: 'CONTROL',
        description: 'Central Railway Traffic, Section Controller & Train Operations Command Room',
      },
      {
        name: 'NIA Office',
        code: 'NIA',
        description: 'National Investigation Agency / Railway Security & Central Surveillance Node',
      },
    ];

    const officeMap = {};
    for (const off of initialOffices) {
      const res = await client.query(
        `INSERT INTO offices (name, code, description)
         VALUES ($1, $2, $3)
         ON CONFLICT (name) DO UPDATE
         SET description = EXCLUDED.description, updated_at = NOW()
         RETURNING id, code, name`,
        [off.name, off.code, off.description]
      );
      officeMap[res.rows[0].code] = res.rows[0].id;
    }
    console.log('  ✓ Seeded offices:', officeMap);

    // 5. Seed initial subnets:
    // We preconfigure the separate /24 networks as active (is_active = true)
    // and provide the combined /23 options as inactive templates (is_active = false)
    // so administrators can toggle or edit between separate /24 and combined /23 without overlaps!
    const initialSubnets = [
      // DRM Office (/24 active, /23 template)
      {
        officeCode: 'DRM',
        subnetName: 'DRM Primary LAN (40.x)',
        networkAddress: '192.168.40.0',
        cidrPrefix: 24,
        gatewayIp: '192.168.40.1',
        description: 'DRM Office Section A — IT Room, Core Switches & Workstations',
        isActive: true,
      },
      {
        officeCode: 'DRM',
        subnetName: 'DRM Secondary LAN (41.x)',
        networkAddress: '192.168.41.0',
        cidrPrefix: 24,
        gatewayIp: '192.168.41.1',
        description: 'DRM Office Section B — S&T Room, Engineering & Planning Terminals',
        isActive: true,
      },
      {
        officeCode: 'DRM',
        subnetName: 'DRM Combined Supernet (/23 Alternative)',
        networkAddress: '192.168.40.0',
        cidrPrefix: 23,
        gatewayIp: '192.168.40.1',
        description: 'Combined /23 address space (192.168.40.0 – 192.168.41.255). Activate when consolidating 40.x and 41.x.',
        isActive: false,
      },

      // Control Office (/24 active, /23 template)
      {
        officeCode: 'CONTROL',
        subnetName: 'Control Operations LAN (50.x)',
        networkAddress: '192.168.50.0',
        cidrPrefix: 24,
        gatewayIp: '192.168.50.1',
        description: 'Control Office — Train Section Controllers & Traffic Monitoring Terminals',
        isActive: true,
      },
      {
        officeCode: 'CONTROL',
        subnetName: 'Control Signaling LAN (51.x)',
        networkAddress: '192.168.51.0',
        cidrPrefix: 24,
        gatewayIp: '192.168.51.1',
        description: 'Control Office — Signaling & Telecom Telemetry Integration',
        isActive: true,
      },
      {
        officeCode: 'CONTROL',
        subnetName: 'Control Combined Supernet (/23 Alternative)',
        networkAddress: '192.168.50.0',
        cidrPrefix: 23,
        gatewayIp: '192.168.50.1',
        description: 'Combined /23 address space (192.168.50.0 – 192.168.51.255). Activate when consolidating 50.x and 51.x.',
        isActive: false,
      },

      // NIA Office (/24 active, /23 template)
      {
        officeCode: 'NIA',
        subnetName: 'NIA Primary Office LAN (20.x)',
        networkAddress: '192.168.20.0',
        cidrPrefix: 24,
        gatewayIp: '192.168.20.1',
        description: 'NIA Office — Administrative & Intelligence Desk Consoles',
        isActive: true,
      },
      {
        officeCode: 'NIA',
        subnetName: 'NIA Surveillance & Video LAN (21.x)',
        networkAddress: '192.168.21.0',
        cidrPrefix: 24,
        gatewayIp: '192.168.21.1',
        description: 'NIA Office — CCTV NVRs & Security Inspection Gateways',
        isActive: true,
      },
      {
        officeCode: 'NIA',
        subnetName: 'NIA Combined Supernet (/23 Alternative)',
        networkAddress: '192.168.20.0',
        cidrPrefix: 23,
        gatewayIp: '192.168.20.1',
        description: 'Combined /23 address space (192.168.20.0 – 192.168.21.255). Activate when consolidating 20.x and 21.x.',
        isActive: false,
      },
    ];

    for (const sub of initialSubnets) {
      const officeId = officeMap[sub.officeCode];
      const details = getSubnetDetails(sub.networkAddress, sub.cidrPrefix);

      // Check if already exists
      const existing = await client.query(
        'SELECT id FROM subnets WHERE office_id = $1 AND network_address = $2 AND cidr_prefix = $3',
        [officeId, details.networkAddress, details.cidrPrefix]
      );

      if (existing.rows.length === 0) {
        await client.query(
          `INSERT INTO subnets (office_id, subnet_name, network_address, cidr_prefix, subnet_mask, gateway_ip, description, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            officeId,
            sub.subnetName,
            details.networkAddress,
            details.cidrPrefix,
            details.subnetMask,
            sub.gatewayIp,
            sub.description,
            sub.isActive,
          ]
        );
      }
    }
    console.log('  ✓ Initial subnets seeded successfully.');

    await client.query('COMMIT');
    console.log('[Migration] Subnets migration finished successfully.\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migration] Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrateSubnets()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      pool.end();
      process.exit(1);
    });
}

module.exports = { migrateSubnets };
