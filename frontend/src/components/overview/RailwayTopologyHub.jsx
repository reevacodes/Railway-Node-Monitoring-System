import React from 'react';
import { Building2, Shield, Network, Activity, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import { AnimatedCounter } from '../../utils/motion';

/**
 * RailwayTopologyHub Component
 * Renders an animated Network Operations Center Topology Map of the
 * major railway departments (DRM HQ, NIA Telecom, Train Control, and Waypoints).
 * Strictly visualizes real database devices, verified links, and live ping reachability.
 */
export const RailwayTopologyHub = ({ devices = [], deviceStatuses = {}, onSelectSection }) => {
  // Compute real node health per railway division
  const hubs = React.useMemo(() => {
    const categories = [
      {
        id: 'drm',
        title: 'DRM Headquarters',
        code: 'DRM-NOC',
        role: 'Divisional Management & Core Routing',
        vlan: 'VLAN 40 (192.168.40.0/24)',
        filterText: 'drm',
      },
      {
        id: 'nia',
        title: 'NIA Telecom Wing',
        code: 'NIA-TEL',
        role: 'Telecom Substation & Fiber Aggregation',
        vlan: 'VLAN 41 (192.168.41.0/24)',
        filterText: 'nia',
      },
      {
        id: 'control',
        title: 'Train Control & Cabins',
        code: 'CTRL-CAB',
        role: 'Operations Dispatch & Traffic Sections',
        vlan: 'VLAN 1 (192.168.1.0/24)',
        filterText: 'control',
      },
      {
        id: 'peripheral',
        title: 'Station Waypoints',
        code: 'STN-PERIPH',
        role: 'Terminal Points & Standalone Edge Racks',
        vlan: 'Peripheral Infrastructure',
        filterText: 'other',
      },
    ];

    return categories.map((cat) => {
      const matchingDevices = devices.filter((d) => {
        const text = `${d.building || ''} ${d.room || ''} ${d.name || ''}`.toLowerCase();
        if (cat.filterText === 'drm') return text.includes('drm');
        if (cat.filterText === 'nia') return text.includes('nia');
        if (cat.filterText === 'control') return text.includes('control') || text.includes('cabin') || text.includes('traffic');
        return !text.includes('drm') && !text.includes('nia') && !text.includes('control') && !text.includes('cabin') && !text.includes('traffic');
      });

      const total = matchingDevices.length;
      const online = matchingDevices.filter((d) => (deviceStatuses[d.id]?.status || '').toLowerCase() === 'online').length;
      const offline = matchingDevices.filter((d) => (deviceStatuses[d.id]?.status || '').toLowerCase() === 'offline').length;
      const verified = matchingDevices.filter((d) => (d.location_verification || '').toLowerCase() === 'verified').length;
      const rate = total > 0 ? Math.round((online / total) * 100) : 100;

      return {
        ...cat,
        total,
        online,
        offline,
        verified,
        rate,
        isHealthy: offline === 0 && online > 0,
        hasOutage: offline > 0,
        devices: matchingDevices,
      };
    });
  }, [devices, deviceStatuses]);

  return (
    <div
      className="panel"
      style={{
        marginBottom: '20px',
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: '#ffffff',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div
        className="panel-header"
        style={{
          backgroundColor: '#fafbfc',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div className="panel-title" style={{ color: 'var(--text-main)' }}>
          <Network size={16} style={{ color: 'var(--accent-primary)' }} />
          <span>Railway Network Infrastructure & Department Conduits</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--status-online-dot)' }} />
            Active Trunk Links
          </span>
          <span>•</span>
          <span>Click any hub card to filter node population</span>
        </div>
      </div>

      <div className="panel-body" style={{ padding: '16px 18px' }}>
        {/* Animated SVG Network Interconnect Flow Line */}
        <div style={{ position: 'relative', marginBottom: '14px' }}>
          <svg
            width="100%"
            height="14"
            style={{ display: 'block', overflow: 'visible' }}
            preserveAspectRatio="none"
          >
            <line
              x1="3%"
              y1="7"
              x2="97%"
              y2="7"
              stroke="#e2e8f0"
              strokeWidth="2"
            />
            <line
              x1="3%"
              y1="7"
              x2="97%"
              y2="7"
              stroke="url(#flowGradientLight)"
              strokeWidth="2"
              strokeDasharray="8, 12"
              className="conduit-line-pulse"
            />
            <defs>
              <linearGradient id="flowGradientLight" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#0284c7" />
                <stop offset="50%" stopColor="#38bdf8" />
                <stop offset="100%" stopColor="#10b981" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        {/* 4 Interactive Railway Hub Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '14px',
          }}
        >
          {hubs.map((hub) => {
            const statusColor = hub.hasOutage
              ? 'var(--status-offline-text)'
              : hub.isHealthy
              ? 'var(--status-online-text)'
              : 'var(--text-muted)';

            const cardBorderColor = hub.hasOutage
              ? '#fca5a5'
              : hub.isHealthy
              ? 'var(--border-subtle)'
              : 'var(--border-subtle)';

            return (
              <div
                key={hub.id}
                onClick={() => onSelectSection?.(hub.filterText)}
                className="dept-health-card"
                style={{
                  backgroundColor: '#ffffff',
                  border: `1px solid ${cardBorderColor}`,
                  borderRadius: 'var(--radius-md)',
                  padding: '14px 16px',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  boxShadow: 'var(--shadow-sm)',
                  transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
                title={`Click to filter assets in ${hub.title}`}
              >
                {/* Header with Hub Code & Status Badge */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div>
                    <span
                      className="mono"
                      style={{
                        fontSize: '10px',
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        padding: '2px 7px',
                        borderRadius: '4px',
                        backgroundColor: '#e0f2fe',
                        color: '#0284c7',
                        border: '1px solid #bae6fd',
                        display: 'inline-block',
                      }}
                    >
                      {hub.code}
                    </span>
                    <h4 style={{ fontSize: '13.5px', marginTop: '6px', color: 'var(--text-main)', fontWeight: 700 }}>
                      {hub.title}
                    </h4>
                  </div>

                  <span
                    className={`status-badge ${hub.hasOutage ? 'offline' : hub.isHealthy ? 'online' : 'unknown'}`}
                    style={{ fontSize: '10.5px', padding: '2px 8px' }}
                  >
                    <span className="status-dot" />
                    <span>{hub.hasOutage ? `${hub.offline} Offline` : `${hub.rate}% Online`}</span>
                  </span>
                </div>

                <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  {hub.role}
                </div>

                {/* Subnet / VLAN chip */}
                <div
                  className="mono"
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    backgroundColor: '#f8fafc',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    border: '1px solid #f1f5f9',
                  }}
                >
                  <Network size={12} style={{ color: 'var(--accent-primary)' }} />
                  <span>{hub.vlan}</span>
                </div>

                {/* Live Node Count & Availability Progress Bar */}
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '11.5px',
                      marginBottom: '6px',
                    }}
                  >
                    <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>
                      Active Reachability:
                    </span>
                    <span className="mono" style={{ fontWeight: 700, color: statusColor }}>
                      <AnimatedCounter value={hub.online} /> / <AnimatedCounter value={hub.total} /> Nodes
                    </span>
                  </div>

                  <div
                    style={{
                      height: '6px',
                      backgroundColor: '#f1f5f9',
                      borderRadius: '999px',
                      overflow: 'hidden',
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${hub.rate}%`,
                        background: hub.hasOutage
                          ? 'linear-gradient(90deg, #ef4444, #f59e0b)'
                          : 'linear-gradient(90deg, #0284c7, #10b981)',
                        borderRadius: '999px',
                        transition: 'width 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
                      }}
                    />
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingTop: '8px',
                    borderTop: '1px solid #f1f5f9',
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                  }}
                >
                  <span>Verified: <strong style={{ color: 'var(--text-secondary)' }}>{hub.verified}</strong>/{hub.total}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--accent-primary)', fontWeight: 600 }}>
                    Filter Nodes <ArrowRight size={11} />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <style>{`
        .conduit-line-pulse {
          animation: conduitPulse 15s linear infinite;
        }
        @keyframes conduitPulse {
          from { stroke-dashoffset: 200; }
          to { stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  );
};

export default RailwayTopologyHub;
