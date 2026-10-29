const pool = require('./db');

async function registerMatchedDevices() {
  console.log('--- Registering Matched Inventory Assets into Devices Table ---');

  // Query all matched ARP discoveries paired with their MAC inventory records
  const query = `
    SELECT DISTINCT ON (d.normalized_mac)
      d.ip_address,
      d.mac_address,
      d.normalized_mac,
      d.interface,
      d.arp_state,
      i.id AS inventory_id,
      i.device_name,
      i.site_station,
      i.department_location,
      i.device_type,
      i.vlan_id,
      i.device_id
    FROM arp_discoveries d
    JOIN mac_inventory i ON i.normalized_mac = d.normalized_mac
    WHERE d.match_status = 'matched'
    ORDER BY d.normalized_mac, d.discovered_at DESC, d.id DESC
  `;

  const { rows: matchedAssets } = await pool.query(query);
  console.log(`Found ${matchedAssets.length} matched assets to register into continuous monitoring.`);

  let newlyCreated = 0;
  let alreadyLinked = 0;
  let updatedCount = 0;

  for (const asset of matchedAssets) {
    const formattedName = `${asset.department_location || 'Office'} PC (${asset.device_name || 'PC'})`;
    const building = asset.site_station || 'Jammu Tawi (JAT)';
    const room = asset.department_location || 'General Office';
    const locationNotes = `Site: ${asset.site_station || '—'} | Location: ${asset.department_location || '—'} (Auto-discovered on Sophos ARP ${asset.interface})`;

    // Check if device with this IP already exists
    const existingDev = await pool.query(
      'SELECT id, name, ip_address FROM devices WHERE ip_address = $1',
      [asset.ip_address]
    );

    let deviceId;

    if (existingDev.rows.length > 0) {
      deviceId = existingDev.rows[0].id;
      console.log(`[EXISTS] ${asset.ip_address} already registered as ID ${deviceId} ("${existingDev.rows[0].name}")`);
      alreadyLinked++;
    } else {
      // Insert into devices table
      const insertResult = await pool.query(
        `INSERT INTO devices (
          name,
          ip_address,
          mac_address,
          device_type,
          building,
          room,
          location_notes,
          location_verification,
          notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id`,
        [
          formattedName,
          asset.ip_address,
          asset.mac_address,
          asset.device_type || 'PC',
          building,
          room,
          locationNotes,
          'Unverified',
          `Auto-registered from MAC Inventory & Sophos ARP discovery. OEM: ${asset.device_name}`
        ]
      );

      deviceId = insertResult.rows[0].id;
      newlyCreated++;
      console.log(`[CREATED] Registered ID ${deviceId}: "${formattedName}" at IP ${asset.ip_address}`);
    }

    // Link back to mac_inventory
    await pool.query(
      `UPDATE mac_inventory
       SET device_id = $1,
           expected_ip = COALESCE(expected_ip, $2),
           updated_at = NOW()
       WHERE id = $3`,
      [deviceId, asset.ip_address, asset.inventory_id]
    );
    updatedCount++;
  }

  console.log(`\nRegistration Complete:`);
  console.log(`- Newly registered devices: ${newlyCreated}`);
  console.log(`- Existing devices linked: ${alreadyLinked}`);
  console.log(`- MAC inventory records updated: ${updatedCount}`);

  await pool.end();
}

if (require.main === module) {
  registerMatchedDevices().catch(err => {
    console.error('Registration failed:', err);
    process.exit(1);
  });
}

module.exports = { registerMatchedDevices };
