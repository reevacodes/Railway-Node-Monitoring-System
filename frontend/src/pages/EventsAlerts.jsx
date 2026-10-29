import React, { useState, useMemo } from 'react';
import { useNetwork } from '../context/NetworkContext';
import StatusBadge from '../components/common/StatusBadge';
import DeviceTypeBadge from '../components/common/DeviceTypeBadge';
import { LocationBadge, CompactLocationView } from '../components/common/LocationBadge';
import DeviceQuickDrawer from '../components/devices/DeviceQuickDrawer';
import EmptyState from '../components/common/EmptyState';
import {
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  Info,
  Clock,
  Filter,
  ShieldAlert,
  MapPin,
  Eye,
  Search,
} from 'lucide-react';

export const EventsAlerts = () => {
  const { incidents, allEvents, devices } = useNetwork();
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [quickFilter, setQuickFilter] = useState('ALL'); // 'ALL' | 'CRITICAL' | 'DEGRADED' | 'RECENT'
  const [searchFilter, setSearchFilter] = useState('');
  const [buildingFilter, setBuildingFilter] = useState('ALL');
  const [severityFilter, setSeverityFilter] = useState('ALL');

  // Extract unique buildings for filter
  const uniqueBuildings = useMemo(() => {
    return Array.from(new Set(devices.map((d) => d.building).filter(Boolean)));
  }, [devices]);

  // Categorize alerts into active incidents
  const offlineIncidents = incidents.filter((i) => i.status === 'offline');
  const unknownIncidents = incidents.filter((i) => i.status === 'unknown');
  const degradedIncidents = incidents.filter((i) => i.isDegraded);

  const isRecentDevice = (dev) => {
    if (!dev?.created_at) return false;
    const ageHours = (Date.now() - new Date(dev.created_at).getTime()) / (1000 * 60 * 60);
    return ageHours < 72;
  };

  const recentIncidentsCount = useMemo(() => {
    return incidents.filter((i) => isRecentDevice(i.device)).length;
  }, [incidents]);

  // Filter incidents
  const filteredIncidents = useMemo(() => {
    return incidents.filter(({ device, status, isDegraded }) => {
      const q = searchFilter.toLowerCase();
      const matchesSearch =
        !q ||
        device.name.toLowerCase().includes(q) ||
        device.ip_address.toLowerCase().includes(q) ||
        (device.building && device.building.toLowerCase().includes(q)) ||
        (device.room && device.room.toLowerCase().includes(q)) ||
        (device.rack && device.rack.toLowerCase().includes(q));

      const matchesBuilding = buildingFilter === 'ALL' || device.building === buildingFilter;

      let severity = 'info';
      if (status === 'offline') severity = 'critical';
      else if (isDegraded) severity = 'warning';

      const matchesSeverity = severityFilter === 'ALL' || severity === severityFilter.toLowerCase();

      let matchesQuick = true;
      if (quickFilter === 'CRITICAL') matchesQuick = status === 'offline';
      else if (quickFilter === 'DEGRADED') matchesQuick = !!isDegraded;
      else if (quickFilter === 'RECENT') matchesQuick = isRecentDevice(device);

      return matchesSearch && matchesBuilding && matchesSeverity && matchesQuick;
    });
  }, [incidents, searchFilter, buildingFilter, severityFilter, quickFilter]);

  // Filter historical events
  const filteredEvents = useMemo(() => {
    return allEvents.filter((evt) => {
      const q = searchFilter.toLowerCase();
      const matchesSearch =
        !q ||
        evt.deviceName.toLowerCase().includes(q) ||
        evt.ipAddress.toLowerCase().includes(q) ||
        (evt.device?.building && evt.device.building.toLowerCase().includes(q)) ||
        (evt.device?.room && evt.device.room.toLowerCase().includes(q));

      const matchesBuilding = buildingFilter === 'ALL' || evt.device?.building === buildingFilter;

      return matchesSearch && matchesBuilding;
    });
  }, [allEvents, searchFilter, buildingFilter]);

  return (
    <div>
      {/* Title Strip */}
      <div className="page-title-strip">
        <div>
          <h1>Events and Alerts Console</h1>
          <div className="page-subtitle">
            Prioritized incident tracking, link drops, timeouts and physical location dispatch guidance
          </div>
        </div>
      </div>

      {/* Operational Incident Summary Strip */}
      <div className="operational-strip">
        <div className="operational-metric">
          <span className="operational-metric-label" style={{ color: '#dc2626' }}>
            <AlertOctagon size={13} /> Critical Outages
          </span>
          <span className="operational-metric-value" style={{ color: offlineIncidents.length > 0 ? '#dc2626' : '#64748b' }}>
            {offlineIncidents.length}
          </span>
          <span className="metric-sub">Nodes returning no ICMP ping reply</span>
        </div>

        <div className="operational-metric">
          <span className="operational-metric-label" style={{ color: '#d97706' }}>
            <AlertTriangle size={13} /> Degraded Links (&gt;100ms)
          </span>
          <span className="operational-metric-value" style={{ color: degradedIncidents.length > 0 ? '#d97706' : '#64748b' }}>
            {degradedIncidents.length}
          </span>
          <span className="metric-sub">High latency response detected</span>
        </div>

        <div className="operational-metric">
          <span className="operational-metric-label" style={{ color: '#64748b' }}>
            <Info size={13} /> Unverified Nodes
          </span>
          <span className="operational-metric-value">
            {unknownIncidents.length}
          </span>
          <span className="metric-sub">Awaiting verification in probe cycle</span>
        </div>
      </div>

      {/* Active Incidents Table with Physical Location */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">
            <ShieldAlert size={15} style={{ color: '#dc2626' }} />
            <span>Active Reachability Incidents Requiring Operator Action</span>
          </div>
          <span style={{ fontSize: '11px', color: '#64748b' }}>
            {filteredIncidents.length} open alert{filteredIncidents.length === 1 ? '' : 's'}
          </span>
        </div>

        {/* Quick Filter Bar for Incidents */}
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
              Incident Filter:
            </span>
            <button
              className={`btn btn-sm ${quickFilter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '11px', padding: '2px 9px' }}
              onClick={() => setQuickFilter('ALL')}
            >
              All Alerts ({incidents.length})
            </button>
            <button
              className={`btn btn-sm ${quickFilter === 'CRITICAL' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '11px', padding: '2px 9px', color: quickFilter === 'CRITICAL' ? '#fff' : '#dc2626' }}
              onClick={() => setQuickFilter('CRITICAL')}
            >
              Critical / Outages ({offlineIncidents.length})
            </button>
            <button
              className={`btn btn-sm ${quickFilter === 'DEGRADED' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '11px', padding: '2px 9px', color: quickFilter === 'DEGRADED' ? '#fff' : '#d97706' }}
              onClick={() => setQuickFilter('DEGRADED')}
            >
              High Latency ({degradedIncidents.length})
            </button>
            <button
              className={`btn btn-sm ${quickFilter === 'RECENT' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '11px', padding: '2px 9px', color: quickFilter === 'RECENT' ? '#fff' : '#8b5cf6' }}
              onClick={() => setQuickFilter('RECENT')}
            >
              Recently Commissioned ({recentIncidentsCount})
            </button>
          </div>

          <div style={{ fontSize: '11px', color: '#64748b' }}>
            Showing <strong>{filteredIncidents.length}</strong> active alerts
          </div>
        </div>

        {/* Filter bar for incidents */}
        <div className="filter-toolbar">
          <div className="filter-group">
            <div style={{ position: 'relative', width: '220px' }}>
              <Search
                size={13}
                style={{ position: 'absolute', left: '8px', top: '9px', color: '#94a3b8' }}
              />
              <input
                type="text"
                className="form-input"
                style={{ paddingLeft: '28px', height: '30px', fontSize: '11.5px' }}
                placeholder="Filter alerts by node, IP, room..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
              />
            </div>

            <select
              className="filter-select"
              value={buildingFilter}
              onChange={(e) => setBuildingFilter(e.target.value)}
            >
              <option value="ALL">All Facilities / Buildings</option>
              {uniqueBuildings.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>

            <select
              className="filter-select"
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
            >
              <option value="ALL">All Severities</option>
              <option value="critical">Critical Only</option>
              <option value="warning">Warning Only</option>
            </select>
          </div>

          <span style={{ fontSize: '11.5px', color: '#64748b' }}>
            {incidents.length} total active incident{incidents.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="panel-body" style={{ padding: '0' }}>
          {filteredIncidents.length === 0 ? (
            <div style={{ padding: '36px 20px', textAlign: 'center' }}>
              <CheckCircle2 size={36} style={{ color: '#10b981', margin: '0 auto 8px auto' }} />
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>
                All Monitored Railway Nodes Normal
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                No active ping timeouts, destination unreachable errors or degraded response latencies.
              </div>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Severity</th>
                    <th>Node Name</th>
                    <th>IP Address</th>
                    <th>Role</th>
                    {/* Physical Location Column */}
                    <th>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <MapPin size={12} style={{ color: '#059669' }} />
                        <span>Physical Location</span>
                      </div>
                    </th>
                    <th>Observed Issue</th>
                    <th>Last Checked</th>
                    <th>Dispatch / Recommended Action</th>
                    <th style={{ textAlign: 'right' }}>Inspect</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredIncidents.map(({ device, status, latency_ms, last_checked, isDegraded }) => {
                    const locationLocationHint = device.room || device.building
                      ? ` [Inspect: ${device.building || ''} - ${device.room || ''} (Rack: ${device.rack || 'N/A'})]`
                      : '';

                    return (
                      <tr key={device.id} className="row-offline">
                        <td>
                          {status === 'offline' ? (
                            <span className="status-badge offline">
                              <span className="status-dot" />
                              CRITICAL
                            </span>
                          ) : isDegraded ? (
                            <span className="status-badge warning">
                              <span className="status-dot" />
                              WARNING
                            </span>
                          ) : (
                            <span className="status-badge unknown">
                              <span className="status-dot" />
                              INFO
                            </span>
                          )}
                        </td>
                        <td style={{ fontWeight: 600 }}>{device.name}</td>
                        <td className="mono" style={{ color: '#0284c7' }}>
                          {device.ip_address}
                        </td>
                        <td>
                          <DeviceTypeBadge type={device.device_type} />
                        </td>
                        {/* Physical Location */}
                        <td>
                          <CompactLocationView device={device} />
                        </td>
                        <td style={{ color: status === 'offline' ? '#dc2626' : '#d97706', fontWeight: 500 }}>
                          {status === 'offline'
                            ? 'Ping Timed Out (0% packet reply)'
                            : isDegraded
                            ? `High Latency: ${latency_ms}ms`
                            : 'Unconfirmed reachability'}
                        </td>
                        <td className="mono" style={{ fontSize: '10.5px' }}>
                          {last_checked ? new Date(last_checked).toLocaleTimeString() : 'Never'}
                        </td>
                        <td style={{ fontSize: '11.5px', color: '#334155' }}>
                          <span>
                            {status === 'offline'
                              ? 'Verify trackside power supply, Ethernet patch cable, or switch port.'
                              : 'Inspect link congestion or duplex mismatch.'}
                          </span>
                          {locationLocationHint && (
                            <strong style={{ color: '#059669', display: 'block', fontSize: '11px', marginTop: '2px' }}>
                              {locationLocationHint}
                            </strong>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => setSelectedDevice(device)}
                            title="Inspect Node & Physical Details"
                          >
                            <Eye size={12} />
                            <span>Inspect</span>
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

      {/* Historical Alert Log with Physical Location */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">
            <Clock size={14} />
            <span>Chronological Event Stream (All Status Check Events)</span>
          </div>
          <span style={{ fontSize: '11px', color: '#64748b' }}>
            Showing {Math.min(filteredEvents.length, 50)} recorded check events
          </span>
        </div>

        <div className="panel-body" style={{ padding: '0' }}>
          {filteredEvents.length === 0 ? (
            <EmptyState
              title="No events logged yet"
              description="Probe cycles execute automatically every 30 seconds."
            />
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: '55px' }}>Log ID</th>
                    <th>Timestamp</th>
                    <th>Target Device</th>
                    <th>IP Address</th>
                    {/* Location Column */}
                    <th>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <MapPin size={12} style={{ color: '#059669' }} />
                        <span>Physical Location</span>
                      </div>
                    </th>
                    <th>Status</th>
                    <th>Latency</th>
                    <th>Event Condition</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.slice(0, 50).map((evt) => (
                    <tr
                      key={evt.id}
                      className={evt.status === 'offline' ? 'row-offline' : ''}
                      style={{ cursor: evt.device ? 'pointer' : 'default' }}
                      onClick={() => evt.device && setSelectedDevice(evt.device)}
                    >
                      <td className="mono" style={{ color: '#64748b' }}>
                        #{evt.id}
                      </td>
                      <td className="mono" style={{ fontSize: '11px' }}>
                        {new Date(evt.checked_at).toLocaleString()}
                      </td>
                      <td style={{ fontWeight: 600 }}>{evt.deviceName}</td>
                      <td className="mono">{evt.ipAddress}</td>
                      {/* Physical Location */}
                      <td>
                        <CompactLocationView device={evt.device} />
                      </td>
                      <td>
                        <StatusBadge status={evt.status} />
                      </td>
                      <td className="mono" style={{ fontSize: '11px' }}>
                        {evt.latency_ms !== null ? `${evt.latency_ms} ms` : '—'}
                      </td>
                      <td style={{ fontSize: '11.5px', color: evt.status === 'online' ? '#059669' : '#dc2626' }}>
                        {evt.status === 'online'
                          ? 'Host replied with valid ICMP echo response'
                          : 'Ping timed out (host unreachable or powered off)'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Inspect Side Drawer */}
      <DeviceQuickDrawer
        device={selectedDevice}
        isOpen={!!selectedDevice}
        onClose={() => setSelectedDevice(null)}
      />
    </div>
  );
};

export default EventsAlerts;
