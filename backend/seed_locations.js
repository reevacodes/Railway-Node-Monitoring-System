require('dotenv').config();
const pool = require('./db');

async function seedLocations() {
  try {
    await pool.query(`
      UPDATE devices SET
        building = 'DRM Office Complex',
        floor = 'Ground Floor',
        room = 'Central Server Room',
        rack = 'Rack 01',
        rack_position = 'U24',
        port_number = 'GigE 0/0/1',
        parent_device_name = 'Core Gateway 01',
        location_notes = 'Main fiber entry demarcation point; key access required.',
        location_verification = 'verified',
        location_verified_at = NOW()
      WHERE id = 1;

      UPDATE devices SET
        building = 'Railway Control Office',
        floor = 'First Floor',
        room = 'Section Controller Hall',
        rack = 'Wall Mount 02',
        rack_position = 'Ceiling Bay 3',
        port_number = 'PoE Port 8',
        parent_device_id = 1,
        parent_device_name = 'Demo Router 01',
        location_notes = 'Mounted on ceiling truss near dispatch console 4.',
        location_verification = 'verified',
        location_verified_at = NOW()
      WHERE id = 2;
    `);
    console.log('Seeded location records for existing devices.');
  } catch (err) {
    console.error('Seed error:', err.message);
  } finally {
    await pool.end();
  }
}

seedLocations();
