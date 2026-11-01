import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Server,
  Network,
  History,
  AlertTriangle,
  Sliders,
  Radio,
  Settings,
  Train,
  ChevronLeft,
  ChevronRight,
  Shield,
  Layers,
} from 'lucide-react';
import { useNetwork } from '../../context/NetworkContext';

export const Sidebar = ({ isCollapsed, onToggleCollapse }) => {
  const { devices, incidents, arpSummary, subnets } = useNetwork();


  const incidentCount = incidents.length;
  const deviceCount = devices.length;

  return (
    <aside className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}>
      {/* Brand & Emblem */}
      <div className="sidebar-header">
        <NavLink to="/" className="railway-brand">
          <div className="railway-emblem">
            <Train size={16} />
          </div>
          {!isCollapsed && (
            <div>
              <div style={{ color: '#ffffff', fontSize: '13px', lineHeight: 1.2 }}>
                RAILWAY NOC
              </div>
              <div style={{ color: '#94a3b8', fontSize: '10px', fontWeight: 500 }}>
                Node Monitoring Console
              </div>
            </div>
          )}
        </NavLink>
      </div>

      {/* Nav List */}
      <div className="sidebar-nav-container">
        {/* Section 1: Monitoring */}
        {!isCollapsed && <div className="nav-section-title">Monitoring</div>}

        <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Overview">
          <LayoutDashboard className="nav-item-icon" />
          {!isCollapsed && <span>Overview</span>}
        </NavLink>

        <NavLink to="/devices" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Device Inventory">
          <Server className="nav-item-icon" />
          {!isCollapsed && (
            <>
              <span>Device Inventory</span>
              {deviceCount > 0 && <span className="nav-item-badge nav-badge-slate">{deviceCount}</span>}
            </>
          )}
        </NavLink>

        <NavLink to="/topology" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Network Topology">
          <Network className="nav-item-icon" />
          {!isCollapsed && <span>Network Topology</span>}
        </NavLink>

        <NavLink to="/mac-inventory" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="MAC Inventory">
          <Layers className="nav-item-icon" />
          {!isCollapsed && (
            <>
              <span>MAC Inventory</span>
              {arpSummary && <span className="nav-item-badge nav-badge-slate">{arpSummary.total_inventory}</span>}
            </>
          )}
        </NavLink>

        <NavLink to="/arp-discovery" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Sophos ARP Discovery">
          <Radio className="nav-item-icon" />
          {!isCollapsed && (
            <>
              <span>Sophos ARP</span>
              {arpSummary && (
                <span className="nav-item-badge nav-badge-slate" style={{ backgroundColor: '#0284c7', color: '#fff' }}>
                  {arpSummary.matched_inventory_count}/{arpSummary.total_inventory}
                </span>
              )}
            </>
          )}
        </NavLink>

        <NavLink to="/history" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Availability History">
          <History className="nav-item-icon" />
          {!isCollapsed && <span>Availability History</span>}
        </NavLink>

        <NavLink to="/alerts" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Events and Alerts">
          <AlertTriangle className="nav-item-icon" />
          {!isCollapsed && (
            <>
              <span>Events & Alerts</span>
              {incidentCount > 0 && (
                <span className="nav-item-badge nav-badge-red">{incidentCount}</span>
              )}
            </>
          )}
        </NavLink>


        {/* Section 2: Administration */}
        <div style={{ marginTop: '16px' }}>
          {!isCollapsed && <div className="nav-section-title">Administration</div>}

          <NavLink to="/devices/manage" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Device Management">
            <Sliders className="nav-item-icon" />
            {!isCollapsed && <span>Device Management</span>}
          </NavLink>

          <NavLink to="/subnets" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Subnet Management">
            <Network className="nav-item-icon" />
            {!isCollapsed && (
              <>
                <span>Subnet Management</span>
                {subnets && subnets.length > 0 && (
                  <span className="nav-item-badge nav-badge-slate">{subnets.filter((s) => s.is_active).length}</span>
                )}
              </>
            )}
          </NavLink>

          <NavLink to="/monitoring-config" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Monitoring Configuration">
            <Radio className="nav-item-icon" />
            {!isCollapsed && <span>Monitoring Config</span>}
          </NavLink>

          <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Settings">
            <Settings className="nav-item-icon" />
            {!isCollapsed && <span>Settings</span>}
          </NavLink>
        </div>
      </div>

      {/* Footer Info */}
      <div className="sidebar-footer">
        {!isCollapsed && (
          <div className="sidebar-footer-info">
            <Shield size={13} style={{ color: '#38bdf8' }} />
            <span>Operational Console v1.4</span>
          </div>
        )}
        <button
          className="collapse-btn"
          style={{ width: '100%', justifyContent: isCollapsed ? 'center' : 'flex-start' }}
          onClick={onToggleCollapse}
          title={isCollapsed ? 'Expand navigation' : 'Collapse navigation'}
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          {!isCollapsed && <span style={{ marginLeft: '6px', fontSize: '11px' }}>Collapse Menu</span>}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
