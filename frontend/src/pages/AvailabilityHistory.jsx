import React, { useState, useMemo } from 'react';
import { useNetwork } from '../context/NetworkContext';
import StatusBadge from '../components/common/StatusBadge';
import LatencyIndicator from '../components/common/LatencyIndicator';
import { CompactLocationView } from '../components/common/LocationBadge';
import DeviceQuickDrawer from '../components/devices/DeviceQuickDrawer';
import EmptyState from '../components/common/EmptyState';
import {
  History,
  Search,
  Filter,
  Download,
  Calendar,
  Clock,
  Activity,
  ArrowUpDown,
  MapPin,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';

export const AvailabilityHistory = () => {
  const { allEvents, devices } = useNetwork();
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [quickFilter, setQuickFilter] = useState('ALL'); // 'ALL' | 'ONLINE' | 'OFFLINE' | 'RECENT'
  const [search, setSearch] = useState('');
  const [deviceFilter, setDeviceFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [buildingFilter, setBuildingFilter] = useState('ALL');
  const [sortAsc, setSortAsc] = useState(false);

  // Extract unique buildings
  const uniqueBuildings = useMemo(() => {
    return Array.from(new Set(devices.map((d) => d.building).filter(Boolean)));
  }, [devices]);

  const isRecentDevice = (dev) => {
    if (!dev?.created_at) return false;
    const ageHours = (Date.now() - new Date(dev.created_at).getTime()) / (1000 * 60 * 60);
    return ageHours < 72;
  };

  // Filter events
  const filteredEvents = useMemo(() => {
    return allEvents
      .filter((evt) => {
        const matchesSearch =
          !search ||
          evt.deviceName.toLowerCase().includes(search.toLowerCase()) ||
          evt.ipAddress.toLowerCase().includes(search.toLowerCase()) ||
          (evt.device?.building && evt.device.building.toLowerCase().includes(search.toLowerCase())) ||
          (evt.device?.room && evt.device.room.toLowerCase().includes(search.toLowerCase())) ||
          (evt.device?.rack && evt.device.rack.toLowerCase().includes(search.toLowerCase()));

        const matchesDevice = deviceFilter === 'ALL' || String(evt.device_id) === String(deviceFilter);
        const matchesStatus = statusFilter === 'ALL' || evt.status.toLowerCase() === statusFilter.toLowerCase();
        const matchesBuilding = buildingFilter === 'ALL' || evt.device?.building === buildingFilter;

        let matchesQuick = true;
        if (quickFilter === 'ONLINE') matchesQuick = evt.status.toLowerCase() === 'online';
        else if (quickFilter === 'OFFLINE') matchesQuick = evt.status.toLowerCase() === 'offline';
        else if (quickFilter === 'RECENT') matchesQuick = isRecentDevice(evt.device);

        return matchesSearch && matchesDevice && matchesStatus && matchesBuilding && matchesQuick;
      })
      .sort((a, b) => {
        const timeA = new Date(a.checked_at).getTime();
        const timeB = new Date(b.checked_at).getTime();
        return sortAsc ? timeA - timeB : timeB - timeA;
      });
  }, [allEvents, search, deviceFilter, statusFilter, buildingFilter, quickFilter, sortAsc]);

  // Aggregate stats
  const totalEvents = filteredEvents.length;
  const onlineEvents = filteredEvents.filter((e) => e.status === 'online').length;
  const offlineEvents = filteredEvents.filter((e) => e.status === 'offline').length;
  const availabilityPct = totalEvents > 0 ? Math.round((onlineEvents / totalEvents) * 100) : 0;

  // For the time-series latency telemetry, prioritize checks with recorded latency responses
  // (If user filtered to a specific device, respect that; otherwise take recent successful latency measurements from active nodes so timeouts don't mask the graph)
  const chartEvents = useMemo(() => {
    if (statusFilter === 'offline' || quickFilter === 'OFFLINE') {
      return [];
    }
    // If a specific device is selected, take its recent checks
    if (deviceFilter !== 'ALL') {
      return filteredEvents.slice(0, 40).reverse();
    }
    // When viewing all nodes, prioritize active latency responses
    const onlinePings = filteredEvents.filter(
      (e) => e.status === 'online' && e.latency_ms !== null && e.latency_ms !== undefined
    );
    if (onlinePings.length > 0) {
      return onlinePings.slice(0, 40).reverse();
    }
    return filteredEvents.slice(0, 40).reverse();
  }, [filteredEvents, deviceFilter, statusFilter, quickFilter]);

  const chartData = useMemo(() => {
    return chartEvents.map((e) => ({
      time: new Date(e.checked_at).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      latency: e.status === 'online' && e.latency_ms !== null ? Number(e.latency_ms) : null,
      device: e.deviceName,
      ip: e.ipAddress,
      status: e.status,
    }));
  }, [chartEvents]);

  return (
    <div>
      {/* Title Strip */}
      <div className="page-title-strip">
        <div>
          <h1>Availability History & Audit Log</h1>
          <div className="page-subtitle">
            Historical reachability telemetry, latency logs, switch ports and physical location records
          </div>
        </div>
      </div>

      {/* Operational Strip */}
      <div className="operational-strip">
        <div className="operational-metric">
          <span className="operational-metric-label">Total Logged Checks</span>
          <span className="operational-metric-value">{totalEvents}</span>
          <span className="metric-sub">Across all registered devices</span>
        </div>

        <div className="operational-metric">
          <span className="operational-metric-label" style={{ color: '#059669' }}>
            Successful Replies
          </span>
          <span className="operational-metric-value" style={{ color: '#059669' }}>
            {onlineEvents}
          </span>
          <span className="metric-sub">{availabilityPct}% aggregate availability</span>
        </div>

        <div className="operational-metric">
          <span className="operational-metric-label" style={{ color: '#dc2626' }}>
            Unreachable / Timeouts
          </span>
          <span className="operational-metric-value" style={{ color: offlineEvents > 0 ? '#dc2626' : '#64748b' }}>
            {offlineEvents}
          </span>
          <span className="metric-sub">No ping response packets</span>
        </div>
      </div>

      {/* Latency History Chart Panel */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">
            <Activity size={14} style={{ color: '#0284c7' }} />
            <span>Time-Series Latency & Reachability (Historical Check Events)</span>
          </div>
          <span style={{ fontSize: '11px', color: '#64748b' }}>
            {chartData.length > 0 ? `${chartData.length} Live Ping Telemetry Samples` : 'No Active Latency Points'}
          </span>
        </div>

        <div className="panel-body" style={{ height: '240px', padding: '12px' }}>
          {chartData.length === 0 ? (
            <EmptyState
              title="No Response Telemetry"
              description="No active ping replies found for the current filter. Switch to 'All Records' or 'Online / Success' to view live latency."
            />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 15, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0284c7" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#0284c7" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#64748b' }} />
                <YAxis unit="ms" tick={{ fontSize: 9, fill: '#64748b' }} domain={[0, (dataMax) => Math.max(Number(dataMax) + 2, 5)]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    color: '#ffffff',
                    borderRadius: '4px',
                    fontSize: '11px',
                    border: 'none',
                  }}
                  formatter={(val, name, item) => [
                    `${val} ms (${item.payload.device || item.payload.ip})`,
                    'Ping Response',
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="latency"
                  stroke="#0284c7"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#latencyGradient)"
                  dot={{ r: 3.5, fill: '#0284c7', stroke: '#ffffff', strokeWidth: 1.5 }}
                  activeDot={{ r: 6 }}
                  name="Latency (ms)"
                  connectNulls={true}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Filterable Table Panel */}
      <div className="panel">
        {/* Quick Filter Bar */}
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
              All Records ({allEvents.length})
            </button>
            <button
              className={`btn btn-sm ${quickFilter === 'ONLINE' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '11px', padding: '2px 9px', color: quickFilter === 'ONLINE' ? '#fff' : '#059669' }}
              onClick={() => setQuickFilter('ONLINE')}
            >
              Online / Success ({onlineEvents})
            </button>
            <button
              className={`btn btn-sm ${quickFilter === 'OFFLINE' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '11px', padding: '2px 9px', color: quickFilter === 'OFFLINE' ? '#fff' : '#dc2626' }}
              onClick={() => setQuickFilter('OFFLINE')}
            >
              Offline / Dropped ({offlineEvents})
            </button>
            <button
              className={`btn btn-sm ${quickFilter === 'RECENT' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '11px', padding: '2px 9px', color: quickFilter === 'RECENT' ? '#fff' : '#8b5cf6' }}
              onClick={() => setQuickFilter('RECENT')}
            >
              Recently Commissioned Nodes
            </button>
          </div>

          <div style={{ fontSize: '11px', color: '#64748b' }}>
            Showing <strong>{filteredEvents.length}</strong> of <strong>{allEvents.length}</strong> check events
          </div>
        </div>

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
                placeholder="Search events, IP, room, rack..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <select
              className="filter-select"
              value={deviceFilter}
              onChange={(e) => setDeviceFilter(e.target.value)}
            >
              <option value="ALL">All Nodes</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.ip_address})
                </option>
              ))}
            </select>

            <select
              className="filter-select"
              value={buildingFilter}
              onChange={(e) => setBuildingFilter(e.target.value)}
            >
              <option value="ALL">All Facilities</option>
              {uniqueBuildings.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>

            <select
              className="filter-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All Outcomes</option>
              <option value="online">Online / Replied</option>
              <option value="offline">Offline / Timed Out</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setSortAsc(!sortAsc)}
              title="Toggle chronological sorting"
            >
              <ArrowUpDown size={12} />
              {sortAsc ? 'Oldest First' : 'Newest First'}
            </button>
            <span style={{ fontSize: '11.5px', color: '#64748b' }}>
              {filteredEvents.length} events
            </span>
          </div>
        </div>

        <div className="panel-body" style={{ padding: '0' }}>
          {filteredEvents.length === 0 ? (
            <EmptyState
              title="No events matching criteria"
              description="Adjust the search query or status filter to see other historical probe results."
            />
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: '60px' }}>Log ID</th>
                    <th>Timestamp</th>
                    <th>Target Node</th>
                    <th>Target IP</th>
                    {/* Location Column */}
                    <th>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <MapPin size={12} style={{ color: '#059669' }} />
                        <span>Physical Location</span>
                      </div>
                    </th>
                    <th>Check Result</th>
                    <th>Response Time</th>
                    <th>Condition / Diagnostics</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.slice(0, 100).map((evt) => (
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
                      <td>
                        <LatencyIndicator latencyMs={evt.latency_ms} />
                      </td>
                      <td style={{ fontSize: '11.5px', color: evt.status === 'online' ? '#059669' : '#dc2626' }}>
                        {evt.status === 'online'
                          ? 'Valid ICMP TTL received from target'
                          : 'No reply received within 1500ms timeout'}
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

export default AvailabilityHistory;
