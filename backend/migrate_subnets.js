
/**
 * Database Migration & Seeding for Dynamic Subnet Management
 * Railway Node Monitoring System
 *
 * Creates:
 * 1. offices table
 * 2. subnets table
 * 3. Required indexes
 * 4. Initial DRM, CONTROL and NIA office records
 * 5. Initial subnet configurations
 *
 * Safe properties:
 * - Uses a database transaction.
 * - Can be executed repeatedly.
 * - Uses office code for conflict handling.
 * - Preserves existing subnet configurations.
 */

const pool = require('./db');
const { getSubnetDetails } = require('./subnet_util');

async function migrateSubnets() {
  const client = await pool.connect();

  let transactionStarted = false;

  try {
    console.log('[Migration] Starting offices and subnets migration...');

    // Start transaction
    await client.query('BEGIN');
    transactionStarted = true;

    // --------------------------------------------------
    // 1. Create offices table
    // --------------------------------------------------

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

    console.log('✓ Table "offices" confirmed.');

    // --------------------------------------------------
    // 2. Create subnets table
    // --------------------------------------------------

    await client.query(`
      CREATE TABLE IF NOT EXISTS subnets (
        id SERIAL PRIMARY KEY,
        office_id INT NOT NULL
          REFERENCES offices(id) ON DELETE RESTRICT,
        subnet_name VARCHAR(100) NOT NULL,
        network_address VARCHAR(45) NOT NULL,
        cidr_prefix INT NOT NULL
          CHECK (cidr_prefix >= 8 AND cidr_prefix <= 30),
        subnet_mask VARCHAR(45) NOT NULL,
        gateway_ip VARCHAR(45),
        description TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    console.log('✓ Table "subnets" confirmed.');

    // --------------------------------------------------
    // 3. Create indexes
    // --------------------------------------------------

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_subnets_office_id
        ON subnets(office_id);

      CREATE INDEX IF NOT EXISTS idx_subnets_active
        ON subnets(is_active);

      CREATE INDEX IF NOT EXISTS idx_subnets_network
        ON subnets(network_address, cidr_prefix);
    `);

    console.log('✓ Subnet indexes confirmed.');

    // --------------------------------------------------
    // 4. Seed initial offices
    // --------------------------------------------------

    const initialOffices = [
      {
        name: 'DRM Office',
        code: 'DRM',
        description:
          'Divisional Railway Manager Office Complex (Administrative & Operational Divisions)',
      },
      {
        name: 'Control Office',
        code: 'CONTROL',
        description:
          'Central Railway Traffic, Section Controller & Train Operations Command Room',
      },
      {
        name: 'NIA Office',
        code: 'NIA',
        description:
          'National Investigation Agency / Railway Security & Central Surveillance Node',
      },
    ];

    const officeMap = {};

    for (const off of initialOffices) {
      const result = await client.query(
        `
        INSERT INTO offices (name, code, description)
        VALUES ($1, $2, $3)

        ON CONFLICT (code)
        DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          updated_at = NOW()

        RETURNING id, code, name;
        `,
        [off.name, off.code, off.description]
      );

      const office = result.rows[0];

      if (!office || !office.id) {
        throw new Error(
          `Failed to create or retrieve office: ${off.code}`
        );
      }

      officeMap[office.code] = office.id;
    }

    console.log('✓ Office records confirmed:', officeMap);

    // --------------------------------------------------
    // 5. Define initial subnet configurations
    // --------------------------------------------------

    const initialSubnets = [
      // DRM Office
      {
        officeCode: 'DRM',
        subnetName: 'DRM Primary LAN (40.x)',
        networkAddress: '192.168.40.0',
        cidrPrefix: 24,
        gatewayIp: '192.168.40.1',
        description:
          'DRM Office Section A — IT Room, Core Switches & Workstations',
        isActive: true,
      },
      {
        officeCode: 'DRM',
        subnetName: 'DRM Secondary LAN (41.x)',
        networkAddress: '192.168.41.0',
        cidrPrefix: 24,
        gatewayIp: '192.168.41.1',
        description:
          'DRM Office Section B — S&T Room, Engineering & Planning Terminals',
        isActive: true,
      },
      {
        officeCode: 'DRM',
        subnetName: 'DRM Combined Supernet (/23 Alternative)',
        networkAddress: '192.168.40.0',
        cidrPrefix: 23,
        gatewayIp: '192.168.40.1',
        description:
          'Combined /23 address space (192.168.40.0 – 192.168.41.255). Activate when consolidating 40.x and 41.x.',
        isActive: false,
      },

      // CONTROL Office
      {
        officeCode: 'CONTROL',
        subnetName: 'Control Operations LAN (50.x)',
        networkAddress: '192.168.50.0',
        cidrPrefix: 24,
        gatewayIp: '192.168.50.1',
        description:
          'Control Office — Train Section Controllers & Traffic Monitoring Terminals',
        isActive: true,
      },
      {
        officeCode: 'CONTROL',
        subnetName: 'Control Signaling LAN (51.x)',
        networkAddress: '192.168.51.0',
        cidrPrefix: 24,
        gatewayIp: '192.168.51.1',
        description:
          'Control Office — Signaling & Telecom Telemetry Integration',
        isActive: true,
      },
      {
        officeCode: 'CONTROL',
        subnetName: 'Control Combined Supernet (/23 Alternative)',
        networkAddress: '192.168.50.0',
        cidrPrefix: 23,
        gatewayIp: '192.168.50.1',
        description:
          'Combined /23 address space (192.168.50.0 – 192.168.51.255). Activate when consolidating 50.x and 51.x.',
        isActive: false,
      },

      // NIA Office
      {
        officeCode: 'NIA',
        subnetName: 'NIA Primary Office LAN (20.x)',
        networkAddress: '192.168.20.0',
        cidrPrefix: 24,
        gatewayIp: '192.168.20.1',
        description:
          'NIA Office — Administrative & Intelligence Desk Consoles',
        isActive: true,
      },
      {
        officeCode: 'NIA',
        subnetName: 'NIA Surveillance & Video LAN (21.x)',
        networkAddress: '192.168.21.0',
        cidrPrefix: 24,
        gatewayIp: '192.168.21.1',
        description:
          'NIA Office — CCTV NVRs & Security Inspection Gateways',
        isActive: true,
      },
      {
        officeCode: 'NIA',
        subnetName: 'NIA Combined Supernet (/23 Alternative)',
        networkAddress: '192.168.20.0',
        cidrPrefix: 23,
        gatewayIp: '192.168.20.1',
        description:
          'Combined /23 address space (192.168.20.0 – 192.168.21.255). Activate when consolidating 20.x and 21.x.',
        isActive: false,
      },
    ];

    // --------------------------------------------------
    // 6. Insert subnet records
    // --------------------------------------------------

    let insertedCount = 0;
    let skippedCount = 0;

    for (const subnet of initialSubnets) {
      const officeId = officeMap[subnet.officeCode];

      if (!officeId) {
        throw new Error(
          `Office mapping not found: ${subnet.officeCode}`
        );
      }

      const details = getSubnetDetails(
        subnet.networkAddress,
        subnet.cidrPrefix
      );

      if (
        !details ||
        !details.networkAddress ||
        !details.subnetMask
      ) {
        throw new Error(
          `Invalid subnet configuration: ${subnet.networkAddress}/${subnet.cidrPrefix}`
        );
      }

      // Check for an existing subnet.
      // Existing administrator configurations are preserved.

      const existing = await client.query(
        `
        SELECT id
        FROM subnets
        WHERE office_id = $1
          AND network_address = $2
          AND cidr_prefix = $3;
        `,
        [
          officeId,
          details.networkAddress,
          details.cidrPrefix,
        ]
      );

      if (existing.rows.length > 0) {
        skippedCount++;

        console.log(
          `~ Skipped existing subnet: ${details.networkAddress}/${details.cidrPrefix}`
        );

        continue;
      }

      await client.query(
        `
        INSERT INTO subnets (
          office_id,
          subnet_name,
          network_address,
          cidr_prefix,
          subnet_mask,
          gateway_ip,
          description,
          is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
        `,
        [
          officeId,
          subnet.subnetName,
          details.networkAddress,
          details.cidrPrefix,
          details.subnetMask,
          subnet.gatewayIp,
          subnet.description,
          subnet.isActive,
        ]
      );

      insertedCount++;

      console.log(
        `+ Inserted: ${subnet.subnetName} (${details.networkAddress}/${details.cidrPrefix})`
      );
    }

    // --------------------------------------------------
    // 7. Commit transaction
    // --------------------------------------------------

    await client.query('COMMIT');
    transactionStarted = false;

    console.log('\n[Migration] Subnets migration completed successfully.');
    console.log(`Offices configured: ${Object.keys(officeMap).length}`);
    console.log(`Subnets inserted: ${insertedCount}`);
    console.log(`Existing subnets skipped: ${skippedCount}`);

  } catch (err) {
    if (transactionStarted) {
      await client.query('ROLLBACK');
    }

    console.error('[Migration] Migration failed:', err.message);

    throw err;

  } finally {
    client.release();
  }
}

// --------------------------------------------------
// Run migration directly
// --------------------------------------------------

if (require.main === module) {
  migrateSubnets()
    .then(() => {
      console.log('[Migration] Process finished.');
      return pool.end();
    })
    .catch(async (err) => {
      console.error(err);

      await pool.end();

      process.exitCode = 1;
    });
}

module.exports = { migrateSubnets };
