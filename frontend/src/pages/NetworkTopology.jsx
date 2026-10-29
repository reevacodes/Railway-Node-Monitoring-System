import React, { useState, useRef, useMemo } from 'react';
import { useNetwork } from '../context/NetworkContext';
import StatusBadge from '../components/common/StatusBadge';
import DeviceTypeBadge from '../components/common/DeviceTypeBadge';
import { LocationBadge, formatCompactLocation } from '../components/common/LocationBadge';
import DeviceQuickDrawer from '../components/devices/DeviceQuickDrawer';
import DeviceFormModal from '../components/devices/DeviceFormModal';
import EmptyState from '../components/common/EmptyState';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  Network,
  Info,
  Server,
  Router,
  Wifi,
  Shield,
  MapPin,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Layers,
} from 'lucide-react';

export const NetworkTopology = () => {
  const { devices, deviceStatuses } = useNetwork();
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [deviceToEdit, setDeviceToEdit] = useState(null);
  const [locationFilter, setLocationFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL'); // 'ALL' | 'ONLINE' | 'OFFLINE' | 'RECENT'

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.15, 2.0));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.15, 0.5));
  const handleReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  };

  const handleMouseUp = () => setIsDragging(false);

  // Extract distinct buildings or rooms for location grouping
  const distinctLocations = useMemo(() => {
    const set = new Set();
    devices.forEach((d) => {
      if (d.building) set.add(d.building);
      else if (d.room) set.add(d.room);
    });
    return Array.from(set);
  }, [devices]);

  // Topology layer counts
  const gatewayCount = useMemo(() => {
    return devices.filter((d) => {
      const t = (d.device_type || '').toLowerCase();
      return t.includes('router') || t.includes('firewall') || t.includes('gateway');
    }).length;
  }, [devices]);

  const switchCount = useMemo(() => {
    return devices.filter((d) => (d.device_type || '').toLowerCase().includes('switch')).length;
  }, [devices]);

  const onlineCount = useMemo(() => {
    return devices.filter((d) => (deviceStatuses[d.id]?.status || '').toLowerCase() === 'online').length;
  }, [devices, deviceStatuses]);

  const offlineCount = useMemo(() => {
    return devices.filter((d) => (deviceStatuses[d.id]?.status || '').toLowerCase() === 'offline').length;
  }, [devices, deviceStatuses]);

  const recentCount = useMemo(() => {
    return devices.filter((d) => {
      if (!d.created_at) return false;
      const ageHours = (Date.now() - new Date(d.created_at).getTime()) / (1000 * 60 * 60);
      return ageHours < 72;
    }).length;
  }, [devices]);

  // Filtered devices based on location filter and status quick filter
  const displayedDevices = useMemo(() => {
    return devices.filter((d) => {
      const matchesLoc = locationFilter === 'ALL' || d.building === locationFilter || d.room === locationFilter;
      const st = (deviceStatuses[d.id]?.status || 'unknown').toLowerCase();
      let matchesStatus = true;
      if (statusFilter === 'ONLINE') matchesStatus = st === 'online';
      else if (statusFilter === 'OFFLINE') matchesStatus = st === 'offline';
      else if (statusFilter === 'RECENT') {
        const ageHours = d.created_at ? (Date.now() - new Date(d.created_at).getTime()) / (1000 * 60 * 60) : 999;
        matchesStatus = ageHours < 72;
      }
      return matchesLoc && matchesStatus;
    });
  }, [devices, locationFilter, statusFilter, deviceStatuses]);

  // Calculate coordinates with clear visual hierarchy
  const getNodeCoordinates = (device, index, total) => {
    const t = (device.device_type || '').toLowerCase();
    let layerY = 340; // Access / edge devices
    if (t.includes('router') || t.includes('firewall')) layerY = 100;
    else if (t.includes('switch')) layerY = 220;

    const spacing = 220;
    const totalWidth = total * spacing;
    const startX = Math.max(140, 500 - totalWidth / 2);
    const x = startX + index * spacing;
    return { x, y: layerY };
  };

  return (
    <div>
      {/* Title Strip & Location Filter */}
      <div className="page-title-strip">
        <div>
          <h1>Railway Network Topology</h1>
          <div className="page-subtitle">
            Visual map of railway operations center, verified switch uplinks and physical node locations
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Location Grouping Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <MapPin size={13} style={{ color: '#059669' }} />
            <select
              className="filter-select"
              style={{ height: '30px', fontSize: '11.5px' }}
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
            >
              <option value="ALL">All Physical Zones ({devices.length} Nodes)</option>
              {distinctLocations.map((loc) => (
                <option key={loc} value={loc}>
                  Zone: {loc}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Topology Hierarchy & Quick Filter Strip (Unique to Topology) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          backgroundColor: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '4px',
          marginBottom: '16px',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#475569', marginRight: '4px' }}>
            Topology Filter:
          </span>
          <button
            className={`btn btn-sm ${statusFilter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '11px', padding: '2px 9px' }}
            onClick={() => setStatusFilter('ALL')}
          >
            All Nodes ({devices.length})
          </button>
          <button
            className={`btn btn-sm ${statusFilter === 'ONLINE' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '11px', padding: '2px 9px', color: statusFilter === 'ONLINE' ? '#fff' : '#059669' }}
            onClick={() => setStatusFilter('ONLINE')}
          >
            Online Links ({onlineCount})
          </button>
          <button
            className={`btn btn-sm ${statusFilter === 'OFFLINE' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '11px', padding: '2px 9px', color: statusFilter === 'OFFLINE' ? '#fff' : '#dc2626' }}
            onClick={() => setStatusFilter('OFFLINE')}
          >
            Offline Drops ({offlineCount})
          </button>
          <button
            className={`btn btn-sm ${statusFilter === 'RECENT' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '11px', padding: '2px 9px', color: statusFilter === 'RECENT' ? '#fff' : '#8b5cf6' }}
            onClick={() => setStatusFilter('RECENT')}
          >
            Recently Added ({recentCount})
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '11.5px', color: '#64748b' }}>
          <span>Core: <strong>{gatewayCount}</strong></span>
          <span>Distribution: <strong>{switchCount}</strong></span>
          <span>Access: <strong>{devices.length - gatewayCount - switchCount}</strong></span>
          <span>Showing on canvas: <strong>{displayedDevices.length}</strong></span>
        </div>
      </div>

      {devices.length === 0 ? (
        <div className="panel">
          <div className="panel-body">
            <EmptyState
              title="No Network Nodes to Display"
              description="Register railway routers, switches, and access points in Device Inventory to generate the topology map."
            />
          </div>
        </div>
      ) : (
        <div className="panel" style={{ position: 'relative' }}>
          <div className="topology-container" style={{ height: '580px' }}>
            {/* Zoom / Pan Controls */}
            <div className="topology-controls">
              <button className="topology-ctrl-btn" onClick={handleZoomIn} title="Zoom In">
                <ZoomIn size={14} />
              </button>
              <button className="topology-ctrl-btn" onClick={handleZoomOut} title="Zoom Out">
                <ZoomOut size={14} />
              </button>
              <button className="topology-ctrl-btn" onClick={handleReset} title="Fit to Screen / Reset View">
                <RotateCcw size={14} />
              </button>
            </div>

            {/* Topology Legend */}
            <div className="topology-legend">
              <div style={{ fontWeight: 600, color: '#1e293b', marginBottom: '2px' }}>
                Topology & Location Legend
              </div>
              <div className="legend-item">
                <span className="status-dot" style={{ backgroundColor: '#10b981' }} />
                <span>Online (ICMP Reachable)</span>
              </div>
              <div className="legend-item">
                <span className="status-dot" style={{ backgroundColor: '#ef4444' }} />
                <span>Offline (Timeout / Loss)</span>
              </div>
              <div className="legend-item" style={{ marginTop: '3px' }}>
                <span className="legend-line-verified" />
                <span>Verified Switch Uplink</span>
              </div>
              <div className="legend-item">
                <span className="legend-line-unverified" />
                <span>Subnet Route (Unconfirmed Port)</span>
              </div>
              <div className="legend-item" style={{ marginTop: '3px' }}>
                <MapPin size={11} style={{ color: '#059669' }} />
                <span>Verified Physical Location</span>
              </div>
            </div>

            {/* Interactive SVG Canvas */}
            <svg
              className="topology-canvas"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              style={{
                cursor: isDragging ? 'grabbing' : 'grab',
                userSelect: 'none',
              }}
            >
              <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
                {/* Background Grid Pattern */}
                <defs>
                  <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
                    <circle cx="2" cy="2" r="1" fill="#cbd5e1" opacity="0.4" />
                  </pattern>
                </defs>
                <rect width="2400" height="2400" fill="url(#grid)" />

                {/* Render Confirmed Connection Links between nodes */}
                {displayedDevices.map((device, i) => {
                  if (i === 0) return null; // First device is root
                  const source = getNodeCoordinates(displayedDevices[0], 0, displayedDevices.length);
                  const target = getNodeCoordinates(device, i, displayedDevices.length);
                  
                  // A link is verified if explicitly assigned to parent_device_id or has verified port_number
                  const isVerifiedLink = Boolean(device.parent_device_id || device.port_number);

                  return (
                    <g key={`link-${device.id}`}>
                      <line
                        x1={source.x}
                        y1={source.y + 10}
                        x2={target.x}
                        y2={target.y - 10}
                        stroke={isVerifiedLink ? '#0284c7' : '#94a3b8'}
                        strokeWidth={isVerifiedLink ? 2 : 1.5}
                        strokeDasharray={isVerifiedLink ? 'none' : '5,5'}
                      />
                      {/* Port Label if verified */}
                      <text
                        x={(source.x + target.x) / 2}
                        y={(source.y + target.y) / 2 - 8}
                        fill={isVerifiedLink ? '#0284c7' : '#64748b'}
                        fontSize="9"
                        textAnchor="middle"
                        fontFamily="var(--font-mono)"
                        fontWeight={isVerifiedLink ? '600' : '400'}
                      >
                        {device.port_number ? `${device.port_number} (Verified)` : 'Unverified Path'}
                      </text>
                    </g>
                  );
                })}

                {/* Render Nodes */}
                {displayedDevices.map((device, i) => {
                  const { x, y } = getNodeCoordinates(device, i, displayedDevices.length);
                  const st = deviceStatuses[device.id] || { status: 'unknown' };
                  const isOnline = st.status === 'online';
                  const isOffline = st.status === 'offline';
                  const isLocationVerified = device.location_verification === 'verified';

                  let statusColor = '#64748b';
                  if (isOnline) statusColor = '#10b981';
                  else if (isOffline) statusColor = '#ef4444';

                  const locationStr = formatCompactLocation(device);

                  return (
                    <g
                      key={`node-${device.id}`}
                      transform={`translate(${x}, ${y})`}
                      onClick={() => setSelectedDevice(device)}
                      style={{ cursor: 'pointer' }}
                    >
                      {/* Node Box */}
                      <rect
                        x="-90"
                        y="-45"
                        width="180"
                        height="90"
                        rx="6"
                        fill="#ffffff"
                        stroke={statusColor}
                        strokeWidth="2"
                        filter="drop-shadow(0px 2px 4px rgba(0,0,0,0.08))"
                      />

                      {/* Top Header Bar with Role & Status Dot */}
                      <rect
                        x="-90"
                        y="-45"
                        width="180"
                        height="20"
                        rx="5"
                        fill="#f8fafc"
                      />
                      <circle cx="-76" cy="-35" r="4" fill={statusColor} />
                      <text
                        x="-66"
                        y="-31"
                        fontSize="9.5"
                        fill="#475569"
                        fontWeight="600"
                        fontFamily="var(--font-sans)"
                      >
                        {device.device_type || 'Node'}
                      </text>

                      {/* Location Verified Pin indicator */}
                      {isLocationVerified && (
                        <circle cx="75" cy="-35" r="4" fill="#059669" />
                      )}

                      {/* Device Name */}
                      <text
                        x="0"
                        y="-10"
                        fontSize="11"
                        fill="#0f172a"
                        fontWeight="700"
                        textAnchor="middle"
                        fontFamily="var(--font-sans)"
                      >
                        {device.name.length > 22 ? device.name.substring(0, 20) + '...' : device.name}
                      </text>

                      {/* IP Address */}
                      <text
                        x="0"
                        y="6"
                        fontSize="10"
                        fill="#0284c7"
                        textAnchor="middle"
                        fontFamily="var(--font-mono)"
                      >
                        {device.ip_address}
                      </text>

                      {/* Physical Location Tag */}
                      <rect
                        x="-82"
                        y="15"
                        width="164"
                        height="18"
                        rx="3"
                        fill={isLocationVerified ? '#ecfdf5' : '#f1f5f9'}
                        stroke={isLocationVerified ? '#a7f3d0' : '#e2e8f0'}
                        strokeWidth="1"
                      />
                      <text
                        x="0"
                        y="27"
                        fontSize="8.5"
                        fill={isLocationVerified ? '#065f46' : '#64748b'}
                        textAnchor="middle"
                        fontWeight={isLocationVerified ? '600' : '400'}
                        fontFamily="var(--font-sans)"
                      >
                        {locationStr.length > 26 ? locationStr.substring(0, 24) + '...' : locationStr}
                      </text>

                      {/* Latency badge if available */}
                      {st.latency_ms !== null && st.latency_ms !== undefined && (
                        <text
                          x="0"
                          y="41"
                          fontSize="8.5"
                          fill="#059669"
                          textAnchor="middle"
                          fontFamily="var(--font-mono)"
                        >
                          {st.latency_ms} ms ping
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>
        </div>
      )}

      {/* Node Detail Drawer */}
      <DeviceQuickDrawer
        device={selectedDevice}
        isOpen={!!selectedDevice}
        onClose={() => setSelectedDevice(null)}
        onEditDevice={(dev) => {
          setDeviceToEdit(dev);
        }}
      />

      {/* Edit Modal if triggered from drawer */}
      <DeviceFormModal
        isOpen={!!deviceToEdit}
        onClose={() => setDeviceToEdit(null)}
        initialDevice={deviceToEdit}
      />
    </div>
  );
};

export default NetworkTopology;
