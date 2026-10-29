const { execFile } = require('child_process');
const net = require('net');

/**
 * Pings an IPv4 address once with 1500ms timeout on Windows.
 * Returns { status: 'online' | 'offline' | 'unknown', latency_ms: number | null, reason: string }
 * 
 * @param {string} ipAddress 
 * @returns {Promise<{ status: string, latency_ms: number | null, reason: string }>}
 */
function pingDevice(ipAddress) {
  return new Promise((resolve) => {
    if (
      !ipAddress ||
      typeof ipAddress !== 'string' ||
      !net.isIPv4(ipAddress.trim())
    ) {
      return resolve({
        status: 'unknown',
        latency_ms: null,
        reason: 'Invalid IP address',
      });
    }

    const target = ipAddress.trim();

    execFile(
      'ping',
      ['-n', '1', '-w', '1500', target],
      { timeout: 4000, windowsHide: true },
      (error, stdout, stderr) => {
        const output = `${stdout || ''}\n${stderr || ''}`;

        if (error) {
          const noReply =
            /timed out|request timed out|destination host unreachable|could not find host|general failure/i.test(
              output
            );

          return resolve({
            status: noReply ? 'offline' : 'unknown',
            latency_ms: null,
            reason: noReply
              ? 'No ping reply'
              : error.message || 'Ping command failed',
          });
        }

        const match = output.match(/time[=<]\s*(\d+)\s*ms/i);

        if (/TTL\s*=/i.test(output)) {
          return resolve({
            status: 'online',
            latency_ms: match ? Number(match[1]) : null,
            reason: 'Ping reply received',
          });
        }

        return resolve({
          status: 'unknown',
          latency_ms: null,
          reason: 'Could not confirm a ping reply',
        });
      }
    );
  });
}

module.exports = { pingDevice };
