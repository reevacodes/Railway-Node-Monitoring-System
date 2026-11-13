const express = require('express');
const pool = require('./db');

const router = express.Router();

// Default freshness threshold in minutes
const DEFAULT_FRESHNESS_MINUTES = 10;

/**
 * 1. GET /api/overview/unified-summary
 * Returns the definitive deduplicated overview health metrics and poll stats.
 */
router.get('/api/overview/unified-summary', async (req, res) => {
  try {
    const freshnessMinutes = parseInt(req.query.freshness_minutes, 10) || DEFAULT_FRESHNESS_MINUTES;

    // 1. Registered devices count from `devices`
    const regCountRes = await pool.query('SELECT count(*) FROM devices');
    const registeredCount = parseInt(regCountRes.rows[0].count, 10);

    // 2. Latest ARP snapshot info
    const latestSnapRes = await pool.query(`
      SELECT * FROM arp_snapshots 
      ORDER BY imported_at DESC, id DESC 
      LIMIT 1
    `);
    const latestSnap = latestSnapRes.rows[0] || null;

    // 3. Unmanaged discovered devices count (where registered_device_id IS NULL)
    const unmanagedCountRes = await pool.query(
      'SELECT count(*) FROM discovered_devices WHERE registered_device_id IS NULL'
    );
    const unmanagedCount = parseInt(unmanagedCountRes.rows[0].count, 10);

    // 4. Discovered devices matched to inventory & registered devices
    const discMatchRes = await pool.query(`
      SELECT
        count(*) AS total_discovered,
        count(matched_inventory_id) AS matched_to_inventory,
        count(registered_device_id) AS matched_to_registered
      FROM discovered_devices
    `);
    const discMatch = discMatchRes.rows[0];

    // 5. Total unique observed assets (Registered + Unmanaged Discovered)
    const totalUniqueAssets = registeredCount + unmanagedCount;

    // 6. Previous snapshot for newly discovered calculation
    let previousSnapId = null;
    if (latestSnap) {
      const prevSnapRes = await pool.query(`
        SELECT id FROM arp_snapshots 
        WHERE id != $1 
        ORDER BY imported_at DESC 
        LIMIT 1
      `, [latestSnap.id]);
      if (prevSnapRes.rows.length > 0) {
        previousSnapId = prevSnapRes.rows[0].id;
      }
    }

    let newlyDiscoveredCount = 0;
    let newlyDiscoveredEndpoints = 0;
    if (latestSnap && previousSnapId) {
      const newMacRes = await pool.query(`
        SELECT count(DISTINCT d.normalized_mac)
        FROM arp_discoveries d
        WHERE d.snapshot_id = $1 
          AND d.normalized_mac IS NOT NULL
          AND d.normalized_mac NOT IN (
            SELECT p.normalized_mac FROM arp_discoveries p
            WHERE p.snapshot_id = $2 AND p.normalized_mac IS NOT NULL
          )
      `, [latestSnap.id, previousSnapId]);
      newlyDiscoveredCount = parseInt(newMacRes.rows[0].count, 10);

      const newObsRes = await pool.query(`
        SELECT count(*)
        FROM discovered_devices dd
        WHERE dd.normalized_mac IS NOT NULL
          AND dd.normalized_mac NOT IN (
            SELECT p.normalized_mac FROM arp_discoveries p
            WHERE p.snapshot_id = $1 AND p.normalized_mac IS NOT NULL
          )
      `, [previousSnapId]);
      newlyDiscoveredEndpoints = parseInt(newObsRes.rows[0].count, 10);
    }

    // 7. Reachability breakdown with freshness evaluation across unified population
    // Registered devices latest status
    const regReachabilityQuery = `
      WITH latest_status AS (
        SELECT DISTINCT ON (device_id)
          device_id, status, latency_ms, checked_at
        FROM status_history
        ORDER BY device_id, checked_at DESC, id DESC
      )
      SELECT
        count(*) FILTER (
          WHERE LOWER(s.status) = 'online' 
            AND s.checked_at >= NOW() - (interval '1 minute' * $1)
        ) AS online,
        count(*) FILTER (
          WHERE LOWER(s.status) = 'offline' 
            AND s.checked_at >= NOW() - (interval '1 minute' * $1)
        ) AS offline,
        count(*) FILTER (
          WHERE s.status IS NULL 
            OR s.checked_at IS NULL
            OR s.checked_at < NOW() - (interval '1 minute' * $1)
            OR LOWER(s.status) = 'unknown'
        ) AS unknown
      FROM devices d
      LEFT JOIN latest_status s ON s.device_id = d.id
    `;
    const regReachRes = await pool.query(regReachabilityQuery, [freshnessMinutes]);
    const regReach = regReachRes.rows[0];

    // Unmanaged discovered reachability
    const unmanagedReachabilityQuery = `
      SELECT
        count(*) FILTER (
          WHERE LOWER(last_ping_status) = 'online' 
            AND last_ping_at >= NOW() - (interval '1 minute' * $1)
        ) AS online,
        count(*) FILTER (
          WHERE LOWER(last_ping_status) = 'offline' 
            AND last_ping_at >= NOW() - (interval '1 minute' * $1)
        ) AS offline,
        count(*) FILTER (
          WHERE last_ping_status IS NULL 
            OR last_ping_at IS NULL
            OR last_ping_at < NOW() - (interval '1 minute' * $1)
            OR LOWER(last_ping_status) = 'unknown'
        ) AS unknown
      FROM discovered_devices
      WHERE registered_device_id IS NULL
    `;
    const unmanagedReachRes = await pool.query(unmanagedReachabilityQuery, [freshnessMinutes]);
    const unmanagedReach = unmanagedReachRes.rows[0];

    const respondingCount = parseInt(regReach.online, 10) + parseInt(unmanagedReach.online, 10);
    const noReplyCount = parseInt(regReach.offline, 10) + parseInt(unmanagedReach.offline, 10);
    const unknownStaleCount = parseInt(regReach.unknown, 10) + parseInt(unmanagedReach.unknown, 10);

    // Operational availability percentage
    const availabilityRate = totalUniqueAssets > 0
      ? Math.round((respondingCount / totalUniqueAssets) * 100)
      : 0;

    let pollerMeta = null;
    try {
      const { getPersistedPollerStatus } = require('./sophos_arp_service');
      pollerMeta = await getPersistedPollerStatus();
    } catch (e) {
      // ignore
    }

    res.json({
      registered_devices_count: registeredCount,
      latest_arp_raw_count: latestSnap ? latestSnap.total_entries : 0,
      valid_mac_devices_count: latestSnap ? latestSnap.entries_with_mac : 0,
      incomplete_no_mac_count: latestSnap ? (latestSnap.total_entries - latestSnap.entries_with_mac) : 0,
      matched_to_inventory_count: parseInt(discMatch.matched_to_inventory, 10),
      matched_to_registered_count: parseInt(discMatch.matched_to_registered, 10),
      unmanaged_discovered_count: unmanagedCount,
      total_unique_observed_assets: totalUniqueAssets,
      newly_discovered_count: newlyDiscoveredCount,
      newly_discovered_endpoints_count: newlyDiscoveredEndpoints,
      ping_responding_count: respondingCount,
      ping_no_reply_count: noReplyCount,
      ping_unknown_stale_count: unknownStaleCount,
      availability_rate: availabilityRate,
      freshness_threshold_minutes: freshnessMinutes,
      last_attempt_at: pollerMeta ? pollerMeta.last_attempt_at : null,
      last_success_at: pollerMeta ? pollerMeta.last_success_at : null,
      snapshot_created_at: pollerMeta?.snapshot_created_at || (latestSnap ? latestSnap.imported_at : null),
      polling_status: pollerMeta ? pollerMeta.polling_status : 'idle',
      polling_error: pollerMeta ? pollerMeta.last_error : null,
      poller_status: pollerMeta,
      latest_snapshot: latestSnap ? {
        id: latestSnap.id,
        name: latestSnap.snapshot_name,
        source_device: latestSnap.source_device || 'Sophos XGS2100',
        imported_at: latestSnap.imported_at,
        snapshot_created_at: pollerMeta?.snapshot_created_at || latestSnap.imported_at,
        total_entries: latestSnap.total_entries,
        entries_with_mac: latestSnap.entries_with_mac,
        incomplete_entries: latestSnap.total_entries - latestSnap.entries_with_mac,
        matched_inventory_count: parseInt(discMatch.matched_to_inventory, 10),
        matched_registered_count: parseInt(discMatch.matched_to_registered, 10),
        unmatched_count: latestSnap.entries_with_mac - parseInt(discMatch.matched_to_registered, 10),
        status: 'success'
      } : null
    });
  } catch (err) {
    console.error('Fetch unified summary failed:', err);
    res.status(500).json({ error: 'Failed to generate unified overview summary' });
  }
});

/**
 * 2. GET /api/overview/unified-devices
 * Returns the deduplicated, paginated unified device list.
 */
router.get('/api/overview/unified-devices', async (req, res) => {
  try {
    const {
      search,
      filter = 'ALL',
      page = 1,
      limit = 25,
      freshness_minutes = DEFAULT_FRESHNESS_MINUTES,
      sort_field = 'name',
      sort_dir = 'asc'
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(200, parseInt(limit, 10) || 25));
    const offset = (pageNum - 1) * limitNum;
    const freshness = parseInt(freshness_minutes, 10) || DEFAULT_FRESHNESS_MINUTES;

    // Previous snapshot for newly discovered lookup
    const snapIdsRes = await pool.query('SELECT id FROM arp_snapshots ORDER BY imported_at DESC LIMIT 2');
    const latestSnapId = snapIdsRes.rows[0]?.id || null;
    const previousSnapId = snapIdsRes.rows[1]?.id || null;

    // Base CTE: Unified Devices (Deduplicated)
    const baseQuery = `
      WITH latest_reg_status AS (
        SELECT DISTINCT ON (device_id)
          device_id, status, latency_ms, checked_at
        FROM status_history
        ORDER BY device_id, checked_at DESC, id DESC
      ),
      prior_snapshot_macs AS (
        SELECT DISTINCT normalized_mac
        FROM arp_discoveries
        WHERE snapshot_id = ${previousSnapId ? Number(previousSnapId) : -1} 
          AND normalized_mac IS NOT NULL
      ),
      unified_raw AS (
        -- Population 1: Registered Managed Devices (26 items)
        SELECT
          CONCAT('reg-', d.id) AS unique_key,
          'managed' AS classification,
          'registered' AS origin,
          d.id AS registered_device_id,
          dd.id AS discovered_device_id,
          d.name AS name,
          COALESCE(d.ip_address, dd.ip_address) AS ip_address,
          COALESCE(d.mac_address, dd.mac_address) AS mac_address,
          LOWER(REPLACE(REPLACE(COALESCE(d.mac_address, dd.mac_address, ''), ':', ''), '-', '')) AS normalized_mac,
          d.device_type AS device_type,
          COALESCE(d.room, d.building, 'Railway Complex') AS department_location,
          d.contact_person AS contact_person,
          d.contact_phone AS contact_phone,
          CASE
            WHEN dd.matched_inventory_id IS NOT NULL THEN 'matched'
            ELSE 'unmatched'
          END AS inventory_match_status,
          CASE
            WHEN sh.checked_at IS NULL THEN 'unknown'
            WHEN sh.checked_at < NOW() - (interval '1 minute' * ${freshness}) THEN 'unknown'
            WHEN LOWER(sh.status) = 'online' THEN 'online'
            WHEN LOWER(sh.status) = 'offline' THEN 'offline'
            ELSE 'unknown'
          END AS effective_ping_status,
          sh.latency_ms AS ping_latency,
          sh.checked_at AS last_ping_at,
          dd.last_seen_at AS last_seen_at,
          dd.interface AS network_interface,
          CASE
            WHEN dd.normalized_mac IS NOT NULL 
              AND dd.normalized_mac NOT IN (SELECT normalized_mac FROM prior_snapshot_macs) THEN true
            ELSE false
          END AS is_newly_discovered
        FROM devices d
        LEFT JOIN (
          SELECT DISTINCT ON (registered_device_id) *
          FROM discovered_devices
          WHERE registered_device_id IS NOT NULL
          ORDER BY registered_device_id, last_seen_at DESC NULLS LAST, id DESC
        ) dd ON dd.registered_device_id = d.id
        LEFT JOIN latest_reg_status sh ON sh.device_id = d.id
        LEFT JOIN (
          SELECT DISTINCT ON (device_id) *
          FROM mac_inventory
          WHERE device_id IS NOT NULL
          ORDER BY device_id, id DESC
        ) inv ON inv.device_id = d.id

        UNION ALL

        -- Population 2: Unmanaged Discovered Devices (183 items)
        SELECT
          CONCAT('disc-', dd.id) AS unique_key,
          'unmanaged' AS classification,
          'discovered' AS origin,
          NULL AS registered_device_id,
          dd.id AS discovered_device_id,
          COALESCE(dd.custom_name, inv.device_name, 'Unmanaged Discovered Host') AS name,
          dd.ip_address AS ip_address,
          dd.mac_address AS mac_address,
          dd.normalized_mac AS normalized_mac,
          COALESCE(dd.device_type, inv.device_type, 'Workstation') AS device_type,
          COALESCE(dd.building_location, dd.department, inv.department_location, 'DRM Complex') AS department_location,
          d_mac.contact_person AS contact_person,
          d_mac.contact_phone AS contact_phone,
          CASE
            WHEN dd.matched_inventory_id IS NOT NULL THEN 'matched'
            ELSE 'unmatched'
          END AS inventory_match_status,
          CASE
            WHEN dd.last_ping_at IS NULL THEN 'unknown'
            WHEN dd.last_ping_at < NOW() - (interval '1 minute' * ${freshness}) THEN 'unknown'
            WHEN LOWER(dd.last_ping_status) = 'online' THEN 'online'
            WHEN LOWER(dd.last_ping_status) = 'offline' THEN 'offline'
            ELSE 'unknown'
          END AS effective_ping_status,
          dd.last_ping_latency AS ping_latency,
          dd.last_ping_at AS last_ping_at,
          dd.last_seen_at AS last_seen_at,
          dd.interface AS network_interface,
          CASE
            WHEN dd.normalized_mac IS NOT NULL 
              AND dd.normalized_mac NOT IN (SELECT normalized_mac FROM prior_snapshot_macs) THEN true
            ELSE false
          END AS is_newly_discovered
        FROM discovered_devices dd
        LEFT JOIN mac_inventory inv ON inv.id = dd.matched_inventory_id
        LEFT JOIN devices d_mac ON (
          (dd.normalized_mac IS NOT NULL AND d_mac.mac_address IS NOT NULL AND LOWER(REGEXP_REPLACE(d_mac.mac_address, '[^a-fA-F0-9]', '', 'g')) = dd.normalized_mac)
          OR (inv.device_id IS NOT NULL AND d_mac.id = inv.device_id)
        )
        WHERE dd.registered_device_id IS NULL
      )
    `;

    // Filter conditions on unified_raw
    let whereClauses = ['1=1'];

    // Category / Status Filter
    const fUpper = (filter || 'ALL').toUpperCase();
    if (fUpper === 'ONLINE') {
      whereClauses.push("effective_ping_status = 'online'");
    } else if (fUpper === 'OFFLINE' || fUpper === 'NO_REPLY') {
      whereClauses.push("effective_ping_status = 'offline'");
    } else if (fUpper === 'UNKNOWN' || fUpper === 'STALE') {
      whereClauses.push("effective_ping_status = 'unknown'");
    } else if (fUpper === 'MANAGED' || fUpper === 'REGISTERED') {
      whereClauses.push("classification = 'managed'");
    } else if (fUpper === 'UNMANAGED') {
      whereClauses.push("classification = 'unmanaged'");
    } else if (fUpper === 'INVENTORY_MATCHED' || fUpper === 'MATCHED') {
      whereClauses.push("inventory_match_status = 'matched'");
    } else if (fUpper === 'NEWLY_DISCOVERED') {
      whereClauses.push("is_newly_discovered = true");
    }

    const whereStr = `WHERE ${whereClauses.join(' AND ')}`;

    // Deterministic Sorting (case-insensitive for text, unique_key tie-breaker)
    const sortExprMap = {
      name: "LOWER(COALESCE(name, ''))",
      ip_address: "COALESCE(ip_address, '')",
      mac_address: "LOWER(COALESCE(mac_address, ''))",
      classification: "LOWER(COALESCE(classification, ''))",
      status: "LOWER(COALESCE(effective_ping_status, ''))",
      latency: 'ping_latency',
      last_ping: 'last_ping_at',
      last_seen: 'last_seen_at'
    };
    const orderExpr = sortExprMap[sort_field] || "LOWER(COALESCE(name, ''))";
    const orderDir = (sort_dir && sort_dir.toLowerCase() === 'desc') ? 'DESC' : 'ASC';

    const trimmedSearch = (search || '').trim();

    if (!trimmedSearch) {
      // Fast SQL count + deterministic paginated query when no search query is active
      const countSql = `${baseQuery} SELECT count(*) FROM unified_raw ${whereStr}`;
      const countRes = await pool.query(countSql);
      const totalMatching = parseInt(countRes.rows[0].count, 10);
      const totalPages = Math.max(1, Math.ceil(totalMatching / limitNum));
      const clampedPage = Math.min(pageNum, totalPages);
      const clampedOffset = (clampedPage - 1) * limitNum;

      const dataSql = `
        ${baseQuery}
        SELECT * FROM unified_raw
        ${whereStr}
        ORDER BY ${orderExpr} ${orderDir} NULLS LAST, unique_key ASC
        LIMIT $1 OFFSET $2
      `;
      const dataRes = await pool.query(dataSql, [limitNum, clampedOffset]);

      return res.json({
        items: dataRes.rows,
        total: totalMatching,
        page: clampedPage,
        limit: limitNum,
        totalPages,
        freshness_threshold_minutes: freshness
      });
    }

    // Forgiving multi-token, case-insensitive, punctuation-normalized + near-match search
    const allSql = `
      ${baseQuery}
      SELECT * FROM unified_raw
      ${whereStr}
      ORDER BY ${orderExpr} ${orderDir} NULLS LAST, unique_key ASC
    `;
    const allRes = await pool.query(allSql);

    const levenshtein = (a, b) => {
      if (a === b) return 0;
      const al = a.length;
      const bl = b.length;
      if (al === 0) return bl;
      if (bl === 0) return al;
      const prev = new Array(bl + 1);
      const curr = new Array(bl + 1);
      for (let j = 0; j <= bl; j++) prev[j] = j;
      for (let i = 1; i <= al; i++) {
        curr[0] = i;
        const ca = a.charCodeAt(i - 1);
        for (let j = 1; j <= bl; j++) {
          const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
          curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        }
        for (let j = 0; j <= bl; j++) prev[j] = curr[j];
      }
      return prev[bl];
    };

    const normalizeAlnum = (val) => String(val || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const tokens = trimmedSearch.toLowerCase().split(/\s+/).filter(Boolean);

    const scoreRow = (row) => {
      const primaryFields = [
        row.name,
        row.contact_person,
        row.department_location,
        row.device_type,
      ].map((v) => String(v || '').toLowerCase());

      const allFields = [
        ...primaryFields,
        row.contact_phone,
        row.ip_address,
        row.mac_address,
        row.normalized_mac,
        row.network_interface,
        row.classification,
        row.effective_ping_status,
      ].map((v) => String(v || '').toLowerCase());

      const allAlnum = allFields.map(normalizeAlnum);
      const wordList = primaryFields
        .join(' ')
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3);

      let totalScore = 0;

      for (const tok of tokens) {
        const tokAlnum = normalizeAlnum(tok);
        let bestTokenScore = 0;

        // 1. Direct substring match (highest priority on name / contact_person)
        for (let i = 0; i < allFields.length; i++) {
          const field = allFields[i];
          if (!field) continue;
          if (field === tok) {
            bestTokenScore = Math.max(bestTokenScore, i < 2 ? 120 : 90);
          } else if (field.startsWith(tok)) {
            bestTokenScore = Math.max(bestTokenScore, i < 2 ? 100 : 75);
          } else if (field.includes(tok)) {
            bestTokenScore = Math.max(bestTokenScore, i < 2 ? 80 : 60);
          }
        }

        // 2. Punctuation/separator-insensitive match (e.g. "9c5322" -> "9C-53-22...", "srdste" -> "SR. DSTE")
        if (bestTokenScore === 0 && tokAlnum.length >= 2) {
          for (let i = 0; i < allAlnum.length; i++) {
            if (allAlnum[i].includes(tokAlnum)) {
              bestTokenScore = Math.max(bestTokenScore, i < 2 ? 70 : 50);
            }
          }
        }

        // 3. Fuzzy near-match for slight typos (e.g. "reva" -> "reeva", "accer" -> "acer")
        if (bestTokenScore === 0 && tokAlnum.length >= 4) {
          const maxDist = tokAlnum.length >= 7 ? 2 : 1;
          for (const word of wordList) {
            if (Math.abs(word.length - tokAlnum.length) > maxDist) continue;
            const dist = levenshtein(tokAlnum, word);
            if (dist <= maxDist) {
              bestTokenScore = Math.max(bestTokenScore, 30 - dist * 10);
            }
          }
        }

        if (bestTokenScore === 0) {
          return 0; // All tokens must match (direct, normalized, or near)
        }
        totalScore += bestTokenScore;
      }

      return totalScore;
    };

    const scored = [];
    for (const row of allRes.rows) {
      const s = scoreRow(row);
      if (s > 0) scored.push({ row, score: s });
    }

    // Sort by relevance score descending, preserving deterministic SQL order for ties
    scored.sort((a, b) => b.score - a.score);
    const matchedRows = scored.map((entry) => entry.row);

    const totalMatching = matchedRows.length;
    const totalPages = Math.max(1, Math.ceil(totalMatching / limitNum));
    const clampedPage = Math.min(pageNum, totalPages);
    const startIdx = (clampedPage - 1) * limitNum;
    const pagedItems = matchedRows.slice(startIdx, startIdx + limitNum);

    res.json({
      items: pagedItems,
      total: totalMatching,
      page: clampedPage,
      limit: limitNum,
      totalPages,
      freshness_threshold_minutes: freshness
    });
  } catch (err) {
    console.error('Fetch unified devices failed:', err);
    res.status(500).json({ error: 'Failed to fetch unified device list' });
  }
});

module.exports = router;
