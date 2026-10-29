/**
 * Discovered Devices Ping Monitoring Service
 * 
 * Periodically probes eligible discovered devices from Sophos ARP discoveries.
 * Features:
 * - Bounded concurrency (batches of 8 parallel pings)
 * - Strict non-overlapping execution lock
 * - Interface-scoped monitoring (Port1 DRM LAN & Port3 Wireless APs by default)
 * - Completely isolated from the registered-device ping cycle
 */

const pool = require('./db');
const { pingDevice } = require('./ping_util');

let isDiscoveredPingInProgress = false;
let pingIntervalTimer = null;

const CONFIG = {
  enabled: process.env.DISCOVERED_PING_ENABLED !== 'false',
  intervalMs: Number(process.env.DISCOVERED_PING_INTERVAL_MS) || 60000, // 60 seconds
  batchSize: Number(process.env.DISCOVERED_PING_BATCH_SIZE) || 8,
  // By default probe internal LAN (Port1) and Wireless/Field APs (Port3); exclude WAN/gateways
  allowedInterfaces: (process.env.DISCOVERED_PING_INTERFACES || 'Port1,Port3')
    .split(',')
    .map(i => i.trim())
    .filter(Boolean)
};

/**
 * Runs a single monitoring cycle across eligible discovered devices.
 * 
 * @param {object} [options]
 * @param {string[]} [options.interfaces] Override interface filter
 * @param {number} [options.limit] Limit probe count for testing
 * @returns {Promise<object>} Cycle summary
 */
async function runDiscoveredPingCycle(options = {}) {
  if (isDiscoveredPingInProgress) {
    console.log('[DiscoveredPing] Previous cycle still running; skipping cycle.');
    return { skipped: true, reason: 'Already in progress' };
  }

  isDiscoveredPingInProgress = true;
  const startTime = Date.now();

  try {
    const interfaces = options.interfaces || CONFIG.allowedInterfaces;
    const limit = options.limit ? Number(options.limit) : null;

    let query = `
      SELECT id, ip_address, mac_address, interface, custom_name
      FROM discovered_devices
      WHERE is_monitored = TRUE
        AND interface = ANY($1)
      ORDER BY id ASC
    `;
    const params = [interfaces];

    if (limit && Number.isInteger(limit) && limit > 0) {
      params.push(limit);
      query += ` LIMIT $2`;
    }

    const { rows: targets } = await pool.query(query, params);

    if (targets.length === 0) {
      const durationMs = Date.now() - startTime;
      const emptyResult = {
        total: 0,
        online: 0,
        offline: 0,
        unknown: 0,
        durationMs
      };
      console.log(
        `[DiscoveredPing] Cycle completed: 0 devices probed | 0 online | 0 no reply | 0 unknown | ${durationMs}ms`
      );
      return emptyResult;
    }

    let onlineCount = 0;
    let offlineCount = 0;
    let unknownCount = 0;

    const BATCH_SIZE = CONFIG.batchSize;
    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
      const batch = targets.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (device) => {
          const probe = await pingDevice(device.ip_address);

          if (probe.status === 'online') onlineCount++;
          else if (probe.status === 'offline') offlineCount++;
          else unknownCount++;

          try {
            await pool.query(
              `UPDATE discovered_devices SET
                last_ping_status = $1,
                last_ping_latency = $2,
                last_ping_at = NOW(),
                updated_at = NOW()
               WHERE id = $3`,
              [
                probe.status,
                probe.status === 'online' ? probe.latency_ms : null,
                device.id
              ]
            );
          } catch (dbErr) {
            console.error(`[DiscoveredPing] Failed to update device ${device.id}:`, dbErr.message);
          }
        })
      );
    }

    const durationMs = Date.now() - startTime;
    const result = {
      success: true,
      total: targets.length,
      online: onlineCount,
      offline: offlineCount,
      unknown: unknownCount,
      durationMs
    };

    console.log(
      `[DiscoveredPing] Cycle completed: ${result.total} devices probed | ${result.online} online | ${result.offline} no reply | ${result.unknown} unknown | ${result.durationMs}ms`
    );

    return result;
  } catch (err) {
    console.error(`[DiscoveredPing] Cycle failed after ${Date.now() - startTime}ms:`, err.message);
    throw err;
  } finally {
    isDiscoveredPingInProgress = false;
  }
}

/**
 * Starts the background timer for discovered device pinging.
 */
function startDiscoveredPingScheduler() {
  if (!CONFIG.enabled) {
    console.log('[DiscoveredPing] Scheduler is disabled via configuration.');
    return;
  }

  if (pingIntervalTimer) {
    return;
  }

  console.log(`[DiscoveredPing] Starting scheduler (Interval: ${CONFIG.intervalMs / 1000}s, Interfaces: ${CONFIG.allowedInterfaces.join(', ')})`);

  // Initial probe after 5 seconds to let server finish startup
  setTimeout(() => {
    runDiscoveredPingCycle().catch(err => {
      console.error('[DiscoveredPing] Initial cycle error:', err.message);
    });
  }, 5000);

  pingIntervalTimer = setInterval(() => {
    runDiscoveredPingCycle().catch(err => {
      console.error('[DiscoveredPing] Interval cycle error:', err.message);
    });
  }, CONFIG.intervalMs);
}

/**
 * Stops the background timer.
 */
function stopDiscoveredPingScheduler() {
  if (pingIntervalTimer) {
    clearInterval(pingIntervalTimer);
    pingIntervalTimer = null;
    console.log('[DiscoveredPing] Scheduler stopped.');
  }
}

function getStatus() {
  return {
    isRunning: Boolean(pingIntervalTimer),
    isInProgress: isDiscoveredPingInProgress,
    config: CONFIG
  };
}

module.exports = {
  runDiscoveredPingCycle,
  startDiscoveredPingScheduler,
  stopDiscoveredPingScheduler,
  getStatus,
  CONFIG
};
