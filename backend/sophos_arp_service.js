/**
 * Sophos ARP Automated Polling and Snapshot Comparison Service
 * 
 * Responsibilities:
 * 1. Schedules periodic ARP collection every 5 minutes (300,000ms).
 * 2. Reuses authorized Sophos login, navigation, and extraction via Playwright.
 * 3. Prevents overlapping collection cycles and duplicate imports.
 * 4. Validates extracted snapshots before database persistence.
 * 5. Compares successful snapshots to detect new MACs, changed IP-to-MAC mappings, and unobserved devices.
 * 6. Synchronizes discoveries into discovered_devices and matches against mac_inventory / devices
 *    without overwriting user-maintained metadata.
 * 7. On extraction/validation failure, safely logs the error and preserves the last successful snapshot.
 * 8. Never interprets absence from an ARP snapshot as proof that a device is offline.
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const pool = require('./db');
const { importArpSnapshot, getLatestSnapshotSummary } = require('./arp_importer');  // Functions for importing ARP snapshots and retrieving the latest snapshot summary
const { normalizeMac, formatMac } = require('./inventory_service'); // 

let playwrightChromium = null;
try {
  const pw = require('../sophos-arp-test/node_modules/playwright');
  playwrightChromium = pw.chromium;
} catch (e1) {
  try {
    const pw = require('playwright');
    playwrightChromium = pw.chromium;
  } catch (e2) {
    try {
      const fallbackPath = 'C:/Projects/Railway Node monitoring System/sophos-arp-test/node_modules/playwright';
      const pw = require(fallbackPath);
      playwrightChromium = pw.chromium;
    } catch (e3) {
      // Will be handled gracefully if live browser extraction is attempted
    }
  }
}

let isArpPollingInProgress = false;
let arpPollingTimer = null;
let lastPollerRun = {
  timestamp: null,
  success: null,
  durationMs: null,
  snapshotId: null,
  error: null,
  summary: null
};

let pollerDbState = {
  last_attempt_at: null,
  last_success_at: null,
  snapshot_created_at: null,
  polling_status: 'idle',
  last_error: null,
  last_duration_ms: null,
  last_snapshot_id: null,
  total_entries: null,
  entries_with_mac: null
};

/**
 * Initializes poller status table and seeds the in-memory cache from database.
 */
async function initPollerStatus() {
  try {
    const { migratePollerStatus } = require('./migrate_sophos_poller_status');
    await migratePollerStatus(pool);
    const res = await pool.query('SELECT * FROM sophos_poller_status WHERE id = 1');
    if (res.rows.length > 0) {
      pollerDbState = { ...res.rows[0] };
    }
  } catch (err) {
    console.error('[SophosPoller] Failed to initialize poller status:', err.message);
  }
}
initPollerStatus();

/**
 * Records a new polling attempt (updates last_attempt_at).
 */
async function recordPollAttempt() {
  try {
    const now = new Date().toISOString();
    pollerDbState.last_attempt_at = now;
    pollerDbState.polling_status = 'in_progress';
    await pool.query(
      `UPDATE sophos_poller_status
       SET last_attempt_at = NOW(),
           polling_status = 'in_progress',
           updated_at = NOW()
       WHERE id = 1`
    );
  } catch (err) {
    console.error('[SophosPoller] Failed to record poll attempt in DB:', err.message);
  }
}

/**
 * Records a polling failure (updates polling_status and last_error, keeps last_success_at & snapshot_created_at unchanged).
 */
async function recordPollFailure(errorMsg, durationMs) {
  try {
    pollerDbState.polling_status = 'failed';
    pollerDbState.last_error = errorMsg;
    pollerDbState.last_duration_ms = durationMs;
    await pool.query(
      `UPDATE sophos_poller_status
       SET polling_status = 'failed',
           last_error = $1,
           last_duration_ms = $2,
           updated_at = NOW()
       WHERE id = 1`,
      [errorMsg, durationMs]
    );
  } catch (err) {
    console.error('[SophosPoller] Failed to record poll failure in DB:', err.message);
  }
}

/**
 * Records a successful extraction where data was identical (updates last_success_at, keeps snapshot_created_at unchanged).
 */
async function recordPollSuccessDuplicate(totalEntries, entriesWithMac, durationMs) {
  try {
    const now = new Date().toISOString();
    pollerDbState.last_success_at = now;
    pollerDbState.polling_status = 'success_duplicate';
    pollerDbState.last_error = null;
    pollerDbState.last_duration_ms = durationMs;
    pollerDbState.total_entries = totalEntries;
    pollerDbState.entries_with_mac = entriesWithMac;
    await pool.query(
      `UPDATE sophos_poller_status
       SET last_success_at = NOW(),
           polling_status = 'success_duplicate',
           last_error = NULL,
           last_duration_ms = $1,
           total_entries = $2,
           entries_with_mac = $3,
           updated_at = NOW()
       WHERE id = 1`,
      [durationMs, totalEntries, entriesWithMac]
    );
  } catch (err) {
    console.error('[SophosPoller] Failed to record duplicate success in DB:', err.message);
  }
}

/**
 * Records a successful extraction where a new distinct snapshot was saved (updates last_success_at and snapshot_created_at).
 */
async function recordPollSuccessNew(snapshotId, totalEntries, entriesWithMac, durationMs) {
  try {
    const now = new Date().toISOString();
    pollerDbState.last_success_at = now;
    pollerDbState.snapshot_created_at = now;
    pollerDbState.last_snapshot_id = snapshotId;
    pollerDbState.polling_status = 'success_new';
    pollerDbState.last_error = null;
    pollerDbState.last_duration_ms = durationMs;
    pollerDbState.total_entries = totalEntries;
    pollerDbState.entries_with_mac = entriesWithMac;
    await pool.query(
      `UPDATE sophos_poller_status
       SET last_success_at = NOW(),
           snapshot_created_at = NOW(),
           last_snapshot_id = $1,
           polling_status = 'success_new',
           last_error = NULL,
           last_duration_ms = $2,
           total_entries = $3,
           entries_with_mac = $4,
           updated_at = NOW()
       WHERE id = 1`,
      [snapshotId, durationMs, totalEntries, entriesWithMac]
    );
  } catch (err) {
    console.error('[SophosPoller] Failed to record new snapshot success in DB:', err.message);
  }
}

/**
 * Asynchronously reads the latest persisted poller status from the database.
 */
async function getPersistedPollerStatus() {
  try {
    const res = await pool.query('SELECT * FROM sophos_poller_status WHERE id = 1');
    if (res.rows.length > 0) {
      pollerDbState = { ...res.rows[0] };
    }
  } catch (err) {
    console.error('[SophosPoller] Error reading persisted poller status:', err.message);
  }
  return {
    isRunning: Boolean(arpPollingTimer),
    isInProgress: isArpPollingInProgress,
    config: {
      enabled: CONFIG.enabled,
      intervalMs: CONFIG.intervalMs,
      intervalSeconds: CONFIG.intervalMs / 1000,
      sophosUrl: CONFIG.sophosUrl
    },
    lastRun: lastPollerRun,
    last_attempt_at: pollerDbState.last_attempt_at,
    last_success_at: pollerDbState.last_success_at,
    snapshot_created_at: pollerDbState.snapshot_created_at,
    polling_status: isArpPollingInProgress ? 'in_progress' : pollerDbState.polling_status,
    last_error: pollerDbState.last_error,
    last_duration_ms: pollerDbState.last_duration_ms,
    last_snapshot_id: pollerDbState.last_snapshot_id,
    total_entries: pollerDbState.total_entries,
    entries_with_mac: pollerDbState.entries_with_mac
  };
}

const CONFIG = {
  enabled: process.env.SOPHOS_ARP_POLL_ENABLED !== 'false',
  intervalMs: Number(process.env.SOPHOS_ARP_POLL_INTERVAL_MS) || 300000, // 5 minutes default
  sophosUrl: process.env.SOPHOS_URL,
  sophosUsername: process.env.SOPHOS_USERNAME,
  sophosPassword: process.env.SOPHOS_PASSWORD,
  profilePath: fs.existsSync(path.resolve(__dirname, '../sophos-arp-test/sophos-profile'))
    ? path.resolve(__dirname, '../sophos-arp-test/sophos-profile')
    : 'C:/Projects/Railway Node monitoring System/sophos-arp-test/sophos-profile',
  minValidEntries: 10
};

// Selectors for Sophos XGS 2100 WebConsole
const SELECTORS = {
  network: '#nav-network',
  neighbors: '#network-neighbors',
  moreTabs: '#tabs-network li.more-tabs',
  arpDropdown: '#arpmodules',
  tableRows: '#DataTable tbody.yui-dt-data tr.yui-dt-rec',
  pageLabel: '#paging2 .yui-pg-current',
  nextPage: '#paging2 .yui-pg-next'
};

const MAX_PAGES = 50;

/**
 * Validates extracted ARP entries before importing.
 * Evaluates pagination completeness, minimum entry thresholds, IPv4/MAC syntax,
 * and detects suspicious entry count drops relative to the previous snapshot.
 * 
 * @param {Array<object>} entries
 * @param {object} [telemetry]
 * @param {object} [previousSnapshotSummary]
 * @returns {{ valid: boolean, status: string, errors: string[], warnings: string[], stats: object }}
 */
function validateExtractedSnapshot(entries, telemetry = null, previousSnapshotSummary = null) {
  const errors = [];
  const warnings = [];
  let status = 'complete';

  if (!Array.isArray(entries)) {
    return {
      valid: false,
      status: 'failed',
      errors: ['Extracted snapshot payload is not an array'],
      warnings: [],
      stats: null
    };
  }

  // 1. Pagination completeness check
  if (telemetry) {
    if (telemetry.paginationCompleted === false || (telemetry.totalPagesDetected > 1 && telemetry.pagesVisited < telemetry.totalPagesDetected)) {
      status = 'incomplete';
      errors.push(`Incomplete pagination: visited ${telemetry.pagesVisited} of ${telemetry.totalPagesDetected} detected pages`);
    }

    if (telemetry.errors && telemetry.errors.length > 0) {
      warnings.push(...telemetry.errors);
    }
  }

  // 2. Entry count check
  if (entries.length === 0) {
    errors.push('Extracted snapshot contains zero entries');
    status = 'failed';
  } else if (CONFIG.minValidEntries && entries.length < CONFIG.minValidEntries) {
    warnings.push(`Extracted snapshot contains ${entries.length} entries (below advisory baseline of ${CONFIG.minValidEntries})`);
    if (status === 'complete') status = 'complete_with_warnings';
  }

  // 3. Format validations
  let validIpCount = 0;
  let validMacCount = 0;
  let incompleteCount = 0;
  let invalidCount = 0;

  for (const item of entries) {
    if (!item || typeof item !== 'object') {
      invalidCount++;
      continue;
    }
    const ip = (item.ip || item.ip_address || '').toString().trim();
    const mac = (item.mac || item.mac_address || '').toString().trim();
    const state = (item.arp_state || item.state || '').toString().toLowerCase();

    let entryHasError = false;
    if (net.isIPv4(ip)) {
      validIpCount++;
    } else {
      entryHasError = true;
    }

    const isExplicitIncomplete = state === 'incomplete' || !mac || mac === '00:00:00:00:00:00' || mac.toLowerCase().includes('incomplete');
    const norm = normalizeMac(mac);

    if (isExplicitIncomplete || norm === '000000000000') {
      incompleteCount++;
    } else if (norm) {
      validMacCount++;
    } else {
      entryHasError = true;
    }

    if (entryHasError) {
      invalidCount++;
    }
  }

  if (entries.length > 0 && validIpCount === 0) {
    errors.push('No valid IPv4 addresses found in extracted entries');
    status = 'failed';
  }

  if (entries.length > 0 && validMacCount === 0 && incompleteCount === 0) {
    errors.push('No valid or recognizable MAC addresses found in extracted entries');
    status = 'failed';
  }

  // 4. Anomaly detection: count reduction vs previous snapshot
  const prevCount = typeof previousSnapshotSummary === 'number'
    ? previousSnapshotSummary
    : (previousSnapshotSummary && previousSnapshotSummary.total_entries ? previousSnapshotSummary.total_entries : 0);

  if (prevCount > 0 && status !== 'failed') {
    const currentCount = entries.length;
    if (currentCount < prevCount * 0.75) {
      const dropPct = Math.round(((prevCount - currentCount) / prevCount) * 100);
      warnings.push(`Significant drop in entry count: extracted ${currentCount} entries vs previous ${prevCount} (-${dropPct}%)`);
      if (status === 'complete') {
        status = 'complete_with_warnings';
      }
    }
  }

  // 5. Final status resolution
  if (errors.length > 0) {
    if (status !== 'incomplete') status = 'failed';
  } else if (warnings.length > 0) {
    status = 'complete_with_warnings';
  }

  return {
    valid: status === 'complete' || status === 'complete_with_warnings',
    status,
    errors,
    warnings,
    stats: {
      total: entries.length,
      validIp: validIpCount,
      validIps: validIpCount,
      validMac: validMacCount,
      validMacs: validMacCount,
      incomplete: incompleteCount,
      incompleteArp: incompleteCount,
      invalid: invalidCount,
      invalidEntries: invalidCount
    }
  };
}

/**
 * Extracts ARP entries from Sophos firewall using Playwright browser automation.
 * Tracks page-by-page progress, pagination completeness, duration, and raw records.
 * 
 * @param {object} [options]
 * @returns {Promise<{ entries: Array<object>, rawEntries: Array<object>, telemetry: object }>}
 */
async function extractFromSophosBrowser(options = {}) {
  const startTime = Date.now();

  if (options.simulateFailure) {
    throw new Error('Simulated extraction failure for operational resilience testing');
  }

  if (options.entries) {
    const rawEntries = options.rawEntries || options.entries;
    const telem = options.telemetry || {
      startTime: new Date(startTime).toISOString(),
      endTime: new Date().toISOString(),
      durationMs: 120,
      totalPagesDetected: options.totalPagesDetected || 1,
      pagesVisited: options.pagesVisited || 1,
      paginationCompleted: options.paginationCompleted !== undefined ? options.paginationCompleted : true,
      pageRows: [{ page: 1, rows: rawEntries.length }],
      totalRawEntries: rawEntries.length,
      duplicateCount: Math.max(0, rawEntries.length - options.entries.length),
      errors: []
    };
    return {
      entries: options.entries,
      rawEntries,
      telemetry: telem
    };
  }

  if (options.fixturePath && fs.existsSync(options.fixturePath)) {
    const raw = fs.readFileSync(options.fixturePath, 'utf8');
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : (parsed.entries || []);
    return {
      entries: list,
      rawEntries: list,
      telemetry: {
        startTime: new Date(startTime).toISOString(),
        endTime: new Date().toISOString(),
        durationMs: 80,
        totalPagesDetected: 1,
        pagesVisited: 1,
        paginationCompleted: true,
        pageRows: [{ page: 1, rows: list.length }],
        totalRawEntries: list.length,
        duplicateCount: 0,
        errors: []
      }
    };
  }

  if (!playwrightChromium) {
    throw new Error('Playwright library not available in sophos-arp-test/node_modules');
  }

  const profileDir = options.profilePath || CONFIG.profilePath;
  const targetUrl = options.sophosUrl || CONFIG.sophosUrl;
  const username = options.sophosUsername || CONFIG.sophosUsername;
  const password = options.sophosPassword || CONFIG.sophosPassword;

  let context = null;
  try {
    context = await playwrightChromium.launchPersistentContext(profileDir, {
      headless: true,
      ignoreHTTPSErrors: true
    });

    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(15000);

    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Accept disclaimer if present
    const acceptButton = page.locator('input[type="button"][value="I accept"]');
    if (await acceptButton.isVisible().catch(() => false)) {
      await acceptButton.click();
      await page.waitForLoadState('domcontentloaded').catch(() => { });
      await page.waitForTimeout(500);
    }

    // Authenticate if login form visible
    const usernameField = page.locator('#username');
    const passwordField = page.locator('#password');
    const loginButton = page.locator('input[name="loginbutton"]');

    if (await usernameField.isVisible().catch(() => false)) {
      await usernameField.fill(username);
      await passwordField.fill(password);
      await loginButton.click();

      await Promise.race([
        acceptButton.waitFor({ state: 'visible', timeout: 15000 }).catch(() => null),
        page.locator('#nav-network').waitFor({ state: 'attached', timeout: 15000 }).catch(() => null)
      ]);

      if (await acceptButton.isVisible().catch(() => false)) {
        await acceptButton.click();
        await page.waitForLoadState('domcontentloaded').catch(() => { });
      }
    }

    // Confirm dashboard
    await page.locator('#nav-network').waitFor({ state: 'attached', timeout: 15000 });

    // Open Network section
    const network = page.locator('#nav-network');
    await network.waitFor({ state: 'visible', timeout: 10000 });
    const className = (await network.getAttribute('class')) || '';
    if (!className.includes('active-nav')) {
      await network.click();
      await page.waitForTimeout(500);
    }

    // Open Neighbors tab
    const neighbors = page.locator('#network-neighbors');
    const moreTabs = page.locator(SELECTORS.moreTabs);
    if (await neighbors.isVisible().catch(() => false)) {
      await neighbors.click();
    } else {
      await moreTabs.waitFor({ state: 'visible', timeout: 10000 });
      await moreTabs.click();
      await page.waitForTimeout(300);
      await neighbors.waitFor({ state: 'visible', timeout: 5000 });
      await neighbors.click();
    }

    await page.waitForTimeout(500);

    // Select IPv4 cache
    const dropdown = page.locator(SELECTORS.arpDropdown);
    await dropdown.waitFor({ state: 'visible', timeout: 10000 });
    await dropdown.selectOption('1'); // IPv4 option

    await page.waitForFunction(() => {
      const label = document.querySelector('#paging2 .yui-pg-current');
      const rows = document.querySelectorAll('#DataTable tbody.yui-dt-data tr.yui-dt-rec');
      return label && /\(\s*1\s+of\s+\d+\s*\)/i.test(label.textContent.trim()) && rows.length > 0;
    }, { timeout: 15000 });

    // Extract pages with telemetry tracking
    const allEntries = [];
    const seenLabels = new Set();
    const pageRows = [];
    let totalPagesDetected = 1;
    let pagesVisited = 0;
    let paginationCompleted = false;

    for (let index = 0; index < MAX_PAGES; index++) {
      const label = (await page.locator(SELECTORS.pageLabel).innerText().catch(() => '')).trim();
      if (label && seenLabels.has(label)) break;
      if (label) seenLabels.add(label);

      const rows = await page.locator(SELECTORS.tableRows).evaluateAll(els =>
        els.map(row => {
          const cells = Array.from(row.querySelectorAll('td')).map(cell =>
            (cell.innerText || cell.textContent || '').trim()
          );
          return {
            ip: cells[1] || '',
            mac: cells[2] || '',
            interface: cells[3] || '',
            state: cells[4] || ''
          };
        }).filter(entry => entry.ip)
      );

      pagesVisited++;
      const match = label.match(/\(?\s*(\d+)\s+of\s+(\d+)\s*\)?/i);
      const currentPageNum = match ? Number(match[1]) : pagesVisited;
      if (match) {
        totalPagesDetected = Number(match[2]);
      }
      pageRows.push({ page: currentPageNum, rows: rows.length });
      allEntries.push(...rows);

      if (match) {
        const current = Number(match[1]);
        const total = Number(match[2]);
        if (current >= total) {
          paginationCompleted = true;
          break;
        }
      }

      const next = page.locator(SELECTORS.nextPage);
      const nextClass = await next.getAttribute('class').catch(() => '');
      if (/disabled/i.test(nextClass)) {
        if (pagesVisited >= totalPagesDetected) {
          paginationCompleted = true;
        }
        break;
      }

      await next.click();
      await page.waitForFunction(
        ({ selector, previous }) => {
          const el = document.querySelector(selector);
          return el && el.textContent.trim() !== previous;
        },
        { selector: SELECTORS.pageLabel, previous: label },
        { timeout: 5000 }
      ).catch(() => { });
    }

    if (pagesVisited >= totalPagesDetected && totalPagesDetected > 0) {
      paginationCompleted = true;
    }

    // Deduplicate entries while preserving raw entries
    const uniqueMap = new Map();
    for (const entry of allEntries) {
      const sig = `${entry.ip}|${entry.mac}|${entry.interface}|${entry.state}`;
      uniqueMap.set(sig, entry);
    }
    const deduplicatedEntries = Array.from(uniqueMap.values());
    const extractionDurationMs = Date.now() - startTime;

    return {
      entries: deduplicatedEntries,
      rawEntries: allEntries,
      telemetry: {
        startTime: new Date(startTime).toISOString(),
        endTime: new Date().toISOString(),
        durationMs: extractionDurationMs,
        totalPagesDetected,
        pagesVisited,
        paginationCompleted,
        pageRows,
        totalRawEntries: allEntries.length,
        duplicateCount: Math.max(0, allEntries.length - deduplicatedEntries.length),
        errors: []
      }
    };
  } finally {
    if (context) {
      await context.close().catch(() => { });
    }
  }
}

/**
 * Checks if the newly extracted entries are identical to the latest snapshot in DB.
 * 
 * @param {Array<object>} newEntries
 * @param {number} latestSnapshotId
 * @returns {Promise<boolean>}
 */
async function isDuplicateOfLatest(newEntries, latestSnapshotId) {
  if (!latestSnapshotId) return false;

  const { rows: latestRows } = await pool.query(
    `SELECT ip_address, normalized_mac, interface
     FROM arp_discoveries
     WHERE snapshot_id = $1
     ORDER BY ip_address ASC`,
    [latestSnapshotId]
  );

  if (latestRows.length === 0) return false;
  if (latestRows.length !== newEntries.length) return false;

  const currentSignature = new Set(
    latestRows.map(r => `${r.ip_address}|${r.normalized_mac || '-'}|${r.interface}`)
  );

  for (const entry of newEntries) {
    const norm = normalizeMac(entry.mac || entry.mac_address);
    const iface = entry.interface || entry.iface || 'Unknown';
    const sig = `${entry.ip || entry.ip_address}|${norm || '-'}|${iface}`;
    if (!currentSignature.has(sig)) {
      return false; // Found a difference
    }
  }

  return true;
}

/**
 * Compares two snapshots to identify:
 * 1. New MAC addresses
 * 2. Changed IP-to-MAC mappings
 * 3. Devices not observed in the latest snapshot
 * 
 * @param {number} baseSnapshotId Earlier snapshot
 * @param {number} targetSnapshotId Later / current snapshot
 * @returns {Promise<object>} Comparison details and metrics
/**
 * Compares two snapshots to identify:
 * 1. New MAC addresses
 * 2. Unobserved MAC addresses (with dormancy explanation)
 * 3. Changed IP-to-MAC mappings (same IP, different MAC)
 * 4. Changed MAC-to-IP mappings (same MAC, different IP)
 * 5. Interface changes (e.g. Port1 -> Port3)
 * 6. ARP state changes (e.g. Incomplete -> Complete)
 * 7. Unchanged entries
 * 
 * @param {number} baseSnapshotId Earlier snapshot
 * @param {number} targetSnapshotId Later / current snapshot
 * @returns {Promise<object>} Comparison details and metrics
 */
async function compareSnapshots(baseSnapshotId, targetSnapshotId) {
  // Support in-memory array comparisons for unit testing and offline preview
  if (Array.isArray(baseSnapshotId) && Array.isArray(targetSnapshotId)) {
    const baseArg = baseSnapshotId;
    const targetArg = targetSnapshotId;
    const normalizeKey = (entry) => {
      const mac = normalizeMac(entry.mac || entry.mac_address || '');
      const ip = (entry.ip || entry.ip_address || '').trim();
      return { mac, ip, iface: entry.interface, state: entry.arp_state };
    };

    const baseEntries = baseArg.map(normalizeKey);
    const targetEntries = targetArg.map(normalizeKey);

    const baseMacs = new Set(baseEntries.filter(e => e.mac).map(e => e.mac));
    const targetMacs = new Set(targetEntries.filter(e => e.mac).map(e => e.mac));

    const newMacs = targetEntries.filter(e => e.mac && !baseMacs.has(e.mac));
    const unobserved = baseEntries.filter(e => e.mac && !targetMacs.has(e.mac)).map(e => ({
      ...e,
      note: 'Unobserved in latest snapshot. Host may be idle, powered off, or subject to ARP cache aging (does not confirm physical removal).'
    }));

    const baseIpMap = new Map();
    baseEntries.forEach(e => { if (e.ip && e.mac) baseIpMap.set(e.ip, e); });
    const changedIpToMac = [];
    targetEntries.forEach(t => {
      if (t.ip && t.mac && baseIpMap.has(t.ip)) {
        const b = baseIpMap.get(t.ip);
        if (b.mac !== t.mac) {
          changedIpToMac.push({ ip_address: t.ip, previous_mac: b.mac, current_mac: t.mac });
        }
      }
    });

    const baseMacMap = new Map();
    baseEntries.forEach(e => { if (e.ip && e.mac) baseMacMap.set(e.mac, e); });
    const changedMacToIp = [];
    targetEntries.forEach(t => {
      if (t.ip && t.mac && baseMacMap.has(t.mac)) {
        const b = baseMacMap.get(t.mac);
        if (b.ip !== t.ip) {
          changedMacToIp.push({ mac_address: t.mac, previous_ip: b.ip, current_ip: t.ip });
        }
      }
    });

    const changedInterface = [];
    targetEntries.forEach(t => {
      if (t.ip && t.mac && baseIpMap.has(t.ip)) {
        const b = baseIpMap.get(t.ip);
        if (b.mac === t.mac && b.iface && t.iface && b.iface !== t.iface) {
          changedInterface.push({ ip_address: t.ip, mac_address: t.mac, previous_interface: b.iface, current_interface: t.iface });
        }
      }
    });

    let unchangedCount = 0;
    targetEntries.forEach(t => {
      if (t.ip && t.mac && baseIpMap.has(t.ip)) {
        const b = baseIpMap.get(t.ip);
        if (b.mac === t.mac && b.iface === t.iface && (b.state || '').toLowerCase() === (t.state || '').toLowerCase()) {
          unchangedCount++;
        }
      }
    });

    const hasChanges = (newMacs.length + unobserved.length + changedIpToMac.length + changedMacToIp.length + changedInterface.length) > 0;

    return {
      baseSnapshot: { id: 'memory-base', total_entries: baseArg.length },
      targetSnapshot: { id: 'memory-target', total_entries: targetArg.length },
      newMacs,
      newMacCount: newMacs.length,
      newCount: newMacs.length,
      unobserved,
      unobservedCount: unobserved.length,
      changedIpToMac,
      changedIpToMacCount: changedIpToMac.length,
      ipChangedCount: changedIpToMac.length,
      changedMacToIp,
      changedMacToIpCount: changedMacToIp.length,
      interfaceChanges: changedInterface,
      interfaceChangesCount: changedInterface.length,
      interfaceChangedCount: changedInterface.length,
      unchangedCount,
      hasChanges,
      timestamp: new Date().toISOString()
    };
  }

  const baseRes = await pool.query('SELECT * FROM arp_snapshots WHERE id = $1', [baseSnapshotId]);
  const targetRes = await pool.query('SELECT * FROM arp_snapshots WHERE id = $1', [targetSnapshotId]);

  if (baseRes.rows.length === 0 || targetRes.rows.length === 0) {
    throw new Error(`Snapshot comparison requires valid snapshot IDs (Base: ${baseSnapshotId}, Target: ${targetSnapshotId})`);
  }

  // 1. New MACs in target that were not in base
  const newMacsRes = await pool.query(`
    SELECT DISTINCT d.normalized_mac, d.mac_address, d.ip_address, d.interface, d.arp_state, d.discovered_at
    FROM arp_discoveries d
    WHERE d.snapshot_id = $1 AND d.has_mac = TRUE AND d.normalized_mac IS NOT NULL
      AND d.normalized_mac NOT IN (
        SELECT b.normalized_mac FROM arp_discoveries b
        WHERE b.snapshot_id = $2 AND b.has_mac = TRUE AND b.normalized_mac IS NOT NULL
      )
    ORDER BY d.ip_address ASC
  `, [targetSnapshotId, baseSnapshotId]);

  // 2. Devices in base that were unobserved in target (with explainable note)
  const unobservedRawRes = await pool.query(`
    SELECT DISTINCT b.normalized_mac, b.mac_address, b.ip_address, b.interface, b.arp_state, b.discovered_at
    FROM arp_discoveries b
    WHERE b.snapshot_id = $1 AND b.has_mac = TRUE AND b.normalized_mac IS NOT NULL
      AND b.normalized_mac NOT IN (
        SELECT t.normalized_mac FROM arp_discoveries t
        WHERE t.snapshot_id = $2 AND t.has_mac = TRUE AND t.normalized_mac IS NOT NULL
      )
    ORDER BY b.ip_address ASC
  `, [baseSnapshotId, targetSnapshotId]);

  const unobserved = unobservedRawRes.rows.map(row => ({
    ...row,
    note: 'Unobserved in latest snapshot. Host may be idle, powered off, or subject to ARP cache aging (does not confirm physical removal).'
  }));

  // 3. Changed IP-to-MAC mappings (same IP, different MAC address)
  const changedIpToMacRes = await pool.query(`
    SELECT
      t.ip_address,
      b.mac_address AS previous_mac,
      b.normalized_mac AS previous_normalized_mac,
      t.mac_address AS current_mac,
      t.normalized_mac AS current_normalized_mac,
      b.interface AS previous_interface,
      t.interface AS current_interface,
      t.discovered_at AS observed_at
    FROM arp_discoveries t
    JOIN arp_discoveries b ON t.ip_address = b.ip_address
    WHERE t.snapshot_id = $1 AND b.snapshot_id = $2
      AND t.has_mac = TRUE AND b.has_mac = TRUE
      AND t.normalized_mac != b.normalized_mac
    ORDER BY t.ip_address ASC
  `, [targetSnapshotId, baseSnapshotId]);

  // 4. Changed MAC-to-IP mappings (same MAC, different IP address)
  const changedMacToIpRes = await pool.query(`
    SELECT
      t.mac_address,
      t.normalized_mac,
      b.ip_address AS previous_ip,
      t.ip_address AS current_ip,
      b.interface AS previous_interface,
      t.interface AS current_interface,
      t.discovered_at AS observed_at
    FROM arp_discoveries t
    JOIN arp_discoveries b ON t.normalized_mac = b.normalized_mac
    WHERE t.snapshot_id = $1 AND b.snapshot_id = $2
      AND t.has_mac = TRUE AND b.has_mac = TRUE
      AND t.ip_address != b.ip_address
    ORDER BY t.mac_address ASC
  `, [targetSnapshotId, baseSnapshotId]);

  // 5. Interface changes (same MAC & IP, changed firewall interface)
  const interfaceChangesRes = await pool.query(`
    SELECT
      t.ip_address,
      t.mac_address,
      t.normalized_mac,
      b.interface AS previous_interface,
      t.interface AS current_interface,
      t.discovered_at AS observed_at
    FROM arp_discoveries t
    JOIN arp_discoveries b ON t.ip_address = b.ip_address AND t.normalized_mac = b.normalized_mac
    WHERE t.snapshot_id = $1 AND b.snapshot_id = $2
      AND t.interface != b.interface
    ORDER BY t.ip_address ASC
  `, [targetSnapshotId, baseSnapshotId]);

  // 6. ARP state changes (same IP, changed ARP state, e.g. Incomplete -> Complete)
  const arpStateChangesRes = await pool.query(`
    SELECT
      t.ip_address,
      t.mac_address,
      t.normalized_mac,
      t.interface,
      b.arp_state AS previous_state,
      t.arp_state AS current_state,
      t.discovered_at AS observed_at
    FROM arp_discoveries t
    JOIN arp_discoveries b ON t.ip_address = b.ip_address
    WHERE t.snapshot_id = $1 AND b.snapshot_id = $2
      AND LOWER(COALESCE(t.arp_state, '')) != LOWER(COALESCE(b.arp_state, ''))
    ORDER BY t.ip_address ASC
  `, [targetSnapshotId, baseSnapshotId]);

  // 7. Stable / unchanged devices
  const unchangedRes = await pool.query(`
    SELECT count(*) AS count
    FROM arp_discoveries t
    JOIN arp_discoveries b ON t.ip_address = b.ip_address
    WHERE t.snapshot_id = $1 AND b.snapshot_id = $2
      AND t.has_mac = TRUE AND b.has_mac = TRUE
      AND t.normalized_mac = b.normalized_mac
      AND t.interface = b.interface
      AND LOWER(COALESCE(t.arp_state, '')) = LOWER(COALESCE(b.arp_state, ''))
  `, [targetSnapshotId, baseSnapshotId]);

  return {
    baseSnapshot: baseRes.rows[0],
    targetSnapshot: targetRes.rows[0],
    newMacs: newMacsRes.rows,
    newMacCount: newMacsRes.rows.length,
    newCount: newMacsRes.rows.length,
    changedMappings: changedIpToMacRes.rows,
    changedMappingCount: changedIpToMacRes.rows.length,
    changedIpToMac: changedIpToMacRes.rows,
    changedIpToMacCount: changedIpToMacRes.rows.length,
    ipChangedCount: changedIpToMacRes.rows.length,
    changedMacToIp: changedMacToIpRes.rows,
    changedMacToIpCount: changedMacToIpRes.rows.length,
    interfaceChanges: interfaceChangesRes.rows,
    interfaceChangesCount: interfaceChangesRes.rows.length,
    interfaceChangedCount: interfaceChangesRes.rows.length,
    arpStateChanges: arpStateChangesRes.rows,
    arpStateChangesCount: arpStateChangesRes.rows.length,
    unobserved,
    unobservedCount: unobserved.length,
    unchangedCount: parseInt(unchangedRes.rows[0].count, 10),
    hasChanges: (newMacsRes.rows.length + unobserved.length + changedIpToMacRes.rows.length + changedMacToIpRes.rows.length + interfaceChangesRes.rows.length) > 0,
    timestamp: new Date().toISOString()
  };
}

/**
 * Runs a single safe automated collection, validation, and comparison cycle.
 * 
 * @param {object} [options]
 * @param {Array<object>} [options.entries] Override entries for testing
 * @param {string} [options.fixturePath] Read fixture for testing
 * @param {boolean} [options.simulateFailure] Force error for failure testing
 * @param {boolean} [options.dryRun] Roll back database transaction
 * @returns {Promise<object>} Cycle outcome
 */
async function runArpPollingCycle(options = {}) {
  console.log("inside runArpPollingCycle");
  if (isArpPollingInProgress) {
    console.log('[SophosPoller] Previous ARP polling cycle still running; skipping cycle.');
    return { skipped: true, reason: 'Already in progress' };
  }

  isArpPollingInProgress = true;
  const startTime = Date.now();
  if (!options.dryRun) {
    await recordPollAttempt();
  }

  try {
    const latestSummaryBefore = await getLatestSnapshotSummary();
    const lastSuccessfulSnapId = latestSummaryBefore ? latestSummaryBefore.id : null;

    // 1. Extraction phase
    let extraction;
    try {
      extraction = await extractFromSophosBrowser(options);
    } catch (extractErr) {
      const durationMs = Date.now() - startTime;
      console.error(`[SophosPoller] Extraction failed: ${extractErr.message}. Preserving last successful snapshot (#${lastSuccessfulSnapId || 'none'}).`);
      if (!options.dryRun) {
        await recordPollFailure(extractErr.message, durationMs);
      }
      lastPollerRun = {
        timestamp: new Date().toISOString(),
        success: false,
        durationMs,
        snapshotId: lastSuccessfulSnapId,
        error: extractErr.message,
        summary: null
      };
      return {
        success: false,
        error: extractErr.message,
        preservedSnapshotId: lastSuccessfulSnapId,
        durationMs
      };
    }

    const entries = Array.isArray(extraction) ? extraction : extraction.entries;
    const rawEntries = extraction.rawEntries || entries;
    const telemetry = extraction.telemetry || {
      startTime: new Date(startTime).toISOString(),
      endTime: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      totalPagesDetected: 1,
      pagesVisited: 1,
      paginationCompleted: true,
      pageRows: [{ page: 1, rows: entries.length }],
      totalRawEntries: rawEntries.length,
      duplicateCount: Math.max(0, rawEntries.length - entries.length),
      errors: []
    };

    // 2. Mandatory Validation & Completeness Check
    const validation = validateExtractedSnapshot(entries, telemetry, latestSummaryBefore);
    if (!validation.valid) {
      const errMsg = validation.errors.join('; ');
      const durationMs = Date.now() - startTime;
      console.error(`[SophosPoller] Extraction integrity verification failed [${validation.status}]: ${errMsg}. Preserving last successful snapshot (#${lastSuccessfulSnapId || 'none'}).`);
      if (!options.dryRun) {
        await recordPollFailure(errMsg, durationMs);
      }
      lastPollerRun = {
        timestamp: new Date().toISOString(),
        success: false,
        status: validation.status,
        durationMs,
        snapshotId: lastSuccessfulSnapId,
        error: errMsg,
        warnings: validation.warnings,
        summary: null
      };
      return {
        success: false,
        status: validation.status,
        error: errMsg,
        warnings: validation.warnings,
        preservedSnapshotId: lastSuccessfulSnapId,
        durationMs
      };
    }

    // 3. Duplicate check against latest snapshot
    const isDuplicate = await isDuplicateOfLatest(entries, lastSuccessfulSnapId);
    if (isDuplicate) {
      const durationMs = Date.now() - startTime;
      console.log(`[SophosPoller] Extracted snapshot is identical to latest snapshot (#${lastSuccessfulSnapId}); duplicate import skipped | ${durationMs}ms`);
      const validMacCount = entries.filter(e => e.mac && e.mac.length > 0 && e.mac !== '00:00:00:00:00:00').length;
      if (!options.dryRun) {
        await recordPollSuccessDuplicate(entries.length, validMacCount, durationMs);
      }
      lastPollerRun = {
        timestamp: new Date().toISOString(),
        success: true,
        durationMs,
        snapshotId: lastSuccessfulSnapId,
        error: null,
        summary: { isDuplicate: true, totalEntries: entries.length }
      };
      return {
        success: true,
        duplicateSkipped: true,
        snapshotId: lastSuccessfulSnapId,
        totalEntries: entries.length,
        durationMs
      };
    }

    // 4. Import phase with full verification and audit metadata
    const snapshotName = options.snapshotName || `Sophos Automated Snapshot ${new Date().toLocaleString()}`;
    const importResult = await importArpSnapshot(
      {
        extractedAt: new Date().toISOString(),
        source: 'Sophos IPv4 Neighbor Cache',
        totalEntries: entries.length,
        entries
      },
      {
        snapshotName,
        sourceDevice: 'Sophos XGS2100',
        dryRun: Boolean(options.dryRun),
        telemetry: {
          ...telemetry,
          durationMs: Date.now() - startTime,
          warnings: validation.warnings,
          status: validation.status
        },
        rawPayload: rawEntries,
        extractionStatus: validation.status
      }
    );

    // 5. Comparison phase (if a previous snapshot existed)
    let comparison = null;
    if (lastSuccessfulSnapId && !options.dryRun) {
      try {
        comparison = await compareSnapshots(lastSuccessfulSnapId, importResult.snapshotId);
      } catch (compErr) {
        console.warn('[SophosPoller] Comparison warning:', compErr.message);
      }
    }

    const durationMs = Date.now() - startTime;
    const newMacCount = comparison ? comparison.newMacCount : 0;
    const changedMappingCount = comparison ? comparison.changedMappingCount : 0;
    const unobservedCount = comparison ? comparison.unobservedCount : 0;

    console.log(
      `[SophosPoller] Cycle completed [${validation.status}]: Snapshot #${importResult.snapshotId} (${importResult.totalEntries} entries, ${importResult.entriesWithMac} with MAC) | ${newMacCount} new MACs | ${changedMappingCount} IP-MAC changes | ${unobservedCount} unobserved | ${durationMs}ms`
    );

    if (!options.dryRun) {
      await recordPollSuccessNew(importResult.snapshotId, importResult.totalEntries, importResult.entriesWithMac, durationMs);
    }

    lastPollerRun = {
      timestamp: new Date().toISOString(),
      success: true,
      status: validation.status,
      durationMs,
      snapshotId: importResult.snapshotId,
      error: null,
      warnings: validation.warnings,
      summary: {
        totalEntries: importResult.totalEntries,
        entriesWithMac: importResult.entriesWithMac,
        newMacCount,
        changedMappingCount,
        unobservedCount
      }
    };

    return {
      success: true,
      status: validation.status,
      snapshotId: importResult.snapshotId,
      totalEntries: importResult.totalEntries,
      entriesWithMac: importResult.entriesWithMac,
      warnings: validation.warnings,
      comparison,
      durationMs
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error(`[SophosPoller] Cycle error after ${durationMs}ms:`, err.message);
    if (!options.dryRun) {
      await recordPollFailure(err.message, durationMs);
    }
    lastPollerRun = {
      timestamp: new Date().toISOString(),
      success: false,
      durationMs,
      error: err.message
    };
    throw err;
  } finally {
    isArpPollingInProgress = false;
  }
}

/**
 * Starts the recurring 5-minute ARP polling scheduler.
 */
function startArpPollingScheduler() {
  if (!CONFIG.enabled) {
    console.log('[SophosPoller] Scheduler is disabled via configuration (SOPHOS_ARP_POLL_ENABLED=false).');
    return;
  }

  if (arpPollingTimer) {
    return;
  }

  console.log(`[SophosPoller] Starting scheduler (Interval: ${CONFIG.intervalMs / 1000}s, Target: ${CONFIG.sophosUrl})`);

  // Initial collection run after 10 seconds to allow ping services and DB to settle
  setTimeout(() => {
    runArpPollingCycle().catch(err => {
      console.error('[SophosPoller] Initial cycle error:', err.message);
    });
  }, 10000);

  arpPollingTimer = setInterval(() => {
    runArpPollingCycle().catch(err => {
      console.error('[SophosPoller] Interval cycle error:', err.message);
    });
  }, CONFIG.intervalMs);
}

/**
 * Stops the recurring scheduler.
 */
function stopArpPollingScheduler() {
  if (arpPollingTimer) {
    clearInterval(arpPollingTimer);
    arpPollingTimer = null;
    console.log('[SophosPoller] Scheduler stopped.');
  }
}

/**
 * Returns operational status and telemetry for the poller.
 */
function getArpPollerStatus() {
  return {
    isRunning: Boolean(arpPollingTimer),
    isInProgress: isArpPollingInProgress,
    config: {
      enabled: CONFIG.enabled,
      intervalMs: CONFIG.intervalMs,
      intervalSeconds: CONFIG.intervalMs / 1000,
      sophosUrl: CONFIG.sophosUrl
    },
    lastRun: lastPollerRun,
    last_attempt_at: pollerDbState.last_attempt_at,
    last_success_at: pollerDbState.last_success_at,
    snapshot_created_at: pollerDbState.snapshot_created_at,
    polling_status: isArpPollingInProgress ? 'in_progress' : pollerDbState.polling_status,
    last_error: pollerDbState.last_error,
    last_duration_ms: pollerDbState.last_duration_ms,
    last_snapshot_id: pollerDbState.last_snapshot_id,
    total_entries: pollerDbState.total_entries,
    entries_with_mac: pollerDbState.entries_with_mac
  };
}

module.exports = {
  runArpPollingCycle,
  startArpPollingScheduler,
  stopArpPollingScheduler,
  getArpPollerStatus,
  getPersistedPollerStatus,
  recordPollAttempt,
  recordPollFailure,
  recordPollSuccessDuplicate,
  recordPollSuccessNew,
  validateExtractedSnapshot,
  compareSnapshots,
  extractFromSophosBrowser,
  CONFIG
};
