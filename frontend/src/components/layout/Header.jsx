import React from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { Search, RefreshCw, Server, CheckCircle2, AlertOctagon } from 'lucide-react';
import { useNetwork } from '../../context/NetworkContext';

const ROUTE_NAMES = {
  '/': { section: 'Monitoring', title: 'System Overview' },
  '/devices': { section: 'Monitoring', title: 'Device Inventory' },
  '/mac-inventory': { section: 'Monitoring', title: 'MAC Inventory & ARP Telemetry' },
  '/arp-discovery': { section: 'Monitoring', title: 'Sophos ARP Discovery' },
  '/topology': { section: 'Monitoring', title: 'Network Topology' },
  '/history': { section: 'Monitoring', title: 'Availability History' },
  '/alerts': { section: 'Monitoring', title: 'Events and Alerts' },
  '/devices/manage': { section: 'Administration', title: 'Device Management' },
  '/monitoring-config': { section: 'Administration', title: 'Monitoring Configuration' },
  '/settings': { section: 'Administration', title: 'Console Settings' },
};


export const Header = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    backendHealth,
    lastRefresh,
    isRefreshing,
    refreshData,
    globalSearch,
    setGlobalSearch,
  } = useNetwork();

  const currentPath = location.pathname;
  let pageMeta = ROUTE_NAMES[currentPath];

  if (!pageMeta && currentPath.startsWith('/devices/')) {
    pageMeta = { section: 'Monitoring', title: 'Device Diagnostics' };
  } else if (!pageMeta) {
    pageMeta = { section: 'Console', title: 'Network Operations' };
  }

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (globalSearch.trim() && currentPath !== '/devices') {
      navigate('/devices');
    }
  };

  return (
    <header className="top-header">
      {/* Left: Breadcrumbs & Page Title */}
      <div className="header-left">
        <div className="breadcrumb-trail">
          <span style={{ color: '#64748b' }}>{pageMeta.section}</span>
          <span className="breadcrumb-separator">/</span>
          <span className="breadcrumb-current">{pageMeta.title}</span>
        </div>
      </div>

      {/* Center: Search Field */}
      <div className="header-center">
        <form onSubmit={handleSearchSubmit} className="search-input-wrapper">
          <Search className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Search nodes by name, IP, or MAC..."
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
          />
        </form>
      </div>

      {/* Right: Refresh Status & Verified Backend Connection */}
      <div className="header-right">
        {/* Verified Backend Connection */}
        <div
          className="health-status-indicator"
          title={
            backendHealth.healthy
              ? `Verified connection to PostgreSQL (${backendHealth.database}) via Node.js API (${backendHealth.latencyMs}ms)`
              : `API Error: ${backendHealth.error || 'Server unreachable'}`
          }
        >
          <span
            className={`health-pulse ${backendHealth.healthy ? '' : 'offline'}`}
          />
          <span style={{ color: backendHealth.healthy ? '#065f46' : '#991b1b' }}>
            {backendHealth.healthy ? 'API: Connected' : 'API: Offline'}
          </span>
          {backendHealth.healthy && backendHealth.latencyMs !== null && (
            <span className="mono" style={{ fontSize: '10.5px', color: '#64748b' }}>
              {backendHealth.latencyMs}ms
            </span>
          )}
        </div>

        {/* Last Refresh info */}
        {lastRefresh && (
          <span style={{ fontSize: '11px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span>Updated:</span>
            <span className="mono">{lastRefresh.toLocaleTimeString()}</span>
          </span>
        )}

        {/* Manual Refresh Action */}
        <button
          className="header-refresh-btn"
          onClick={refreshData}
          disabled={isRefreshing}
          title="Force immediate ping poll and data refresh"
        >
          <RefreshCw size={13} className={isRefreshing ? 'spin-icon' : ''} />
          <span>Refresh</span>
        </button>
      </div>
    </header>
  );
};

export default Header;
