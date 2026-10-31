import React, { useState, useRef, useMemo } from 'react';
import { useNetwork } from '../context/NetworkContext';
import DeviceQuickDrawer from '../components/devices/DeviceQuickDrawer';
import DeviceFormModal from '../components/devices/DeviceFormModal';
import EmptyState from '../components/common/EmptyState';
import { formatCompactLocation } from '../components/common/LocationBadge';
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Network,
  Server,
  Building2,
  Cpu,
  ArrowLeft,
  ChevronRight,
  Shield,
  Layers,
  Plus,
  Search,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ArrowRight,
  Activity,
  Radio,
  MapPin,
  ExternalLink,
} from 'lucide-react';

/**
 * 3 Official Railway Office Branches
 */
const OFFICES = [
  {
    id: 'DRM',
    name: 'DRM Office',
    fullName: 'DRM Headquarters Office',
    code: 'DRM-HQ',
    role: 'Divisional Management, IT Demarcation & Core Routing',
    color: '#0284c7', // Sky blue
    bgLight: '#f0f9ff',
    borderLight: '#bae6fd',
    vlan: 'VLAN 40 (192.168.40.0/24)',
    description: 'Divisional HQ administration, IT room, and engineering planning workstations.',
  },
  {
    id: 'CONTROL',
    name: 'Control Office',
    fullName: 'Railway Control & Dispatch Office',
    code: 'CTRL-OPS',
    role: 'Train Dispatch, Section Controller & Traffic Cabins',
    color: '#059669', // Emerald green
    bgLight: '#ecfdf5',
    borderLight: '#a7f3d0',
    vlan: 'VLAN 1 & Cabins (192.168.1.0/24)',
    description: 'Real-time train dispatch console, station controller desks, and HOR monitoring cell.',
  },
  {
    id: 'NIA',
    name: 'NIA Office',
    fullName: 'NIA Telecom Substation Office',
    code: 'NIA-TEL',
    role: 'Telecommunications Bay & Fiber Aggregation Wing',
    color: '#7c3aed', // Purple
    bgLight: '#f5f3ff',
    borderLight: '#ddd6fe',
    vlan: 'VLAN 41 (192.168.41.0/24)',
    description: 'Optical fiber distribution racks, S&T telecommunication bays, and trackside gateways.',
  },
];

/**
 * Resolves reliable office assignment for any device
 */
export const getDeviceOfficeId = (device) => {
  if (device.office) {
    const o = String(device.office).toUpperCase();
    if (o.includes('DRM')) return 'DRM';
    if (o.includes('CONTROL') || o.includes('CABIN')) return 'CONTROL';
    if (o.includes('NIA') || o.includes('TEL')) return 'NIA';
  }
  const str = `${device.building || ''} ${device.room || ''} ${device.name || ''}`.toLowerCase();
  if (
    str.includes('control') ||
    str.includes('cabin') ||
    str.includes('controller') ||
    str.includes('hor cell') ||
    str.includes('cmi')
  ) {
    return 'CONTROL';
  }
  if (str.includes('nia') || (device.ip_address && device.ip_address.startsWith('192.168.41.'))) {
    return 'NIA';
  }
  return 'DRM';
};

export const NetworkTopology = () => {
  const { devices, deviceStatuses, backendHealth, refreshData } = useNetwork();

  // Navigation: 'ALL' (Tree Overview of 3 offices) or 'DRM' | 'CONTROL' | 'NIA' (Expanded Office)
  const [activeOffice, setActiveOffice] = useState('ALL');
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [deviceToEdit, setDeviceToEdit] = useState(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Filters & Search
  const [statusFilter, setStatusFilter] = useState('ALL'); // 'ALL' | 'ONLINE' | 'OFFLINE'
  const [searchQuery, setSearchQuery] = useState('');

  // Canvas Viewport Pan & Zoom
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.15, 2.2));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.15, 0.45));
  const handleReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleMouseDown = (e) => {
    // Only drag on canvas background, not when clicking nodes/buttons
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

  // -------------------------------------------------------------
  // Live Office Statistics Calculation (Uses Real ICMP Statuses)
  // -------------------------------------------------------------
  const officeStats = useMemo(() => {
    return OFFICES.map((off) => {
      const officeDevices = devices.filter((d) => getDeviceOfficeId(d) === off.id);
      const total = officeDevices.length;
      let online = 0;
      let offline = 0;
      let unknown = 0;

      officeDevices.forEach((d) => {
        const st = (deviceStatuses[d.id]?.status || 'unknown').toLowerCase();
        if (st === 'online') online++;
        else if (st === 'offline') offline++;
        else unknown++;
      });

      const verifiedLinks = officeDevices.filter(
        (d) => Boolean(d.parent_device_id) && d.location_verification === 'verified'
      ).length;

      let connectivityStatus = 'ALL OPERATIONAL';
      let statusColor = '#059669';

      if (total === 0) {
        connectivityStatus = 'NO REGISTERED NODES';
        statusColor = '#64748b';
      } else if (offline > 0) {
        connectivityStatus = `${offline} DROP${offline > 1 ? 'S' : ''} DETECTED`;
        statusColor = '#dc2626';
      } else if (online === 0 && unknown > 0) {
        connectivityStatus = 'AWAITING TELEMETRY';
        statusColor = '#f59e0b';
      }

      return {
        ...off,
        devices: officeDevices,
        total,
        online,
        offline,
        unknown,
        verifiedLinks,
        connectivityStatus,
        statusColor,
      };
    });
  }, [devices, deviceStatuses]);

  // Active office object if in single office mode
  const currentOfficeObj = useMemo(() => {
    if (activeOffice === 'ALL') return null;
    return officeStats.find((o) => o.id === activeOffice) || officeStats[0];
  }, [activeOffice, officeStats]);

  // Devices in the currently selected office
  const currentOfficeDevices = useMemo(() => {
    if (activeOffice === 'ALL') return [];
    const base = devices.filter((d) => getDeviceOfficeId(d) === activeOffice);

    return base.filter((dev) => {
      // 1. Status Filter
      const st = (deviceStatuses[dev.id]?.status || 'unknown').toLowerCase();
      if (statusFilter === 'ONLINE' && st !== 'online') return false;
      if (statusFilter === 'OFFLINE' && st !== 'offline') return false;

      // 2. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = (dev.name || '').toLowerCase().includes(q);
        const matchesIp = (dev.ip_address || '').toLowerCase().includes(q);
        const matchesRoom = (dev.room || '').toLowerCase().includes(q);
        const matchesType = (dev.device_type || '').toLowerCase().includes(q);
        if (!matchesName && !matchesIp && !matchesRoom && !matchesType) return false;
      }

      return true;
    });
  }, [devices, activeOffice, statusFilter, searchQuery, deviceStatuses]);

  // -------------------------------------------------------------
  // Layout Hierarchy Algorithm for Expanded Office View
  // Separates:
  // 1. Core/Distribution Infrastructure (Routers, Switches)
  // 2. Connected Child Devices (Verified via parent_device_id)
  // 3. Unlinked / Standalone Devices (No parent assigned)
  // -------------------------------------------------------------
  const officeLayout = useMemo(() => {
    if (activeOffice === 'ALL') return null;

    const devs = currentOfficeDevices;
    const parentMap = new Map(); // parentId -> [children]
    const devById = new Map();
    devs.forEach((d) => devById.set(d.id, d));

    // Group child devices under their verified parents
    devs.forEach((d) => {
      if (d.parent_device_id && devById.has(d.parent_device_id)) {
        if (!parentMap.has(d.parent_device_id)) {
          parentMap.set(d.parent_device_id, []);
        }
        parentMap.get(d.parent_device_id).push(d);
      }
    });

    // Infrastructure nodes (Routers, Core Switches, Managed Switches, Gateways)
    const infraDevices = devs.filter((d) => {
      const t = (d.device_type || '').toLowerCase();
      return (
        t.includes('router') ||
        t.includes('switch') ||
        t.includes('gateway') ||
        t.includes('firewall') ||
        t.includes('access point')
      );
    });

    // Root infrastructure nodes (have no parent within this office)
    const rootInfra = infraDevices.filter(
      (d) => !d.parent_device_id || !devById.has(d.parent_device_id)
    );

    // Connected non-infra devices (children of known parents)
    const connectedChildren = devs.filter(
      (d) => d.parent_device_id && devById.has(d.parent_device_id)
    );

    // Unlinked devices (No parent_device_id assigned or parent not in this office)
    const unlinkedDevices = devs.filter((d) => {
      const isInfra = infraDevices.some((inf) => inf.id === d.id);
      const isConnectedChild = connectedChildren.some((c) => c.id === d.id);
      return !isInfra && !isConnectedChild;
    });

    // Calculate Coordinates
    const coordinates = new Map();
    const links = [];

    // 1. Position Office Root Hub
    const officeRootPos = { x: 600, y: 155 };

    // 2. Position Infrastructure Nodes
    const infraSpacing = 260;
    const totalInfraWidth = Math.max(1, rootInfra.length) * infraSpacing;
    const startInfraX = 600 - totalInfraWidth / 2 + infraSpacing / 2;

    rootInfra.forEach((inf, idx) => {
      const x = rootInfra.length === 1 ? 600 : startInfraX + idx * infraSpacing;
      const y = 290;
      coordinates.set(inf.id, { x, y, tier: 'infra' });

      // Link from Office Root to Root Switch
      links.push({
        id: `link-root-${inf.id}`,
        from: officeRootPos,
        to: { x, y: y - 48 },
        isVerified: true,
        label: 'Main Office Trunk',
        isTrunk: true,
      });

      // Position any children of this switch
      const children = parentMap.get(inf.id) || [];
      const childSpacing = 210;
      const totalChildWidth = Math.max(1, children.length) * childSpacing;
      const startChildX = x - totalChildWidth / 2 + childSpacing / 2;

      children.forEach((child, cIdx) => {
        const cx = children.length === 1 ? x : startChildX + cIdx * childSpacing;
        const cy = 440;
        coordinates.set(child.id, { x: cx, y: cy, tier: 'child' });

        links.push({
          id: `link-${inf.id}-${child.id}`,
          from: { x, y: y + 48 },
          to: { x: cx, y: cy - 48 },
          isVerified: child.location_verification === 'verified' || Boolean(child.port_number),
          label: child.port_number ? `Port ${child.port_number}` : 'Switch Link',
          isTrunk: false,
        });
      });
    });

    // 3. Position Unlinked Devices in dedicated "Unlinked Devices Section"
    // Rendered on a neat grid below the switches
    const unlinkedPerRow = 4;
    const unlinkedColWidth = 230;
    const unlinkedRowHeight = 125;
    const unlinkedStartY = rootInfra.length > 0 ? 590 : 290;

    unlinkedDevices.forEach((dev, idx) => {
      const row = Math.floor(idx / unlinkedPerRow);
      const col = idx % unlinkedPerRow;
      const countInRow = Math.min(unlinkedDevices.length - row * unlinkedPerRow, unlinkedPerRow);
      const rowWidth = countInRow * unlinkedColWidth;
      const startX = 600 - rowWidth / 2 + unlinkedColWidth / 2;

      const x = startX + col * unlinkedColWidth;
      const y = unlinkedStartY + row * unlinkedRowHeight;
      coordinates.set(dev.id, { x, y, tier: 'unlinked' });
    });

    return {
      officeRootPos,
      coordinates,
      links,
      rootInfra,
      connectedChildren,
      unlinkedDevices,
      unlinkedStartY,
    };
  }, [currentOfficeDevices, activeOffice]);

  // Overall fleet stats
  const totalFleetCount = devices.length;
  const totalOnlineCount = useMemo(() => {
    return devices.filter((d) => (deviceStatuses[d.id]?.status || '').toLowerCase() === 'online').length;
  }, [devices, deviceStatuses]);
  const totalOfflineCount = useMemo(() => {
    return devices.filter((d) => (deviceStatuses[d.id]?.status || '').toLowerCase() === 'offline').length;
  }, [devices, deviceStatuses]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* =========================================================
          TOP ACTION BAR & OFFICE NAVIGATION TABS
          ========================================================= */}
      <div className="page-title-strip">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {activeOffice !== 'ALL' && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setActiveOffice('ALL');
                  handleReset();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontWeight: 600,
                  color: '#0284c7',
                }}
                title="Return to 3-Office Tree Overview"
              >
                <ArrowLeft size={13} /> Back to All Offices
              </button>
            )}
            <h1>
              {activeOffice === 'ALL'
                ? 'Railway Network Topology'
                : `${currentOfficeObj?.fullName || 'Office'} Topology`}
            </h1>
          </div>
          <div className="page-subtitle">
            {activeOffice === 'ALL'
              ? 'Hierarchical tree map of Central Server routing to DRM Office, Control Office, and NIA Office.'
              : `Internal switch hierarchy, verified port uplinks, and monitored workstations for ${currentOfficeObj?.name}.`}
          </div>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Office Segmented Switcher */}
          <div
            style={{
              display: 'inline-flex',
              backgroundColor: '#f1f5f9',
              padding: '3px',
              borderRadius: '6px',
              border: '1px solid #e2e8f0',
            }}
          >
            <button
              type="button"
              className={`btn btn-sm ${activeOffice === 'ALL' ? 'btn-primary' : ''}`}
              style={{
                fontSize: '11px',
                padding: '3px 10px',
                border: 'none',
                backgroundColor: activeOffice === 'ALL' ? '#0f172a' : 'transparent',
                color: activeOffice === 'ALL' ? '#ffffff' : '#475569',
                boxShadow: activeOffice === 'ALL' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
              }}
              onClick={() => {
                setActiveOffice('ALL');
                handleReset();
              }}
            >
              All Offices ({totalFleetCount})
            </button>
            {OFFICES.map((off) => {
              const count = devices.filter((d) => getDeviceOfficeId(d) === off.id).length;
              const isSelected = activeOffice === off.id;
              return (
                <button
                  key={off.id}
                  type="button"
                  className={`btn btn-sm ${isSelected ? 'btn-primary' : ''}`}
                  style={{
                    fontSize: '11px',
                    padding: '3px 10px',
                    border: 'none',
                    backgroundColor: isSelected ? off.color : 'transparent',
                    color: isSelected ? '#ffffff' : '#475569',
                    boxShadow: isSelected ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
                  }}
                  onClick={() => {
                    setActiveOffice(off.id);
                    handleReset();
                  }}
                >
                  {off.name} ({count})
                </button>
              );
            })}
          </div>

          {/* Register Node Button */}
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

      {/* =========================================================
          OFFICE METRIC SUB-STRIP
          ========================================================= */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          backgroundColor: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '4px',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        {/* Left: Quick Reachability Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#475569', marginRight: '4px' }}>
            Filter Nodes:
          </span>
          <button
            type="button"
            className={`btn btn-sm ${statusFilter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '11px', padding: '2px 9px' }}
            onClick={() => setStatusFilter('ALL')}
          >
            All Statuses
          </button>
          <button
            type="button"
            className={`btn btn-sm ${statusFilter === 'ONLINE' ? 'btn-primary' : 'btn-secondary'}`}
            style={{
              fontSize: '11px',
              padding: '2px 9px',
              color: statusFilter === 'ONLINE' ? '#fff' : '#059669',
            }}
            onClick={() => setStatusFilter('ONLINE')}
          >
            Online Only
          </button>
          <button
            type="button"
            className={`btn btn-sm ${statusFilter === 'OFFLINE' ? 'btn-primary' : 'btn-secondary'}`}
            style={{
              fontSize: '11px',
              padding: '2px 9px',
              color: statusFilter === 'OFFLINE' ? '#fff' : '#dc2626',
            }}
            onClick={() => setStatusFilter('OFFLINE')}
          >
            Offline Drops
          </button>
        </div>

        {/* Right: Search Box & Fleet Summary */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <Search
              size={12}
              style={{ position: 'absolute', left: '8px', color: '#94a3b8', pointerEvents: 'none' }}
            />
            <input
              type="text"
              placeholder="Search office nodes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                height: '28px',
                paddingLeft: '26px',
                paddingRight: '8px',
                fontSize: '11.5px',
                border: '1px solid #cbd5e1',
                borderRadius: '4px',
                width: '180px',
              }}
            />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              fontSize: '11.5px',
              color: '#64748b',
            }}
          >
            <span>
              Total Fleet: <strong>{totalFleetCount}</strong>
            </span>
            <span style={{ color: '#059669' }}>
              Online: <strong>{totalOnlineCount}</strong>
            </span>
            <span style={{ color: '#dc2626' }}>
              Offline: <strong>{totalOfflineCount}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* =========================================================
          INTERACTIVE SVG TOPOLOGY CANVAS CONTAINER
          ========================================================= */}
      <div className="panel" style={{ position: 'relative' }}>
        <div className="topology-container" style={{ height: '620px' }}>
          {/* Zoom & Pan Viewport Controls */}
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

          {/* Interactive Topology Legend */}
          <div className="topology-legend">
            <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: '3px', fontSize: '11px' }}>
              {activeOffice === 'ALL' ? 'Railway Hierarchy Legend' : 'Office Network Legend'}
            </div>
            <div className="legend-item">
              <span className="status-dot" style={{ backgroundColor: '#10b981' }} />
              <span>Online (ICMP Reachable)</span>
            </div>
            <div className="legend-item">
              <span className="status-dot" style={{ backgroundColor: '#ef4444' }} />
              <span>Offline (Drop / No Reply)</span>
            </div>
            <div className="legend-item">
              <span className="status-dot" style={{ backgroundColor: '#94a3b8' }} />
              <span>Unknown / Untested</span>
            </div>
            <div className="legend-item" style={{ marginTop: '3px' }}>
              <span
                style={{
                  display: 'inline-block',
                  width: '18px',
                  height: '2px',
                  backgroundColor: '#0284c7',
                  marginRight: '6px',
                }}
              />
              <span>Verified Physical Uplink</span>
            </div>
            <div className="legend-item">
              <span
                style={{
                  display: 'inline-block',
                  width: '18px',
                  height: '2px',
                  borderTop: '2px dashed #94a3b8',
                  marginRight: '6px',
                }}
              />
              <span>Unverified / Subnet Path</span>
            </div>
          </div>

          {/* SVG Canvas with Pan & Zoom Dragging */}
          <svg
            className="topology-canvas"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{
              cursor: isDragging ? 'grabbing' : 'grab',
              userSelect: 'none',
              backgroundColor: '#f8fafc',
            }}
          >
            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              {/* Engineering Grid Background */}
              <defs>
                <pattern id="railway-grid" width="32" height="32" patternUnits="userSpaceOnUse">
                  <circle cx="2" cy="2" r="1.2" fill="#cbd5e1" opacity="0.45" />
                </pattern>
                <linearGradient id="trunk-grad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#0284c7" />
                  <stop offset="100%" stopColor="#0369a1" />
                </linearGradient>
              </defs>
              <rect width="3000" height="3000" x="-500" y="-500" fill="url(#railway-grid)" />

              {/* =========================================================
                  VIEW 1: INITIAL 3-OFFICE HIERARCHICAL TREE VIEW
                  ========================================================= */}
              {activeOffice === 'ALL' && (
                <g>
                  {/* 1. Trunk Connection Bus Lines: Central Server -> 3 Offices */}
                  {/* Vertical drop from Central Server */}
                  <line
                    x1="600"
                    y1="120"
                    x2="600"
                    y2="190"
                    stroke="#0284c7"
                    strokeWidth="3"
                  />
                  {/* Horizontal Distribution Bus across 3 offices */}
                  <line
                    x1="220"
                    y1="190"
                    x2="980"
                    y2="190"
                    stroke="#0284c7"
                    strokeWidth="3"
                  />
                  {/* Vertical drop into DRM Office */}
                  <line
                    x1="220"
                    y1="190"
                    x2="220"
                    y2="245"
                    stroke="#0284c7"
                    strokeWidth="2.5"
                    strokeDasharray="4, 4"
                  />
                  {/* Vertical drop into Control Office */}
                  <line
                    x1="600"
                    y1="190"
                    x2="600"
                    y2="245"
                    stroke="#059669"
                    strokeWidth="2.5"
                    strokeDasharray="4, 4"
                  />
                  {/* Vertical drop into NIA Office */}
                  <line
                    x1="980"
                    y1="190"
                    x2="980"
                    y2="245"
                    stroke="#7c3aed"
                    strokeWidth="2.5"
                    strokeDasharray="4, 4"
                  />

                  {/* Trunk Line Pulse Indicators */}
                  <circle cx="600" cy="190" r="4" fill="#0284c7" />
                  <circle cx="220" cy="190" r="4" fill="#0284c7" />
                  <circle cx="980" cy="190" r="4" fill="#7c3aed" />

                  {/* 2. Top Root: CENTRAL SERVER PC NODE */}
                  <g transform="translate(600, 75)">
                    {/* Server Box */}
                    <rect
                      x="-140"
                      y="-40"
                      width="280"
                      height="80"
                      rx="8"
                      fill="#ffffff"
                      stroke="#0f172a"
                      strokeWidth="2.5"
                      filter="drop-shadow(0 4px 6px rgba(15, 23, 42, 0.1))"
                    />
                    {/* Top Accent Strip */}
                    <rect
                      x="-140"
                      y="-40"
                      width="280"
                      height="22"
                      rx="7"
                      fill="#0f172a"
                    />
                    <circle cx="-120" cy="-29" r="4" fill="#10b981" />
                    <text
                      x="-108"
                      y="-26"
                      fill="#f8fafc"
                      fontSize="9.5"
                      fontWeight="700"
                      letterSpacing="0.06em"
                      fontFamily="var(--font-sans)"
                    >
                      LOGICAL ROOT • CENTRAL HOST
                    </text>

                    {/* Server Title & Specs */}
                    <text
                      x="0"
                      y="-2"
                      textAnchor="middle"
                      fill="#0f172a"
                      fontSize="13"
                      fontWeight="800"
                      fontFamily="var(--font-sans)"
                    >
                      CENTRAL SERVER PC
                    </text>
                    <text
                      x="0"
                      y="16"
                      textAnchor="middle"
                      fill="#0284c7"
                      fontSize="10.5"
                      fontWeight="600"
                      fontFamily="var(--font-mono)"
                    >
                      PostgreSQL: network_monitor • Port 5001
                    </text>
                    <text
                      x="0"
                      y="31"
                      textAnchor="middle"
                      fill="#64748b"
                      fontSize="9"
                      fontFamily="var(--font-sans)"
                    >
                      Central ICMP Telemetry & NOC Routing Core
                    </text>
                  </g>

                  {/* 3. Three Office Branch Cards */}
                  {officeStats.map((off, idx) => {
                    const posX = idx === 0 ? 220 : idx === 1 ? 600 : 980;
                    const posY = 350;

                    return (
                      <g
                        key={off.id}
                        transform={`translate(${posX}, ${posY})`}
                        onClick={() => {
                          setActiveOffice(off.id);
                          handleReset();
                        }}
                        style={{ cursor: 'pointer' }}
                        className="office-summary-card"
                      >
                        {/* Outer Office Card Container */}
                        <rect
                          x="-145"
                          y="-105"
                          width="290"
                          height="210"
                          rx="10"
                          fill="#ffffff"
                          stroke={off.color}
                          strokeWidth="2.5"
                          filter="drop-shadow(0 6px 12px rgba(0, 0, 0, 0.08))"
                        />

                        {/* Top Header Banner with Office Code */}
                        <rect
                          x="-145"
                          y="-105"
                          width="290"
                          height="42"
                          rx="9"
                          fill={off.color}
                        />
                        <text
                          x="-128"
                          y="-82"
                          fill="#ffffff"
                          fontSize="13.5"
                          fontWeight="800"
                          fontFamily="var(--font-sans)"
                        >
                          {off.name}
                        </text>
                        <text
                          x="128"
                          y="-82"
                          textAnchor="end"
                          fill="#ffffff"
                          fontSize="10"
                          fontWeight="700"
                          fontFamily="var(--font-mono)"
                          opacity="0.9"
                        >
                          [{off.code}]
                        </text>

                        {/* Office Role / Subtitle */}
                        <text
                          x="-128"
                          y="-42"
                          fill="#475569"
                          fontSize="10"
                          fontWeight="600"
                          fontFamily="var(--font-sans)"
                        >
                          {off.role.length > 40 ? off.role.substring(0, 38) + '...' : off.role}
                        </text>

                        {/* VLAN & Subnet chip */}
                        <rect
                          x="-128"
                          y="-28"
                          width="256"
                          height="20"
                          rx="4"
                          fill="#f8fafc"
                          stroke="#e2e8f0"
                          strokeWidth="1"
                        />
                        <text
                          x="0"
                          y="-14"
                          textAnchor="middle"
                          fill="#0284c7"
                          fontSize="9.5"
                          fontWeight="600"
                          fontFamily="var(--font-mono)"
                        >
                          {off.vlan}
                        </text>

                        {/* Live Status Metric Grid */}
                        {/* Total Devices */}
                        <rect
                          x="-128"
                          y="2"
                          width="78"
                          height="44"
                          rx="4"
                          fill="#f8fafc"
                          stroke="#e2e8f0"
                          strokeWidth="1"
                        />
                        <text
                          x="-89"
                          y="18"
                          textAnchor="middle"
                          fill="#64748b"
                          fontSize="9"
                          fontWeight="600"
                        >
                          REGISTERED
                        </text>
                        <text
                          x="-89"
                          y="38"
                          textAnchor="middle"
                          fill="#0f172a"
                          fontSize="15"
                          fontWeight="800"
                          fontFamily="var(--font-mono)"
                        >
                          {off.total}
                        </text>

                        {/* Online Devices */}
                        <rect
                          x="-42"
                          y="2"
                          width="84"
                          height="44"
                          rx="4"
                          fill="#ecfdf5"
                          stroke="#a7f3d0"
                          strokeWidth="1"
                        />
                        <text
                          x="0"
                          y="18"
                          textAnchor="middle"
                          fill="#065f46"
                          fontSize="9"
                          fontWeight="600"
                        >
                          ONLINE
                        </text>
                        <text
                          x="0"
                          y="38"
                          textAnchor="middle"
                          fill="#059669"
                          fontSize="15"
                          fontWeight="800"
                          fontFamily="var(--font-mono)"
                        >
                          {off.online}
                        </text>

                        {/* Offline Devices */}
                        <rect
                          x="50"
                          y="2"
                          width="78"
                          height="44"
                          rx="4"
                          fill={off.offline > 0 ? '#fef2f2' : '#f8fafc'}
                          stroke={off.offline > 0 ? '#fecaca' : '#e2e8f0'}
                          strokeWidth="1"
                        />
                        <text
                          x="89"
                          y="18"
                          textAnchor="middle"
                          fill={off.offline > 0 ? '#991b1b' : '#64748b'}
                          fontSize="9"
                          fontWeight="600"
                        >
                          OFFLINE
                        </text>
                        <text
                          x="89"
                          y="38"
                          textAnchor="middle"
                          fill={off.offline > 0 ? '#dc2626' : '#64748b'}
                          fontSize="15"
                          fontWeight="800"
                          fontFamily="var(--font-mono)"
                        >
                          {off.offline}
                        </text>

                        {/* Overall Office Connectivity Banner */}
                        <rect
                          x="-128"
                          y="54"
                          width="256"
                          height="22"
                          rx="4"
                          fill={off.statusColor}
                          opacity="0.12"
                        />
                        <text
                          x="0"
                          y="69"
                          textAnchor="middle"
                          fill={off.statusColor}
                          fontSize="10"
                          fontWeight="800"
                          letterSpacing="0.04em"
                        >
                          ● {off.connectivityStatus}
                        </text>

                        {/* Interactive Click CTA Footer */}
                        <text
                          x="0"
                          y="94"
                          textAnchor="middle"
                          fill={off.color}
                          fontSize="10"
                          fontWeight="700"
                        >
                          Click to Expand Internal Topology →
                        </text>
                      </g>
                    );
                  })}
                </g>
              )}

              {/* =========================================================
                  VIEW 2: EXPANDED SINGLE OFFICE HIERARCHICAL TOPOLOGY
                  ========================================================= */}
              {activeOffice !== 'ALL' && officeLayout && (
                <g>
                  {/* 1. Central Server PC at the very top */}
                  <g transform="translate(600, 50)">
                    <rect
                      x="-120"
                      y="-25"
                      width="240"
                      height="50"
                      rx="6"
                      fill="#ffffff"
                      stroke="#0f172a"
                      strokeWidth="2"
                      filter="drop-shadow(0 2px 4px rgba(0,0,0,0.06))"
                    />
                    <circle cx="-100" cy="0" r="4" fill="#10b981" />
                    <text
                      x="0"
                      y="-4"
                      textAnchor="middle"
                      fill="#0f172a"
                      fontSize="11"
                      fontWeight="800"
                    >
                      CENTRAL SERVER PC
                    </text>
                    <text
                      x="0"
                      y="12"
                      textAnchor="middle"
                      fill="#0284c7"
                      fontSize="9"
                      fontFamily="var(--font-mono)"
                      fontWeight="600"
                    >
                      NOC Central Monitoring Root
                    </text>
                  </g>

                  {/* Trunk link from Central Server PC to Office Gateway Node */}
                  <line
                    x1="600"
                    y1="75"
                    x2="600"
                    y2={officeLayout.officeRootPos.y - 40}
                    stroke={currentOfficeObj?.color || '#0284c7'}
                    strokeWidth="3"
                  />

                  {/* 2. Office Gateway / Root Node */}
                  <g transform={`translate(${officeLayout.officeRootPos.x}, ${officeLayout.officeRootPos.y})`}>
                    <rect
                      x="-160"
                      y="-35"
                      width="320"
                      height="70"
                      rx="8"
                      fill="#ffffff"
                      stroke={currentOfficeObj?.color || '#0284c7'}
                      strokeWidth="2.5"
                      filter="drop-shadow(0 4px 8px rgba(0,0,0,0.08))"
                    />
                    <rect
                      x="-160"
                      y="-35"
                      width="320"
                      height="22"
                      rx="7"
                      fill={currentOfficeObj?.color || '#0284c7'}
                    />
                    <text
                      x="-145"
                      y="-20"
                      fill="#ffffff"
                      fontSize="10"
                      fontWeight="800"
                      letterSpacing="0.05em"
                    >
                      OFFICE LOGICAL ROOT • {currentOfficeObj?.code}
                    </text>
                    <text
                      x="145"
                      y="-20"
                      textAnchor="end"
                      fill="#ffffff"
                      fontSize="9.5"
                      fontWeight="600"
                    >
                      {currentOfficeDevices.length} Nodes Monitored
                    </text>

                    <text
                      x="0"
                      y="4"
                      textAnchor="middle"
                      fill="#0f172a"
                      fontSize="13"
                      fontWeight="800"
                    >
                      {currentOfficeObj?.fullName}
                    </text>
                    <text
                      x="0"
                      y="22"
                      textAnchor="middle"
                      fill="#64748b"
                      fontSize="9.5"
                      fontWeight="500"
                    >
                      {currentOfficeObj?.description}
                    </text>
                  </g>

                  {/* 3. Verified Physical Connection Links */}
                  {officeLayout.links.map((link) => {
                    const midX = (link.from.x + link.to.x) / 2;
                    const midY = (link.from.y + link.to.y) / 2;

                    return (
                      <g key={link.id}>
                        <line
                          x1={link.from.x}
                          y1={link.from.y}
                          x2={link.to.x}
                          y2={link.to.y}
                          stroke={link.isVerified ? '#0284c7' : '#94a3b8'}
                          strokeWidth={link.isTrunk ? 3 : link.isVerified ? 2 : 1.5}
                          strokeDasharray={link.isVerified ? 'none' : '5, 5'}
                        />
                        {/* Port Label Chip */}
                        {link.label && (
                          <g transform={`translate(${midX}, ${midY})`}>
                            <rect
                              x="-55"
                              y="-9"
                              width="110"
                              height="18"
                              rx="3"
                              fill="#ffffff"
                              stroke={link.isVerified ? '#bae6fd' : '#e2e8f0'}
                              strokeWidth="1"
                            />
                            <text
                              x="0"
                              y="3"
                              textAnchor="middle"
                              fill={link.isVerified ? '#0284c7' : '#64748b'}
                              fontSize="8.5"
                              fontFamily="var(--font-mono)"
                              fontWeight={link.isVerified ? '700' : '500'}
                            >
                              {link.label}
                            </text>
                          </g>
                        )}
                      </g>
                    );
                  })}

                  {/* 4. Render All Infrastructure & Connected Nodes */}
                  {currentOfficeDevices.map((dev) => {
                    const coords = officeLayout.coordinates.get(dev.id);
                    if (!coords) return null;

                    const st = deviceStatuses[dev.id] || { status: 'unknown' };
                    const isOnline = (st.status || '').toLowerCase() === 'online';
                    const isOffline = (st.status || '').toLowerCase() === 'offline';
                    const isVerifiedLoc = dev.location_verification === 'verified';

                    let borderColor = '#94a3b8';
                    let dotColor = '#94a3b8';
                    if (isOnline) {
                      borderColor = '#10b981';
                      dotColor = '#10b981';
                    } else if (isOffline) {
                      borderColor = '#ef4444';
                      dotColor = '#ef4444';
                    }

                    const locationStr = formatCompactLocation(dev);

                    return (
                      <g
                        key={`node-${dev.id}`}
                        transform={`translate(${coords.x}, ${coords.y})`}
                        onClick={() => setSelectedDevice(dev)}
                        style={{ cursor: 'pointer' }}
                        className="device-node-card"
                      >
                        {/* Node Card Box */}
                        <rect
                          x="-95"
                          y="-45"
                          width="190"
                          height="90"
                          rx="6"
                          fill="#ffffff"
                          stroke={borderColor}
                          strokeWidth="2"
                          filter="drop-shadow(0 2px 4px rgba(0,0,0,0.06))"
                        />

                        {/* Top Header Strip with Role & Status Dot */}
                        <rect
                          x="-95"
                          y="-45"
                          width="190"
                          height="20"
                          rx="5"
                          fill="#f8fafc"
                          stroke={borderColor}
                          strokeWidth="0.5"
                        />
                        <circle cx="-81" cy="-35" r="4" fill={dotColor} />
                        <text
                          x="-71"
                          y="-31"
                          fontSize="9.5"
                          fill="#475569"
                          fontWeight="700"
                        >
                          {dev.device_type || 'PC / Node'}
                        </text>

                        {/* Location Verified Pin indicator */}
                        {isVerifiedLoc && (
                          <circle cx="80" cy="-35" r="4" fill="#059669" />
                        )}

                        {/* Device Name */}
                        <text
                          x="0"
                          y="-10"
                          fontSize="11.5"
                          fill="#0f172a"
                          fontWeight="700"
                          textAnchor="middle"
                        >
                          {dev.name.length > 22 ? dev.name.substring(0, 20) + '...' : dev.name}
                        </text>

                        {/* IP Address */}
                        <text
                          x="0"
                          y="6"
                          fontSize="10"
                          fill="#0284c7"
                          textAnchor="middle"
                          fontFamily="var(--font-mono)"
                          fontWeight="600"
                        >
                          {dev.ip_address || 'DHCP Unbound'}
                        </text>

                        {/* Location Tag */}
                        <rect
                          x="-88"
                          y="15"
                          width="176"
                          height="18"
                          rx="3"
                          fill={isVerifiedLoc ? '#ecfdf5' : '#f1f5f9'}
                          stroke={isVerifiedLoc ? '#a7f3d0' : '#e2e8f0'}
                          strokeWidth="1"
                        />
                        <text
                          x="0"
                          y="27"
                          fontSize="8.5"
                          fill={isVerifiedLoc ? '#065f46' : '#64748b'}
                          textAnchor="middle"
                          fontWeight={isVerifiedLoc ? '600' : '400'}
                        >
                          {locationStr.length > 27 ? locationStr.substring(0, 25) + '...' : locationStr}
                        </text>

                        {/* Latency badge */}
                        {st.latency_ms !== null && st.latency_ms !== undefined && (
                          <text
                            x="0"
                            y="41"
                            fontSize="8.5"
                            fill="#059669"
                            textAnchor="middle"
                            fontFamily="var(--font-mono)"
                            fontWeight="600"
                          >
                            {st.latency_ms} ms ping
                          </text>
                        )}
                      </g>
                    );
                  })}

                  {/* 5. Unlinked Devices Boundary Box if unlinked nodes exist */}
                  {officeLayout.unlinkedDevices.length > 0 && (
                    <g transform={`translate(600, ${officeLayout.unlinkedStartY - 40})`}>
                      <text
                        x="0"
                        y="0"
                        textAnchor="middle"
                        fill="#64748b"
                        fontSize="11"
                        fontWeight="700"
                        letterSpacing="0.04em"
                      >
                        STANDALONE / UNLINKED ACCESS NODES (NO PARENT SWITCH VERIFIED)
                      </text>
                      <text
                        x="0"
                        y="14"
                        textAnchor="middle"
                        fill="#94a3b8"
                        fontSize="9"
                      >
                        Monitored via subnet broadcast • Physical switch port assignment pending field audit
                      </text>
                    </g>
                  )}
                </g>
              )}
            </g>
          </svg>
        </div>
      </div>

      {/* =========================================================
          DEVICE QUICK INSPECTION DRAWER
          ========================================================= */}
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

      {/* =========================================================
          DEVICE REGISTRATION & EDIT MODAL
          ========================================================= */}
      <DeviceFormModal
        isOpen={isAddModalOpen || !!deviceToEdit}
        onClose={() => {
          setIsAddModalOpen(false);
          setDeviceToEdit(null);
        }}
        initialDevice={deviceToEdit}
      />
    </div>
  );
};

export default NetworkTopology;
