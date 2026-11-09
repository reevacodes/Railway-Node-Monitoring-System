import React, { useState, useEffect, useMemo } from 'react';
import { useNetwork } from '../context/NetworkContext';
import api from '../services/api';
import ArpStateBadge from '../components/common/ArpStateBadge';
import StatusBadge from '../components/common/StatusBadge';
import LatencyIndicator from '../components/common/LatencyIndicator';
import EmptyState from '../components/common/EmptyState';
import Drawer from '../components/common/Drawer';
import DeviceIdentifier from '../components/common/DeviceIdentifier';
import { formatIndianDate, formatIndianDateTime } from '../utils/formatters';
import {
  Layers,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  Radio,
  RefreshCw,
  Eye,
  Shield,
  MapPin,
  Cpu,
  ArrowUpDown,
  Download,
  UploadCloud,
  ExternalLink,
  Zap,
  AlertOctagon,
} from 'lucide-react';

// OUI Vendor Intelligence lookup for physical Layer-2 NICs
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

export const MacInventory = () => {
  const { globalSearch, setGlobalSearch, showNotification } = useNetwork();
  const [inventoryData, setInventoryData] = useState({
    items: [],
    summary: { total_inventory: 0, matched_in_arp: 0, unobserved: 0, multi_mac_count: 0 },
    filters: { departments: [], interfaces: [], arpStates: [] },
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  // Quick Filter Pills: 'ALL' | 'ONLINE' | 'OFFLINE' | 'RECENT' | 'DUAL_NIC' | 'MISMATCH'
  const [quickFilter, setQuickFilter] = useState('ALL');

  // Dropdown Filters
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [matchFilter, setMatchFilter] = useState('ALL');
  const [ifaceFilter, setIfaceFilter] = useState('ALL');
  const [arpStateFilter, setArpStateFilter] = useState('ALL');

  // Sorting
  const [sortField, setSortField] = useState('id');
  const [sortDirection, setSortDirection] = useState('asc');

  // Selected item for drawer
  const [selectedItem, setSelectedItem] = useState(null);
  const [itemDetails, setItemDetails] = useState(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  const fetchInventory = async () => {
    setIsLoading(true);
    try {
      const data = await api.getMacInventory({
        department: deptFilter,
        match_status: matchFilter,
        interface: ifaceFilter,
        arp_state: arpStateFilter,
        search: globalSearch,
      });
      setInventoryData(data);
    } catch (err) {
      console.error('Failed to load MAC inventory:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchInventory();
  }, [deptFilter, matchFilter, ifaceFilter, arpStateFilter, globalSearch]);

  const handleSyncInventory = async () => {
    setIsSyncing(true);
    try {
      const res = await api.importMacInventory({});
      showNotification(`MAC Inventory synced successfully (${res.totalInventoryRecords} records).`, 'success');
      await fetchInventory();
    } catch (err) {
      showNotification(err.message || 'Failed to sync inventory', 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleInspect = async (item) => {
    setSelectedItem(item);
    setIsLoadingDetails(true);
    try {
      const details = await api.getMacInventoryItem(item.id);
      setItemDetails(details);
    } catch (err) {
      console.error('Failed to load item details:', err);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Metrics for quick filter counts
  const isRecentItem = (item) => {
    const timestamp = item.created_at || item.discovered_at;
    if (!timestamp) return false;
    const ageHours = (Date.now() - new Date(timestamp).getTime()) / (1000 * 60 * 60);
    return ageHours < 72; // within 3 days
  };

  const onlineCount = useMemo(() => {
    return inventoryData.items.filter((i) => (i.ping_status || '').toLowerCase() === 'online').length;
  }, [inventoryData.items]);

  const offlineCount = useMemo(() => {
    return inventoryData.items.filter((i) => (i.ping_status || '').toLowerCase() === 'offline').length;
  }, [inventoryData.items]);

  const recentCount = useMemo(() => {
    return inventoryData.items.filter(isRecentItem).length;
  }, [inventoryData.items]);

  const dualNicCount = useMemo(() => {
    return inventoryData.items.filter((i) => i.is_multi_mac).length;
  }, [inventoryData.items]);

  const mismatchCount = useMemo(() => {
    return inventoryData.items.filter(
      (i) => i.discovered_ip && i.registered_ip && i.discovered_ip !== i.registered_ip
    ).length;
  }, [inventoryData.items]);

  const uniqueVendorsCount = useMemo(() => {
    const vendors = new Set(inventoryData.items.map((i) => getVendorFromMac(i.mac_address)).filter(Boolean));
    return vendors.size;
  }, [inventoryData.items]);

  // Filter items by active quick filter
  const filteredItems = useMemo(() => {
    return inventoryData.items.filter((item) => {
      if (quickFilter === 'ONLINE') return (item.ping_status || '').toLowerCase() === 'online';
      if (quickFilter === 'OFFLINE') return (item.ping_status || '').toLowerCase() === 'offline';
      if (quickFilter === 'RECENT') return isRecentItem(item);
      if (quickFilter === 'DUAL_NIC') return !!item.is_multi_mac;
      if (quickFilter === 'MISMATCH') {
        return item.discovered_ip && item.registered_ip && item.discovered_ip !== item.registered_ip;
      }
      return true;
    });
  }, [inventoryData.items, quickFilter]);

  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (sortField === 'discovered_ip') {
        valA = a.discovered_ip || '';
        valB = b.discovered_ip || '';
      }

      if (sortField === 'created_at') {
        valA = new Date(a.created_at || 0).getTime();
        valB = new Date(b.created_at || 0).getTime();
        return sortDirection === 'asc' ? valA - valB : valB - valA;
      }

      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredItems, sortField, sortDirection]);

  const { summary } = inventoryData;

  return (
    <div>
      {/* Title Strip */}
      <div className="page-title-strip">
        <div>
          <h1>MAC Inventory & Sophos ARP Correlation</h1>
          <div className="page-subtitle">
            Comprehensive office MAC inventory matched against firewall neighbor-table observations
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleSyncInventory}
            disabled={isSyncing}
            title="Re-synchronize database from data/inventory.csv"
          >
            <RefreshCw size={13} className={isSyncing ? 'spin-icon' : ''} />
            <span>{isSyncing ? 'Syncing...' : 'Sync Inventory CSV'}</span>
          </button>
        </div>
      </div>

      {/* 1. Operational Summary Strip (Differentiated for Layer 2 & Hardware Engineering) */}
      <div className="operational-strip">
        <div className="operational-metric">
          <span className="operational-metric-label">
            <Layers size={13} /> Total Physical NICs
          </span>
          <span className="operational-metric-value">{summary.total_inventory}</span>
          <span className="metric-sub">Layer-2 MAC hardware database</span>
        </div>

        <div className="operational-metric">
          <span className="operational-metric-label" style={{ color: '#0284c7' }}>
            <Cpu size={13} /> Hardware Vendors (OUI)
          </span>
          <span className="operational-metric-value" style={{ color: '#0284c7' }}>
            {uniqueVendorsCount}
          </span>
          <span className="metric-sub">HP, Acer, Intel, Cisco, Realtek</span>
        </div>

        <div className="operational-metric">
          <span className="operational-metric-label" style={{ color: '#059669' }}>
            <CheckCircle2 size={13} /> Online Ping Reachable
          </span>
          <span className="operational-metric-value" style={{ color: '#059669' }}>
            {onlineCount}
          </span>
          <span className="metric-sub">
            {summary.total_inventory > 0 ? Math.round((onlineCount / summary.total_inventory) * 100) : 0}% fleet responsiveness
          </span>
        </div>

        <div className="operational-metric">
          <span className="operational-metric-label" style={{ color: '#d97706' }}>
            <Radio size={13} /> Dual-NIC Workstations
          </span>
          <span className="operational-metric-value" style={{ color: '#d97706' }}>
            {summary.multi_mac_count}
          </span>
          <span className="metric-sub">Ethernet + Wi-Fi multi-homed nodes</span>
        </div>

        <div className="operational-metric">
          <span className="operational-metric-label" style={{ color: mismatchCount > 0 ? '#dc2626' : '#64748b' }}>
            <AlertOctagon size={13} /> IP Discrepancies
          </span>
          <span className="operational-metric-value" style={{ color: mismatchCount > 0 ? '#dc2626' : '#64748b' }}>
            {mismatchCount}
          </span>
          <span className="metric-sub">{mismatchCount > 0 ? 'Discovered IP != Registered' : 'Zero IP drift detected'}</span>
        </div>
      </div>

      {/* Main Panel */}
      <div className="panel">
        {/* Quick Filter Bar (Online, Offline, Recently Added, Dual-NIC, Mismatch) */}
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
              Quick Filters:
            </span>
            <button
              className={`btn btn-sm ${quickFilter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '11px', padding: '2px 9px' }}
              onClick={() => setQuickFilter('ALL')}
            >
              All Assets ({inventoryData.items.length})
            </button>
            <button
              className={`btn btn-sm ${quickFilter === 'ONLINE' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '11px', padding: '2px 9px', color: quickFilter === 'ONLINE' ? '#fff' : '#059669' }}
              onClick={() => setQuickFilter('ONLINE')}
            >
              Online ({onlineCount})
            </button>
            <button
              className={`btn btn-sm ${quickFilter === 'OFFLINE' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '11px', padding: '2px 9px', color: quickFilter === 'OFFLINE' ? '#fff' : '#dc2626' }}
              onClick={() => setQuickFilter('OFFLINE')}
            >
              Offline ({offlineCount})
            </button>
            <button
              className={`btn btn-sm ${quickFilter === 'RECENT' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '11px', padding: '2px 9px', color: quickFilter === 'RECENT' ? '#fff' : '#8b5cf6' }}
              onClick={() => setQuickFilter('RECENT')}
            >
              Recently Added ({recentCount})
            </button>
            <button
              className={`btn btn-sm ${quickFilter === 'DUAL_NIC' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '11px', padding: '2px 9px', color: quickFilter === 'DUAL_NIC' ? '#fff' : '#d97706' }}
              onClick={() => setQuickFilter('DUAL_NIC')}
            >
              Dual-NIC ({dualNicCount})
            </button>
            {mismatchCount > 0 && (
              <button
                className={`btn btn-sm ${quickFilter === 'MISMATCH' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: '11px', padding: '2px 9px', color: quickFilter === 'MISMATCH' ? '#fff' : '#dc2626' }}
                onClick={() => setQuickFilter('MISMATCH')}
              >
                IP Discrepancy ({mismatchCount})
              </button>
            )}
          </div>

          <div style={{ fontSize: '11px', color: '#64748b' }}>
            Showing <strong>{sortedItems.length}</strong> of <strong>{inventoryData.items.length}</strong> MAC entries
          </div>
        </div>

        {/* Dropdown Filter Toolbar */}
        <div className="filter-toolbar">
          <div className="filter-group">
            {/* Search Input */}
            <div style={{ position: 'relative', width: '230px' }}>
              <Search
                size={13}
                style={{ position: 'absolute', left: '8px', top: '9px', color: '#94a3b8' }}
              />
              <input
                type="text"
                className="form-input"
                style={{ paddingLeft: '28px', height: '30px', fontSize: '11.5px' }}
                placeholder="Search MAC, vendor, room, IP..."
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
              />
            </div>

            {/* Department / Location Filter */}
            <select
              className="filter-select"
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
            >
              <option value="ALL">All Departments / Cabins ({inventoryData.filters.departments.length})</option>
              {inventoryData.filters.departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            {/* Match Status Filter */}
            <select
              className="filter-select"
              value={matchFilter}
              onChange={(e) => setMatchFilter(e.target.value)}
            >
              <option value="ALL">All Discovery States</option>
              <option value="matched">Matched in ARP Snapshot ({summary.matched_in_arp})</option>
              <option value="unobserved">Not in ARP Snapshot ({summary.unobserved})</option>
            </select>

            {/* Firewall Interface Filter */}
            <select
              className="filter-select"
              value={ifaceFilter}
              onChange={(e) => setIfaceFilter(e.target.value)}
            >
              <option value="ALL">All Firewall Interfaces</option>
              {inventoryData.filters.interfaces.map((iface) => (
                <option key={iface} value={iface}>
                  {iface}
                </option>
              ))}
            </select>

            {/* ARP State Filter */}
            <select
              className="filter-select"
              value={arpStateFilter}
              onChange={(e) => setArpStateFilter(e.target.value)}
            >
              <option value="ALL">All ARP States</option>
              {inventoryData.filters.arpStates.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Inventory Data Table */}
        <div className="panel-body" style={{ padding: '0' }}>
          {sortedItems.length === 0 ? (
            <EmptyState
              title="No Inventory Assets Found"
              description={
                inventoryData.summary.total_inventory === 0
                  ? 'Click "Sync Inventory CSV" to import the office inventory records.'
                  : 'No records match the applied search or filter criteria.'
              }
              action={
                inventoryData.summary.total_inventory === 0 ? (
                  <button className="btn btn-primary btn-sm" onClick={handleSyncInventory}>
                    Sync data/inventory.csv
                  </button>
                ) : (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setGlobalSearch('');
                      setDeptFilter('ALL');
                      setMatchFilter('ALL');
                      setIfaceFilter('ALL');
                      setArpStateFilter('ALL');
                    }}
                  >
                    Reset Filters
                  </button>
                )
              }
            />
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th onClick={() => handleSort('id')} style={{ cursor: 'pointer', width: '45px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                        ID <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th onClick={() => handleSort('mac_address')} style={{ cursor: 'pointer' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                        MAC & Vendor OUI <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th onClick={() => handleSort('device_name')} style={{ cursor: 'pointer' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                        Asset / Type <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th onClick={() => handleSort('department_location')} style={{ cursor: 'pointer' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                        <MapPin size={11} style={{ color: '#059669' }} />
                        <span>Department / Cabin</span>
                        <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th onClick={() => handleSort('discovered_ip')} style={{ cursor: 'pointer' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                        <span>Discovered IP (Sophos)</span>
                        <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th>Firewall Port</th>
                    <th>ARP State</th>
                    <th>Match State</th>
                    <th>Registered IP</th>
                    <th>Ping State</th>
                    <th onClick={() => handleSort('created_at')} style={{ cursor: 'pointer' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                        <Clock size={11} /> Added <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th style={{ textAlign: 'right', width: '60px' }}>Inspect</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedItems.map((item) => {
                    const isMatched = item.match_status === 'matched';
                    const hasIpMismatch = item.discovered_ip && item.registered_ip && item.discovered_ip !== item.registered_ip;
                    const vendor = getVendorFromMac(item.mac_address);
                    return (
                      <tr
                        key={item.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => handleInspect(item)}
                        className={hasIpMismatch ? 'row-offline' : ''}
                      >
                        <td className="mono" style={{ color: '#64748b' }}>
                          #{item.id}
                        </td>
                        {/* MAC Address & OUI Vendor */}
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span className="mono" style={{ fontWeight: 600, color: '#0f172a' }}>
                                {item.mac_address}
                              </span>
                              {item.is_multi_mac && (
                                <span
                                  className="status-badge warning"
                                  style={{ fontSize: '9.5px', padding: '1px 4px' }}
                                  title="Device has multiple physical NICs in office inventory"
                                >
                                  Dual-NIC
                                </span>
                              )}
                            </div>
                            {vendor && (
                              <span
                                style={{
                                  fontSize: '10px',
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
                        {/* Device Name */}
                        <td>
                          <DeviceIdentifier
                            name={item.device_name}
                            contactPerson={item.contact_person}
                            contactPhone={item.contact_phone}
                            extraBadge={item.device_type ? <span style={{ fontSize: '10.5px', color: '#64748b' }}>({item.device_type})</span> : null}
                          />
                        </td>
                        {/* Department / Cabin */}
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <span style={{ fontWeight: 500, color: '#1e293b' }}>
                              {item.department_location}
                            </span>
                          </div>
                        </td>
                        {/* Discovered IP (Sophos) */}
                        <td className="mono" style={{ fontWeight: 600, color: isMatched ? '#0284c7' : '#94a3b8' }}>
                          {item.discovered_ip || 'Not in snapshot'}
                        </td>
                        {/* Firewall Interface */}
                        <td>
                          {item.discovered_interface ? (
                            <span className="mono" style={{ fontSize: '11px', color: '#334155', fontWeight: 500 }}>
                              {item.discovered_interface}
                            </span>
                          ) : (
                            <span style={{ color: '#94a3b8', fontSize: '11px' }}>—</span>
                          )}
                        </td>
                        {/* ARP State */}
                        <td>
                          <ArpStateBadge state={item.arp_state} />
                        </td>
                        {/* Match State */}
                        <td>
                          {isMatched ? (
                            <span className="status-badge online" style={{ fontSize: '10.5px' }}>
                              <CheckCircle2 size={10} /> Matched
                            </span>
                          ) : (
                            <span className="status-badge unknown" style={{ fontSize: '10.5px' }}>
                              <Clock size={10} /> Unobserved
                            </span>
                          )}
                        </td>
                        {/* Registered IP (Separated!) */}
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span className="mono" style={{ fontSize: '11px', color: item.registered_ip ? '#059669' : '#94a3b8' }}>
                              {item.registered_ip || item.expected_ip || 'Unregistered'}
                            </span>
                            {hasIpMismatch && (
                              <span
                                className="status-badge warning"
                                style={{ fontSize: '9px', padding: '0 4px' }}
                                title={`Discovered IP (${item.discovered_ip}) differs from configured static IP (${item.registered_ip})`}
                              >
                                Divergent
                              </span>
                            )}
                          </div>
                        </td>
                        {/* Ping Reachability */}
                        <td>
                          {item.ping_status ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <StatusBadge status={item.ping_status} />
                              {item.ping_status === 'online' && item.ping_latency !== null && (
                                <LatencyIndicator latency={item.ping_latency} />
                              )}
                            </div>
                          ) : (
                            <span style={{ fontSize: '10.5px', color: '#94a3b8' }}>Not probed</span>
                          )}
                        </td>
                        {/* Commissioned / Added Date */}
                        <td style={{ fontSize: '10.5px', color: '#64748b' }}>
                          {item.created_at ? formatIndianDate(item.created_at) : '—'}
                        </td>
                        {/* Action */}
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleInspect(item);
                            }}
                          >
                            <Eye size={12} />
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

      {/* Deep Inspection Drawer */}
      <Drawer
        isOpen={!!selectedItem}
        onClose={() => {
          setSelectedItem(null);
          setItemDetails(null);
        }}
        title={`Asset Telemetry — ${selectedItem?.device_name} (${selectedItem?.mac_address})`}
        width={540}
      >
        {selectedItem && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Top Discovery Match Banner */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 14px',
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '4px',
              }}
            >
              <div>
                <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>
                  Sophos Neighbor Status
                </div>
                <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <ArpStateBadge state={selectedItem.arp_state} />
                  {selectedItem.discovered_ip && (
                    <span className="mono" style={{ fontWeight: 600, color: '#0284c7' }}>
                      {selectedItem.discovered_ip} ({selectedItem.discovered_interface})
                    </span>
                  )}
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>
                  Snapshot Source
                </span>
                <span className="mono" style={{ fontSize: '11.5px', color: '#0f172a', fontWeight: 500 }}>
                  {selectedItem.snapshot_name || 'arp-ipv4-parsed.csv'}
                </span>
              </div>
            </div>

            {/* 1. Hardware Asset Identity */}
            <div>
              <div style={{ fontSize: '11.5px', fontWeight: 600, color: '#334155', marginBottom: '8px' }}>
                Inventory Specifications & Location
              </div>
              <div className="kv-grid">
                <span className="kv-key">Asset Model / Name:</span>
                <span className="kv-value">
                  <DeviceIdentifier
                    name={selectedItem.device_name}
                    contactPerson={selectedItem.contact_person}
                    contactPhone={selectedItem.contact_phone}
                  />
                </span>

                <span className="kv-key">Station / Site:</span>
                <span className="kv-value">{selectedItem.site_station}</span>

                <span className="kv-key">Department / Cabin:</span>
                <span className="kv-value" style={{ fontWeight: 600, color: '#0284c7' }}>
                  {selectedItem.department_location}
                </span>

                <span className="kv-key">Formatted MAC:</span>
                <span className="kv-value mono" style={{ fontWeight: 600 }}>
                  {selectedItem.mac_address}
                </span>

                <span className="kv-key">Normalized MAC:</span>
                <span className="kv-value mono" style={{ color: '#64748b' }}>
                  {selectedItem.normalized_mac}
                </span>

                <span className="kv-key">Raw Spreadsheet Entry:</span>
                <span className="kv-value mono" style={{ fontSize: '10.5px', color: '#475569' }}>
                  {selectedItem.raw_mac_entry || selectedItem.mac_address}
                </span>

                <span className="kv-key">Expected IP (Config):</span>
                <span className="kv-value mono">
                  {selectedItem.expected_ip || <span style={{ color: '#94a3b8' }}>Unspecified in Excel</span>}
                </span>

                <span className="kv-key">Linked Probe Node:</span>
                <span className="kv-value">
                  {selectedItem.linked_device_name ? (
                    <div>
                      <div style={{ color: '#059669', fontWeight: 600 }}>
                        {selectedItem.linked_device_name} ({selectedItem.registered_ip})
                      </div>
                      {selectedItem.contact_person && (
                        <div style={{ fontSize: '11px', color: '#1e293b', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px', marginTop: '2px' }}>
                          <span style={{ color: '#6366f1' }}>👤</span>
                          <span>{selectedItem.contact_person}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <span style={{ color: '#94a3b8' }}>Not linked to ping scheduler</span>
                  )}
                </span>

                <span className="kv-key">Continuous Ping:</span>
                <span className="kv-value">
                  {selectedItem.ping_status ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <StatusBadge status={selectedItem.ping_status} />
                      {selectedItem.ping_status === 'online' && selectedItem.ping_latency !== null && (
                        <LatencyIndicator latency={selectedItem.ping_latency} />
                      )}
                    </div>
                  ) : (
                    <span style={{ color: '#94a3b8' }}>Not polled yet</span>
                  )}
                </span>
              </div>
            </div>

            {/* 2. Multi-MAC Sibling Interfaces */}
            {itemDetails?.multi_mac_siblings && itemDetails.multi_mac_siblings.length > 0 && (
              <div
                style={{
                  backgroundColor: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderRadius: '4px',
                  padding: '12px',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '11.5px', color: '#92400e', marginBottom: '6px' }}>
                  Multi-NIC Host Detected: Sibling Physical Interfaces
                </div>
                <div style={{ fontSize: '11px', color: '#78350f', marginBottom: '8px' }}>
                  This workstation has multiple network interface cards recorded in the office inventory:
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {itemDetails.multi_mac_siblings.map((sib) => (
                    <div
                      key={sib.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '4px 8px',
                        backgroundColor: '#ffffff',
                        border: '1px solid #fef3c7',
                        borderRadius: '3px',
                      }}
                    >
                      <span className="mono" style={{ fontWeight: 600, fontSize: '11px' }}>
                        {sib.mac_address}
                      </span>
                      <span style={{ fontSize: '11px', color: '#64748b' }}>
                        {sib.device_name} ({sib.department_location})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 3. Sophos ARP Discovery Observations */}
            <div>
              <div style={{ fontSize: '11.5px', fontWeight: 600, color: '#334155', marginBottom: '8px' }}>
                Historical Observations in Firewall Snapshots
              </div>

              {isLoadingDetails ? (
                <div style={{ padding: '16px', textAlign: 'center', color: '#64748b' }}>
                  Loading discovery logs...
                </div>
              ) : itemDetails?.discoveries?.length === 0 ? (
                <div style={{ padding: '14px', textAlign: 'center', color: '#94a3b8', fontSize: '11.5px', fontStyle: 'italic', backgroundColor: '#f8fafc', borderRadius: '4px' }}>
                  This MAC address was not observed in the imported Sophos neighbor-table snapshot.
                </div>
              ) : (
                <div className="table-wrapper">
                  <table className="table" style={{ fontSize: '11.5px' }}>
                    <thead>
                      <tr>
                        <th>Snapshot</th>
                        <th>Observed IP</th>
                        <th>Firewall Port</th>
                        <th>State</th>
                        <th>Observed At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itemDetails?.discoveries?.map((d) => (
                        <tr key={d.id}>
                          <td style={{ fontWeight: 500 }}>{d.snapshot_name}</td>
                          <td className="mono" style={{ color: '#0284c7', fontWeight: 600 }}>
                            {d.ip_address}
                          </td>
                          <td className="mono">{d.interface}</td>
                          <td>
                            <ArpStateBadge state={d.arp_state} />
                          </td>
                          <td className="mono" style={{ fontSize: '10.5px' }}>
                            {new Date(d.discovered_at).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
};

export default MacInventory;
