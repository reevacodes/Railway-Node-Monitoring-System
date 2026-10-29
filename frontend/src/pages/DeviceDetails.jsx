import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useNetwork } from '../context/NetworkContext';
import StatusBadge from '../components/common/StatusBadge';
import DeviceTypeBadge from '../components/common/DeviceTypeBadge';
import LatencyIndicator from '../components/common/LatencyIndicator';
import { LocationBadge } from '../components/common/LocationBadge';
import DeviceFormModal from '../components/devices/DeviceFormModal';
import EmptyState from '../components/common/EmptyState';
import api from '../services/api';
import {
  ArrowLeft,
  RefreshCw,
  Trash2,
  Activity,
  Calendar,
  Network,
  Cpu,
  MapPin,
  Clock,
  ShieldCheck,
  AlertTriangle,
  Radio,
  Edit,
  CheckCircle2,
  Check,
  Building,
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';

export const DeviceDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { devices, deviceStatuses, probeDevice, removeDevice, verifyLocation } = useNetwork();

  const [history, setHistory] = useState([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isProbing, setIsProbing] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const device = devices.find((d) => String(d.id) === String(id));
  const currentStatus = deviceStatuses[id] || { status: 'unknown' };

  const loadHistory = async () => {
    if (!id) return;
    setIsLoadingHistory(true);
    try {
      const records = await api.getDeviceHistory(id);
      if (Array.isArray(records)) {
        setHistory(records);
      }
    } catch (err) {
      console.error('Failed to load device history:', err);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [id]);

  const handleManualProbe = async () => {
    if (!device) return;
    setIsProbing(true);
    try {
      await probeDevice(device.id);
      await loadHistory();
    } finally {
      setIsProbing(false);
    }
  };

  const handleToggleVerification = async () => {
    if (!device) return;
    setIsVerifying(true);
    try {
      const targetState = device.location_verification === 'verified' ? 'unverified' : 'verified';
      await verifyLocation(device.id, targetState);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleDelete = async () => {
    if (!device) return;
    if (window.confirm(`Are you sure you want to delete ${device.name}?`)) {
      await removeDevice(device.id, device.name);
      navigate('/devices');
    }
  };

  if (!device) {
    return (
      <div>
        <div style={{ marginBottom: '16px' }}>
          <Link to="/devices" className="btn btn-secondary btn-sm">
            <ArrowLeft size={13} /> Return to Device Inventory
          </Link>
        </div>
        <EmptyState
          title="Device Not Found"
          description={`No registered device with ID #${id} was found in the database.`}
        />
      </div>
    );
  }

  // Calculate statistics from actual history
  const totalChecks = history.length;
  const onlineChecks = history.filter((h) => h.status === 'online').length;
  const offlineChecks = history.filter((h) => h.status === 'offline').length;
  const uptimePercent = totalChecks > 0 ? Math.round((onlineChecks / totalChecks) * 100) : 0;
  const isLocationVerified = device.location_verification === 'verified';

  // Chart data from real history records (chronological order)
  const chartData = [...history]
    .slice(0, 30)
    .reverse()
    .map((h) => ({
      time: new Date(h.checked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      latency: h.status === 'online' && h.latency_ms !== null ? h.latency_ms : null,
      status: h.status,
    }));

  return (
    <div>
      {/* Top Breadcrumb & Actions */}
      <div className="page-title-strip">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Link to="/devices" className="btn btn-secondary btn-sm">
            <ArrowLeft size={13} /> Inventory
          </Link>
          <div>
            <h1>{device.name}</h1>
            <div className="page-subtitle">
              Node ID #{device.id} • Registered {new Date(device.created_at).toLocaleDateString()}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setIsEditModalOpen(true)}
          >
            <Edit size={12} /> Edit Node & Location
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleManualProbe}
            disabled={isProbing}
          >
            <RefreshCw size={12} className={isProbing ? 'spin-icon' : ''} />
            {isProbing ? 'Probing...' : 'Trigger Ping Probe'}
          </button>
          <button className="btn btn-danger btn-sm" onClick={handleDelete}>
            <Trash2 size={12} /> Delete
          </button>
        </div>
      </div>

      {/* Operational Summary Strip */}
      <div className="operational-strip">
        <div className="operational-metric">
          <span className="operational-metric-label">Reachability State</span>
          <div style={{ marginTop: '4px' }}>
            <StatusBadge status={currentStatus.status} />
          </div>
          <span className="metric-sub">
            {currentStatus.status === 'offline' ? 'No ping response / timeout' : 'Daemon verified'}
          </span>
        </div>

        <div className="operational-metric">
          <span className="operational-metric-label">Recent Latency</span>
          <span className="operational-metric-value">
            {currentStatus.latency_ms !== null && currentStatus.latency_ms !== undefined
              ? `${currentStatus.latency_ms} ms`
              : '—'}
          </span>
          <span className="metric-sub">ICMP round-trip time</span>
        </div>

        <div className="operational-metric">
          <span className="operational-metric-label">Location Verification</span>
          <div style={{ marginTop: '4px' }}>
            <LocationBadge
              status={device.location_verification}
              verifiedAt={device.location_verified_at}
            />
          </div>
          <span className="metric-sub">
            {device.location_verified_at
              ? `Checked ${new Date(device.location_verified_at).toLocaleDateString()}`
              : 'Unverified physical installation'}
          </span>
        </div>

        <div className="operational-metric">
          <span className="operational-metric-label">Historical Availability</span>
          <span className="operational-metric-value" style={{ color: uptimePercent > 90 ? '#059669' : '#dc2626' }}>
            {totalChecks > 0 ? `${uptimePercent}%` : '—'}
          </span>
          <span className="metric-sub">{onlineChecks} of {totalChecks} checks successful</span>
        </div>
      </div>

      {/* 1. DEDICATED PHYSICAL LOCATION & CONNECTIVITY SECTION */}
      <div className="panel" style={{ marginBottom: '20px' }}>
        <div className="panel-header">
          <div className="panel-title">
            <MapPin size={15} style={{ color: '#059669' }} />
            <span>Physical Location & Switch Port Connectivity</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <LocationBadge
              status={device.location_verification}
              verifiedAt={device.location_verified_at}
            />
            <button
              className={`btn btn-sm ${isLocationVerified ? 'btn-secondary' : 'btn-primary'}`}
              onClick={handleToggleVerification}
              disabled={isVerifying}
            >
              <CheckCircle2 size={12} />
              {isLocationVerified ? 'Revert to Unverified' : 'Mark Location as Verified'}
            </button>
          </div>
        </div>

        <div className="panel-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
            {/* Left: Location Hierarchy */}
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                Physical Location Hierarchy
              </div>
              <div className="kv-grid">
                <span className="kv-key">Building / Office:</span>
                <span className="kv-value" style={{ fontWeight: 600 }}>
                  {device.building ? (
                    <span style={{ color: '#0f172a' }}>{device.building}</span>
                  ) : (
                    <span style={{ color: '#94a3b8' }}>Unrecorded building</span>
                  )}
                </span>

                <span className="kv-key">Floor / Level:</span>
                <span className="kv-value">
                  {device.floor || <span style={{ color: '#94a3b8' }}>Unrecorded floor</span>}
                </span>

                <span className="kv-key">Room / Section:</span>
                <span className="kv-value">
                  {device.room ? (
                    <span style={{ color: '#0284c7', fontWeight: 600 }}>{device.room}</span>
                  ) : (
                    <span style={{ color: '#94a3b8' }}>Unrecorded room</span>
                  )}
                </span>

                <span className="kv-key">Rack / Cabinet:</span>
                <span className="kv-value">
                  {device.rack ? (
                    <span>
                      {device.rack}
                      {device.rack_position && (
                        <span className="mono" style={{ marginLeft: '6px', color: '#059669', fontSize: '11px' }}>
                          [Position: {device.rack_position}]
                        </span>
                      )}
                    </span>
                  ) : (
                    <span style={{ color: '#94a3b8' }}>Unrecorded rack</span>
                  )}
                </span>
              </div>
            </div>

            {/* Right: Verified Switch Port & Link Details */}
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                Port & Uplink Verification
              </div>
              <div className="kv-grid">
                <span className="kv-key">Connected Switch Port:</span>
                <span className="kv-value mono" style={{ color: device.port_number ? '#0f172a' : '#94a3b8', fontWeight: 600 }}>
                  {device.port_number || 'Unverified physical port'}
                </span>

                <span className="kv-key">Parent / Upstream Device:</span>
                <span className="kv-value">
                  {device.parent_device_name ? (
                    <span style={{ color: '#0284c7', fontWeight: 500 }}>
                      {device.parent_device_name}
                      {device.parent_device_id && ` (Node #${device.parent_device_id})`}
                    </span>
                  ) : (
                    <span style={{ color: '#94a3b8' }}>None / Standalone root node</span>
                  )}
                </span>

                <span className="kv-key">Last Verified Date:</span>
                <span className="kv-value mono" style={{ fontSize: '11px' }}>
                  {device.location_verified_at
                    ? new Date(device.location_verified_at).toLocaleString()
                    : <span style={{ color: '#94a3b8' }}>Awaiting technician verification</span>}
                </span>

                <span className="kv-key">Physical Location Notes:</span>
                <span className="kv-value" style={{ fontSize: '11.5px', color: '#475569' }}>
                  {device.location_notes || <span style={{ color: '#94a3b8' }}>No location notes recorded</span>}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Split Panels: Technical Profile & Latency Chart */}
      <div className="overview-split-layout">
        {/* Device Network Profile */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">
              <Cpu size={14} />
              <span>Network Interface Profile & Database Entry</span>
            </div>
            <span style={{ fontSize: '11px', color: '#64748b' }}>PostgreSQL Node Record</span>
          </div>

          <div className="panel-body">
            <div className="kv-grid" style={{ marginBottom: '16px' }}>
              <span className="kv-key">Node Name:</span>
              <span className="kv-value">{device.name}</span>

              <span className="kv-key">Hardware Role:</span>
              <span className="kv-value">
                <DeviceTypeBadge type={device.device_type} />
              </span>

              <span className="kv-key">IPv4 Target:</span>
              <span className="kv-value mono" style={{ color: '#0284c7', fontWeight: 600 }}>
                {device.ip_address}
              </span>

              <span className="kv-key">MAC Interface ID:</span>
              <span className="kv-value mono">
                {device.mac_address || <span style={{ color: '#94a3b8' }}>Not recorded</span>}
              </span>

              <span className="kv-key">General Notes:</span>
              <span className="kv-value">
                {device.notes || <span style={{ color: '#94a3b8' }}>No general notes</span>}
              </span>

              <span className="kv-key">Last Probed:</span>
              <span className="kv-value mono" style={{ fontSize: '11px' }}>
                {currentStatus.checked_at ? new Date(currentStatus.checked_at).toLocaleString() : 'Never'}
              </span>

              <span className="kv-key">Registered:</span>
              <span className="kv-value mono" style={{ fontSize: '11px' }}>
                {new Date(device.created_at).toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* Latency History Chart */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">
              <Activity size={14} style={{ color: '#0284c7' }} />
              <span>Historical Latency & Availability</span>
            </div>
            <span style={{ fontSize: '11px', color: '#64748b' }}>Last 30 Checks</span>
          </div>

          <div className="panel-body" style={{ height: '240px', padding: '12px' }}>
            {chartData.length === 0 ? (
              <EmptyState
                title="No History Telemetry"
                description="Trigger a manual probe or wait for the automatic cycle to record points."
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#64748b' }} />
                  <YAxis unit="ms" tick={{ fontSize: 9, fill: '#64748b' }} domain={[0, 'dataMax + 20']} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      color: '#ffffff',
                      borderRadius: '4px',
                      fontSize: '11px',
                      border: 'none',
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="latency"
                    stroke="#0284c7"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#0284c7' }}
                    activeDot={{ r: 5 }}
                    name="Ping Latency (ms)"
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Historical Audit Trail Table */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">
            <Clock size={14} />
            <span>Recorded Ping History Log (Database Records)</span>
          </div>
          <span style={{ fontSize: '11px', color: '#64748b' }}>
            {history.length} historical check entries
          </span>
        </div>

        <div className="panel-body" style={{ padding: '0' }}>
          {history.length === 0 ? (
            <EmptyState
              title="No Log Records"
              description="Historical logs will appear once probe cycles run."
            />
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: '60px' }}>Log ID</th>
                    <th>Timestamp</th>
                    <th>Probe Result</th>
                    <th>Diagnostic Note</th>
                    <th>Response Time</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((record) => (
                    <tr key={record.id} className={record.status === 'offline' ? 'row-offline' : ''}>
                      <td className="mono" style={{ color: '#64748b' }}>
                        #{record.id}
                      </td>
                      <td className="mono" style={{ fontSize: '11px' }}>
                        {new Date(record.checked_at).toLocaleString()}
                      </td>
                      <td>
                        <StatusBadge status={record.status} />
                      </td>
                      <td style={{ fontSize: '11.5px', color: record.status === 'online' ? '#059669' : '#dc2626' }}>
                        {record.status === 'online'
                          ? 'Ping reply confirmed'
                          : 'No ping response / Request timed out'}
                      </td>
                      <td>
                        <LatencyIndicator latencyMs={record.latency_ms} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      <DeviceFormModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        initialDevice={device}
      />
    </div>
  );
};

export default DeviceDetails;
