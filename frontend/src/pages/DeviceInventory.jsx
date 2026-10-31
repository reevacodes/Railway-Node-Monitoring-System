import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNetwork } from '../context/NetworkContext';
import StatusBadge from '../components/common/StatusBadge';
import DeviceTypeBadge from '../components/common/DeviceTypeBadge';
import LatencyIndicator from '../components/common/LatencyIndicator';
import { LocationBadge, CompactLocationView } from '../components/common/LocationBadge';
import EmptyState from '../components/common/EmptyState';
import DeviceFormModal from '../components/devices/DeviceFormModal';
import DeviceQuickDrawer from '../components/devices/DeviceQuickDrawer';
import { formatIndianDate } from '../utils/formatters';
import {
  Plus,
  Search,
  Filter,
  Trash2,
  RefreshCw,
  Eye,
  Edit,
  ArrowUpDown,
  MapPin,
  CheckCircle2,
  Cpu,
  Clock,
  Network,
  Server,
  AlertTriangle,
  X,
} from 'lucide-react';

export const DeviceInventory = () => {
  const navigate = useNavigate();
  const {
    devices,
    deviceStatuses,
    removeDevice,
    probeDevice,
    verifyLocation,
    globalSearch,
    setGlobalSearch,
  } = useNetwork();

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [deviceToEdit, setDeviceToEdit] = useState(null);
  const [selectedDevice, setSelectedDevice] = useState(null);

  // Filters
  const [quickFilter, setQuickFilter] = useState('ALL'); // 'ALL' | 'ONLINE' | 'OFFLINE' | 'RECENT'
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [officeFilter, setOfficeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [buildingFilter, setBuildingFilter] = useState('ALL');
  const [verificationFilter, setVerificationFilter] = useState('ALL');

  // Sorting
  const [sortField, setSortField] = useState('id');
  const [sortDirection, setSortDirection] = useState('asc');
  const [probingId, setProbingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  // Operational fleet metrics calculation (unique to Device Inventory)
  const isRecentDevice = (dev) => {
    if (!dev?.created_at) return false;
    const ageHours = (Date.now() - new Date(dev.created_at).getTime()) / (1000 * 60 * 60);
    return ageHours < 72; // Commissioned within last 3 days
  };

  const onlineCount = useMemo(() => {
    return devices.filter((d) => (deviceStatuses[d.id]?.status || '').toLowerCase() === 'online').length;
  }, [devices, deviceStatuses]);

  const offlineCount = useMemo(() => {
    return devices.filter((d) => (deviceStatuses[d.id]?.status || '').toLowerCase() === 'offline').length;
  }, [devices, deviceStatuses]);

  const recentCount = useMemo(() => {
    return devices.filter(isRecentDevice).length;
  }, [devices]);

  const pcCount = useMemo(() => {
    return devices.filter((d) => (d.device_type || '').toLowerCase().includes('pc') || (d.device_type || '').toLowerCase().includes('workstation')).length;
  }, [devices]);

  const infraCount = useMemo(() => {
    return devices.filter((d) => {
      const t = (d.device_type || '').toLowerCase();
      return t.includes('switch') || t.includes('router') || t.includes('access point') || t.includes('gateway');
    }).length;
  }, [devices]);

  const verifiedLocationsCount = useMemo(() => {
    return devices.filter((d) => (d.location_verification || '').toLowerCase() === 'verified').length;
  }, [devices]);

  // Extract unique values for filters
  const uniqueTypes = useMemo(() => {
    return Array.from(new Set(devices.map((d) => d.device_type).filter(Boolean)));
  }, [devices]);

  const uniqueBuildings = useMemo(() => {
    return Array.from(new Set(devices.map((d) => d.building || d.room).filter(Boolean)));
  }, [devices]);

  // Sorting handler
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Filter & Sort Logic
  const filteredDevices = useMemo(() => {
    const rawQuery = (globalSearch || '').trim();
    const query = rawQuery.toLowerCase();
    const cleanQueryMac = query.replace(/[^a-z0-9]/g, '');

    return devices.filter((dev) => {
      // 1. Search Query Match
      if (query) {
        const name = (dev.name || '').toLowerCase();
        const ip = (dev.ip_address || '').toLowerCase();
        const mac = (dev.mac_address || '').toLowerCase();
        const cleanMac = mac.replace(/[^a-z0-9]/g, '');
        const type = (dev.device_type || '').toLowerCase();
        const building = (dev.building || '').toLowerCase();
        const room = (dev.room || '').toLowerCase();
        const floor = (dev.floor || '').toLowerCase();
        const rack = (dev.rack || '').toLowerCase();
        const port = String(dev.port_number || '').toLowerCase();
        const notes = (dev.notes || '').toLowerCase();
        const locNotes = (dev.location_notes || '').toLowerCase();
        const idStr = String(dev.id || '');

        const matchesMac =
          (mac && mac.includes(query)) ||
          (cleanQueryMac.length >= 2 && cleanMac.length >= 2 && cleanMac.includes(cleanQueryMac));

        const matchesId =
          idStr === query ||
          `#${idStr}` === query ||
          `#${idStr}`.startsWith(query);

        const matchesSearch =
          name.includes(query) ||
          ip.includes(query) ||
          matchesMac ||
          matchesId ||
          type.includes(query) ||
          building.includes(query) ||
          room.includes(query) ||
          floor.includes(query) ||
          rack.includes(query) ||
          port.includes(query) ||
          notes.includes(query) ||
          locNotes.includes(query);

        if (!matchesSearch) return false;
      }

      // 2. Hardware Role / Device Type Match
      if (typeFilter !== 'ALL') {
        const filterTypeLower = typeFilter.toLowerCase();
        const devTypeLower = (dev.device_type || '').toLowerCase();
        const matchesType =
          devTypeLower === filterTypeLower ||
          (filterTypeLower === 'pc' && (devTypeLower.includes('pc') || devTypeLower.includes('workstation')));
        if (!matchesType) return false;
      }

      // 2b. Railway Office Division Match
      if (officeFilter !== 'ALL') {
        const devOff = (dev.office || (
          (dev.ip_address && dev.ip_address.startsWith('192.168.41.')) ? 'NIA' :
          (dev.building && dev.building.toLowerCase().includes('control')) ? 'CONTROL' : 'DRM'
        )).toUpperCase();
        if (devOff !== officeFilter) return false;
      }

      // 3. Building / Office Location Match
      if (buildingFilter !== 'ALL') {
        const matchesBuilding = dev.building === buildingFilter || dev.room === buildingFilter;
        if (!matchesBuilding) return false;
      }

      // 4. Reachability Status Match
      const currentStatus = (deviceStatuses[dev.id]?.status || 'unknown').toLowerCase();
      if (statusFilter !== 'ALL') {
        if (currentStatus !== statusFilter.toLowerCase()) return false;
      } else if (quickFilter === 'ONLINE') {
        if (currentStatus !== 'online') return false;
      } else if (quickFilter === 'OFFLINE') {
        if (currentStatus !== 'offline') return false;
      }

      // 5. Quick Filter (Recent)
      if (quickFilter === 'RECENT') {
        if (!isRecentDevice(dev)) return false;
      }

      // 6. Audit / Verification Match
      if (verificationFilter !== 'ALL') {
        const verification = (dev.location_verification || 'unverified').toLowerCase();
        if (verification !== verificationFilter.toLowerCase()) return false;
      }

      return true;
    }).sort((a, b) => {
      if (sortField === 'recent') {
        const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return sortDirection === 'asc' ? timeA - timeB : timeB - timeA;
      }

      let valA = a[sortField];
      let valB = b[sortField];

      if (sortField === 'status') {
        valA = deviceStatuses[a.id]?.status || 'unknown';
        valB = deviceStatuses[b.id]?.status || 'unknown';
      } else if (sortField === 'latency') {
        valA = deviceStatuses[a.id]?.latency_ms ?? 999999;
        valB = deviceStatuses[b.id]?.latency_ms ?? 999999;
      } else if (sortField === 'location') {
        valA = `${a.room || ''} ${a.building || ''} ${a.rack || ''}`;
        valB = `${b.room || ''} ${b.building || ''} ${b.rack || ''}`;
      }

      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [
    devices,
    globalSearch,
    quickFilter,
    typeFilter,
    statusFilter,
    buildingFilter,
    verificationFilter,
    sortField,
    sortDirection,
    deviceStatuses,
  ]);

  // Manual probe action
  const handleProbe = async (e, id) => {
    e.stopPropagation();
    setProbingId(id);
    try {
      await probeDevice(id);
    } finally {
      setProbingId(null);
    }
  };

  // Delete device confirmation
  const handleDelete = async (e, dev) => {
    e.stopPropagation();
    if (window.confirm(`Are you sure you want to remove device "${dev.name}" from railway monitoring?`)) {
      setDeletingId(dev.id);
      try {
        await removeDevice(dev.id, dev.name);
      } finally {
        setDeletingId(null);
      }
    }
  };

  const formatAddedDate = (dateStr) => {
    if (!dateStr) return '—';
    const date = new Date(dateStr);
    const now = new Date();
    const diffHours = (now - date) / (1000 * 60 * 60);
    if (diffHours < 24) return 'Added Today';
    if (diffHours < 48) return 'Added Yesterday';
    return formatIndianDate(date);
  };

  return (
    <div>
      {/* Title Strip & Primary Actions */}
      <div className="page-title-strip">
        <div>
          <h1>Device Inventory</h1>
          <div className="page-subtitle">
            Catalog of all managed railway network nodes, physical locations and switch interfaces
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDeviceToEdit(null);
              setIsAddModalOpen(true);
            }}
          >
            <Plus size={14} /> Register Node
          </button>
        </div>
      </div>

      {/* 1. Fleet & Hardware Infrastructure Metric Strip (Unique to Device Inventory) */}
      <div className="operational-strip" style={{ marginBottom: '14px' }}>
        <div className="operational-metric">
          <span className="operational-metric-label">
            <Server size={13} /> Registered Fleet
          </span>
          <span className="operational-metric-value">{devices.length}</span>
          <span className="metric-sub">Total provisioned hardware nodes</span>
        </div>

        <div className="operational-metric">
          <span className="operational-metric-label" style={{ color: '#0284c7' }}>
            <Cpu size={13} /> Workstations / PCs
          </span>
          <span className="operational-metric-value" style={{ color: '#0284c7' }}>{pcCount}</span>
          <span className="metric-sub">End-user office workstations</span>
        </div>

        <div className="operational-metric">
          <span className="operational-metric-label" style={{ color: '#0891b2' }}>
            <Network size={13} /> Network Hardware
          </span>
          <span className="operational-metric-value" style={{ color: '#0891b2' }}>{infraCount}</span>
          <span className="metric-sub">Routers, switches & access points</span>
        </div>

        <div className="operational-metric">
          <span className="operational-metric-label" style={{ color: '#059669' }}>
            <CheckCircle2 size={13} /> Verified Locations
          </span>
          <span className="operational-metric-value" style={{ color: '#059669' }}>{verifiedLocationsCount}</span>
          <span className="metric-sub">Physically audited by technician</span>
        </div>

        <div className="operational-metric">
          <span className="operational-metric-label" style={{ color: '#8b5cf6' }}>
            <Clock size={13} /> Recently Added
          </span>
          <span className="operational-metric-value" style={{ color: '#8b5cf6' }}>{recentCount}</span>
          <span className="metric-sub">Added in the last 72 hours</span>
        </div>
      </div>

      {/* Main Panel */}
      <div className="panel">
        {/* Quick Filter Pills (All / Online / Offline / Recently Added) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginRight: '4px' }}>
              Quick Filters:
            </span>
            <button
              className={`btn btn-sm ${quickFilter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '11px', padding: '3px 9px' }}
              onClick={() => { setQuickFilter('ALL'); setStatusFilter('ALL'); }}
            >
              All Nodes ({devices.length})
            </button>
            <button
              className={`btn btn-sm ${quickFilter === 'ONLINE' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '11px', padding: '3px 9px', color: quickFilter === 'ONLINE' ? '#ffffff' : '#059669', borderColor: '#a7f3d0' }}
              onClick={() => { setQuickFilter('ONLINE'); setStatusFilter('online'); }}
            >
              <CheckCircle2 size={12} style={{ marginRight: '3px' }} /> Online ({onlineCount})
            </button>
            <button
              className={`btn btn-sm ${quickFilter === 'OFFLINE' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '11px', padding: '3px 9px', color: quickFilter === 'OFFLINE' ? '#ffffff' : '#dc2626', borderColor: '#fecaca' }}
              onClick={() => { setQuickFilter('OFFLINE'); setStatusFilter('offline'); }}
            >
              <AlertTriangle size={12} style={{ marginRight: '3px' }} /> Offline ({offlineCount})
            </button>
            <button
              className={`btn btn-sm ${quickFilter === 'RECENT' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '11px', padding: '3px 9px', color: quickFilter === 'RECENT' ? '#ffffff' : '#7c3aed', borderColor: '#ddd6fe' }}
              onClick={() => { setQuickFilter('RECENT'); setStatusFilter('ALL'); }}
            >
              <Clock size={12} style={{ marginRight: '3px' }} /> Recently Added ({recentCount})
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', color: '#64748b' }}>Sort By:</span>
            <select
              className="filter-select"
              style={{ height: '26px', fontSize: '11px', padding: '0 6px' }}
              value={sortField}
              onChange={(e) => handleSort(e.target.value)}
            >
              <option value="id">ID (Default)</option>
              <option value="recent">Recently Added (Newest)</option>
              <option value="name">Device Name</option>
              <option value="status">Reachability Status</option>
              <option value="latency">Response Latency</option>
              <option value="location">Physical Location</option>
            </select>
          </div>
        </div>

        {/* Filter Toolbar with Physical Location Selectors */}
        <div className="filter-toolbar">
          <div className="filter-group">
            {/* Search Input */}
            <div style={{ position: 'relative', width: '220px' }}>
              <Search
                size={13}
                style={{ position: 'absolute', left: '8px', top: '9px', color: '#94a3b8' }}
              />
              <input
                type="text"
                className="form-input"
                style={{ paddingLeft: '28px', paddingRight: globalSearch ? '24px' : '8px', height: '30px', fontSize: '11.5px' }}
                placeholder="Search name, IP, MAC, room, rack..."
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
              />
              {globalSearch && (
                <button
                  type="button"
                  onClick={() => setGlobalSearch('')}
                  style={{
                    position: 'absolute',
                    right: '6px',
                    top: '7px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#94a3b8',
                    padding: 0,
                  }}
                  title="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Hardware Role Filter */}
            <select
              className="filter-select"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="ALL">All Hardware Roles ({devices.length})</option>
              {uniqueTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            {/* Railway Office Division Filter */}
            <select
              className="filter-select"
              value={officeFilter}
              onChange={(e) => setOfficeFilter(e.target.value)}
              style={{ fontWeight: 600 }}
            >
              <option value="ALL">All Offices (DRM, Control, NIA)</option>
              <option value="DRM">DRM Office</option>
              <option value="CONTROL">Control Office</option>
              <option value="NIA">NIA Office</option>
            </select>

            {/* Reachability Status Filter */}
            <select
              className="filter-select"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                if (e.target.value === 'online') setQuickFilter('ONLINE');
                else if (e.target.value === 'offline') setQuickFilter('OFFLINE');
                else setQuickFilter('ALL');
              }}
            >
              <option value="ALL">All Reachability</option>
              <option value="online">Online Only</option>
              <option value="offline">Offline Only</option>
              <option value="unknown">Unknown</option>
            </select>

            {/* Building / Office Location Filter */}
            <select
              className="filter-select"
              value={buildingFilter}
              onChange={(e) => setBuildingFilter(e.target.value)}
            >
              <option value="ALL">All Office Locations</option>
              {uniqueBuildings.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>

            {/* Location Verification Filter */}
            <select
              className="filter-select"
              value={verificationFilter}
              onChange={(e) => setVerificationFilter(e.target.value)}
            >
              <option value="ALL">All Audit States</option>
              <option value="verified">Verified Location</option>
              <option value="unverified">Unverified Location</option>
            </select>
          </div>

          <div style={{ fontSize: '11.5px', color: '#64748b' }}>
            Showing <strong>{filteredDevices.length}</strong> of <strong>{devices.length}</strong> devices
          </div>
        </div>

        {/* Data Table */}
        <div className="panel-body" style={{ padding: '0' }}>
          {filteredDevices.length === 0 ? (
            <EmptyState
              title={devices.length === 0 ? 'No Devices Registered' : 'No Devices Match Filter'}
              description={
                devices.length === 0
                  ? 'Get started by registering network nodes or trackside equipment with physical locations.'
                  : 'Try adjusting the search keyword or location filters to see matching devices.'
              }
              action={
                devices.length === 0 ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDeviceToEdit(null);
                      setIsAddModalOpen(true);
                    }}
                  >
                    <Plus size={13} /> Add First Device
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                    {globalSearch && (
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => setGlobalSearch('')}
                      >
                        Clear Search
                      </button>
                    )}
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setGlobalSearch('');
                        setQuickFilter('ALL');
                        setTypeFilter('ALL');
                        setStatusFilter('ALL');
                        setBuildingFilter('ALL');
                        setVerificationFilter('ALL');
                      }}
                    >
                      Reset All Filters
                    </button>
                  </div>
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
                    <th onClick={() => handleSort('name')} style={{ cursor: 'pointer' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                        Device Name & Make <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th onClick={() => handleSort('device_type')} style={{ cursor: 'pointer' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                        Role <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th onClick={() => handleSort('ip_address')} style={{ cursor: 'pointer' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                        IP & MAC <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th onClick={() => handleSort('location')} style={{ cursor: 'pointer' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                        <MapPin size={12} style={{ color: '#059669' }} />
                        <span>Physical Location</span>
                        <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th>Switch Port</th>
                    <th onClick={() => handleSort('status')} style={{ cursor: 'pointer' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                        Reachability <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th onClick={() => handleSort('latency')} style={{ cursor: 'pointer' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                        Latency <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th onClick={() => handleSort('recent')} style={{ cursor: 'pointer' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                        Commissioned <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th style={{ textAlign: 'right', minWidth: '130px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDevices.map((dev) => {
                    const st = deviceStatuses[dev.id] || { status: 'unknown' };
                    const isRecent = isRecentDevice(dev);
                    return (
                      <tr
                        key={dev.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setSelectedDevice(dev)}
                        className={st.status === 'offline' ? 'row-offline' : ''}
                      >
                        <td className="mono" style={{ color: '#64748b' }}>
                          #{dev.id}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontWeight: 600 }}>{dev.name}</span>
                            <span
                              style={{
                                fontSize: '9px',
                                padding: '1px 5px',
                                backgroundColor: dev.office === 'NIA' ? '#ede9fe' : dev.office === 'CONTROL' ? '#ecfdf5' : '#e0f2fe',
                                color: dev.office === 'NIA' ? '#7c3aed' : dev.office === 'CONTROL' ? '#059669' : '#0284c7',
                                border: `1px solid ${dev.office === 'NIA' ? '#ddd6fe' : dev.office === 'CONTROL' ? '#a7f3d0' : '#bae6fd'}`,
                                borderRadius: '3px',
                                fontWeight: 700,
                              }}
                              title={`Railway Office Branch: ${dev.office || 'DRM'}`}
                            >
                              {dev.office || 'DRM'}
                            </span>
                            {isRecent && (
                              <span
                                style={{
                                  fontSize: '9px',
                                  padding: '1px 5px',
                                  backgroundColor: '#ede9fe',
                                  color: '#6d28d9',
                                  borderRadius: '3px',
                                  fontWeight: 600,
                                }}
                                title="Commissioned in the last 72 hours"
                              >
                                NEW
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <DeviceTypeBadge type={dev.device_type} />
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span className="mono" style={{ fontWeight: 600, color: '#0284c7' }}>
                              {dev.ip_address}
                            </span>
                            {dev.mac_address && (
                              <span className="mono" style={{ fontSize: '10px', color: '#64748b' }}>
                                {dev.mac_address}
                              </span>
                            )}
                          </div>
                        </td>
                        {/* Compact Location display */}
                        <td>
                          <CompactLocationView device={dev} />
                        </td>
                        <td>
                          {dev.port_number ? (
                            <span className="mono" style={{ fontSize: '11px', fontWeight: 500, color: '#334155' }}>
                              Port {dev.port_number}
                            </span>
                          ) : (
                            <span style={{ fontSize: '11px', color: '#94a3b8' }}>Access Port</span>
                          )}
                        </td>
                        <td>
                          <StatusBadge status={st.status} />
                        </td>
                        <td>
                          <LatencyIndicator latencyMs={st.latency_ms} />
                        </td>
                        <td style={{ fontSize: '11px', color: isRecent ? '#7c3aed' : '#64748b', fontWeight: isRecent ? 600 : 400 }}>
                          {formatAddedDate(dev.created_at)}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '4px' }}>
                            <button
                              className="btn btn-secondary btn-sm"
                              title="Edit device & physical location"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeviceToEdit(dev);
                                setIsAddModalOpen(true);
                              }}
                            >
                              <Edit size={11} />
                            </button>
                            <button
                              className="btn btn-secondary btn-sm"
                              title="Manual Probe Check"
                              onClick={(e) => handleProbe(e, dev.id)}
                              disabled={probingId === dev.id}
                            >
                              <RefreshCw
                                size={11}
                                className={probingId === dev.id ? 'spin-icon' : ''}
                              />
                            </button>
                            <button
                              className="btn btn-secondary btn-sm"
                              title="View Diagnostics Details"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/devices/${dev.id}`);
                              }}
                            >
                              <Eye size={11} />
                            </button>
                            <button
                              className="btn btn-danger btn-sm"
                              title="Delete Device"
                              onClick={(e) => handleDelete(e, dev)}
                              disabled={deletingId === dev.id}
                            >
                              <Trash2 size={11} />
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
        </div>
      </div>

      {/* Add / Edit Device Modal */}
      <DeviceFormModal
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          setDeviceToEdit(null);
        }}
        initialDevice={deviceToEdit}
      />

      {/* Quick Inspection Drawer */}
      <DeviceQuickDrawer
        device={selectedDevice}
        isOpen={!!selectedDevice}
        onClose={() => setSelectedDevice(null)}
        onEditDevice={(dev) => {
          setSelectedDevice(null);
          setDeviceToEdit(dev);
          setIsAddModalOpen(true);
        }}
      />
    </div>
  );
};

export default DeviceInventory;
