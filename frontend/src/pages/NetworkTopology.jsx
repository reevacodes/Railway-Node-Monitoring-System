import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useNetwork } from '../context/NetworkContext';
import api from '../services/api';
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
  ChevronDown,
  Monitor,
  Wifi,
  Router,
} from 'lucide-react';

/**
 * Official Railway Office Branches & Subnet Specifications
 * DRM: 192.168.40.0/24 & 192.168.41.0/24 (/23 supernet: 192.168.40.0/23)
 * Control: 192.168.50.0/24 & 192.168.51.0/24 (/23 supernet: 192.168.50.0/23)
 * NIA: 192.168.20.0/24 & 192.168.21.0/24 (/23 supernet: 192.168.20.0/23)
 */
export const OFFICES = [
  {
    id: 'DRM',
    name: 'DRM Office',
    fullName: 'DRM Headquarters Office Complex',
    code: 'DRM-HQ',
    role: 'Divisional Management, IT Demarcation & Operational Divisions',
    color: '#0284c7', // Sky blue
    bgLight: '#f0f9ff',
    borderLight: '#bae6fd',
    subnets: ['192.168.40.0/24', '192.168.41.0/24'],
    vlan: 'Subnets: 192.168.40.0/24 & 192.168.41.0/24 (/23 supernet)',
    description: 'Divisional administrative desks, IT room, S&T department, and engineering planning workstations.',
  },
  {
    id: 'CONTROL',
    name: 'Control Office',
    fullName: 'Central Railway Control & Dispatch Office',
    code: 'CTRL-OPS',
    role: 'Central Traffic, Section Controller & Train Operations Command',
    color: '#059669', // Emerald green
    bgLight: '#ecfdf5',
    borderLight: '#a7f3d0',
    subnets: ['192.168.50.0/24', '192.168.51.0/24'],
    vlan: 'Subnets: 192.168.50.0/24 & 192.168.51.0/24 (/23 supernet)',
    description: 'Real-time train dispatch console, section controller desks, traffic signaling, and HOR monitoring cell.',
  },
  {
    id: 'NIA',
    name: 'NIA Office',
    fullName: 'NIA Railway Security & Surveillance Office',
    code: 'NIA-SEC',
    role: 'Railway Security, CCTV Surveillance & Video Feeds',
    color: '#7c3aed', // Purple
    bgLight: '#f5f3ff',
    borderLight: '#ddd6fe',
    subnets: ['192.168.20.0/24', '192.168.21.0/24'],
    vlan: 'Subnets: 192.168.20.0/24 & 192.168.21.0/24 (/23 supernet)',
    description: 'Administrative intelligence consoles, CCTV NVRs, and security inspection gateways.',
  },
];

/**
 * Resolves reliable office assignment for any device using database-aligned CIDR rules.
 * 192.168.40.x & 192.168.41.x -> DRM Office (Never NIA)
 * 192.168.50.x & 192.168.51.x -> Control Office
 * 192.168.20.x & 192.168.21.x -> NIA Office
 */
export const getDeviceOfficeId = (device) => {
  // 1. If backend matched_office is present, use its office_code
  if (device?.matched_office?.office_code || device?.matched_office?.code) {
    const c = (device.matched_office.office_code || device.matched_office.code).toUpperCase();
    if (c === 'DRM' || c === 'CONTROL' || c === 'NIA') return c;
  }

  // 2. Official Railway Office IP Allocation (Strict database-aligned CIDR ranges)
  const ip = device?.ip_address ? device.ip_address.trim() : '';
  if (ip) {
    if (ip.startsWith('192.168.40.') || ip.startsWith('192.168.41.')) {
      return 'DRM';
    }
    if (ip.startsWith('192.168.50.') || ip.startsWith('192.168.51.')) {
      return 'CONTROL';
    }
    if (ip.startsWith('192.168.20.') || ip.startsWith('192.168.21.')) {
      return 'NIA';
    }
  }

  // 3. Fallback: manual office property
  if (device?.office) {
    const o = String(device.office).toUpperCase();
    if (o.includes('DRM')) return 'DRM';
    if (o.includes('CONTROL') || o.includes('CABIN')) return 'CONTROL';
    if (o.includes('NIA') || o.includes('TEL')) return 'NIA';
  }

  // 4. Physical building and room hints
  const str = `${device?.building || ''} ${device?.room || ''} ${device?.name || ''}`.toLowerCase();
  if (
    str.includes('control') ||
    str.includes('cabin') ||
    str.includes('controller') ||
    str.includes('hor cell') ||
    str.includes('cmi')
  ) {
    return 'CONTROL';
  }
  if (str.includes('nia')) {
    return 'NIA';
  }

  // Default to DRM
  return 'DRM';
};

/**
 * Resolves Subnet Label for a device
 */
export const getDeviceSubnetLabel = (device) => {
  if (device?.matched_subnet?.cidr_prefix) {
    return `${device.matched_subnet.network_address}/${device.matched_subnet.cidr_prefix}`;
  }
  const ip = device?.ip_address ? device.ip_address.trim() : '';
  if (ip.startsWith('192.168.40.')) return '192.168.40.0/24';
  if (ip.startsWith('192.168.41.')) return '192.168.41.0/24';
  if (ip.startsWith('192.168.50.')) return '192.168.50.0/24';
  if (ip.startsWith('192.168.51.')) return '192.168.51.0/24';
  if (ip.startsWith('192.168.20.')) return '192.168.20.0/24';
  if (ip.startsWith('192.168.21.')) return '192.168.21.0/24';
  if (ip.startsWith('192.168.1.')) return '192.168.1.0/24';
  if (ip.startsWith('192.168.10.')) return '192.168.10.0/24';
  return 'Unassigned Network';
};

export const NetworkTopology = () => {
  const { devices, deviceStatuses, subnets: contextSubnets, offices: contextOffices, refreshData } = useNetwork();

  // Navigation: 'ALL' (Central Server Tree Overview of 3 offices) or 'DRM' | 'CONTROL' | 'NIA' (Expanded Office)
  const [activeOffice, setActiveOffice] = useState('ALL');
  const [selectedSubnetFilter, setSelectedSubnetFilter] = useState('ALL'); // 'ALL' or specific subnet CIDR (e.g. '192.168.40.0/24')
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [deviceToEdit, setDeviceToEdit] = useState(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // View Mode: 'CANVAS' (Interactive Topology Canvas) | 'TREE' (Subnet Groups Hierarchy View)
  const [viewMode, setViewMode] = useState('CANVAS');

  // Filters & Search
  const [statusFilter, setStatusFilter] = useState('ALL'); // 'ALL' | 'ONLINE' | 'OFFLINE'
  const [searchQuery, setSearchQuery] = useState('');

  // Tree Hierarchy state
  const [hierarchyData, setHierarchyData] = useState(null);
  const [isHierarchyLoading, setIsHierarchyLoading] = useState(false);
  const [collapsedSubnets, setCollapsedSubnets] = useState({});

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

  // Fetch full hierarchy for Tree View
  const loadHierarchy = async () => {
    setIsHierarchyLoading(true);
    try {
      const data = await api.getTopologyHierarchy();
      setHierarchyData(data);
    } catch (err) {
      console.error('Failed to load topology hierarchy:', err);
    } finally {
      setIsHierarchyLoading(false);
    }
  };

  useEffect(() => {
    loadHierarchy();
  }, [contextSubnets, contextOffices]);

  // Office Stats for 'ALL' Canvas View
  const officeStats = useMemo(() => {
    return OFFICES.map((off) => {
      const officeDevices = devices.filter((d) => getDeviceOfficeId(d) === off.id);
      const onlineCount = officeDevices.filter(
        (d) => (deviceStatuses[d.id]?.status || '').toLowerCase() === 'online'
      ).length;
      const offlineCount = officeDevices.filter(
        (d) => (deviceStatuses[d.id]?.status || '').toLowerCase() === 'offline'
      ).length;
      const unknownCount = officeDevices.length - onlineCount - offlineCount;

      return {
        ...off,
        deviceCount: officeDevices.length,
        onlineCount,
        offlineCount,
        unknownCount,
      };
    });
  }, [devices, deviceStatuses]);

  // Devices belonging to active office (filtered by search, status, and subnet)
  const currentOfficeDevices = useMemo(() => {
    if (activeOffice === 'ALL') return [];
    const base = devices.filter((d) => getDeviceOfficeId(d) === activeOffice);

    return base.filter((d) => {
      // Subnet filter
      if (selectedSubnetFilter !== 'ALL') {
        const subLabel = getDeviceSubnetLabel(d);
        if (subLabel !== selectedSubnetFilter) return false;
      }

      // Status filter
      const st = (deviceStatuses[d.id]?.status || 'unknown').toLowerCase();
      if (statusFilter === 'ONLINE' && st !== 'online') return false;
      if (statusFilter === 'OFFLINE' && st !== 'offline') return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          (d.name || '').toLowerCase().includes(q) ||
          (d.contact_person || '').toLowerCase().includes(q) ||
          (d.ip_address || '').toLowerCase().includes(q) ||
          (d.mac_address || '').toLowerCase().includes(q) ||
          (d.room || '').toLowerCase().includes(q) ||
          (d.building || '').toLowerCase().includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [devices, activeOffice, selectedSubnetFilter, statusFilter, searchQuery, deviceStatuses]);

  // Distinct subnets present in the current active office
  const activeOfficeSubnets = useMemo(() => {
    if (activeOffice === 'ALL') return [];
    const officeDevs = devices.filter((d) => getDeviceOfficeId(d) === activeOffice);
    const subMap = new Map();

    officeDevs.forEach((d) => {
      const label = getDeviceSubnetLabel(d);
      if (!subMap.has(label)) {
        subMap.set(label, { label, total: 0, online: 0, offline: 0 });
      }
      const entry = subMap.get(label);
      entry.total += 1;
      const st = (deviceStatuses[d.id]?.status || '').toLowerCase();
      if (st === 'online') entry.online += 1;
      else if (st === 'offline') entry.offline += 1;
    });

    return Array.from(subMap.values());
  }, [devices, activeOffice, deviceStatuses]);

  // -------------------------------------------------------------
  // Layout Hierarchy Algorithm for Expanded Office View
  // Separates:
  // 1. Core/Distribution Infrastructure (Routers, Switches, Firewalls)
  // 2. Connected Child Devices (Verified via parent_device_id)
  // 3. Standalone / Unlinked Devices (NO PARENT SWITCH VERIFIED)
  // -------------------------------------------------------------
  const officeLayout = useMemo(() => {
    if (activeOffice === 'ALL') return null;

    const devs = currentOfficeDevices;
    const parentMap = new Map();
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

    // 3. Position Unlinked Devices in dedicated "Standalone / Unlinked Devices Section"
    // Calculate heading Y to ensure dedicated row and zero overlap
    let headingY = 250;
    if (rootInfra.length > 0) {
      headingY = connectedChildren.length > 0 ? 550 : 420;
    }

    // Ample vertical clearance between heading banner and first card row
    const unlinkedStartY = headingY + 110;
    const unlinkedPerRow = 4;
    const unlinkedColWidth = 230;
    const unlinkedRowHeight = 135;

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

    // Compute dynamic canvas height based on maximum content Y
    const totalUnlinkedRows = Math.ceil(unlinkedDevices.length / unlinkedPerRow);
    const maxContentY = unlinkedDevices.length > 0
      ? unlinkedStartY + (totalUnlinkedRows - 1) * unlinkedRowHeight + 50
      : (connectedChildren.length > 0 ? 500 : 380);

    const dynamicCanvasHeight = Math.max(720, maxContentY + 100);

    return {
      officeRootPos,
      coordinates,
      links,
      rootInfra,
      connectedChildren,
      unlinkedDevices,
      headingY,
      unlinkedStartY,
      dynamicCanvasHeight,
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

  const activeOfficeMeta = useMemo(() => {
    return OFFICES.find((o) => o.id === activeOffice) || OFFICES[0];
  }, [activeOffice]);

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
                  setSelectedSubnetFilter('ALL');
                  handleReset();
                }}
                style={{ padding: '4px 8px', fontSize: '11.5px' }}
                title="Return to 3-Office Topology Overview"
              >
                <ArrowLeft size={13} />
                <span>All Offices</span>
              </button>
            )}

            <h1>Railway Network Topology</h1>

            {activeOffice !== 'ALL' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <ChevronRight size={14} style={{ color: '#94a3b8' }} />
                <span
                  style={{
                    fontSize: '11.5px',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    backgroundColor: activeOfficeMeta.bgLight,
                    color: activeOfficeMeta.color,
                    border: `1px solid ${activeOfficeMeta.borderLight}`,
                    fontWeight: 700,
                  }}
                >
                  {activeOfficeMeta.name.toUpperCase()}
                </span>
              </div>
            )}
          </div>
          <div className="page-subtitle">
            {activeOffice === 'ALL'
              ? 'Hierarchical tree map of Central Server routing to DRM Office, Control Office, and NIA Office.'
              : `Operational topology for ${activeOfficeMeta.fullName} with verified switch uplinks and standalone nodes.`}
          </div>
        </div>

        {/* View Mode & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Dual View Mode Switcher */}
          <div
            style={{
              display: 'flex',
              backgroundColor: '#e2e8f0',
              padding: '2px',
              borderRadius: '4px',
              gap: '2px',
            }}
          >
            <button
              className={`btn btn-sm ${viewMode === 'CANVAS' ? 'btn-primary' : 'btn-secondary'}`}
              style={{
                fontSize: '11px',
                padding: '3px 10px',
                border: 'none',
                boxShadow: viewMode === 'CANVAS' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
              }}
              onClick={() => setViewMode('CANVAS')}
            >
              <Network size={12} />
              <span>Topology Canvas</span>
            </button>
            <button
              className={`btn btn-sm ${viewMode === 'TREE' ? 'btn-primary' : 'btn-secondary'}`}
              style={{
                fontSize: '11px',
                padding: '3px 10px',
                border: 'none',
                boxShadow: viewMode === 'TREE' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
              }}
              onClick={() => setViewMode('TREE')}
            >
              <Layers size={12} />
              <span>Office Subnets View</span>
            </button>
          </div>

          <button
            className="btn btn-secondary"
            onClick={() => {
              if (refreshData) refreshData();
              loadHierarchy();
            }}
            title="Refresh Topology"
          >
            <RotateCcw size={13} className={isHierarchyLoading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* =========================================================
          OFFICE NAVIGATION TABS & REACHABILITY SUMMARY
          ========================================================= */}
      <div
        className="panel"
        style={{
          padding: '10px 16px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '12px',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {/* Office Selection Tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', marginRight: '4px' }}>
            Office Scope:
          </span>

          <button
            type="button"
            className={`btn btn-sm ${activeOffice === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '11.5px', padding: '4px 12px', fontWeight: 600 }}
            onClick={() => {
              setActiveOffice('ALL');
              setSelectedSubnetFilter('ALL');
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
                className={`btn btn-sm ${isSelected ? 'btn-primary' : 'btn-secondary'}`}
                style={{
                  fontSize: '11.5px',
                  padding: '4px 12px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  borderColor: isSelected ? off.color : undefined,
                  backgroundColor: isSelected ? off.color : undefined,
                }}
                onClick={() => {
                  setActiveOffice(off.id);
                  setSelectedSubnetFilter('ALL');
                  handleReset();
                }}
              >
                <span>{off.name}</span>
                <span
                  style={{
                    fontSize: '10px',
                    padding: '1px 5px',
                    borderRadius: '10px',
                    backgroundColor: isSelected ? 'rgba(255,255,255,0.25)' : '#e2e8f0',
                    color: isSelected ? '#ffffff' : '#475569',
                    fontWeight: 700,
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Reachability Indicators */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '11.5px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#059669', fontWeight: 600 }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#10b981' }} />
            {totalOnlineCount} Online
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#dc2626', fontWeight: 600 }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#ef4444' }} />
            {totalOfflineCount} Offline
          </span>
          <span style={{ color: '#64748b' }}>
            Total Assets: <strong>{totalFleetCount}</strong>
          </span>
        </div>
      </div>

      {/* =========================================================
          SUBNET-LEVEL FILTER PILLS (Visible in Expanded Office View)
          ========================================================= */}
      {activeOffice !== 'ALL' && activeOfficeSubnets.length > 0 && (
        <div
          className="panel"
          style={{
            padding: '8px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
          }}
        >
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Subnet Filter:
          </span>

          <button
            type="button"
            className={`btn btn-sm ${selectedSubnetFilter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '11px', padding: '2px 8px', fontWeight: 600 }}
            onClick={() => setSelectedSubnetFilter('ALL')}
          >
            All Subnets ({devices.filter((d) => getDeviceOfficeId(d) === activeOffice).length})
          </button>

          {activeOfficeSubnets.map((sub) => {
            const isSelected = selectedSubnetFilter === sub.label;
            return (
              <button
                key={sub.label}
                type="button"
                className={`btn btn-sm ${isSelected ? 'btn-primary' : 'btn-secondary'}`}
                style={{
                  fontSize: '11px',
                  padding: '2px 8px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
                onClick={() => setSelectedSubnetFilter(sub.label)}
              >
                <span className="mono">{sub.label}</span>
                <span
                  style={{
                    fontSize: '9.5px',
                    padding: '1px 5px',
                    borderRadius: '8px',
                    backgroundColor: isSelected ? 'rgba(255,255,255,0.25)' : '#e2e8f0',
                    color: isSelected ? '#ffffff' : '#334155',
                  }}
                >
                  {sub.total} nodes {sub.online > 0 ? `(${sub.online} up)` : ''}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* =========================================================
          VIEW MODE 1: INTERACTIVE TOPOLOGY CANVAS
          ========================================================= */}
      {viewMode === 'CANVAS' ? (
        <div className="panel" style={{ position: 'relative', overflow: 'hidden' }}>
          {/* Canvas Sub-Header: Filters & Search */}
          <div
            style={{
              padding: '8px 14px',
              backgroundColor: '#ffffff',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            {/* Reachability Status Filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>Filter:</span>
              <button
                className={`btn btn-sm ${statusFilter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: '11px', padding: '2px 8px' }}
                onClick={() => setStatusFilter('ALL')}
              >
                All Nodes
              </button>
              <button
                className={`btn btn-sm ${statusFilter === 'ONLINE' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: '11px', padding: '2px 8px', color: statusFilter === 'ONLINE' ? '#fff' : '#059669' }}
                onClick={() => setStatusFilter('ONLINE')}
              >
                Online Only
              </button>
              <button
                className={`btn btn-sm ${statusFilter === 'OFFLINE' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: '11px', padding: '2px 8px', color: statusFilter === 'OFFLINE' ? '#fff' : '#dc2626' }}
                onClick={() => setStatusFilter('OFFLINE')}
              >
                Offline Only
              </button>
            </div>

            {/* Quick Search inside Topology */}
            <div style={{ position: 'relative', width: '220px' }}>
              <Search size={12} style={{ position: 'absolute', left: '8px', top: '8px', color: '#94a3b8' }} />
              <input
                type="text"
                className="form-input"
                style={{ paddingLeft: '26px', height: '28px', fontSize: '11px' }}
                placeholder="Search name, IP, rack, room..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* Canvas Viewport Container with Dynamic Height & Vertical Scrolling */}
          <div
            className="topology-container"
            style={{
              height: '740px',
              maxHeight: 'calc(100vh - 220px)',
              overflowY: 'auto',
              overflowX: 'auto',
              position: 'relative',
              backgroundColor: '#f8fafc',
            }}
          >
            {/* Floating Zoom & Pan Controls */}
            <div className="topology-controls" style={{ zIndex: 10 }}>
              <button className="topology-ctrl-btn" onClick={handleZoomIn} title="Zoom In">
                <ZoomIn size={14} />
              </button>
              <button className="topology-ctrl-btn" onClick={handleZoomOut} title="Zoom Out">
                <ZoomOut size={14} />
              </button>
              <button className="topology-ctrl-btn" onClick={handleReset} title="Reset View / Center">
                <RotateCcw size={14} />
              </button>
            </div>

            {/* Floating Topology Legend */}
            <div className="topology-legend" style={{ zIndex: 10 }}>
              <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: '4px', fontSize: '10.5px' }}>
                Topology Key
              </div>
              <div className="legend-item">
                <span className="status-dot" style={{ backgroundColor: '#10b981' }} />
                <span>Online (ICMP Reachable)</span>
              </div>
              <div className="legend-item">
                <span className="status-dot" style={{ backgroundColor: '#ef4444' }} />
                <span>Offline (Timeout / Loss)</span>
              </div>
              <div className="legend-item">
                <span style={{ width: '14px', height: '2px', backgroundColor: '#0284c7', display: 'inline-block' }} />
                <span>Verified Switch Uplink</span>
              </div>
              <div className="legend-item">
                <span style={{ width: '14px', height: '2px', borderTop: '2px dashed #94a3b8', display: 'inline-block' }} />
                <span>Unlinked Access Node</span>
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
                width: '100%',
                minWidth: '1280px',
                height: `${activeOffice === 'ALL' ? 680 : officeLayout?.dynamicCanvasHeight || 720}px`,
                cursor: isDragging ? 'grabbing' : 'grab',
                userSelect: 'none',
              }}
            >
              <defs>
                <pattern id="railway-grid" width="32" height="32" patternUnits="userSpaceOnUse">
                  <circle cx="2" cy="2" r="1" fill="#cbd5e1" opacity="0.45" />
                </pattern>
              </defs>

              <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
                <rect width="3200" height="3200" x="-600" y="-600" fill="url(#railway-grid)" />

                {/* =========================================================
                    A. MAIN NETWORK HIERARCHY (ALL OFFICES VIEW)
                    Root: CENTRAL SERVER PC
                    Branches: DRM OFFICE | CONTROL OFFICE | NIA OFFICE
                    ========================================================= */}
                {activeOffice === 'ALL' && (
                  <g>
                    {/* Trunk Lines from Central Server to 3 Offices */}
                    <path
                      d="M 600 115 L 600 190 L 220 190 L 220 245"
                      fill="none"
                      stroke="#0284c7"
                      strokeWidth="2.5"
                    />
                    <path
                      d="M 600 115 L 600 245"
                      fill="none"
                      stroke="#059669"
                      strokeWidth="2.5"
                    />
                    <path
                      d="M 600 115 L 600 190 L 980 190 L 980 245"
                      fill="none"
                      stroke="#7c3aed"
                      strokeWidth="2.5"
                      strokeDasharray="4, 4"
                    />

                    {/* Trunk Line Pulse Indicators */}
                    <circle cx="600" cy="190" r="4" fill="#059669" />
                    <circle cx="220" cy="190" r="4" fill="#0284c7" />
                    <circle cx="980" cy="190" r="4" fill="#7c3aed" />

                    {/* 1. Top Root: CENTRAL SERVER PC NODE */}
                    <g transform="translate(600, 75)">
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
                      >
                        LOGICAL ROOT • CENTRAL HOST
                      </text>

                      <text
                        x="0"
                        y="-2"
                        textAnchor="middle"
                        fill="#0f172a"
                        fontSize="13"
                        fontWeight="800"
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
                      >
                        Central ICMP Telemetry & NOC Routing Core
                      </text>
                    </g>

                    {/* 2. Three Office Branch Cards */}
                    {officeStats.map((off, idx) => {
                      const posX = idx === 0 ? 220 : idx === 1 ? 600 : 980;
                      const posY = 350;

                      return (
                        <g
                          key={off.id}
                          transform={`translate(${posX}, ${posY})`}
                          onClick={() => {
                            setActiveOffice(off.id);
                            setSelectedSubnetFilter('ALL');
                            handleReset();
                          }}
                          style={{ cursor: 'pointer' }}
                          className="office-summary-card"
                        >
                          {/* Outer Container */}
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

                          {/* Top Header Banner */}
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
                            {off.code}
                          </text>

                          {/* Subnet / VLAN Specification */}
                          <rect
                            x="-135"
                            y="-52"
                            width="270"
                            height="20"
                            rx="4"
                            fill={off.bgLight}
                            stroke={off.borderLight}
                            strokeWidth="1"
                          />
                          <text
                            x="0"
                            y="-38"
                            textAnchor="middle"
                            fill={off.color}
                            fontSize="9.5"
                            fontWeight="600"
                            fontFamily="var(--font-mono)"
                          >
                            {off.subnets.join(' • ')}
                          </text>

                          {/* Metric 1: Total Devices */}
                          <g transform="translate(-135, -22)">
                            <rect width="84" height="44" rx="4" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="1" />
                            <text x="42" y="15" textAnchor="middle" fill="#64748b" fontSize="8.5" fontWeight="600">
                              TOTAL NODES
                            </text>
                            <text x="42" y="34" textAnchor="middle" fill="#0f172a" fontSize="14" fontWeight="800">
                              {off.deviceCount}
                            </text>
                          </g>

                          {/* Metric 2: Online Devices */}
                          <g transform="translate(-42, -22)">
                            <rect width="84" height="44" rx="4" fill="#ecfdf5" stroke="#a7f3d0" strokeWidth="1" />
                            <text x="42" y="15" textAnchor="middle" fill="#059669" fontSize="8.5" fontWeight="600">
                              ONLINE
                            </text>
                            <text x="42" y="34" textAnchor="middle" fill="#047857" fontSize="14" fontWeight="800">
                              {off.onlineCount}
                            </text>
                          </g>

                          {/* Metric 3: Offline Devices */}
                          <g transform="translate(51, -22)">
                            <rect width="84" height="44" rx="4" fill="#fef2f2" stroke="#fecaca" strokeWidth="1" />
                            <text x="42" y="15" textAnchor="middle" fill="#dc2626" fontSize="8.5" fontWeight="600">
                              OFFLINE
                            </text>
                            <text x="42" y="34" textAnchor="middle" fill="#b91c1c" fontSize="14" fontWeight="800">
                              {off.offlineCount}
                            </text>
                          </g>

                          {/* Click to expand action button */}
                          <rect
                            x="-135"
                            y="32"
                            width="270"
                            height="24"
                            rx="4"
                            fill={off.color}
                            opacity="0.1"
                          />
                          <text
                            x="0"
                            y="48"
                            textAnchor="middle"
                            fill={off.color}
                            fontSize="10"
                            fontWeight="700"
                          >
                            CLICK TO EXPAND OFFICE TOPOLOGY →
                          </text>

                          {/* Description text */}
                          <text
                            x="0"
                            y="85"
                            textAnchor="middle"
                            fill="#64748b"
                            fontSize="8"
                            fontFamily="var(--font-sans)"
                          >
                            {off.description.length > 55 ? off.description.substring(0, 52) + '...' : off.description}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                )}

                {/* =========================================================
                    B. EXPANDED OFFICE VIEW (DRM / CONTROL / NIA)
                    1. Office Root Hub
                    2. Infrastructure Switches (Root Infra)
                    3. Connected Children Nodes
                    4. DEDICATED ROW: STANDALONE / UNLINKED ACCESS NODES
                       (NO OVERLAP with cards below!)
                    ========================================================= */}
                {activeOffice !== 'ALL' && officeLayout && (
                  <g>
                    {/* 1. Office Root Hub Node */}
                    <g transform="translate(600, 75)">
                      <rect
                        x="-175"
                        y="-45"
                        width="350"
                        height="90"
                        rx="8"
                        fill="#ffffff"
                        stroke={activeOfficeMeta.color}
                        strokeWidth="2.5"
                        filter="drop-shadow(0 4px 6px rgba(0, 0, 0, 0.08))"
                      />
                      <rect
                        x="-175"
                        y="-45"
                        width="350"
                        height="24"
                        rx="7"
                        fill={activeOfficeMeta.color}
                      />
                      <text
                        x="-155"
                        y="-30"
                        fill="#ffffff"
                        fontSize="10"
                        fontWeight="700"
                        letterSpacing="0.05em"
                      >
                        OFFICE LOGICAL ROOT HUB • {activeOfficeMeta.code}
                      </text>
                      <text
                        x="0"
                        y="-2"
                        textAnchor="middle"
                        fill="#0f172a"
                        fontSize="14"
                        fontWeight="800"
                      >
                        {activeOfficeMeta.name.toUpperCase()}
                      </text>
                      <text
                        x="0"
                        y="16"
                        textAnchor="middle"
                        fill={activeOfficeMeta.color}
                        fontSize="10.5"
                        fontWeight="600"
                        fontFamily="var(--font-mono)"
                      >
                        {activeOfficeMeta.vlan}
                      </text>
                      <text
                        x="0"
                        y="32"
                        textAnchor="middle"
                        fill="#64748b"
                        fontSize="9"
                      >
                        {currentOfficeDevices.length} Operating Nodes Monitored ({officeLayout.unlinkedDevices.length} Standalone)
                      </text>
                    </g>

                    {/* 2. Render Verified Links */}
                    {officeLayout.links.map((link) => (
                      <g key={link.id}>
                        <line
                          x1={link.from.x}
                          y1={link.from.y}
                          x2={link.to.x}
                          y2={link.to.y}
                          stroke={link.isVerified ? '#0284c7' : '#94a3b8'}
                          strokeWidth={link.isTrunk ? 2.5 : 1.5}
                          strokeDasharray={link.isVerified ? 'none' : '4, 4'}
                        />
                        {link.label && (
                          <g transform={`translate(${(link.from.x + link.to.x) / 2}, ${(link.from.y + link.to.y) / 2})`}>
                            <rect
                              x="-38"
                              y="-8"
                              width="76"
                              height="16"
                              rx="3"
                              fill="#f8fafc"
                              stroke="#cbd5e1"
                              strokeWidth="0.8"
                            />
                            <text
                              x="0"
                              y="3"
                              textAnchor="middle"
                              fill="#475569"
                              fontSize="8"
                              fontWeight="600"
                              fontFamily="var(--font-mono)"
                            >
                              {link.label}
                            </text>
                          </g>
                        )}
                      </g>
                    ))}

                    {/* 3. Render All Infrastructure & Connected Nodes */}
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
                      const subnetStr = getDeviceSubnetLabel(dev);

                      return (
                        <g
                          key={`node-${dev.id}`}
                          transform={`translate(${coords.x}, ${coords.y})`}
                          onClick={() => setSelectedDevice(dev)}
                          style={{ cursor: 'pointer' }}
                          className="device-node-card"
                        >
                          {/* Card Box */}
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

                          {/* Card Header Strip */}
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

                          {/* Subnet Pill Badge */}
                          <text
                            x="85"
                            y="-31"
                            textAnchor="end"
                            fontSize="8"
                            fill="#0284c7"
                            fontFamily="var(--font-mono)"
                            fontWeight="600"
                          >
                            {subnetStr.split('/')[0].split('.').slice(2).join('.')}/24
                          </text>

                          <title>{`${dev.name}${dev.contact_person ? `\nUser / Custodian: ${dev.contact_person}` : ''}\nIP: ${dev.ip_address || 'Unbound'}\nLocation: ${locationStr}`}</title>

                          {/* Device Name */}
                          <text
                            x="0"
                            y={dev.contact_person ? "-13" : "-10"}
                            fontSize="11.5"
                            fill="#0f172a"
                            fontWeight="700"
                            textAnchor="middle"
                          >
                            {dev.name.length > 22 ? dev.name.substring(0, 20) + '...' : dev.name}
                          </text>

                          {/* Person Name (under device name) */}
                          {dev.contact_person && (
                            <text
                              x="0"
                              y="0"
                              fontSize="9.5"
                              fill="#1e293b"
                              fontWeight="600"
                              textAnchor="middle"
                            >
                              👤 {dev.contact_person.length > 22 ? dev.contact_person.substring(0, 20) + '...' : dev.contact_person}
                            </text>
                          )}

                          {/* IP Address */}
                          <text
                            x="0"
                            y={dev.contact_person ? "12" : "6"}
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
                            y={dev.contact_person ? "19" : "15"}
                            width="176"
                            height="18"
                            rx="3"
                            fill={isVerifiedLoc ? '#ecfdf5' : '#f1f5f9'}
                            stroke={isVerifiedLoc ? '#a7f3d0' : '#e2e8f0'}
                            strokeWidth="1"
                          />
                          <text
                            x="0"
                            y={dev.contact_person ? "31" : "27"}
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
                              y={dev.contact_person ? "43" : "41"}
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

                    {/* 4. DEDICATED ROW: STANDALONE / UNLINKED ACCESS NODES HEADING
                        Positioned at headingY, with device cards starting at unlinkedStartY (headingY + 110)
                        Guarantees 43px+ of clean vertical space with ZERO CARD OVERLAP! */}
                    {officeLayout.unlinkedDevices.length > 0 && (
                      <g transform={`translate(600, ${officeLayout.headingY})`}>
                        {/* Distinct Header Banner Box */}
                        <rect
                          x="-280"
                          y="-18"
                          width="560"
                          height="44"
                          rx="6"
                          fill="#f8fafc"
                          stroke="#cbd5e1"
                          strokeWidth="1.5"
                          filter="drop-shadow(0 2px 4px rgba(0,0,0,0.04))"
                        />
                        <circle cx="-255" cy="4" r="5" fill="#f59e0b" />
                        <text
                          x="0"
                          y="-1"
                          textAnchor="middle"
                          fill="#1e293b"
                          fontSize="12"
                          fontWeight="800"
                          letterSpacing="0.05em"
                        >
                          STANDALONE / UNLINKED ACCESS NODES (NO PARENT SWITCH VERIFIED)
                        </text>
                        <text
                          x="0"
                          y="15"
                          textAnchor="middle"
                          fill="#64748b"
                          fontSize="9.5"
                          fontWeight="500"
                        >
                          Monitored via direct IP telemetry • Physical switch port assignment pending field audit ({officeLayout.unlinkedDevices.length} nodes)
                        </text>
                      </g>
                    )}
                  </g>
                )}
              </g>
            </svg>
          </div>
        </div>
      ) : (
        /* =========================================================
            VIEW MODE 2: OFFICE SUBNETS HIERARCHY TREE VIEW
            Subnet Grouping:
            Office -> Subnets (40.x, 41.x, etc.) -> Switches, PCs, Unlinked Nodes
            ========================================================= */
        <div>
          {isHierarchyLoading ? (
            <div className="panel" style={{ padding: '36px', textAlign: 'center', color: '#64748b' }}>
              <RotateCcw size={18} className="spin" style={{ display: 'inline-block', marginBottom: '8px' }} />
              <div>Loading Subnet Hierarchy...</div>
            </div>
          ) : !hierarchyData || !hierarchyData.offices ? (
            <div className="panel">
              <div className="panel-body">
                <EmptyState
                  title="No Office Subnet Groupings Available"
                  description="Configure subnets in Subnet Management to populate the operational hierarchy."
                />
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {hierarchyData.offices
                .filter((off) => activeOffice === 'ALL' || off.office_code === activeOffice)
                .map((office) => {
                  const subnetsList = office.subnets || [];

                  return (
                    <div key={office.office_id} className="panel" style={{ overflow: 'hidden' }}>
                      {/* Office Header */}
                      <div
                        style={{
                          padding: '12px 18px',
                          backgroundColor: '#f8fafc',
                          borderBottom: '1px solid #e2e8f0',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: '10px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <Building2 size={16} style={{ color: '#0284c7' }} />
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
                                {office.office_name.toUpperCase()}
                              </span>
                              <span
                                style={{
                                  fontSize: '10.5px',
                                  fontWeight: 700,
                                  padding: '1px 6px',
                                  borderRadius: '3px',
                                  backgroundColor: '#e0f2fe',
                                  color: '#0369a1',
                                }}
                              >
                                {office.office_code}
                              </span>
                            </div>
                            {office.description && (
                              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '1px' }}>
                                {office.description}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Office Status Tally */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px' }}>
                          <span style={{ fontWeight: 600, color: '#0f172a' }}>
                            {office.total_devices} Operating Nodes
                          </span>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              color: '#059669',
                              fontWeight: 600,
                              backgroundColor: '#ecfdf5',
                              padding: '2px 8px',
                              borderRadius: '12px',
                            }}
                          >
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10b981' }} />
                            {office.online_devices} Online
                          </span>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              color: '#dc2626',
                              fontWeight: 600,
                              backgroundColor: '#fef2f2',
                              padding: '2px 8px',
                              borderRadius: '12px',
                            }}
                          >
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ef4444' }} />
                            {office.offline_devices} Offline
                          </span>
                        </div>
                      </div>

                      {/* Subnet Accordion Groups */}
                      <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        {subnetsList.map((subnet) => {
                          const isCollapsed = Boolean(collapsedSubnets[subnet.id]);
                          const deviceGroups = subnet.device_groups || [];

                          return (
                            <div
                              key={subnet.id}
                              style={{
                                border: '1px solid #e2e8f0',
                                borderRadius: '6px',
                                overflow: 'hidden',
                                backgroundColor: '#ffffff',
                              }}
                            >
                              {/* Subnet Bar */}
                              <div
                                onClick={() =>
                                  setCollapsedSubnets((prev) => ({
                                    ...prev,
                                    [subnet.id]: !prev[subnet.id],
                                  }))
                                }
                                style={{
                                  padding: '10px 14px',
                                  backgroundColor: '#f1f5f9',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  userSelect: 'none',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                  <Network size={14} style={{ color: '#0284c7' }} />
                                  <span style={{ fontWeight: 700, fontSize: '12.5px', color: '#0f172a' }}>
                                    {subnet.subnet_name}
                                  </span>
                                  <span className="mono" style={{ fontSize: '11px', color: '#0369a1', fontWeight: 600 }}>
                                    ({subnet.network_address}/{subnet.cidr_prefix})
                                  </span>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11.5px' }}>
                                  <span style={{ color: '#475569' }}>
                                    <strong>{subnet.device_count}</strong> Assigned Nodes
                                  </span>
                                  <span style={{ color: '#059669', fontWeight: 600 }}>
                                    {subnet.online_count} Online
                                  </span>
                                  <span style={{ color: '#dc2626', fontWeight: 600 }}>
                                    {subnet.offline_count} Offline
                                  </span>
                                </div>
                              </div>

                              {/* Subnet Device Groups */}
                              {!isCollapsed && (
                                <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                  {deviceGroups.length === 0 ? (
                                    <div style={{ color: '#94a3b8', fontSize: '11.5px', fontStyle: 'italic', padding: '6px 0' }}>
                                      No operating devices registered in this subnet range.
                                    </div>
                                  ) : (
                                    deviceGroups.map((group) => (
                                      <div key={group.group_name}>
                                        <div
                                          style={{
                                            fontSize: '11px',
                                            fontWeight: 700,
                                            color: '#64748b',
                                            textTransform: 'uppercase',
                                            marginBottom: '8px',
                                            letterSpacing: '0.04em',
                                          }}
                                        >
                                          {group.group_name} ({group.count})
                                        </div>

                                        <div
                                          style={{
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                                            gap: '8px',
                                          }}
                                        >
                                          {group.devices.map((device) => {
                                            const isOnline = (device.ping_status || '').toLowerCase() === 'online';
                                            const isOffline = (device.ping_status || '').toLowerCase() === 'offline';
                                            const statusColor = isOnline ? '#10b981' : isOffline ? '#ef4444' : '#64748b';

                                            return (
                                              <div
                                                key={`dev-${device.id}`}
                                                onClick={() => setSelectedDevice(device)}
                                                style={{
                                                  padding: '9px 11px',
                                                  borderRadius: '4px',
                                                  border: `1px solid ${statusColor}`,
                                                  backgroundColor: '#ffffff',
                                                  cursor: 'pointer',
                                                  display: 'flex',
                                                  flexDirection: 'column',
                                                  gap: '3px',
                                                  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                                                }}
                                              >
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                  <span style={{ fontWeight: 700, fontSize: '11.5px', color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {device.name}
                                                  </span>
                                                  {device.contact_person ? (
                                                    <div style={{ fontSize: '10.5px', color: '#1e293b', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px', marginTop: '1px' }}>
                                                      <span style={{ color: '#6366f1' }}>👤</span>
                                                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {device.contact_person}
                                                      </span>
                                                    </div>
                                                  ) : (
                                                    <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '1px' }}>
                                                      Unassigned
                                                    </div>
                                                  )}
                                                  <span
                                                    style={{
                                                      width: '6px',
                                                      height: '6px',
                                                      borderRadius: '50%',
                                                      backgroundColor: statusColor,
                                                    }}
                                                  />
                                                </div>

                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10.5px' }}>
                                                  <span className="mono" style={{ color: '#0284c7', fontWeight: 600 }}>
                                                    {device.ip_address}
                                                  </span>
                                                  <span style={{ fontSize: '9.5px', color: '#64748b' }}>
                                                    {device.device_type}
                                                  </span>
                                                </div>

                                                <div style={{ fontSize: '9px', color: '#64748b', marginTop: '2px' }}>
                                                  {device.building || device.room || 'Railway Complex'}
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    ))
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

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
