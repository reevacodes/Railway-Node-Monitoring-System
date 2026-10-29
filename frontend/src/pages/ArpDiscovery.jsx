import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNetwork } from '../context/NetworkContext';
import api from '../services/api';
import ArpStateBadge from '../components/common/ArpStateBadge';
import StatusBadge from '../components/common/StatusBadge';
import EmptyState from '../components/common/EmptyState';
import Modal from '../components/common/Modal';
import { formatIndianDateTime, formatIndianDate, formatIndianTime } from '../utils/formatters';
import {
  Radio,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  AlertTriangle,
  UploadCloud,
  Shield,
  Server,
  RefreshCw,
  Info,
  Edit2,
  Check,
  ChevronLeft,
  ChevronRight,
  PlusCircle,
  Activity,
  Layers,
  MapPin,
  Lock,
  X,
  Calendar,
  ArrowRight,
  Eye,
  GitCompare
} from 'lucide-react';

// OUI Vendor Intelligence lookup for discovered MACs
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

export const ArpDiscovery = () => {
  const { showNotification, uploadArpSnapshot } = useNetwork();

  // Primary View Mode: 'MONITORED_DEVICES' (default: discovered devices) vs 'RAW_SNAPSHOT' (Snapshot History)
  const [activeView, setActiveView] = useState('MONITORED_DEVICES');

  // ==========================================
  // Local Search State with 300ms Debounce
  // ==========================================
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // ==========================================
  // State: Discovered Devices (Live Monitored & Editable)
  // ==========================================
  const [discoveredDevices, setDiscoveredDevices] = useState([]);
  const [discoveredSummary, setDiscoveredSummary] = useState({
    total: 0,
    online: 0,
    offline: 0,
    unknown: 0,
    unmatched: 0,
    matched_inventory: 0,
    registered_devices: 0,
  });
  const [devicePage, setDevicePage] = useState(1);
  const [deviceTotalPages, setDeviceTotalPages] = useState(1);
  const [deviceTotalCount, setDeviceTotalCount] = useState(0);
  const [isDiscoveredLoading, setIsDiscoveredLoading] = useState(true);
  const [discoveredError, setDiscoveredError] = useState(null);

  // Filters for Discovered Devices
  const [discIfaceFilter, setDiscIfaceFilter] = useState('ALL'); // 'ALL' | 'Port1' | 'Port3' | 'Port2' | 'Port5'
  const [discStatusFilter, setDiscStatusFilter] = useState('ALL'); // 'ALL' | 'online' | 'offline' | 'unknown'
  const [discMatchFilter, setDiscMatchFilter] = useState('ALL'); // 'ALL' | 'unmatched' | 'matched_inventory' | 'registered_device' | 'matched'

  // Direct Database Editing Modal
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState(null);
  const [editForm, setEditForm] = useState({
    custom_name: '',
    device_type: 'PC',
    department: '',
    building_location: '',
    notes: '',
    is_monitored: true,
  });
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isProbingSingle, setIsProbingSingle] = useState(false);
  const [isProbingAll, setIsProbingAll] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);

  // ==========================================
  // State: Snapshot History View (Audit Log)
  // ==========================================
  const [snapshots, setSnapshots] = useState([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState('');
  const [rawSnapshotData, setRawSnapshotData] = useState({
    items: [],
    summary: { total_entries: 0, matched: 0, unmatched: 0, no_mac_failed: 0 },
  });
  const [isRawLoading, setIsRawLoading] = useState(false);
  const [rawError, setRawError] = useState(null);
  const [rawQuickFilter, setRawQuickFilter] = useState('ALL'); // 'ALL' | 'MATCHED' | 'UNMATCHED' | 'NO_MAC'
  const [rawIfaceFilter, setRawIfaceFilter] = useState('ALL');
  const [rawArpStateFilter, setRawArpStateFilter] = useState('ALL');

  // Snapshot History Sub-View: 'TABLE' (all snapshots history) | 'DETAILS' (specific snapshot entries)
  const [snapHistoryView, setSnapHistoryView] = useState('TABLE');

  // Filters for Snapshot History Table
  const [snapSearch, setSnapSearch] = useState('');
  const [snapFromDate, setSnapFromDate] = useState('');
  const [snapToDate, setSnapToDate] = useState('');
  const [snapSourceFilter, setSnapSourceFilter] = useState('ALL');
  const [snapTablePage, setSnapTablePage] = useState(1);
  const snapPageLimit = 10;

  // Snapshot Comparison Modal State
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const [compareBaseId, setCompareBaseId] = useState('');
  const [compareTargetId, setCompareTargetId] = useState('');
  const [compareDiff, setCompareDiff] = useState(null);
  const [isComparing, setIsComparing] = useState(false);
  const [compareError, setCompareError] = useState(null);

  // Snapshot Import Modal
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [rawText, setRawText] = useState('');
  const [snapshotFileName, setSnapshotFileName] = useState('Sophos XGS2100 Export');
  const [isSubmittingImport, setIsSubmittingImport] = useState(false);

  // ----------------------------------------------------
  // Debounce search input by 300 ms and reset page to 1
  // ----------------------------------------------------
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setDevicePage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // ----------------------------------------------------
  // Unified Quick Filter Handlers (Synchronized with Dropdowns)
  // ----------------------------------------------------
  const handleQuickFilterSelect = (preset) => {
    setDevicePage(1);
    if (preset === 'ALL') {
      setDiscStatusFilter('ALL');
      setDiscMatchFilter('ALL');
    } else if (preset === 'ONLINE') {
      setDiscStatusFilter('online');
      setDiscMatchFilter('ALL');
    } else if (preset === 'OFFLINE') {
      setDiscStatusFilter('offline');
      setDiscMatchFilter('ALL');
    } else if (preset === 'UNKNOWN') {
      setDiscStatusFilter('unknown');
      setDiscMatchFilter('ALL');
    } else if (preset === 'UNMATCHED') {
      setDiscStatusFilter('ALL');
      setDiscMatchFilter('unmatched');
    } else if (preset === 'MATCHED') {
      setDiscStatusFilter('ALL');
      setDiscMatchFilter('matched_inventory');
    } else if (preset === 'REGISTERED') {
      setDiscStatusFilter('ALL');
      setDiscMatchFilter('registered_device');
    }
  };

  const isQuickFilterActive = (preset) => {
    if (preset === 'ALL') return discStatusFilter === 'ALL' && discMatchFilter === 'ALL';
    if (preset === 'ONLINE') return discStatusFilter === 'online';
    if (preset === 'OFFLINE') return discStatusFilter === 'offline';
    if (preset === 'UNKNOWN') return discStatusFilter === 'unknown';
    if (preset === 'UNMATCHED') return discMatchFilter === 'unmatched';
    if (preset === 'MATCHED') return discMatchFilter === 'matched_inventory';
    if (preset === 'REGISTERED') return discMatchFilter === 'registered_device';
    return false;
  };

  const isAnyFilterActive = discIfaceFilter !== 'ALL' || discStatusFilter !== 'ALL' || discMatchFilter !== 'ALL' || !!searchTerm;

  const handleClearFilters = () => {
    setSearchTerm('');
    setDebouncedSearch('');
    setDiscIfaceFilter('ALL');
    setDiscStatusFilter('ALL');
    setDiscMatchFilter('ALL');
    setDevicePage(1);
  };

  const handleStatusFilterChange = (val) => {
    setDiscStatusFilter(val);
    setDevicePage(1);
  };

  const handleMatchFilterChange = (val) => {
    setDiscMatchFilter(val);
    setDevicePage(1);
  };

  const handleIfaceFilterChange = (val) => {
    setDiscIfaceFilter(val);
    setDevicePage(1);
  };

  // ----------------------------------------------------
  // Fetch Discovered Devices (Live Monitored & Editable)
  // ----------------------------------------------------
  const fetchDiscoveredDevices = useCallback(async () => {
    setIsDiscoveredLoading(true);
    setDiscoveredError(null);
    try {
      const data = await api.getDiscoveredDevices({
        page: devicePage,
        limit: 50,
        interface: discIfaceFilter !== 'ALL' ? discIfaceFilter : undefined,
        ping_status: discStatusFilter !== 'ALL' ? discStatusFilter : undefined,
        match_status: discMatchFilter !== 'ALL' ? discMatchFilter : undefined,
        search: debouncedSearch || undefined,
      });

      setDiscoveredDevices(data.items || []);
      setDiscoveredSummary(data.summary || {});
      setDeviceTotalPages(data.totalPages || 1);
      setDeviceTotalCount(data.total || 0);
    } catch (err) {
      console.error('Failed to load discovered devices:', err);
      setDiscoveredError(err.message || 'Failed to load discovered devices telemetry');
    } finally {
      setIsDiscoveredLoading(false);
    }
  }, [devicePage, discIfaceFilter, discStatusFilter, discMatchFilter, debouncedSearch]);

  // ----------------------------------------------------
  // Fetch Raw Snapshot Data (Snapshot History)
  // ----------------------------------------------------
  const fetchSnapshotsList = async () => {
    try {
      const list = await api.getArpSnapshots();
      setSnapshots(list);
      if (list.length > 0 && !selectedSnapshotId) {
        setSelectedSnapshotId(String(list[0].id));
      }
      if (list.length >= 2 && !compareBaseId && !compareTargetId) {
        setCompareTargetId(String(list[0].id));
        setCompareBaseId(String(list[1].id));
      }
    } catch (err) {
      console.error('Failed to load snapshots list:', err);
    }
  };

  // ----------------------------------------------------
  // Snapshot History Table Filtering & Pagination
  // ----------------------------------------------------
  const filteredSnapshots = useMemo(() => {
    return snapshots.filter((s) => {
      // 1. Search by ID (e.g. "18" or "#18") or snapshot name
      if (snapSearch.trim()) {
        const q = snapSearch.trim().toLowerCase().replace(/^#/, '');
        const idMatch = String(s.id).includes(q);
        const nameMatch = (s.snapshot_name || '').toLowerCase().includes(q);
        const srcMatch = (s.source_device || '').toLowerCase().includes(q);
        if (!idMatch && !nameMatch && !srcMatch) return false;
      }
      // 2. Date Range Filter (Asia/Kolkata date string check)
      if (snapFromDate) {
        const snapDate = new Date(s.imported_at).toISOString().slice(0, 10);
        if (snapDate < snapFromDate) return false;
      }
      if (snapToDate) {
        const snapDate = new Date(s.imported_at).toISOString().slice(0, 10);
        if (snapDate > snapToDate) return false;
      }
      // 3. Source Device Filter
      if (snapSourceFilter !== 'ALL') {
        const src = s.source_device || 'Sophos XGS2100';
        if (src !== snapSourceFilter) return false;
      }
      return true;
    });
  }, [snapshots, snapSearch, snapFromDate, snapToDate, snapSourceFilter]);

  const snapTotalPages = Math.max(1, Math.ceil(filteredSnapshots.length / snapPageLimit));
  const paginatedSnapshots = useMemo(() => {
    const start = (snapTablePage - 1) * snapPageLimit;
    return filteredSnapshots.slice(start, start + snapPageLimit);
  }, [filteredSnapshots, snapTablePage, snapPageLimit]);

  const isAnySnapFilterActive = !!snapSearch || !!snapFromDate || !!snapToDate || snapSourceFilter !== 'ALL';

  const handleClearSnapFilters = () => {
    setSnapSearch('');
    setSnapFromDate('');
    setSnapToDate('');
    setSnapSourceFilter('ALL');
    setSnapTablePage(1);
  };

  const handleViewSnapshotDetails = (snapshot) => {
    setSelectedSnapshotId(String(snapshot.id));
    setSnapHistoryView('DETAILS');
  };

  const handleOpenCompare = (targetSnapId = null) => {
    if (targetSnapId) {
      setCompareTargetId(String(targetSnapId));
      const other = snapshots.find(s => String(s.id) !== String(targetSnapId));
      if (other) setCompareBaseId(String(other.id));
    } else if (snapshots.length >= 2) {
      setCompareTargetId(String(snapshots[0].id));
      setCompareBaseId(String(snapshots[1].id));
    }
    setIsCompareModalOpen(true);
    setCompareDiff(null);
    setCompareError(null);
  };

  const handleRunCompare = async () => {
    if (!compareBaseId || !compareTargetId) return;
    setIsComparing(true);
    setCompareError(null);
    try {
      const res = await api.compareArpSnapshots(compareBaseId, compareTargetId);
      setCompareDiff(res);
    } catch (err) {
      setCompareError(err.message || 'Comparison failed');
    } finally {
      setIsComparing(false);
    }
  };

  const fetchRawSnapshotEntries = useCallback(async () => {
    if (!selectedSnapshotId) return;
    setIsRawLoading(true);
    setRawError(null);
    try {
      let matchParam = undefined;
      if (rawQuickFilter === 'MATCHED') matchParam = 'matched';
      else if (rawQuickFilter === 'UNMATCHED') matchParam = 'unmatched';
      else if (rawQuickFilter === 'NO_MAC') matchParam = 'no_mac';

      const data = await api.getArpDiscoveries({
        snapshot_id: selectedSnapshotId,
        interface: rawIfaceFilter !== 'ALL' ? rawIfaceFilter : undefined,
        arp_state: rawArpStateFilter !== 'ALL' ? rawArpStateFilter : undefined,
        match_status: matchParam,
        search: debouncedSearch || undefined,
      });
      setRawSnapshotData(data);
    } catch (err) {
      console.error('Failed to load raw snapshot entries:', err);
      setRawError(err.message || 'Failed to load snapshot history entries');
    } finally {
      setIsRawLoading(false);
    }
  }, [selectedSnapshotId, rawQuickFilter, rawIfaceFilter, rawArpStateFilter, debouncedSearch]);

  const isAnyRawFilterActive = rawQuickFilter !== 'ALL' || rawIfaceFilter !== 'ALL' || rawArpStateFilter !== 'ALL' || !!searchTerm;

  const handleClearRawFilters = () => {
    setSearchTerm('');
    setDebouncedSearch('');
    setRawQuickFilter('ALL');
    setRawIfaceFilter('ALL');
    setRawArpStateFilter('ALL');
  };

  // Initial load
  useEffect(() => {
    fetchDiscoveredDevices();
    fetchSnapshotsList();
  }, []);

  // Update on filter / pagination changes
  useEffect(() => {
    if (activeView === 'MONITORED_DEVICES') {
      fetchDiscoveredDevices();
    } else {
      fetchRawSnapshotEntries();
    }
  }, [activeView, fetchDiscoveredDevices, fetchRawSnapshotEntries]);

  // ----------------------------------------------------
  // Edit Modal Handlers (Direct Database Editing)
  // ----------------------------------------------------
  const handleOpenEdit = (device) => {
    setEditingDevice(device);
    setEditForm({
      custom_name: device.custom_name || '',
      device_type: device.device_type || 'PC',
      department: device.department || '',
      building_location: device.building_location || '',
      notes: device.notes || '',
      is_monitored: device.is_monitored !== false,
    });
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = async (e) => {
    if (e) e.preventDefault();
    if (!editingDevice) return;

    setIsSavingEdit(true);
    try {
      await api.updateDiscoveredDevice(editingDevice.id, editForm);
      showNotification(`Saved identification for ${editingDevice.ip_address} directly to PostgreSQL.`, 'success');
      setIsEditModalOpen(false);
      await fetchDiscoveredDevices();
    } catch (err) {
      showNotification(err.message || 'Failed to update device', 'error');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleSingleProbe = async (deviceId) => {
    setIsProbingSingle(true);
    try {
      const result = await api.pingDiscoveredDevice(deviceId);
      showNotification(
        `Probe result for ${result.device.ip_address}: ${result.probe.status.toUpperCase()}${
          result.probe.latency_ms !== null ? ` (${result.probe.latency_ms} ms)` : ''
        }`,
        result.probe.status === 'online' ? 'success' : 'info'
      );
      if (editingDevice && editingDevice.id === deviceId) {
        setEditingDevice(result.device);
      }
      await fetchDiscoveredDevices();
    } catch (err) {
      showNotification(err.message || 'Probe execution failed', 'error');
    } finally {
      setIsProbingSingle(false);
    }
  };

  const handlePingAll = async () => {
    setIsProbingAll(true);
    try {
      await api.pingAllDiscoveredDevices();
      showNotification('Background ping cycle started across all monitored discovered devices.', 'info');
      setTimeout(() => {
        fetchDiscoveredDevices();
        setIsProbingAll(false);
      }, 3000);
    } catch (err) {
      showNotification(err.message || 'Failed to start ping cycle', 'error');
      setIsProbingAll(false);
    }
  };

  const handlePromoteDevice = async (deviceId, deviceIp) => {
    const confirmed = window.confirm(
      `Promote discovered device ${deviceIp ? `(${deviceIp})` : ''} to the registered device inventory?\n\nThis will add the device to the official monitored devices table.`
    );
    if (!confirmed) return;

    setIsRegistering(true);
    try {
      const result = await api.registerDiscoveredDevice(deviceId);
      showNotification(result.message || 'Device promoted to monitored inventory.', 'success');
      if (editingDevice && editingDevice.id === deviceId) {
        setEditingDevice(result.device);
      }
      await fetchDiscoveredDevices();
    } catch (err) {
      showNotification(err.message || 'Failed to register device', 'error');
    } finally {
      setIsRegistering(false);
    }
  };

  // ----------------------------------------------------
  // Raw Snapshot Import Handler
  // ----------------------------------------------------
  const handleImportSubmit = async (e) => {
    e.preventDefault();
    setIsSubmittingImport(true);
    try {
      const result = await uploadArpSnapshot({
        snapshot_content: rawText || undefined,
        filename: snapshotFileName || 'Sophos XGS2100 Export',
      });
      setIsImportModalOpen(false);
      setRawText('');
      await fetchSnapshotsList();
      setSelectedSnapshotId(String(result.snapshotId));
      await fetchDiscoveredDevices();
      await fetchRawSnapshotEntries();
      showNotification('Successfully imported Sophos neighbor cache snapshot.', 'success');
    } catch (err) {
      showNotification(err.message || 'Failed to import snapshot', 'error');
    } finally {
      setIsSubmittingImport(false);
    }
  };

  // Active snapshot reference for metadata header
  const activeSnapshot = snapshots.find((s) => String(s.id) === String(selectedSnapshotId)) || snapshots[0];

  return (
    <div>
      {/* Title Strip */}
      <div className="page-title-strip">
        <div>
          <h1>Sophos XGS2100 ARP / Neighbor Discovery</h1>
          <div className="page-subtitle">
            Layer-2 network discovery, ICMP reachability verification, MAC inventory correlation & station asset identification
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handlePingAll}
            disabled={isProbingAll}
            title="Probe all eligible discovered devices on Port1 & Port3"
          >
            <Activity size={13} className={isProbingAll ? 'spin' : ''} />
            <span>{isProbingAll ? 'Probing Devices...' : 'Ping All Discovered'}</span>
          </button>

          <button
            className="btn btn-primary btn-sm"
            onClick={() => setIsImportModalOpen(true)}
          >
            <UploadCloud size={14} /> Import Snapshot
          </button>
        </div>
      </div>

      {/* Primary View Switcher Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          borderBottom: '1px solid #e2e8f0',
          marginBottom: '16px',
          paddingBottom: '2px',
        }}
      >
        <button
          onClick={() => setActiveView('MONITORED_DEVICES')}
          style={{
            padding: '8px 16px',
            fontSize: '13px',
            fontWeight: 600,
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            borderBottom: activeView === 'MONITORED_DEVICES' ? '3px solid #0284c7' : '3px solid transparent',
            color: activeView === 'MONITORED_DEVICES' ? '#0284c7' : '#64748b',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <Activity size={16} />
          <span>Discovered Devices</span>
          <span
            style={{
              backgroundColor: activeView === 'MONITORED_DEVICES' ? '#e0f2fe' : '#f1f5f9',
              color: activeView === 'MONITORED_DEVICES' ? '#0284c7' : '#64748b',
              fontSize: '11px',
              padding: '1px 6px',
              borderRadius: '10px',
            }}
          >
            {discoveredSummary.total ?? '…'}
          </span>
        </button>

        <button
          onClick={() => setActiveView('RAW_SNAPSHOT')}
          style={{
            padding: '8px 16px',
            fontSize: '13px',
            fontWeight: 600,
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            borderBottom: activeView === 'RAW_SNAPSHOT' ? '3px solid #0284c7' : '3px solid transparent',
            color: activeView === 'RAW_SNAPSHOT' ? '#0284c7' : '#64748b',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <Radio size={16} />
          <span>Snapshot History</span>
          <span
            style={{
              backgroundColor: activeView === 'RAW_SNAPSHOT' ? '#e0f2fe' : '#f1f5f9',
              color: activeView === 'RAW_SNAPSHOT' ? '#0284c7' : '#64748b',
              fontSize: '11px',
              padding: '1px 6px',
              borderRadius: '10px',
            }}
          >
            {activeSnapshot?.total_entries ?? '…'}
          </span>
        </button>
      </div>

      {/* ========================================================== */}
      {/* VIEW 1: DISCOVERED DEVICES (Live Ping, Monitoring & Direct Edit) */}
      {/* ========================================================== */}
      {activeView === 'MONITORED_DEVICES' && (
        <div>
          {/* Operational Metrics Cards (Compact 6-Card Strip) */}
          <div className="operational-strip" style={{ marginBottom: '16px' }}>
            {/* Card 1: Discovered Devices */}
            <div
              className="operational-metric"
              onClick={() => handleQuickFilterSelect('ALL')}
              style={{ cursor: 'pointer', border: isQuickFilterActive('ALL') ? '2px solid #0284c7' : undefined }}
              title="Click to view all discovered Layer-2 devices with confirmed MACs"
            >
              <span className="operational-metric-label">
                <Radio size={13} /> Discovered Devices
              </span>
              <span className="operational-metric-value">{discoveredSummary.total ?? '…'}</span>
              <span className="metric-sub">Layer-2 hosts observed with confirmed MAC</span>
            </div>

            {/* Card 2: Responding to Ping */}
            <div
              className="operational-metric"
              onClick={() => handleQuickFilterSelect('ONLINE')}
              style={{ cursor: 'pointer', border: isQuickFilterActive('ONLINE') ? '2px solid #059669' : undefined }}
              title="Click to filter by devices actively responding to ICMP ping"
            >
              <span className="operational-metric-label" style={{ color: '#059669' }}>
                <CheckCircle2 size={13} /> Responding to Ping
              </span>
              <span className="operational-metric-value" style={{ color: '#059669' }}>
                {discoveredSummary.online ?? '…'}
              </span>
              <span className="metric-sub">Active ICMP reply on railway LAN</span>
            </div>

            {/* Card 3: No Ping Reply */}
            <div
              className="operational-metric"
              onClick={() => handleQuickFilterSelect('OFFLINE')}
              style={{ cursor: 'pointer', border: isQuickFilterActive('OFFLINE') ? '2px solid #dc2626' : undefined }}
              title="Click to filter by devices with no ICMP reply in recent probe"
            >
              <span className="operational-metric-label" style={{ color: '#dc2626' }}>
                <AlertTriangle size={13} /> No Ping Reply
              </span>
              <span className="operational-metric-value" style={{ color: '#dc2626' }}>
                {discoveredSummary.offline ?? '…'}
              </span>
              <span className="metric-sub">Probe timed out or host unreachable</span>
            </div>

            {/* Card 4: Unknown / Stale */}
            <div
              className="operational-metric"
              onClick={() => handleQuickFilterSelect('UNKNOWN')}
              style={{ cursor: 'pointer', border: isQuickFilterActive('UNKNOWN') ? '2px solid #64748b' : undefined }}
              title="Click to filter by devices awaiting probe verification"
            >
              <span className="operational-metric-label" style={{ color: '#475569' }}>
                <Clock size={13} /> Unknown / Stale
              </span>
              <span className="operational-metric-value">
                {discoveredSummary.unknown ?? '…'}
              </span>
              <span className="metric-sub">Awaiting probe or unverified status</span>
            </div>

            {/* Card 5: Matched to Inventory */}
            <div
              className="operational-metric"
              onClick={() => handleQuickFilterSelect('MATCHED')}
              style={{ cursor: 'pointer', border: isQuickFilterActive('MATCHED') ? '2px solid #10b981' : undefined }}
              title="Click to filter by devices correlated with station MAC inventory"
            >
              <span className="operational-metric-label" style={{ color: '#10b981' }}>
                <CheckCircle2 size={13} /> Matched to Inventory
              </span>
              <span className="operational-metric-value" style={{ color: '#10b981' }}>
                {discoveredSummary.matched_inventory ?? '…'}
              </span>
              <span className="metric-sub">Correlated with station MAC inventory</span>
            </div>

            {/* Card 6: Unmanaged Devices */}
            <div
              className="operational-metric"
              onClick={() => handleQuickFilterSelect('UNMATCHED')}
              style={{ cursor: 'pointer', border: isQuickFilterActive('UNMATCHED') ? '2px solid #0284c7' : undefined }}
              title="Click to filter by unmanaged discovered devices"
            >
              <span className="operational-metric-label" style={{ color: '#0284c7' }}>
                <Layers size={13} /> Unmanaged Devices
              </span>
              <span className="operational-metric-value" style={{ color: '#0284c7' }}>
                {discoveredSummary.unmatched ?? '…'}
              </span>
              <span className="metric-sub">Layer-2 hosts awaiting registration</span>
            </div>
          </div>

          {/* Main Table Panel */}
          <div className="panel">
            {/* Quick Filter Pills Row */}
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: '#475569', marginRight: '4px' }}>
                  Filter Preset:
                </span>
                <button
                  className={`btn btn-sm ${isQuickFilterActive('ALL') ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: '11px', padding: '2px 9px' }}
                  onClick={() => handleQuickFilterSelect('ALL')}
                >
                  All ({discoveredSummary.total ?? 0})
                </button>
                <button
                  className={`btn btn-sm ${isQuickFilterActive('ONLINE') ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: '11px', padding: '2px 9px', color: isQuickFilterActive('ONLINE') ? '#fff' : '#059669' }}
                  onClick={() => handleQuickFilterSelect('ONLINE')}
                >
                  Online ({discoveredSummary.online ?? 0})
                </button>
                <button
                  className={`btn btn-sm ${isQuickFilterActive('OFFLINE') ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: '11px', padding: '2px 9px', color: isQuickFilterActive('OFFLINE') ? '#fff' : '#dc2626' }}
                  onClick={() => handleQuickFilterSelect('OFFLINE')}
                >
                  No Ping Reply ({discoveredSummary.offline ?? 0})
                </button>
                <button
                  className={`btn btn-sm ${isQuickFilterActive('UNKNOWN') ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: '11px', padding: '2px 9px' }}
                  onClick={() => handleQuickFilterSelect('UNKNOWN')}
                >
                  Unknown / Stale ({discoveredSummary.unknown ?? 0})
                </button>
                <button
                  className={`btn btn-sm ${isQuickFilterActive('UNMATCHED') ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: '11px', padding: '2px 9px', color: isQuickFilterActive('UNMATCHED') ? '#fff' : '#0284c7' }}
                  onClick={() => handleQuickFilterSelect('UNMATCHED')}
                >
                  Unmanaged ({discoveredSummary.unmatched ?? 0})
                </button>
                <button
                  className={`btn btn-sm ${isQuickFilterActive('MATCHED') ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: '11px', padding: '2px 9px', color: isQuickFilterActive('MATCHED') ? '#fff' : '#10b981' }}
                  onClick={() => handleQuickFilterSelect('MATCHED')}
                >
                  Inventory Matched ({discoveredSummary.matched_inventory ?? 0})
                </button>
                <button
                  className={`btn btn-sm ${isQuickFilterActive('REGISTERED') ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: '11px', padding: '2px 9px', color: isQuickFilterActive('REGISTERED') ? '#fff' : '#8b5cf6' }}
                  onClick={() => handleQuickFilterSelect('REGISTERED')}
                >
                  Registered Nodes ({discoveredSummary.registered_devices ?? 0})
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {isAnyFilterActive && (
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: '11px', padding: '3px 8px', color: '#dc2626', borderColor: '#fca5a5' }}
                    onClick={handleClearFilters}
                    title="Reset all search queries and dropdown filters"
                  >
                    Clear Filters
                  </button>
                )}
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ fontSize: '11px', padding: '3px 8px' }}
                  onClick={fetchDiscoveredDevices}
                >
                  <RefreshCw size={11} className={isDiscoveredLoading ? 'spin' : ''} /> Refresh Table
                </button>
              </div>
            </div>

            {/* Filter Toolbar */}
            <div className="filter-toolbar">
              <div className="filter-group">
                <div style={{ position: 'relative', width: '260px' }}>
                  <Search
                    size={13}
                    style={{ position: 'absolute', left: '8px', top: '9px', color: '#94a3b8' }}
                  />
                  <input
                    type="text"
                    className="form-input"
                    style={{ paddingLeft: '28px', height: '30px', fontSize: '11.5px' }}
                    placeholder="Search name, IP, MAC, department, location..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                  {searchTerm && (
                    <button
                      onClick={() => setSearchTerm('')}
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

                <select
                  className="filter-select"
                  value={discIfaceFilter}
                  onChange={(e) => handleIfaceFilterChange(e.target.value)}
                >
                  <option value="ALL">All Firewall Ports</option>
                  <option value="Port1">Port1 (Internal DRM LAN)</option>
                  <option value="Port3">Port3 (WLAN / Field APs)</option>
                  <option value="Port2">Port2 (WAN / Gateway)</option>
                  <option value="Port5">Port5 (ISP / DMZ)</option>
                </select>

                <select
                  className="filter-select"
                  value={discStatusFilter}
                  onChange={(e) => handleStatusFilterChange(e.target.value)}
                >
                  <option value="ALL">All Ping States</option>
                  <option value="online">Online (Responding)</option>
                  <option value="offline">Offline / No Reply</option>
                  <option value="unknown">Unverified / Pending</option>
                </select>

                <select
                  className="filter-select"
                  value={discMatchFilter}
                  onChange={(e) => handleMatchFilterChange(e.target.value)}
                >
                  <option value="ALL">All Classifications</option>
                  <option value="unmatched">Unmanaged Only</option>
                  <option value="matched">All Matched (Inventory or Registered)</option>
                  <option value="matched_inventory">Inventory Matched</option>
                  <option value="registered_device">Registered Nodes</option>
                </select>
              </div>

              <div style={{ fontSize: '11px', color: '#64748b' }}>
                Showing page <strong>{devicePage}</strong> of <strong>{deviceTotalPages}</strong> ({deviceTotalCount} matching devices)
              </div>
            </div>

            {/* Discovered Devices Table Body */}
            <div className="panel-body" style={{ padding: '0' }}>
              {isDiscoveredLoading ? (
                <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
                  <RefreshCw size={24} className="spin" style={{ margin: '0 auto 8px' }} />
                  <div>Loading discovered devices and ping telemetry...</div>
                </div>
              ) : discoveredError ? (
                <div style={{ padding: '40px', textAlign: 'center', color: '#b91c1c' }}>
                  <AlertTriangle size={28} style={{ margin: '0 auto 8px', color: '#dc2626' }} />
                  <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>
                    Failed to Load Discovered Devices
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '12px' }}>
                    {discoveredError}
                  </div>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={fetchDiscoveredDevices}
                  >
                    <RefreshCw size={12} /> Retry Loading
                  </button>
                </div>
              ) : discoveredDevices.length === 0 ? (
                <div style={{ padding: '30px', textAlign: 'center' }}>
                  <EmptyState
                    title="No Discovered Devices Match Criteria"
                    description="Adjust your search criteria, port selection, or population filters."
                  />
                  {isAnyFilterActive && (
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ marginTop: '12px' }}
                      onClick={handleClearFilters}
                    >
                      Clear All Filters
                    </button>
                  )}
                </div>
              ) : (
                <div className="table-wrapper">
                  <table className="table" style={{ fontSize: '11.5px' }}>
                    <thead>
                      <tr>
                        <th>Device Identity & Location</th>
                        <th>Discovered IP</th>
                        <th>MAC Address & Vendor</th>
                        <th>Firewall Port</th>
                        <th>Ping Reachability</th>
                        <th>Latency</th>
                        <th>Classification</th>
                        <th>Last Probe</th>
                        <th style={{ textAlign: 'center', width: '130px' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {discoveredDevices.map((device) => {
                        const vendor = getVendorFromMac(device.mac_address);
                        const isOnline = device.last_ping_status === 'online';
                        const isOffline = device.last_ping_status === 'offline';

                        // Display name resolution priority: custom_name > inventory_name > registered_name > "Unidentified Host"
                        const displayName = device.custom_name ||
                          device.inventory_device_name ||
                          device.registered_device_name ||
                          null;

                        const locationDisplay = device.building_location ||
                          device.department ||
                          device.inventory_location ||
                          device.registered_building ||
                          null;

                        return (
                          <tr
                            key={device.id}
                            className={isOffline ? 'row-offline' : ''}
                            style={{
                              backgroundColor: device.custom_name ? '#f0fdf4' : undefined,
                            }}
                          >
                            {/* 1. Device Identity & Location */}
                            <td>
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span style={{ fontWeight: 600, color: displayName ? '#0f172a' : '#94a3b8', fontSize: '12px' }}>
                                    {displayName || <em>Unidentified Device</em>}
                                  </span>
                                  {device.custom_name && (
                                    <span
                                      style={{
                                        fontSize: '9.5px',
                                        backgroundColor: '#dcfce7',
                                        color: '#15803d',
                                        padding: '1px 5px',
                                        borderRadius: '3px',
                                        fontWeight: 500,
                                      }}
                                    >
                                      Custom
                                    </span>
                                  )}
                                </div>
                                {locationDisplay ? (
                                  <div style={{ fontSize: '10.5px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '3px', marginTop: '2px' }}>
                                    <MapPin size={10} style={{ flexShrink: 0 }} /> {locationDisplay}
                                  </div>
                                ) : (
                                  <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '1px' }}>
                                    Location not set
                                  </div>
                                )}
                              </div>
                            </td>

                            {/* 2. Discovered IP Address */}
                            <td className="mono" style={{ fontWeight: 600, color: '#0284c7' }}>
                              {device.ip_address}
                            </td>

                            {/* 3. MAC Address & Vendor */}
                            <td>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <span className="mono" style={{ fontWeight: 500, color: '#0f172a' }}>
                                  {device.mac_address}
                                </span>
                                {vendor && (
                                  <span
                                    style={{
                                      fontSize: '9.5px',
                                      color: '#475569',
                                      backgroundColor: '#f1f5f9',
                                      padding: '1px 5px',
                                      borderRadius: '3px',
                                      width: 'fit-content',
                                      border: '1px solid #e2e8f0',
                                    }}
                                  >
                                    {vendor}
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* 4. Firewall Port / Interface */}
                            <td className="mono" style={{ fontWeight: 500 }}>
                              {device.interface}
                            </td>

                            {/* 5. Ping Status Badge */}
                            <td>
                              <StatusBadge status={device.last_ping_status || 'unknown'} />
                            </td>

                            {/* 6. Latency */}
                            <td className="mono" style={{ fontSize: '11px', color: isOnline ? '#059669' : '#64748b' }}>
                              {device.last_ping_latency !== null && device.last_ping_latency !== undefined
                                ? `${device.last_ping_latency} ms`
                                : '—'}
                            </td>

                            {/* 7. Classification */}
                            <td>
                              {device.derived_match_status === 'registered_device' ? (
                                <span className="status-badge online" style={{ fontSize: '10px' }}>
                                  <Server size={10} /> Registered Node
                                </span>
                              ) : device.derived_match_status === 'matched_inventory' ? (
                                <span className="status-badge online" style={{ fontSize: '10px' }}>
                                  <CheckCircle2 size={10} /> Inventory Matched
                                </span>
                              ) : (
                                <span className="status-badge warning" style={{ fontSize: '10px' }}>
                                  <Radio size={10} /> Unmanaged Discovered
                                </span>
                              )}
                            </td>

                            {/* 8. Last Probe Timestamp */}
                            <td style={{ fontSize: '10.5px', color: '#64748b' }}>
                              {device.last_ping_at
                                ? new Date(device.last_ping_at).toLocaleTimeString()
                                : 'Pending'}
                            </td>

                            {/* 9. Actions */}
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                                <button
                                  className="btn btn-secondary btn-sm"
                                  style={{ padding: '3px 8px', fontSize: '11px' }}
                                  title="Edit device identification details"
                                  onClick={() => handleOpenEdit(device)}
                                >
                                  <Edit2 size={11} /> Edit
                                </button>

                                <button
                                  className="btn btn-secondary btn-sm"
                                  style={{ padding: '3px 6px', fontSize: '11px' }}
                                  title="Ping this IP now"
                                  onClick={() => handleSingleProbe(device.id)}
                                  disabled={isProbingSingle}
                                >
                                  <Activity size={11} />
                                </button>

                                {!device.registered_device_id && (
                                  <button
                                    className="btn btn-secondary btn-sm"
                                    style={{ padding: '3px 6px', fontSize: '11px', color: '#0284c7' }}
                                    title="Promote to monitored device inventory"
                                    onClick={() => handlePromoteDevice(device.id, device.ip_address)}
                                    disabled={isRegistering}
                                  >
                                    <PlusCircle size={11} />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination Bar */}
              {deviceTotalPages > 1 && (
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
                    disabled={devicePage <= 1}
                    onClick={() => setDevicePage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft size={13} /> Previous
                  </button>

                  <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                    Page <strong>{devicePage}</strong> of <strong>{deviceTotalPages}</strong> ({deviceTotalCount} total assets)
                  </span>

                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={devicePage >= deviceTotalPages}
                    onClick={() => setDevicePage((p) => Math.min(deviceTotalPages, p + 1))}
                  >
                    Next <ChevronRight size={13} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================== */}
      {/* VIEW 2: SNAPSHOT HISTORY (Historical Sophos ARP Cache Audit) */}
      {/* ========================================================== */}
      {activeView === 'RAW_SNAPSHOT' && (
        <div>
          {/* Sub-Navigation for Snapshot History */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '14px',
              paddingBottom: '8px',
              borderBottom: '1px solid #e2e8f0',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                className={`btn btn-sm ${snapHistoryView === 'TABLE' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setSnapHistoryView('TABLE')}
                style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Clock size={13} />
                <span>All Snapshots History ({snapshots.length})</span>
              </button>

              <button
                className={`btn btn-sm ${snapHistoryView === 'DETAILS' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setSnapHistoryView('DETAILS')}
                style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Radio size={13} />
                <span>Snapshot Entries {activeSnapshot ? `(#${activeSnapshot.id})` : ''}</span>
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => handleOpenCompare()}
                style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                title="Compare two historical ARP snapshots to identify deltas"
              >
                <Layers size={13} />
                <span>Compare Snapshots</span>
              </button>

              <button
                className="btn btn-secondary btn-sm"
                onClick={fetchSnapshotsList}
                style={{ fontSize: '12px' }}
                title="Reload snapshots list from PostgreSQL"
              >
                <RefreshCw size={12} />
              </button>
            </div>
          </div>

          {/* ---------------------------------------------------- */}
          {/* SUB-VIEW A: ALL SNAPSHOTS HISTORY TABLE */}
          {/* ---------------------------------------------------- */}
          {snapHistoryView === 'TABLE' && (
            <div className="panel">
              <div className="panel-header">
                <div className="panel-title">
                  <Clock size={15} style={{ color: '#0284c7' }} />
                  <span>Collected Sophos ARP Snapshots History</span>
                </div>
                <span style={{ fontSize: '11px', color: '#64748b' }}>
                  Showing {filteredSnapshots.length} of {snapshots.length} saved snapshots in database
                </span>
              </div>

              {/* Filter Toolbar for Snapshot History Table */}
              <div className="filter-toolbar" style={{ flexWrap: 'wrap', gap: '8px', padding: '10px 14px' }}>
                <div className="filter-group" style={{ flexWrap: 'wrap', gap: '8px' }}>
                  {/* Search by ID or Name */}
                  <div style={{ position: 'relative', width: '220px' }}>
                    <Search
                      size={13}
                      style={{ position: 'absolute', left: '8px', top: '9px', color: '#94a3b8' }}
                    />
                    <input
                      type="text"
                      className="form-input"
                      style={{ paddingLeft: '28px', height: '30px', fontSize: '11.5px' }}
                      placeholder="Search snapshot ID or name..."
                      value={snapSearch}
                      onChange={(e) => {
                        setSnapSearch(e.target.value);
                        setSnapTablePage(1);
                      }}
                    />
                    {snapSearch && (
                      <button
                        onClick={() => { setSnapSearch(''); setSnapTablePage(1); }}
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
                      >
                        ×
                      </button>
                    )}
                  </div>

                  {/* From Date */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ fontSize: '11px', color: '#64748b' }}>From:</span>
                    <input
                      type="date"
                      className="form-input"
                      style={{ height: '30px', fontSize: '11.5px', padding: '2px 6px' }}
                      value={snapFromDate}
                      onChange={(e) => {
                        setSnapFromDate(e.target.value);
                        setSnapTablePage(1);
                      }}
                    />
                  </div>

                  {/* To Date */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ fontSize: '11px', color: '#64748b' }}>To:</span>
                    <input
                      type="date"
                      className="form-input"
                      style={{ height: '30px', fontSize: '11.5px', padding: '2px 6px' }}
                      value={snapToDate}
                      onChange={(e) => {
                        setSnapToDate(e.target.value);
                        setSnapTablePage(1);
                      }}
                    />
                  </div>

                  {/* Source Device */}
                  <select
                    className="filter-select"
                    style={{ height: '30px', fontSize: '11.5px' }}
                    value={snapSourceFilter}
                    onChange={(e) => {
                      setSnapSourceFilter(e.target.value);
                      setSnapTablePage(1);
                    }}
                  >
                    <option value="ALL">All Source Devices</option>
                    <option value="Sophos XGS2100">Sophos XGS2100</option>
                    <option value="Manual Upload">Manual Upload</option>
                  </select>

                  {isAnySnapFilterActive && (
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ height: '30px', fontSize: '11px', color: '#dc2626', borderColor: '#fca5a5' }}
                      onClick={handleClearSnapFilters}
                    >
                      Clear Filters
                    </button>
                  )}
                </div>

                <div style={{ fontSize: '11px', color: '#64748b' }}>
                  Page <strong>{snapTablePage}</strong> of <strong>{snapTotalPages}</strong> ({filteredSnapshots.length} matching)
                </div>
              </div>

              {/* Snapshot History Table Body */}
              <div className="panel-body" style={{ padding: '0' }}>
                {filteredSnapshots.length === 0 ? (
                  <div style={{ padding: '30px', textAlign: 'center' }}>
                    <EmptyState
                      title="No Historical Snapshots Match Criteria"
                      description="Adjust your search keyword or date range to see previously saved ARP snapshots."
                    />
                    {isAnySnapFilterActive && (
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ marginTop: '12px' }}
                        onClick={handleClearSnapFilters}
                      >
                        Reset Snapshot Filters
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="table-wrapper">
                    <table className="table" style={{ fontSize: '11.5px' }}>
                      <thead>
                        <tr>
                          <th style={{ width: '55px' }}>ID</th>
                          <th>Extraction / Collection Time</th>
                          <th>Import Time</th>
                          <th>Total Raw</th>
                          <th>Valid MAC</th>
                          <th>Incomplete</th>
                          <th>Source Device</th>
                          <th>Status</th>
                          <th style={{ textAlign: 'right', minWidth: '150px' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedSnapshots.map((s) => {
                          const isSelected = String(s.id) === String(selectedSnapshotId);
                          const incompleteCount = s.invalid_entries_count ?? (s.total_entries - s.entries_with_mac);
                          return (
                            <tr
                              key={s.id}
                              style={{ backgroundColor: isSelected ? '#f0f9ff' : undefined }}
                            >
                              <td className="mono" style={{ fontWeight: 700, color: '#0284c7' }}>
                                #{s.id}
                              </td>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <Clock size={12} style={{ color: '#0284c7' }} />
                                  <span className="mono" style={{ fontWeight: 600 }}>
                                    {formatIndianDateTime(s.imported_at)}
                                  </span>
                                </div>
                              </td>
                              <td>
                                <span className="mono" style={{ color: '#64748b' }}>
                                  {formatIndianDateTime(s.imported_at)}
                                </span>
                              </td>
                              <td className="mono" style={{ fontWeight: 600 }}>
                                {s.total_entries}
                              </td>
                              <td className="mono" style={{ color: '#059669', fontWeight: 600 }}>
                                {s.entries_with_mac}
                              </td>
                              <td className="mono" style={{ color: incompleteCount > 0 ? '#dc2626' : '#64748b' }}>
                                {incompleteCount}
                              </td>
                              <td>
                                <span className="device-type-tag" style={{ fontSize: '10px' }}>
                                  <Shield size={10} /> {s.source_device || 'Sophos XGS2100'}
                                </span>
                              </td>
                              <td>
                                <span className="status-badge online" style={{ fontSize: '10px' }}>
                                  <CheckCircle2 size={10} /> Success
                                </span>
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <div style={{ display: 'inline-flex', gap: '6px' }}>
                                  <button
                                    className="btn btn-primary btn-sm"
                                    style={{ fontSize: '11px', padding: '2px 8px' }}
                                    onClick={() => handleViewSnapshotDetails(s)}
                                    title={`View and filter saved entries from Snapshot #${s.id}`}
                                  >
                                    <Eye size={11} /> View Details
                                  </button>
                                  <button
                                    className="btn btn-secondary btn-sm"
                                    style={{ fontSize: '11px', padding: '2px 7px' }}
                                    onClick={() => handleOpenCompare(s.id)}
                                    title="Compare with another snapshot"
                                  >
                                    <Layers size={11} /> Compare
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Pagination Controls */}
                {snapTotalPages > 1 && (
                  <div
                    style={{
                      padding: '10px 16px',
                      borderTop: '1px solid #e2e8f0',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      backgroundColor: '#f8fafc',
                    }}
                  >
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={snapTablePage <= 1}
                      onClick={() => setSnapTablePage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft size={13} /> Previous
                    </button>

                    <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                      Page <strong>{snapTablePage}</strong> of <strong>{snapTotalPages}</strong> ({filteredSnapshots.length} snapshots)
                    </span>

                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={snapTablePage >= snapTotalPages}
                      onClick={() => setSnapTablePage((p) => Math.min(snapTotalPages, p + 1))}
                    >
                      Next <ChevronRight size={13} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ---------------------------------------------------- */}
          {/* SUB-VIEW B: SPECIFIC SNAPSHOT DETAILS & ENTRIES */}
          {/* ---------------------------------------------------- */}
          {snapHistoryView === 'DETAILS' && (
            <div>
              {/* Back to Table Action Strip */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setSnapHistoryView('TABLE')}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <ChevronLeft size={13} />
                  <span>Back to All Snapshots History</span>
                </button>

                {snapshots.length > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '11px', color: '#64748b' }}>Switch Snapshot:</span>
                    <select
                      className="filter-select"
                      value={selectedSnapshotId}
                      onChange={(e) => setSelectedSnapshotId(e.target.value)}
                      style={{ fontSize: '11.5px', height: '28px' }}
                    >
                      {snapshots.map((s) => (
                        <option key={s.id} value={s.id}>
                          #{s.id} — {s.snapshot_name} ({formatIndianDate(s.imported_at)})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Snapshot Header Card with Exact Indian Timestamps */}
              {activeSnapshot && (
                <div
                  style={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '4px',
                    padding: '12px 16px',
                    marginBottom: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div
                      style={{
                        width: '38px',
                        height: '38px',
                        borderRadius: '4px',
                        backgroundColor: '#e0f2fe',
                        color: '#0284c7',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                      }}
                    >
                      <Radio size={20} />
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>
                          Snapshot #{activeSnapshot.id}: {activeSnapshot.snapshot_name}
                        </span>
                        <span className="device-type-tag">
                          <Shield size={11} /> {activeSnapshot.source_device || 'Sophos XGS2100'}
                        </span>
                        <span className="status-badge online" style={{ fontSize: '10px' }}>
                          <CheckCircle2 size={10} /> Verified
                        </span>
                      </div>
                      <div style={{ fontSize: '11.5px', color: '#475569', marginTop: '3px' }}>
                        Collection Timestamp:{' '}
                        <strong className="mono" style={{ color: '#0284c7' }}>
                          {formatIndianDateTime(activeSnapshot.imported_at)}
                        </strong>
                        {' • '}
                        Import Timestamp:{' '}
                        <span className="mono" style={{ color: '#64748b' }}>
                          {formatIndianDateTime(activeSnapshot.imported_at)}
                        </span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                        <span style={{ color: '#0f172a', fontWeight: 600 }}>{activeSnapshot.total_entries} Total Entries</span>
                        {' • '}
                        <span style={{ color: '#059669', fontWeight: 600 }}>{activeSnapshot.entries_with_mac} Valid MACs</span>
                        {' • '}
                        <span style={{ color: '#dc2626' }}>
                          {activeSnapshot.invalid_entries_count ?? (activeSnapshot.total_entries - activeSnapshot.entries_with_mac)} Incomplete (No MAC)
                        </span>
                        {activeSnapshot.matched_inventory_count !== undefined && (
                          <>
                            {' • '}
                            <span style={{ color: '#8b5cf6', fontWeight: 600 }}>
                              {activeSnapshot.matched_inventory_count} Matched to Inventory
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleOpenCompare(activeSnapshot.id)}
                      style={{ fontSize: '11px' }}
                    >
                      <Layers size={11} /> Compare with Another
                    </button>
                  </div>
                </div>
              )}

              {/* Raw Snapshot Entries Table Panel */}
              <div className="panel">
                {/* Quick Filter Pills Row for Raw Snapshot Entries */}
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#475569', marginRight: '4px' }}>
                      Filter Entries:
                    </span>
                    <button
                      className={`btn btn-sm ${rawQuickFilter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ fontSize: '11px', padding: '2px 9px' }}
                      onClick={() => setRawQuickFilter('ALL')}
                    >
                      All ({rawSnapshotData.summary?.total_entries || activeSnapshot?.total_entries || 0})
                    </button>
                    <button
                      className={`btn btn-sm ${rawQuickFilter === 'MATCHED' ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ fontSize: '11px', padding: '2px 9px', color: rawQuickFilter === 'MATCHED' ? '#fff' : '#10b981' }}
                      onClick={() => setRawQuickFilter('MATCHED')}
                    >
                      Matched ({rawSnapshotData.summary?.matched || 0})
                    </button>
                    <button
                      className={`btn btn-sm ${rawQuickFilter === 'UNMATCHED' ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ fontSize: '11px', padding: '2px 9px', color: rawQuickFilter === 'UNMATCHED' ? '#fff' : '#0284c7' }}
                      onClick={() => setRawQuickFilter('UNMATCHED')}
                    >
                      Unmatched ({rawSnapshotData.summary?.unmatched || 0})
                    </button>
                    <button
                      className={`btn btn-sm ${rawQuickFilter === 'NO_MAC' ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ fontSize: '11px', padding: '2px 9px', color: rawQuickFilter === 'NO_MAC' ? '#fff' : '#dc2626' }}
                      onClick={() => setRawQuickFilter('NO_MAC')}
                    >
                      Incomplete / No MAC ({rawSnapshotData.summary?.no_mac_failed || 0})
                    </button>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {isAnyRawFilterActive && (
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ fontSize: '11px', padding: '3px 8px', color: '#dc2626', borderColor: '#fca5a5' }}
                        onClick={handleClearRawFilters}
                      >
                        Clear Filters
                      </button>
                    )}
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ fontSize: '11px', padding: '3px 8px' }}
                      onClick={fetchRawSnapshotEntries}
                    >
                      <RefreshCw size={11} className={isRawLoading ? 'spin' : ''} /> Refresh Entries
                    </button>
                  </div>
                </div>

                <div className="filter-toolbar">
                  <div className="filter-group">
                    <div style={{ position: 'relative', width: '240px' }}>
                      <Search
                        size={13}
                        style={{ position: 'absolute', left: '8px', top: '9px', color: '#94a3b8' }}
                      />
                      <input
                        type="text"
                        className="form-input"
                        style={{ paddingLeft: '28px', height: '30px', fontSize: '11.5px' }}
                        placeholder="Search IP, MAC, location..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                      />
                      {searchTerm && (
                        <button
                          onClick={() => setSearchTerm('')}
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

                    <select
                      className="filter-select"
                      value={rawIfaceFilter}
                      onChange={(e) => setRawIfaceFilter(e.target.value)}
                    >
                      <option value="ALL">All Firewall Ports</option>
                      <option value="Port1">Port1 (Internal LAN)</option>
                      <option value="Port3">Port3 (WLAN / Relay)</option>
                      <option value="Port2">Port2 (WAN / Gateway)</option>
                      <option value="Port5">Port5 (DMZ)</option>
                    </select>

                    <select
                      className="filter-select"
                      value={rawArpStateFilter}
                      onChange={(e) => setRawArpStateFilter(e.target.value)}
                    >
                      <option value="ALL">All ARP States</option>
                      <option value="Complete">Complete (Active)</option>
                      <option value="Incomplete">Incomplete (No MAC)</option>
                      <option value="REACHABLE">REACHABLE</option>
                      <option value="STALE">STALE</option>
                      <option value="FAILED">FAILED</option>
                    </select>
                  </div>

                  <div style={{ fontSize: '11px', color: '#64748b' }}>
                    Showing <strong>{rawSnapshotData.items?.length || 0}</strong> raw neighbor cache rows
                  </div>
                </div>

                <div className="panel-body" style={{ padding: '0' }}>
                  {isRawLoading ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
                      <RefreshCw size={24} className="spin" style={{ margin: '0 auto 8px' }} />
                      <div>Loading snapshot entries...</div>
                    </div>
                  ) : rawError ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: '#b91c1c' }}>
                      <AlertTriangle size={28} style={{ margin: '0 auto 8px', color: '#dc2626' }} />
                      <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>
                        Failed to Load Snapshot Entries
                      </div>
                      <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '12px' }}>
                        {rawError}
                      </div>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={fetchRawSnapshotEntries}
                      >
                        <RefreshCw size={12} /> Retry Loading
                      </button>
                    </div>
                  ) : (rawSnapshotData.items || []).length === 0 ? (
                    <div style={{ padding: '30px', textAlign: 'center' }}>
                      <EmptyState
                        title="No Snapshot Entries Match Filters"
                        description="Adjust your search criteria or switch to another filter preset."
                      />
                      {isAnyRawFilterActive && (
                        <button
                          className="btn btn-secondary btn-sm"
                          style={{ marginTop: '12px' }}
                          onClick={handleClearRawFilters}
                        >
                          Clear All Filters
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="table-wrapper">
                      <table className="table" style={{ fontSize: '11.5px' }}>
                        <thead>
                          <tr>
                            <th style={{ width: '45px' }}>ID</th>
                            <th>IP Address</th>
                            <th>MAC Address</th>
                            <th>Port</th>
                            <th>ARP State</th>
                            <th>Inventory Correlation</th>
                            <th>Matched Device</th>
                            <th>Department / Cabin</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(rawSnapshotData.items || []).map((entry) => (
                            <tr key={entry.id} className={!entry.has_mac ? 'row-offline' : ''}>
                              <td className="mono" style={{ color: '#64748b' }}>#{entry.id}</td>
                              <td className="mono" style={{ fontWeight: 600, color: '#0284c7' }}>{entry.ip_address}</td>
                              <td className="mono" style={{ color: entry.mac_address ? '#0f172a' : '#dc2626' }}>
                                {entry.mac_address || <em>Incomplete (No MAC)</em>}
                              </td>
                              <td className="mono">{entry.interface}</td>
                              <td><ArpStateBadge state={entry.arp_state} /></td>
                              <td>
                                {entry.match_status === 'matched' ? (
                                  <span className="status-badge online" style={{ fontSize: '10px' }}>
                                    <CheckCircle2 size={10} /> Matched
                                  </span>
                                ) : entry.match_status === 'no_mac' ? (
                                  <span className="status-badge offline" style={{ fontSize: '10px' }}>
                                    <AlertTriangle size={10} /> No MAC
                                  </span>
                                ) : (
                                  <span className="status-badge warning" style={{ fontSize: '10px' }}>
                                    <Radio size={10} /> Unmatched
                                  </span>
                                )}
                              </td>
                              <td style={{ fontWeight: 600 }}>{entry.inventory_device_name || '—'}</td>
                              <td style={{ fontSize: '11px', color: '#64748b' }}>{entry.inventory_location || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================== */}
      {/* MODAL: DIRECT DATABASE EDITING & NODE PROMOTION */}
      {/* ========================================================== */}
      {editingDevice && (
        <Modal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          title={`Edit Discovered Device: ${editingDevice.ip_address}`}
          maxWidth={580}
        >
          {/* Read-Only Observed Network Telemetry Strip (Protected from Manual Changes) */}
          <div
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '4px',
              padding: '10px 14px',
              marginBottom: '16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10.5px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '8px' }}>
              <Lock size={12} style={{ color: '#0284c7' }} />
              <span>Observed Network Telemetry (Read-Only / Protected)</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '11.5px' }}>
              <div>
                <span style={{ color: '#64748b' }}>IP Address: </span>
                <strong className="mono" style={{ color: '#0284c7' }}>{editingDevice.ip_address}</strong>
              </div>
              <div>
                <span style={{ color: '#64748b' }}>MAC Address: </span>
                <strong className="mono">{editingDevice.mac_address || '—'}</strong>
              </div>
              <div>
                <span style={{ color: '#64748b' }}>Firewall Interface: </span>
                <strong className="mono">{editingDevice.interface}</strong>
              </div>
              <div>
                <span style={{ color: '#64748b' }}>ARP State: </span>
                <ArpStateBadge state={editingDevice.arp_state} />
              </div>
              <div>
                <span style={{ color: '#64748b' }}>Live Ping Status: </span>
                <StatusBadge status={editingDevice.last_ping_status || 'unknown'} />
              </div>
              <div>
                <span style={{ color: '#64748b' }}>Last Probe: </span>
                <span>{editingDevice.last_ping_at ? new Date(editingDevice.last_ping_at).toLocaleTimeString() : 'Pending'}</span>
              </div>
            </div>
          </div>

          {/* Editable Identification Form */}
          <form onSubmit={handleSaveEdit}>
            <div className="form-group" style={{ marginBottom: '12px' }}>
              <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>
                Device / Station Name
              </label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. DRM Finance Section - PC 04"
                value={editForm.custom_name}
                onChange={(e) => setEditForm({ ...editForm, custom_name: e.target.value })}
              />
              <span className="form-hint">Assign a descriptive identity for this discovered IP address in PostgreSQL.</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>
                  Device Type
                </label>
                <select
                  className="form-select"
                  value={editForm.device_type}
                  onChange={(e) => setEditForm({ ...editForm, device_type: e.target.value })}
                >
                  <option value="PC">PC / Workstation</option>
                  <option value="Printer">Network Printer</option>
                  <option value="Server">Server</option>
                  <option value="Access Point">Wireless AP</option>
                  <option value="Switch">Managed Switch</option>
                  <option value="CCTV Camera">CCTV Camera</option>
                  <option value="IP Phone">IP Phone</option>
                  <option value="Gateway">Router / Gateway</option>
                  <option value="Other">Other Device</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>
                  Department / Section
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Accounts, S&T, Operating"
                  value={editForm.department}
                  onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}
                />
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: '12px' }}>
              <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>
                Building / Room Location
              </label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. DRM Building, 1st Floor, Room 104, Desk 2"
                value={editForm.building_location}
                onChange={(e) => setEditForm({ ...editForm, building_location: e.target.value })}
              />
            </div>

            <div className="form-group" style={{ marginBottom: '14px' }}>
              <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>
                Notes / Audit Remarks
              </label>
              <textarea
                className="form-input"
                style={{ height: '65px', resize: 'vertical' }}
                placeholder="e.g. Verified during site walkthrough..."
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
              />
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '18px',
                padding: '8px 12px',
                backgroundColor: '#f8fafc',
                borderRadius: '4px',
                border: '1px solid #e2e8f0',
              }}
            >
              <input
                type="checkbox"
                id="is_monitored_cb"
                checked={editForm.is_monitored}
                onChange={(e) => setEditForm({ ...editForm, is_monitored: e.target.checked })}
              />
              <label htmlFor="is_monitored_cb" style={{ fontSize: '12px', fontWeight: 500, cursor: 'pointer' }}>
                Enable Periodic ICMP Ping Monitoring for this Discovered IP
              </label>
            </div>

            {/* Modal Actions Footer */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: '12px',
                borderTop: '1px solid #e2e8f0',
              }}
            >
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleSingleProbe(editingDevice.id)}
                  disabled={isProbingSingle}
                >
                  <Activity size={12} className={isProbingSingle ? 'spin' : ''} />
                  <span>{isProbingSingle ? 'Pinging...' : 'Ping Now'}</span>
                </button>

                {!editingDevice.registered_device_id && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => handlePromoteDevice(editingDevice.id, editingDevice.ip_address)}
                    disabled={isRegistering}
                    title="Promote this discovered device to monitored devices registry"
                  >
                    <PlusCircle size={12} />
                    <span>{isRegistering ? 'Promoting...' : 'Promote to Node'}</span>
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setIsEditModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={isSavingEdit}
                >
                  <Check size={12} />
                  <span>{isSavingEdit ? 'Saving to PostgreSQL...' : 'Save to PostgreSQL'}</span>
                </button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {/* Snapshot Import Modal */}
      {isImportModalOpen && (
        <Modal
          isOpen={isImportModalOpen}
          onClose={() => setIsImportModalOpen(false)}
          title="Import Sophos ARP Snapshot"
          maxWidth={520}
        >
          <form onSubmit={handleImportSubmit}>
            <div className="form-group" style={{ marginBottom: '12px' }}>
              <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>
                Snapshot Label
              </label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Sophos Mid-Day Export"
                value={snapshotFileName}
                onChange={(e) => setSnapshotFileName(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ marginBottom: '14px' }}>
              <label className="form-label" style={{ fontSize: '12px', fontWeight: 600 }}>
                Snapshot Content (JSON or CSV)
              </label>
              <textarea
                className="form-input mono"
                style={{ height: '140px', fontSize: '11px', resize: 'vertical' }}
                placeholder="Leave blank to automatically import canonical sophos-arp-test/arp-snapshot.json..."
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
              />
              <span className="form-hint">
                Leaving this empty will import the canonical 273-entry snapshot from sophos-arp-test.
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setIsImportModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={isSubmittingImport}
              >
                <UploadCloud size={13} />
                <span>{isSubmittingImport ? 'Importing...' : 'Import & Sync'}</span>
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Snapshot Comparison Modal */}
      {isCompareModalOpen && (
        <Modal
          isOpen={isCompareModalOpen}
          onClose={() => setIsCompareModalOpen(false)}
          title="Sophos ARP Snapshot Delta Comparison"
          maxWidth={760}
        >
          <div>
            <div
              style={{
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '4px',
                padding: '12px 14px',
                marginBottom: '14px',
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '12px', alignItems: 'flex-end' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '11.5px', fontWeight: 600 }}>
                    Baseline Snapshot (Older)
                  </label>
                  <select
                    className="filter-select"
                    style={{ width: '100%', height: '32px', fontSize: '11.5px' }}
                    value={compareBaseId}
                    onChange={(e) => setCompareBaseId(e.target.value)}
                  >
                    {snapshots.map((s) => (
                      <option key={s.id} value={s.id}>
                        #{s.id} — {s.snapshot_name} ({formatIndianDate(s.imported_at)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: '11.5px', fontWeight: 600 }}>
                    Target Snapshot (Newer)
                  </label>
                  <select
                    className="filter-select"
                    style={{ width: '100%', height: '32px', fontSize: '11.5px' }}
                    value={compareTargetId}
                    onChange={(e) => setCompareTargetId(e.target.value)}
                  >
                    {snapshots.map((s) => (
                      <option key={s.id} value={s.id}>
                        #{s.id} — {s.snapshot_name} ({formatIndianDate(s.imported_at)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <button
                    className="btn btn-primary btn-sm"
                    style={{ height: '32px', display: 'flex', alignItems: 'center', gap: '6px' }}
                    onClick={handleRunCompare}
                    disabled={isComparing || !compareBaseId || !compareTargetId || compareBaseId === compareTargetId}
                  >
                    <Layers size={13} className={isComparing ? 'spin' : ''} />
                    <span>{isComparing ? 'Comparing...' : 'Run Diff'}</span>
                  </button>
                </div>
              </div>
              {compareBaseId === compareTargetId && (
                <div style={{ fontSize: '11px', color: '#dc2626', marginTop: '6px' }}>
                  Please select two distinct snapshots to calculate delta comparison.
                </div>
              )}
            </div>

            {compareError && (
              <div
                style={{
                  backgroundColor: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '4px',
                  padding: '10px 14px',
                  marginBottom: '14px',
                  color: '#b91c1c',
                  fontSize: '12px',
                }}
              >
                <strong>Comparison Error:</strong> {compareError}
              </div>
            )}

            {compareDiff && (
              <div>
                {/* 4 Delta Metric Tiles */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '14px' }}>
                  <div style={{ padding: '8px 10px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '4px' }}>
                    <div style={{ fontSize: '11px', color: '#166534', fontWeight: 600 }}>New MACs</div>
                    <div style={{ fontSize: '18px', fontWeight: 700, color: '#15803d' }}>
                      {(compareDiff.newMacs || compareDiff.new_macs)?.length ?? compareDiff.newMacCount ?? 0}
                    </div>
                    <div style={{ fontSize: '10px', color: '#166534' }}>Appeared in target</div>
                  </div>

                  <div style={{ padding: '8px 10px', backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '4px' }}>
                    <div style={{ fontSize: '11px', color: '#b45309', fontWeight: 600 }}>Changed IP-MAC</div>
                    <div style={{ fontSize: '18px', fontWeight: 700, color: '#b45309' }}>
                      {(compareDiff.changedMappings || compareDiff.changed_mappings)?.length ?? compareDiff.changedMappingCount ?? 0}
                    </div>
                    <div style={{ fontSize: '10px', color: '#92400e' }}>Hardware swap / roam</div>
                  </div>

                  <div style={{ padding: '8px 10px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '4px' }}>
                    <div style={{ fontSize: '11px', color: '#b91c1c', fontWeight: 600 }}>Not in Target</div>
                    <div style={{ fontSize: '18px', fontWeight: 700, color: '#dc2626' }}>
                      {(compareDiff.unobserved || compareDiff.unobserved_devices)?.length ?? compareDiff.unobservedCount ?? 0}
                    </div>
                    <div style={{ fontSize: '10px', color: '#991b1b' }}>Absent from target poll</div>
                  </div>

                  <div style={{ padding: '8px 10px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '4px' }}>
                    <div style={{ fontSize: '11px', color: '#475569', fontWeight: 600 }}>Unchanged</div>
                    <div style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                      {compareDiff.unchangedCount ?? compareDiff.unchanged_count ?? '—'}
                    </div>
                    <div style={{ fontSize: '10px', color: '#64748b' }}>Identical mapping</div>
                  </div>
                </div>

                {/* Diff Tables */}
                <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
                  {(compareDiff.newMacs || compareDiff.new_macs)?.length > 0 && (
                    <div style={{ marginBottom: '14px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: '#166534', marginBottom: '6px' }}>
                        Newly Appeared MAC Addresses ({(compareDiff.newMacs || compareDiff.new_macs).length}):
                      </div>
                      <table className="table" style={{ fontSize: '11px' }}>
                        <thead>
                          <tr>
                            <th>IP Address</th>
                            <th>MAC Address</th>
                            <th>Interface</th>
                            <th>Vendor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(compareDiff.newMacs || compareDiff.new_macs).slice(0, 15).map((d, i) => (
                            <tr key={i}>
                              <td className="mono" style={{ color: '#0284c7', fontWeight: 600 }}>{d.ip_address}</td>
                              <td className="mono">{d.mac_address}</td>
                              <td className="mono">{d.interface}</td>
                              <td>{getVendorFromMac(d.mac_address) || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {(compareDiff.changedMappings || compareDiff.changed_mappings)?.length > 0 && (
                    <div style={{ marginBottom: '14px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: '#b45309', marginBottom: '6px' }}>
                        Changed IP-to-MAC Mappings ({(compareDiff.changedMappings || compareDiff.changed_mappings).length}):
                      </div>
                      <table className="table" style={{ fontSize: '11px' }}>
                        <thead>
                          <tr>
                            <th>IP Address</th>
                            <th>Baseline MAC</th>
                            <th>Target MAC</th>
                            <th>Interface</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(compareDiff.changedMappings || compareDiff.changed_mappings).slice(0, 15).map((d, i) => (
                            <tr key={i}>
                              <td className="mono" style={{ color: '#0284c7', fontWeight: 600 }}>{d.ip_address}</td>
                              <td className="mono" style={{ color: '#dc2626' }}>{d.previous_mac || d.old_mac}</td>
                              <td className="mono" style={{ color: '#15803d', fontWeight: 600 }}>{d.current_mac || d.new_mac}</td>
                              <td className="mono">{d.current_interface || d.interface}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {(compareDiff.unobserved || compareDiff.unobserved_devices)?.length > 0 && (
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: '#b91c1c', marginBottom: '6px' }}>
                        Devices Not Observed in Target Poll ({(compareDiff.unobserved || compareDiff.unobserved_devices).length}):
                      </div>
                      <table className="table" style={{ fontSize: '11px' }}>
                        <thead>
                          <tr>
                            <th>IP Address</th>
                            <th>MAC Address</th>
                            <th>Interface</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(compareDiff.unobserved || compareDiff.unobserved_devices).slice(0, 15).map((d, i) => (
                            <tr key={i}>
                              <td className="mono">{d.ip_address}</td>
                              <td className="mono">{d.mac_address}</td>
                              <td className="mono">{d.interface}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {((compareDiff.newMacs || compareDiff.new_macs)?.length || 0) === 0 &&
                   ((compareDiff.changedMappings || compareDiff.changed_mappings)?.length || 0) === 0 &&
                   ((compareDiff.unobserved || compareDiff.unobserved_devices)?.length || 0) === 0 && (
                    <div style={{ padding: '20px', textAlign: 'center', color: '#059669', fontSize: '12px' }}>
                      ✓ Zero deltas detected: Target snapshot is identical to Baseline snapshot.
                    </div>
                  )}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px', paddingTop: '10px', borderTop: '1px solid #e2e8f0' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setIsCompareModalOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default ArpDiscovery;
