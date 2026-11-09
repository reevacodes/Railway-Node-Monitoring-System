import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useNetwork } from '../context/NetworkContext';
import api, { isCancel } from '../services/api';
import StatusBadge from '../components/common/StatusBadge';
import DeviceTypeBadge from '../components/common/DeviceTypeBadge';
import LatencyIndicator from '../components/common/LatencyIndicator';
import { CompactLocationView } from '../components/common/LocationBadge';
import EmptyState from '../components/common/EmptyState';
import Modal from '../components/common/Modal';
import DeviceQuickDrawer from '../components/devices/DeviceQuickDrawer';
import DeviceIdentifier from '../components/common/DeviceIdentifier';
import { formatIndianDateTime, formatIndianDate, formatIndianTime } from '../utils/formatters';
import {
  Server,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Activity,
  ArrowRight,
  Clock,
  ShieldAlert,
  Zap,
  Building2,
  Network,
  ChevronRight,
  ChevronLeft,
  Search,
  ExternalLink,
  Radio,
  Layers,
  Shield,
  RefreshCw,
  Info,
  ChevronDown,
  ChevronUp,
  MapPin,
  Tag,
  Check,
  Download,
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';

// OUI Vendor Intelligence lookup for MAC addresses
const getVendorFromMac = (mac) => {
  if (!mac) return null;
  const clean = mac.replace(/[^a-fA-F0-9]/g, '').toLowerCase().slice(0, 6);
  const vendors = {
    '7085c2': 'HP Inc.',
    'b42e99': 'Intel Corp',
    '38d547': 'Acer Inc.',
    '001a2b': 'Cisco Systems',
    '00e04c': 'Realtek',
    'd83add': 'Sophos / Broadcom',
    'f46d04': 'ASUSTek',
    '507b9d': 'Voltriq IoT',
    'ac7289': 'Intel Wi-Fi',
    'c85b76': 'Dell Inc.',
    '18c04d': 'HP Enterprise',
    '309c23': 'Lenovo',
  };
  if (vendors[clean]) return vendors[clean];
  if (clean.startsWith('00e0') || clean.startsWith('5254')) return 'Realtek / QEMU';
  if (clean.startsWith('7085') || clean.startsWith('18c0') || clean.startsWith('3c52')) return 'HP Inc.';
  if (clean.startsWith('b42e') || clean.startsWith('ac72') || clean.startsWith('001b')) return 'Intel';
  if (clean.startsWith('38d5') || clean.startsWith('001e')) return 'Acer Inc.';
  if (clean.startsWith('c85b') || clean.startsWith('1866')) return 'Dell Inc.';
  return 'Standard NIC';
};

export const Overview = () => {
  const { devices, deviceStatuses, incidents, allEvents, probeDevice, showNotification } = useNetwork();
  
  // Quick Drawer & Department Modal State
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [incidentFilter, setIncidentFilter] = useState('ALL');
  const [selectedDept, setSelectedDept] = useState(null);
  const [deptFilter, setDeptFilter] = useState('working');
  const [deptSearch, setDeptSearch] = useState('');

  // =========================================================
  // Unified Network Health & Discovery State (Phase 3)
  // =========================================================
  const [unifiedSummary, setUnifiedSummary] = useState(null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState(null);
  const [showSecondaryStats, setShowSecondaryStats] = useState(true);

  // Unified Devices Table State
  const [unifiedDevices, setUnifiedDevices] = useState([]);
  const [unifiedTotal, setUnifiedTotal] = useState(0);
  const [unifiedPage, setUnifiedPage] = useState(1);
  const [unifiedTotalPages, setUnifiedTotalPages] = useState(1);
  const [unifiedFilter, setUnifiedFilter] = useState('ALL'); // 'ALL' | 'ONLINE' | 'OFFLINE' | 'UNKNOWN' | 'MANAGED' | 'UNMANAGED' | 'INVENTORY_MATCHED' | 'NEWLY_DISCOVERED'
  const [unifiedSearch, setUnifiedSearch] = useState('');
  const [debouncedUnifiedSearch, setDebouncedUnifiedSearch] = useState('');
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isBackgroundRefreshing, setIsBackgroundRefreshing] = useState(false);
  const [devicesError, setDevicesError] = useState(null);
  const [lastDevicesUpdated, setLastDevicesUpdated] = useState(null);

  // Backward compatibility alias for indicators
  const isUnifiedLoading = isInitialLoading;

  // Persistent tracking refs to prevent race conditions, duplicate polling, and false abort errors
  const hasLoadedInitialDevices = useRef(false);
  const hasLoadedInitialSummary = useRef(false);
  const devicesInFlightRef = useRef(false);
  const summaryInFlightRef = useRef(false);
  const devicesRequestIdRef = useRef(0);
  const summaryRequestIdRef = useRef(0);
  const isMountedRef = useRef(true);
  const fetchDevicesLatestRef = useRef(null);

  // Helper to render metric values with loading spinners and robust zero display
  const renderMetricValue = (val, isLoading) => {
    if (isLoading && (val === undefined || val === null)) {
      return <RefreshCw size={14} className="spin" style={{ display: 'inline-block', opacity: 0.6 }} />;
    }
    if (typeof val === 'number') {
      return val;
    }
    if (val !== null && val !== undefined) {
      return val;
    }
    return '—';
  };

  // ----------------------------------------------------
  // Debounce search input by 350ms and reset to page 1
  // ----------------------------------------------------
  useEffect(() => {
    const trimmed = unifiedSearch.trim();
    if (trimmed === debouncedUnifiedSearch) return;
    const timer = setTimeout(() => {
      setDebouncedUnifiedSearch(trimmed);
      setUnifiedPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [unifiedSearch, debouncedUnifiedSearch]);

  // Immediately clear search and reset to page 1
  const handleClearSearch = () => {
    setUnifiedSearch('');
    setDebouncedUnifiedSearch('');
    setUnifiedPage(1);
  };

  // ----------------------------------------------------
  // Fetch Unified Overview Summary
  // ----------------------------------------------------
  const fetchUnifiedSummary = useCallback(async (isSilent = false) => {
    // If background silent refresh and request is already in-flight, skip to avoid overlap
    if (summaryInFlightRef.current && isSilent) {
      return;
    }
    summaryInFlightRef.current = true;
    const reqId = ++summaryRequestIdRef.current;

    if (!hasLoadedInitialSummary.current && !isSilent) {
      setIsSummaryLoading(true);
      setSummaryError(null);
    }

    try {
      const data = await api.getUnifiedOverviewSummary({ freshness_minutes: 10 });
      if (!isMountedRef.current || reqId !== summaryRequestIdRef.current) return;

      setUnifiedSummary(data);
      hasLoadedInitialSummary.current = true;
      setSummaryError(null);
    } catch (err) {
      if (isCancel(err) || !isMountedRef.current || reqId !== summaryRequestIdRef.current) {
        return; // Safely ignore cancelled / superseded requests
      }
      if (hasLoadedInitialSummary.current) {
        // Retain previous summary metrics during background refresh failure
        console.warn('Background refresh of unified summary failed:', err);
      } else {
        console.error('Failed to load unified summary:', err);
        setSummaryError(err.response?.data?.error || err.message || 'Failed to connect to summary API');
      }
    } finally {
      if (isMountedRef.current && reqId === summaryRequestIdRef.current) {
        summaryInFlightRef.current = false;
        setIsSummaryLoading(false);
      }
    }
  }, []);

  // ----------------------------------------------------
  // Fetch Unified Devices List (Deduplicated)
  // ----------------------------------------------------
  const fetchUnifiedDevices = useCallback(async ({
    page = unifiedPage,
    filter = unifiedFilter,
    search = debouncedUnifiedSearch,
    isSilent = false,
    force = false,
  } = {}) => {
    // If background silent refresh and request is already in-flight, skip to avoid overlap
    if (devicesInFlightRef.current && isSilent && !force) {
      return;
    }

    devicesInFlightRef.current = true;
    const reqId = ++devicesRequestIdRef.current;

    const isInitial = !hasLoadedInitialDevices.current;
    if (isInitial) {
      setIsInitialLoading(true);
      setDevicesError(null);
    } else {
      setIsBackgroundRefreshing(true);
    }

    try {
      const data = await api.getUnifiedOverviewDevices({
        page,
        limit: 20,
        filter,
        search: search ? search.trim() : undefined,
        freshness_minutes: 10,
      });

      if (!isMountedRef.current || reqId !== devicesRequestIdRef.current) {
        return; // Stale or superseded response: discard safely
      }

      setUnifiedDevices(data.items || []);
      setUnifiedTotal(data.total ?? 0);
      setUnifiedTotalPages(data.totalPages ?? 1);
      setDevicesError(null);
      hasLoadedInitialDevices.current = true;
      setLastDevicesUpdated(new Date());
    } catch (err) {
      if (isCancel(err) || !isMountedRef.current || reqId !== devicesRequestIdRef.current) {
        // Request cancelled or superseded - DO NOT classify as error!
        return;
      }

      if (hasLoadedInitialDevices.current) {
        // Background refresh failure: retain previous table rows, do NOT replace table
        console.warn('Background refresh of unified devices failed:', err);
      } else {
        // Genuine initial load failure: show error screen with retry
        console.error('Failed to load unified devices:', err);
        setDevicesError(err.response?.data?.error || err.message || 'Failed to connect to devices API');
      }
    } finally {
      if (isMountedRef.current && reqId === devicesRequestIdRef.current) {
        devicesInFlightRef.current = false;
        setIsInitialLoading(false);
        setIsBackgroundRefreshing(false);
      }
    }
  }, [unifiedPage, unifiedFilter, debouncedUnifiedSearch]);

  // Keep fetchDevicesLatestRef pointing to current parameters
  useEffect(() => {
    fetchDevicesLatestRef.current = fetchUnifiedDevices;
  }, [fetchUnifiedDevices]);

  // Trigger devices fetch when query parameters (page, filter, search) change
  useEffect(() => {
    fetchUnifiedDevices({
      page: unifiedPage,
      filter: unifiedFilter,
      search: debouncedUnifiedSearch,
      isSilent: false,
    });
  }, [unifiedPage, unifiedFilter, debouncedUnifiedSearch]);

  // Dedicated background polling cycle (every 15 seconds)
  useEffect(() => {
    isMountedRef.current = true;
    fetchUnifiedSummary(false);

    const interval = setInterval(() => {
      if (!isMountedRef.current) return;
      fetchUnifiedSummary(true);
      fetchDevicesLatestRef.current?.({ isSilent: true });
    }, 15000);

    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
      api.cancelRequest('unified-devices');
      api.cancelRequest('unified-summary');
    };
  }, [fetchUnifiedSummary]);

  // Manual table refresh handler
  const handleManualTableRefresh = () => {
    fetchUnifiedDevices({ force: true, isSilent: false });
  };

  // Global header refresh handler
  const handleGlobalRefresh = () => {
    fetchUnifiedSummary(false);
    fetchUnifiedDevices({ force: true, isSilent: false });
    showNotification?.('Refreshed operational telemetry.', 'info');
  };

  // Handle card click to filter unified table
  const handleCardFilterClick = (filterPreset) => {
    setUnifiedFilter(filterPreset);
    setUnifiedPage(1);
    const tableEl = document.getElementById('unified-device-health-table');
    if (tableEl) {
      tableEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // ----------------------------------------------------
  // Legacy Department / Section Calculations (for Modal)
  // ----------------------------------------------------
  const deptBreakdown = {};
  devices.forEach((dev) => {
    const loc = dev.room || dev.building || 'General Section';
    if (!deptBreakdown[loc]) {
      deptBreakdown[loc] = { online: 0, offline: 0, unknown: 0, total: 0, devices: [] };
    }
    deptBreakdown[loc].total++;
    deptBreakdown[loc].devices.push(dev);
    const st = (deviceStatuses[dev.id]?.status || 'unknown').toLowerCase();
    if (st === 'online') deptBreakdown[loc].online++;
    else if (st === 'offline') deptBreakdown[loc].offline++;
    else deptBreakdown[loc].unknown++;
  });

  // Subnet breakdown
  const subnetBreakdown = {
    '192.168.40.0/24': { label: 'Admin & Cabins VLAN', online: 0, total: 0 },
    '192.168.41.0/24': { label: 'Operating & Traffic VLAN', online: 0, total: 0 },
    '192.168.1.0/24':  { label: 'Station Gateway Subnet', online: 0, total: 0 },
    'Other':           { label: 'Peripheral Subnets', online: 0, total: 0 },
  };

  devices.forEach((dev) => {
    const ip = dev.ip_address || '';
    const st = (deviceStatuses[dev.id]?.status || 'unknown').toLowerCase();
    let key = 'Other';
    if (ip.startsWith('192.168.40.')) key = '192.168.40.0/24';
    else if (ip.startsWith('192.168.41.')) key = '192.168.41.0/24';
    else if (ip.startsWith('192.168.1.')) key = '192.168.1.0/24';

    subnetBreakdown[key].total++;
    if (st === 'online') subnetBreakdown[key].online++;
  });

  // Incident queue
  const displayedIncidentNodes = devices.filter((dev) => {
    const st = (deviceStatuses[dev.id]?.status || 'unknown').toLowerCase();
    if (incidentFilter === 'CRITICAL') return st === 'offline';
    if (incidentFilter === 'ONLINE') return st === 'online';
    return true;
  });

  // Recently Commissioned Devices
  const recentlyAddedDevices = [...devices].sort(
    (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
  );

  // Latency trend
  const onlineEventsForChart = allEvents.filter(
    (evt) => evt.status === 'online' && evt.latency_ms !== null && evt.latency_ms !== undefined
  );
  const chartSource = onlineEventsForChart.length > 0 ? onlineEventsForChart : allEvents;
  const chartData = [...chartSource]
    .slice(0, 25)
    .reverse()
    .map((evt) => ({
      time: new Date(evt.checked_at).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      latency: evt.status === 'online' && evt.latency_ms !== null ? Number(evt.latency_ms) : null,
      device: evt.deviceName,
      status: evt.status,
    }));

  return (
    <div>
      {/* Page Title & Actions Strip */}
      <div className="page-title-strip">
        <div>
          <h1>Railway Network Operations Center (NOC)</h1>
          <div className="page-subtitle">
            Centralized health monitoring, Layer-2 Sophos ARP correlation, ICMP reachability & unified asset intelligence
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleGlobalRefresh}
            title="Refresh overview metrics"
          >
            <RefreshCw size={13} className={isSummaryLoading || isBackgroundRefreshing || isInitialLoading ? 'spin' : ''} />
            <span>Refresh</span>
          </button>
          <Link to="/devices" className="btn btn-secondary btn-sm">
            Device Inventory
          </Link>
          <Link to="/arp-discovery" className="btn btn-primary btn-sm">
            <Radio size={13} /> Sophos ARP
          </Link>
        </div>
      </div>

      {/* Summary Error Alert Banner if API failed */}
      {summaryError && !unifiedSummary && (
        <div
          style={{
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '4px',
            padding: '10px 14px',
            marginBottom: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '12px',
            color: '#b91c1c',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={15} style={{ flexShrink: 0 }} />
            <span>
              <strong>Failed to load unified network summary:</strong> {summaryError}
            </span>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            style={{ borderColor: '#fca5a5', color: '#991b1b', padding: '2px 8px', fontSize: '11px' }}
            onClick={() => {
              setIsSummaryLoading(true);
              fetchUnifiedSummary();
            }}
          >
            <RefreshCw size={11} /> Retry
          </button>
        </div>
      )}

      {/* ========================================================= */}
      {/* 1. PRIMARY OPERATIONAL METRIC CARDS (Unified & Deduplicated) */}
      {/* ========================================================= */}
      <div className="operational-strip" style={{ marginBottom: '12px' }}>
        {/* Card 1: Total Unique Assets */}
        <div
          className="operational-metric"
          onClick={() => handleCardFilterClick('ALL')}
          style={{ cursor: 'pointer', border: unifiedFilter === 'ALL' ? '2px solid #0284c7' : undefined }}
          title="Click to show all unique observed devices (26 Managed in DB + 183 Discovered via Sophos)"
        >
          <span className="operational-metric-label">
            <Server size={13} /> Unique Observed Assets
          </span>
          <span className="operational-metric-value">
            {renderMetricValue(unifiedSummary?.total_unique_observed_assets, isSummaryLoading)}
          </span>
          <span className="metric-sub">
            {unifiedSummary ? `${unifiedSummary.registered_devices_count} Managed + ${unifiedSummary.unmanaged_discovered_count} Discovered (Deduplicated)` : 'Deduplicated railway nodes'}
          </span>
        </div>

        {/* Card 2: Responding to Ping */}
        <div
          className="operational-metric"
          onClick={() => handleCardFilterClick('ONLINE')}
          style={{ cursor: 'pointer', border: unifiedFilter === 'ONLINE' ? '2px solid #059669' : undefined }}
          title="Click to filter by devices actively responding to ICMP ping within freshness window"
        >
          <span className="operational-metric-label" style={{ color: '#059669' }}>
            <CheckCircle2 size={13} /> Responding to Ping
          </span>
          <span className="operational-metric-value" style={{ color: '#059669' }}>
            {renderMetricValue(unifiedSummary?.ping_responding_count, isSummaryLoading)}
          </span>
          <span className="metric-sub">
            {unifiedSummary ? `${unifiedSummary.availability_rate}% reachability availability` : 'Active ICMP replies'}
          </span>
        </div>

        {/* Card 3: No Ping Reply */}
        <div
          className="operational-metric"
          onClick={() => handleCardFilterClick('OFFLINE')}
          style={{ cursor: 'pointer', border: unifiedFilter === 'OFFLINE' ? '2px solid #dc2626' : undefined }}
          title="Click to filter by devices with no ICMP reply in recent cycle"
        >
          <span className="operational-metric-label" style={{ color: '#dc2626' }}>
            <AlertTriangle size={13} /> No Ping Reply
          </span>
          <span className="operational-metric-value" style={{ color: '#dc2626' }}>
            {renderMetricValue(unifiedSummary?.ping_no_reply_count, isSummaryLoading)}
          </span>
          <span className="metric-sub">Probe timed out / host unreachable</span>
        </div>

        {/* Card 4: Unknown / Stale */}
        <div
          className="operational-metric"
          onClick={() => handleCardFilterClick('UNKNOWN')}
          style={{ cursor: 'pointer', border: unifiedFilter === 'UNKNOWN' ? '2px solid #64748b' : undefined }}
          title="Click to filter by devices with no probe result within freshness threshold"
        >
          <span className="operational-metric-label" style={{ color: '#475569' }}>
            <HelpCircle size={13} /> Unknown / Stale
          </span>
          <span className="operational-metric-value">
            {renderMetricValue(unifiedSummary?.ping_unknown_stale_count, isSummaryLoading)}
          </span>
          <span className="metric-sub">No probe within {unifiedSummary?.freshness_threshold_minutes || 10} min</span>
        </div>

        {/* Card 5: Managed Devices */}
        <div
          className="operational-metric"
          onClick={() => handleCardFilterClick('MANAGED')}
          style={{ cursor: 'pointer', border: unifiedFilter === 'MANAGED' ? '2px solid #8b5cf6' : undefined }}
          title="Click to filter by registered managed inventory"
        >
          <span className="operational-metric-label" style={{ color: '#8b5cf6' }}>
            <Server size={13} /> Managed Devices
          </span>
          <span className="operational-metric-value" style={{ color: '#8b5cf6' }}>
            {renderMetricValue(unifiedSummary?.registered_devices_count, isSummaryLoading)}
          </span>
          <span className="metric-sub">Registered railway inventory</span>
        </div>

        {/* Card 6: Unmanaged Discovered */}
        <div
          className="operational-metric"
          onClick={() => handleCardFilterClick('UNMANAGED')}
          style={{ cursor: 'pointer', border: unifiedFilter === 'UNMANAGED' ? '2px solid #0284c7' : undefined }}
          title="Click to filter by unmanaged discovered devices"
        >
          <span className="operational-metric-label" style={{ color: '#0284c7' }}>
            <Radio size={13} /> Unmanaged Discovered
          </span>
          <span className="operational-metric-value" style={{ color: '#0284c7' }}>
            {renderMetricValue(unifiedSummary?.unmanaged_discovered_count, isSummaryLoading)}
          </span>
          <span className="metric-sub">Layer-2 hosts awaiting registration</span>
        </div>
      </div>

      {/* ========================================================= */}
      {/* 2. SECONDARY DISCOVERY & CORRELATION METRICS STRIP */}
      {/* ========================================================= */}
      <div
        style={{
          backgroundColor: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '4px',
          padding: '10px 14px',
          marginBottom: '16px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            userSelect: 'none',
          }}
          onClick={() => setShowSecondaryStats((prev) => !prev)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Shield size={14} style={{ color: '#0284c7' }} />
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#0f172a' }}>
              Sophos Firewall Neighbor Cache Intelligence & Discovery Correlation
            </span>
            <span style={{ fontSize: '11px', color: '#64748b' }}>
              (Click to {showSecondaryStats ? 'collapse' : 'expand'})
            </span>
          </div>
          <div>
            {showSecondaryStats ? <ChevronUp size={15} style={{ color: '#64748b' }} /> : <ChevronDown size={15} style={{ color: '#64748b' }} />}
          </div>
        </div>

        {showSecondaryStats && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '12px',
              marginTop: '12px',
              paddingTop: '12px',
              borderTop: '1px solid #f1f5f9',
            }}
          >
            {/* Card 7: Latest ARP Entries */}
            <div style={{ padding: '6px 10px', backgroundColor: '#f8fafc', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '11px', color: '#64748b' }}>Latest ARP Poll Entries</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginTop: '2px' }}>
                {renderMetricValue(unifiedSummary?.latest_arp_raw_count, isSummaryLoading)}
              </div>
              <div style={{ fontSize: '10.5px', color: '#64748b' }}>Raw neighbor cache rows</div>
            </div>

            {/* Card 8: Confirmed MAC Nodes */}
            <div style={{ padding: '6px 10px', backgroundColor: '#f8fafc', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '11px', color: '#64748b' }}>Confirmed MAC Nodes</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#0284c7', marginTop: '2px' }}>
                {renderMetricValue(unifiedSummary?.valid_mac_devices_count, isSummaryLoading)}
              </div>
              <div style={{ fontSize: '10.5px', color: '#64748b' }}>Valid Layer-2 hardware entries</div>
            </div>

            {/* Card 9: Matched to MAC Inventory */}
            <div
              onClick={() => handleCardFilterClick('INVENTORY_MATCHED')}
              style={{
                padding: '6px 10px',
                backgroundColor: '#f8fafc',
                borderRadius: '4px',
                border: unifiedFilter === 'INVENTORY_MATCHED' ? '2px solid #10b981' : '1px solid #e2e8f0',
                cursor: 'pointer',
              }}
              title="Click to filter by devices correlated with station MAC inventory"
            >
              <div style={{ fontSize: '11px', color: '#64748b' }}>Matched to MAC Inventory</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#10b981', marginTop: '2px' }}>
                {renderMetricValue(unifiedSummary?.matched_to_inventory_count, isSummaryLoading)}
              </div>
              <div style={{ fontSize: '10.5px', color: '#059669', fontWeight: 500 }}>Correlated with inventory records</div>
            </div>

            {/* Card 10: Matched to Registered Nodes */}
            <div style={{ padding: '6px 10px', backgroundColor: '#f8fafc', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '11px', color: '#64748b' }}>Matched to Registered Nodes</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#8b5cf6', marginTop: '2px' }}>
                {renderMetricValue(unifiedSummary?.matched_to_registered_count, isSummaryLoading)}
              </div>
              <div style={{ fontSize: '10.5px', color: '#64748b' }}>Linked to managed devices</div>
            </div>

            {/* Card 11: Newly Discovered */}
            <div
              onClick={() => handleCardFilterClick('NEWLY_DISCOVERED')}
              style={{
                padding: '6px 10px',
                backgroundColor: '#f8fafc',
                borderRadius: '4px',
                border: unifiedFilter === 'NEWLY_DISCOVERED' ? '2px solid #f59e0b' : '1px solid #e2e8f0',
                cursor: 'pointer',
              }}
              title="Click to filter by devices first seen in the latest firewall snapshot"
            >
              <div style={{ fontSize: '11px', color: '#64748b' }}>Newly Discovered</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#f59e0b', marginTop: '2px' }}>
                {renderMetricValue(unifiedSummary?.newly_discovered_count, isSummaryLoading)}
              </div>
              <div style={{ fontSize: '10.5px', color: '#b45309' }}>
                {unifiedSummary?.newly_discovered_endpoints_count ? `${unifiedSummary.newly_discovered_endpoints_count} endpoints (new MACs)` : 'First seen in latest poll'}
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ========================================================= */}
      {/* 3. LATEST SOPHOS ARP POLL METADATA PANEL */}
      {/* ========================================================= */}
      {unifiedSummary?.latest_snapshot && (() => {
        const lastAttempt = unifiedSummary.last_attempt_at || unifiedSummary.poller_status?.last_attempt_at;
        const lastSuccess = unifiedSummary.last_success_at || unifiedSummary.poller_status?.last_success_at;
        const snapCreated = unifiedSummary.snapshot_created_at || unifiedSummary.latest_snapshot.imported_at;
        const status = unifiedSummary.polling_status || unifiedSummary.poller_status?.polling_status || 'idle';
        const errorMsg = unifiedSummary.polling_error || unifiedSummary.poller_status?.last_error;

        return (
          <div
            style={{
              backgroundColor: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              padding: '14px 16px',
              marginBottom: '16px',
              borderLeft: '4px solid #0284c7',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '8px',
                    backgroundColor: '#e0f2fe',
                    color: '#0284c7',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Radio size={20} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: '13px', color: '#0f172a' }}>
                      {unifiedSummary.latest_snapshot.name}
                    </span>
                    {status === 'in_progress' ? (
                      <span className="status-badge warning" style={{ fontSize: '10px', padding: '1px 6px' }}>
                        <RefreshCw size={10} className="spin" /> Polling in Progress...
                      </span>
                    ) : status === 'success_new' ? (
                      <span className="status-badge online" style={{ fontSize: '10px', padding: '1px 6px' }}>
                        <Check size={10} /> Snapshot Updated Successfully
                      </span>
                    ) : status === 'success_duplicate' ? (
                      <span className="status-badge online" style={{ fontSize: '10px', padding: '1px 6px', background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }}>
                        <Check size={10} /> Data Unchanged (Duplicate Skipped)
                      </span>
                    ) : status === 'failed' ? (
                      <span className="status-badge offline" style={{ fontSize: '10px', padding: '1px 6px', background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}>
                        <AlertTriangle size={10} /> Extraction Failed (Preserving Snapshot)
                      </span>
                    ) : (
                      <span className="status-badge online" style={{ fontSize: '10px', padding: '1px 6px' }}>
                        <Check size={10} /> Verified Snapshot
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                    Source: <strong>{unifiedSummary.latest_snapshot.source_device}</strong>
                    {' • '}
                    Raw Entries: <strong>{unifiedSummary.latest_snapshot.total_entries}</strong> (
                    <span style={{ color: '#059669', fontWeight: 600 }}>{unifiedSummary.latest_snapshot.entries_with_mac} valid MAC</span>,{' '}
                    <span style={{ color: '#dc2626' }}>{unifiedSummary.latest_snapshot.incomplete_entries} incomplete</span>)
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <a
                  href={`${api.baseUrl || 'http://localhost:5001'}/api/arp/snapshots/latest/export?format=csv`}
                  download
                  className="btn btn-primary btn-sm"
                  style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '5px', textDecoration: 'none' }}
                  title="Download all entries from latest firewall snapshot as CSV"
                >
                  <Download size={12} /> Download Snapshot (CSV)
                </a>
                <Link to="/arp-discovery" className="btn btn-secondary btn-sm" style={{ fontSize: '11px' }}>
                  Snapshot History <ArrowRight size={12} />
                </Link>
              </div>
            </div>

            {/* THREE DISTINCT TIMESTAMPS BAR */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '10px',
                padding: '10px 12px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
                fontSize: '11px',
              }}
            >
              <div>
                <span style={{ color: '#64748b', display: 'block', marginBottom: '2px', fontWeight: 500 }}>
                  Last Poll Attempt:
                </span>
                <strong className="mono" style={{ color: '#0f172a', fontSize: '12px' }}>
                  {lastAttempt ? formatIndianDateTime(lastAttempt) : 'None recorded'}
                </strong>
              </div>
              <div>
                <span style={{ color: '#64748b', display: 'block', marginBottom: '2px', fontWeight: 500 }}>
                  Last Successful Extraction:
                </span>
                <strong className="mono" style={{ color: '#059669', fontSize: '12px' }}>
                  {lastSuccess ? formatIndianDateTime(lastSuccess) : 'None recorded'}
                </strong>
              </div>
              <div>
                <span style={{ color: '#64748b', display: 'block', marginBottom: '2px', fontWeight: 500 }}>
                  Latest Snapshot Created:
                </span>
                <strong className="mono" style={{ color: '#0284c7', fontSize: '12px' }}>
                  {snapCreated ? formatIndianDateTime(snapCreated) : 'None recorded'}
                </strong>
              </div>
            </div>

            {/* CONTEXTUAL ERROR / DUPLICATE STATUS NOTIFICATION */}
            {status === 'failed' && (
              <div style={{ marginTop: '10px', fontSize: '11px', color: '#b45309', display: 'flex', alignItems: 'center', gap: '6px', background: '#fffbeb', padding: '6px 10px', borderRadius: '4px', border: '1px solid #fef3c7' }}>
                <AlertTriangle size={13} color="#d97706" style={{ flexShrink: 0 }} />
                <span>
                  <strong>Extraction Warning:</strong> Last attempt at {lastAttempt ? formatIndianTime(lastAttempt) : 'recent'} failed{errorMsg ? ` (${errorMsg.slice(0, 120)})` : ''}. Safely retaining previous verified extraction and snapshot.
                </span>
              </div>
            )}
            {status === 'success_duplicate' && (
              <div style={{ marginTop: '10px', fontSize: '11px', color: '#047857', display: 'flex', alignItems: 'center', gap: '6px', background: '#ecfdf5', padding: '6px 10px', borderRadius: '4px', border: '1px solid #a7f3d0' }}>
                <Check size={13} color="#059669" style={{ flexShrink: 0 }} />
                <span>
                  <strong>Firewall In-Sync:</strong> Extraction succeeded at {lastSuccess ? formatIndianTime(lastSuccess) : 'recent'}. All entries matched the existing snapshot, skipping duplicate creation.
                </span>
              </div>
            )}
          </div>
        );
      })()}

      {/* ========================================================= */}
      {/* 4. UNIFIED DEDUPLICATED DEVICE HEALTH TABLE */}
      {/* ========================================================= */}
      <div id="unified-device-health-table" className="panel" style={{ marginBottom: '16px' }}>
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: '#f8fafc',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          {/* Quick Filter Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#475569', marginRight: '4px' }}>
              Population Filter:
            </span>
            <button
              className={`btn btn-sm ${unifiedFilter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '11px', padding: '2px 9px' }}
              onClick={() => { setUnifiedFilter('ALL'); setUnifiedPage(1); }}
            >
              All Assets ({unifiedSummary ? unifiedSummary.total_unique_observed_assets : '…'})
            </button>
            <button
              className={`btn btn-sm ${unifiedFilter === 'ONLINE' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '11px', padding: '2px 9px', color: unifiedFilter === 'ONLINE' ? '#fff' : '#059669' }}
              onClick={() => { setUnifiedFilter('ONLINE'); setUnifiedPage(1); }}
            >
              Online ({unifiedSummary ? unifiedSummary.ping_responding_count : '…'})
            </button>
            <button
              className={`btn btn-sm ${unifiedFilter === 'OFFLINE' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '11px', padding: '2px 9px', color: unifiedFilter === 'OFFLINE' ? '#fff' : '#dc2626' }}
              onClick={() => { setUnifiedFilter('OFFLINE'); setUnifiedPage(1); }}
            >
              No Ping Reply ({unifiedSummary ? unifiedSummary.ping_no_reply_count : '…'})
            </button>
            <button
              className={`btn btn-sm ${unifiedFilter === 'UNKNOWN' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '11px', padding: '2px 9px' }}
              onClick={() => { setUnifiedFilter('UNKNOWN'); setUnifiedPage(1); }}
            >
              Unknown / Stale ({unifiedSummary ? unifiedSummary.ping_unknown_stale_count : '…'})
            </button>
            <button
              className={`btn btn-sm ${unifiedFilter === 'MANAGED' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '11px', padding: '2px 9px', color: unifiedFilter === 'MANAGED' ? '#fff' : '#8b5cf6' }}
              onClick={() => { setUnifiedFilter('MANAGED'); setUnifiedPage(1); }}
            >
              Managed ({unifiedSummary ? unifiedSummary.registered_devices_count : '…'})
            </button>
            <button
              className={`btn btn-sm ${unifiedFilter === 'UNMANAGED' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '11px', padding: '2px 9px', color: unifiedFilter === 'UNMANAGED' ? '#fff' : '#0284c7' }}
              onClick={() => { setUnifiedFilter('UNMANAGED'); setUnifiedPage(1); }}
            >
              Unmanaged ({unifiedSummary ? unifiedSummary.unmanaged_discovered_count : '…'})
            </button>
            <button
              className={`btn btn-sm ${unifiedFilter === 'INVENTORY_MATCHED' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '11px', padding: '2px 9px', color: unifiedFilter === 'INVENTORY_MATCHED' ? '#fff' : '#10b981' }}
              onClick={() => { setUnifiedFilter('INVENTORY_MATCHED'); setUnifiedPage(1); }}
            >
              Inventory Matched ({unifiedSummary ? unifiedSummary.matched_to_inventory_count : '…'})
            </button>
            <button
              className={`btn btn-sm ${unifiedFilter === 'NEWLY_DISCOVERED' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '11px', padding: '2px 9px', color: unifiedFilter === 'NEWLY_DISCOVERED' ? '#fff' : '#f59e0b' }}
              onClick={() => { setUnifiedFilter('NEWLY_DISCOVERED'); setUnifiedPage(1); }}
            >
              Newly Discovered ({unifiedSummary ? (unifiedSummary.newly_discovered_endpoints_count ?? unifiedSummary.newly_discovered_count) : '…'})
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {lastDevicesUpdated && (
              <span style={{ fontSize: '11px', color: '#64748b' }}>
                Updated {lastDevicesUpdated.toLocaleTimeString()}
              </span>
            )}
            <button
              className="btn btn-secondary btn-sm"
              style={{ fontSize: '11px', padding: '3px 8px' }}
              onClick={handleManualTableRefresh}
              title="Refresh Unified Devices Table"
            >
              <RefreshCw size={11} className={isBackgroundRefreshing || isInitialLoading ? 'spin' : ''} /> Refresh Table
            </button>
          </div>
        </div>

        {/* Search Toolbar */}
        <div className="filter-toolbar">
          <div className="filter-group">
            <div style={{ position: 'relative', width: '280px' }}>
              <Search
                size={13}
                style={{ position: 'absolute', left: '8px', top: '9px', color: '#94a3b8' }}
              />
              <input
                type="text"
                className="form-input"
                style={{ paddingLeft: '28px', height: '30px', fontSize: '11.5px' }}
                placeholder="Search device name, IP, MAC, location..."
                value={unifiedSearch}
                onChange={(e) => setUnifiedSearch(e.target.value)}
              />
              {unifiedSearch && (
                <button
                  onClick={handleClearSearch}
                  style={{
                    position: 'absolute',
                    right: '8px',
                    top: '7px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#94a3b8',
                    fontSize: '12px'
                  }}
                  title="Clear search"
                >
                  ×
                </button>
              )}
            </div>
          </div>

          <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {isBackgroundRefreshing && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#0284c7', fontSize: '10.5px' }}>
                <RefreshCw size={10} className="spin" /> Updating...
              </span>
            )}
            <span>
              Showing page <strong>{unifiedPage}</strong> of <strong>{unifiedTotalPages}</strong> ({unifiedTotal} matching assets)
            </span>
          </div>
        </div>

        {/* Unified Table Body */}
        <div className="panel-body" style={{ padding: '0' }}>
          {isInitialLoading && !hasLoadedInitialDevices.current ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
              <RefreshCw size={24} className="spin" style={{ margin: '0 auto 8px' }} />
              <div>Loading unified device telemetry...</div>
            </div>
          ) : devicesError && unifiedDevices.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#b91c1c' }}>
              <AlertTriangle size={28} style={{ margin: '0 auto 8px', color: '#dc2626' }} />
              <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>
                Failed to Load Unified Devices
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '12px' }}>
                {devicesError}
              </div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleManualTableRefresh}
              >
                <RefreshCw size={12} /> Retry Loading Devices
              </button>
            </div>
          ) : unifiedDevices.length === 0 ? (
            <EmptyState
              title="No Devices Match Active Filter"
              description="Adjust your search criteria or switch to another population filter."
            />
          ) : (
            <div className="table-wrapper">
              <table className="table" style={{ fontSize: '11.5px' }}>
                <thead>
                  <tr>
                    <th>Device Identification</th>
                    <th>IP Address</th>
                    <th>MAC Address & Vendor</th>
                    <th>Classification</th>
                    <th>Department / Location</th>
                    <th>MAC Inventory</th>
                    <th>Ping Reachability</th>
                    <th>Last Probe Time</th>
                    <th>ARP Observed</th>
                    <th style={{ textAlign: 'center', width: '90px' }}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {unifiedDevices.map((dev) => {
                    const isOnline = dev.effective_ping_status === 'online';
                    const isOffline = dev.effective_ping_status === 'offline';
                    const vendor = getVendorFromMac(dev.mac_address);

                    return (
                      <tr key={dev.unique_key} className={isOffline ? 'row-offline' : ''}>
                        {/* 1. Device Identification */}
                        <td>
                          <DeviceIdentifier
                            name={dev.name}
                            contactPerson={dev.contact_person}
                            contactPhone={dev.contact_phone}
                          />
                          <div style={{ fontSize: '10px', color: '#64748b', marginTop: '1px' }}>
                            <DeviceTypeBadge type={dev.device_type} />
                            {dev.is_newly_discovered && (
                              <span
                                style={{
                                  backgroundColor: '#fef3c7',
                                  color: '#b45309',
                                  padding: '1px 5px',
                                  borderRadius: '3px',
                                  fontSize: '9.5px',
                                  fontWeight: 600,
                                  marginLeft: '4px',
                                }}
                              >
                                New Poll
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 2. IP Address */}
                        <td className="mono" style={{ fontWeight: 600, color: '#0284c7' }}>
                          {dev.ip_address}
                        </td>

                        {/* 3. MAC & Vendor */}
                        <td>
                          {dev.mac_address ? (
                            <div>
                              <div className="mono" style={{ fontSize: '11px', color: '#0f172a' }}>
                                {dev.mac_address}
                              </div>
                              {vendor && (
                                <div style={{ fontSize: '10px', color: '#64748b' }}>{vendor}</div>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>—</span>
                          )}
                        </td>

                        {/* 4. Classification */}
                        <td>
                          {dev.classification === 'managed' ? (
                            <span className="status-badge online" style={{ fontSize: '10px' }}>
                              <Server size={10} /> Managed Node
                            </span>
                          ) : (
                            <span className="status-badge warning" style={{ fontSize: '10px' }}>
                              <Radio size={10} /> Unmanaged Discovered
                            </span>
                          )}
                        </td>

                        {/* 5. Department / Location */}
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#475569' }}>
                            <MapPin size={11} style={{ color: '#94a3b8' }} />
                            <span>{dev.department_location}</span>
                          </div>
                          {dev.network_interface && (
                            <span className="mono" style={{ fontSize: '9.5px', color: '#64748b' }}>
                              {dev.network_interface}
                            </span>
                          )}
                        </td>

                        {/* 6. Inventory Match */}
                        <td>
                          {dev.inventory_match_status === 'matched' ? (
                            <span className="status-badge online" style={{ fontSize: '10px' }}>
                              <CheckCircle2 size={10} /> Matched
                            </span>
                          ) : (
                            <span style={{ fontSize: '10.5px', color: '#94a3b8' }}>Unmatched</span>
                          )}
                        </td>

                        {/* 7. Ping Reachability & Latency */}
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <StatusBadge status={dev.effective_ping_status} />
                            {isOnline && dev.ping_latency !== null && (
                              <div style={{ fontSize: '10px', color: '#059669', fontWeight: 600 }}>
                                {dev.ping_latency} ms
                              </div>
                            )}
                          </div>
                        </td>

                        {/* 8. Last Probe Time */}
                        <td style={{ fontSize: '10.5px', color: '#64748b' }}>
                          {dev.last_ping_at
                            ? formatIndianTime(dev.last_ping_at)
                            : 'Pending'}
                        </td>

                        {/* 9. ARP Observed Time */}
                        <td style={{ fontSize: '10.5px', color: '#64748b' }}>
                          {dev.last_seen_at
                            ? formatIndianDate(dev.last_seen_at)
                            : '—'}
                        </td>

                        {/* 10. Action */}
                        <td style={{ textAlign: 'center' }}>
                          {dev.registered_device_id ? (
                            <button
                              className="btn btn-secondary btn-sm"
                              style={{ padding: '2px 7px', fontSize: '10.5px' }}
                              onClick={() => {
                                const realDev = devices.find(d => d.id === dev.registered_device_id);
                                if (realDev) setSelectedDevice(realDev);
                              }}
                            >
                              Inspect
                            </button>
                          ) : (
                            <Link
                              to="/arp-discovery"
                              className="btn btn-secondary btn-sm"
                              style={{ padding: '2px 7px', fontSize: '10.5px' }}
                            >
                              Edit
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination Controls */}
          {unifiedTotalPages > 1 && (
            <div
              style={{
                padding: '10px 16px',
                borderTop: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <button
                className="btn btn-secondary btn-sm"
                disabled={unifiedPage <= 1}
                onClick={() => setUnifiedPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft size={13} /> Previous
              </button>

              <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                Page <strong>{unifiedPage}</strong> of <strong>{unifiedTotalPages}</strong> ({unifiedTotal} assets)
              </span>

              <button
                className="btn btn-secondary btn-sm"
                disabled={unifiedPage >= unifiedTotalPages}
                onClick={() => setUnifiedPage((p) => Math.min(unifiedTotalPages, p + 1))}
              >
                Next <ChevronRight size={13} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ========================================================= */}
      {/* 5. PRESERVED MISSION CONTROL: PHYSICAL SECTIONS & RECHARTS */}
      {/* ========================================================= */}
      <div className="overview-split-layout">
        {/* Physical Office Operations Matrix */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">
              <Building2 size={15} style={{ color: '#0284c7' }} />
              <span>Office & Department Physical Health (Managed Inventory)</span>
            </div>
            <span style={{ fontSize: '11px', color: '#64748b' }}>
              Physical Sections: {Object.keys(deptBreakdown).length} • Click section to view nodes
            </span>
          </div>

          <div className="panel-body" style={{ padding: '14px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px' }}>
              {Object.entries(deptBreakdown).map(([dept, data]) => {
                const isHealthy = data.offline === 0 && data.online > 0;
                const hasIssues = data.offline > 0;
                const pct = data.total > 0 ? Math.round((data.online / data.total) * 100) : 0;
                return (
                  <div
                    key={dept}
                    onClick={() => {
                      setSelectedDept(dept);
                      setDeptFilter('working');
                      setDeptSearch('');
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedDept(dept);
                        setDeptFilter('working');
                        setDeptSearch('');
                      }
                    }}
                    className="dept-health-card"
                    style={{
                      padding: '10px 12px',
                      borderRadius: '6px',
                      border: `1px solid ${hasIssues ? '#fca5a5' : isHealthy ? '#a7f3d0' : '#e2e8f0'}`,
                      backgroundColor: hasIssues ? '#fff5f5' : isHealthy ? '#f0fdf4' : '#f8fafc',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      cursor: 'pointer',
                    }}
                    title={`Click to view devices from ${dept}`}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, fontSize: '12px', color: '#0f172a' }}>{dept}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span
                          className={`status-badge ${hasIssues ? 'offline' : isHealthy ? 'online' : 'unknown'}`}
                          style={{ fontSize: '9.5px', padding: '1px 5px' }}
                        >
                          {hasIssues ? `${data.offline} Down` : isHealthy ? 'All Up' : 'Standby'}
                        </span>
                        <ChevronRight size={13} style={{ color: '#94a3b8' }} />
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                      <span style={{ fontSize: '11px', color: '#64748b' }}>
                        {data.online} / {data.total} Online
                      </span>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: hasIssues ? '#dc2626' : '#059669' }}>
                        {pct}%
                      </span>
                    </div>

                    <div style={{ width: '100%', height: '4px', backgroundColor: '#e2e8f0', borderRadius: '2px', overflow: 'hidden', marginTop: '2px' }}>
                      <div
                        style={{
                          width: `${pct}%`,
                          height: '100%',
                          backgroundColor: hasIssues ? '#ef4444' : '#10b981',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Subnet / VLAN Telemetry & Latency Trends (Recharts) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Subnet Architecture Gauge */}
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <Network size={14} style={{ color: '#0891b2' }} />
                <span>Railway Subnet Architecture</span>
              </div>
              <span style={{ fontSize: '11px', color: '#64748b' }}>Active Segments</span>
            </div>
            <div className="panel-body" style={{ padding: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {Object.entries(subnetBreakdown).map(([subnet, data]) => (
                  <div key={subnet} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', backgroundColor: '#f8fafc', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                    <div>
                      <div className="mono" style={{ fontSize: '11.5px', fontWeight: 600, color: '#0284c7' }}>
                        {subnet}
                      </div>
                      <div style={{ fontSize: '10.5px', color: '#64748b' }}>{data.label}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: data.online > 0 ? '#059669' : '#dc2626' }}>
                        {data.online} / {data.total}
                      </span>
                      <span style={{ fontSize: '10px', color: '#64748b', marginLeft: '4px' }}>active</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Response-Time Trend */}
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <Zap size={14} style={{ color: '#0284c7' }} />
                <span>Response-Time Trend (Real History)</span>
              </div>
              <span style={{ fontSize: '11px', color: '#64748b' }}>Live Ping Samples</span>
            </div>
            <div className="panel-body" style={{ height: '180px', padding: '10px' }}>
              {chartData.length === 0 ? (
                <EmptyState
                  title="No latency telemetry"
                  description="Status history records will render here as ping cycles execute."
                />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#64748b' }} />
                    <YAxis unit="ms" tick={{ fontSize: 9, fill: '#64748b' }} domain={[0, (dataMax) => Math.max(Number(dataMax) + 2, 5)]} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0f172a',
                        color: '#ffffff',
                        borderRadius: '4px',
                        fontSize: '11px',
                        border: 'none',
                      }}
                      formatter={(val, name, item) => [
                        `${val} ms (${item.payload.device})`,
                        'Ping Response',
                      ]}
                    />
                    <Line
                      type="monotone"
                      dataKey="latency"
                      stroke="#0284c7"
                      strokeWidth={2}
                      dot={{ r: 3.5, fill: '#0284c7', stroke: '#ffffff', strokeWidth: 1.5 }}
                      activeDot={{ r: 6 }}
                      name="Latency (ms)"
                      connectNulls={true}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================= */}
      {/* 6. LOWER SPLIT: REAL-TIME INCIDENT TRIAGE & RECENT COMMISSIONING */}
      {/* ========================================================= */}
      <div className="overview-split-layout">
        {/* Real-time incident triage queue */}
        <div className="panel">
          <div className="panel-header" style={{ flexWrap: 'wrap', gap: '8px' }}>
            <div className="panel-title">
              <ShieldAlert size={15} style={{ color: incidents.length > 0 ? '#dc2626' : '#059669' }} />
              <span>Real-Time Node Reachability Diagnostics (Managed Devices)</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button
                className={`btn btn-sm ${incidentFilter === 'CRITICAL' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: '10.5px', padding: '2px 8px' }}
                onClick={() => setIncidentFilter('CRITICAL')}
              >
                Unreachable ({incidents.length})
              </button>
              <button
                className={`btn btn-sm ${incidentFilter === 'ONLINE' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: '10.5px', padding: '2px 8px', color: incidentFilter === 'ONLINE' ? '#fff' : '#059669' }}
                onClick={() => setIncidentFilter('ONLINE')}
              >
                Online ({devices.filter(d => (deviceStatuses[d.id]?.status || '').toLowerCase() === 'online').length})
              </button>
              <button
                className={`btn btn-sm ${incidentFilter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: '10.5px', padding: '2px 8px' }}
                onClick={() => setIncidentFilter('ALL')}
              >
                All ({devices.length})
              </button>
            </div>
          </div>

          <div className="panel-body" style={{ padding: '0' }}>
            {displayedIncidentNodes.length === 0 ? (
              <div style={{ padding: '30px 20px', textAlign: 'center' }}>
                <CheckCircle2 size={32} style={{ color: '#10b981', margin: '0 auto 8px auto' }} />
                <div style={{ fontWeight: 600, fontSize: '13px', color: '#0f172a' }}>
                  No nodes matching active filter
                </div>
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Device Name</th>
                      <th>IP Address</th>
                      <th>Location / Section</th>
                      <th>Status</th>
                      <th>Telemetry Diagnosed</th>
                      <th style={{ textAlign: 'right' }}>Inspect</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedIncidentNodes.slice(0, 8).map((item) => {
                      const dev = item.device || item;
                      const st = deviceStatuses[dev.id] || { status: item.status || 'unknown' };
                      return (
                        <tr key={dev.id} className={st.status === 'offline' ? 'row-offline' : ''}>
                          <td>
                            <DeviceIdentifier
                              name={dev.name}
                              contactPerson={dev.contact_person}
                              contactPhone={dev.contact_phone}
                            />
                          </td>
                          <td className="mono">{dev.ip_address}</td>
                          <td>
                            <CompactLocationView device={dev} />
                          </td>
                          <td>
                            <StatusBadge status={st.status} />
                          </td>
                          <td style={{ fontSize: '11px', color: st.status === 'online' ? '#059669' : '#dc2626' }}>
                            {st.status === 'online'
                              ? `ICMP Reply received (${st.latency_ms ?? 0} ms)`
                              : 'ICMP Echo timed out / host unreachable'}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => setSelectedDevice(dev)}
                            >
                              Inspect
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Recently Commissioned Railway Nodes */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">
              <Clock size={14} style={{ color: '#8b5cf6' }} />
              <span>Recently Commissioned Railway Nodes</span>
            </div>
            <Link to="/devices" style={{ fontSize: '11.5px', color: '#0284c7', textDecoration: 'none' }}>
              Manage
            </Link>
          </div>

          <div className="panel-body" style={{ padding: '0' }}>
            <div className="table-wrapper">
              <table className="table" style={{ fontSize: '11.5px' }}>
                <thead>
                  <tr>
                    <th>Node</th>
                    <th>Location</th>
                    <th>Status</th>
                    <th>Commissioned</th>
                  </tr>
                </thead>
                <tbody>
                  {recentlyAddedDevices.slice(0, 6).map((dev) => {
                    const st = deviceStatuses[dev.id] || { status: 'unknown' };
                    return (
                      <tr key={dev.id}>
                        <td>
                          <DeviceIdentifier
                            name={dev.name}
                            contactPerson={dev.contact_person}
                            contactPhone={dev.contact_phone}
                          />
                          <div className="mono" style={{ fontSize: '10px', color: '#0284c7', marginTop: '1px' }}>{dev.ip_address}</div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 500 }}>{dev.room || dev.building || 'DRM Office'}</div>
                        </td>
                        <td>
                          <StatusBadge status={st.status} />
                        </td>
                        <td style={{ fontSize: '10.5px', color: '#64748b' }}>
                          {new Date(dev.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================= */}
      {/* 7. DEPARTMENT OPERATIONAL DEVICES MODAL */}
      {/* ========================================================= */}
      {selectedDept && (() => {
        const deptData = deptBreakdown[selectedDept] || { online: 0, offline: 0, unknown: 0, total: 0, devices: [] };
        const allDeptDevices = deptData.devices || [];
        const workingDevices = allDeptDevices.filter((d) => (deviceStatuses[d.id]?.status || '').toLowerCase() === 'online');
        const offlineDevices = allDeptDevices.filter((d) => (deviceStatuses[d.id]?.status || '').toLowerCase() === 'offline');

        let displayedDevices = [];
        if (deptFilter === 'working') {
          displayedDevices = workingDevices;
        } else if (deptFilter === 'offline') {
          displayedDevices = offlineDevices;
        } else {
          displayedDevices = allDeptDevices;
        }

        if (deptSearch.trim()) {
          const q = deptSearch.toLowerCase().trim();
          displayedDevices = displayedDevices.filter((d) =>
            (d.name || '').toLowerCase().includes(q) ||
            (d.contact_person || '').toLowerCase().includes(q) ||
            (d.ip_address || '').toLowerCase().includes(q) ||
            (d.device_type || '').toLowerCase().includes(q) ||
            (d.mac_address || '').toLowerCase().includes(q)
          );
        }

        return (
          <Modal
            isOpen={!!selectedDept}
            onClose={() => setSelectedDept(null)}
            title={
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Building2 size={17} style={{ color: '#0284c7' }} />
                <span>{selectedDept} — Department Node Inventory</span>
              </div>
            }
            maxWidth={780}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 14px',
                backgroundColor: '#f8fafc',
                borderRadius: '6px',
                border: '1px solid #e2e8f0',
                marginBottom: '14px',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', gap: '18px', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Working Online
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#059669' }}>
                    {workingDevices.length}{' '}
                    <span style={{ fontSize: '12px', fontWeight: 400, color: '#64748b' }}>
                      / {allDeptDevices.length} nodes
                    </span>
                  </div>
                </div>
                <div style={{ borderLeft: '1px solid #e2e8f0', paddingLeft: '18px' }}>
                  <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Offline / Down
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: offlineDevices.length > 0 ? '#dc2626' : '#64748b' }}>
                    {offlineDevices.length}
                  </div>
                </div>
              </div>

              {workingDevices.length > 0 && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    workingDevices.forEach((d) => probeDevice(d.id));
                  }}
                  title="Run ICMP check for all working devices in this room"
                >
                  <Zap size={12} /> Probe Working Nodes
                </button>
              )}
            </div>

            {/* Filter Pills */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', gap: '10px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  className={`btn btn-sm ${deptFilter === 'working' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setDeptFilter('working')}
                >
                  <CheckCircle2 size={13} /> Working / Online ({workingDevices.length})
                </button>
                <button
                  className={`btn btn-sm ${deptFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setDeptFilter('all')}
                >
                  All ({allDeptDevices.length})
                </button>
                {offlineDevices.length > 0 && (
                  <button
                    className={`btn btn-sm ${deptFilter === 'offline' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setDeptFilter('offline')}
                  >
                    <AlertTriangle size={13} /> Offline ({offlineDevices.length})
                  </button>
                )}
              </div>

              {allDeptDevices.length > 2 && (
                <div style={{ position: 'relative', minWidth: '180px' }}>
                  <input
                    type="text"
                    placeholder="Search in section..."
                    value={deptSearch}
                    onChange={(e) => setDeptSearch(e.target.value)}
                    className="form-control"
                    style={{ fontSize: '12px', padding: '4px 8px 4px 26px', height: '30px' }}
                  />
                  <Search size={13} style={{ position: 'absolute', left: '8px', top: '8px', color: '#94a3b8' }} />
                </div>
              )}
            </div>

            {/* Devices Table */}
            <div className="table-container" style={{ maxHeight: '380px', overflowY: 'auto' }}>
              <table className="table" style={{ fontSize: '12px' }}>
                <thead>
                  <tr>
                    <th>Device Name</th>
                    <th>IP Address</th>
                    <th>Status & Latency</th>
                    <th>Physical Location</th>
                    <th>Last Checked</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedDevices.map((dev) => {
                    const st = deviceStatuses[dev.id] || { status: 'unknown' };
                    const isOnline = (st.status || '').toLowerCase() === 'online';
                    return (
                      <tr key={dev.id}>
                        <td>
                          <DeviceIdentifier
                            name={dev.name}
                            contactPerson={dev.contact_person}
                            contactPhone={dev.contact_phone}
                          />
                          <div style={{ marginTop: '2px' }}>
                            <DeviceTypeBadge type={dev.device_type} />
                          </div>
                        </td>
                        <td>
                          <span className="mono" style={{ fontSize: '11px', color: '#0284c7', fontWeight: 500 }}>
                            {dev.ip_address}
                          </span>
                        </td>
                        <td>
                          <StatusBadge status={st.status} />
                          {isOnline && st.latency_ms !== null && (
                            <span style={{ fontSize: '10px', color: '#059669', marginLeft: '4px', fontWeight: 600 }}>
                              {st.latency_ms} ms
                            </span>
                          )}
                        </td>
                        <td>
                          <CompactLocationView device={dev} />
                        </td>
                        <td style={{ fontSize: '11px', color: '#64748b' }}>
                          {st.checked_at ? new Date(st.checked_at).toLocaleTimeString() : 'Not checked'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="modal-footer" style={{ margin: '18px -18px -18px -18px' }}>
              <button className="btn btn-primary btn-sm" onClick={() => setSelectedDept(null)}>
                Close
              </button>
            </div>
          </Modal>
        );
      })()}

      {/* Inspect Side Drawer */}
      <DeviceQuickDrawer
        device={selectedDevice}
        isOpen={!!selectedDevice}
        onClose={() => setSelectedDevice(null)}
      />
    </div>
  );
};

export default Overview;
