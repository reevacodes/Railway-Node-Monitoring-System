import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Drawer from '../common/Drawer';
import StatusBadge from '../common/StatusBadge';
import DeviceTypeBadge from '../common/DeviceTypeBadge';
import LatencyIndicator from '../common/LatencyIndicator';
import { LocationBadge, formatCompactLocation } from '../common/LocationBadge';
import { useNetwork } from '../../context/NetworkContext';
import {
  RefreshCw,
  ExternalLink,
  MapPin,
  CheckCircle2,
  ShieldCheck,
  Edit,
  Network,
  Clock,
  Layers,
  User,
  Phone,
} from 'lucide-react';

export const DeviceQuickDrawer = ({ device, isOpen, onClose, onEditDevice = null }) => {
  const navigate = useNavigate();
  const { deviceStatuses, deviceHistories, fetchDeviceHistory, probeDevice, verifyLocation } = useNetwork();
  const [isProbing, setIsProbing] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    if (isOpen && device?.id && fetchDeviceHistory) {
      fetchDeviceHistory(device.id);
    }
  }, [isOpen, device?.id, fetchDeviceHistory]);

  if (!device) return null;

  const currentStatus = deviceStatuses[device.id] || { status: 'unknown' };
  const history = deviceHistories[device.id] || [];
  const isLocationVerified = device.location_verification === 'verified';

  const handleManualProbe = async () => {
    setIsProbing(true);
    try {
      await probeDevice(device.id);
    } finally {
      setIsProbing(false);
    }
  };

  const handleToggleVerification = async () => {
    setIsVerifying(true);
    try {
      await verifyLocation(device.id, isLocationVerified ? 'unverified' : 'verified');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleViewFullDetails = () => {
    onClose();
    navigate(`/devices/${device.id}`);
  };

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title={`Node Inspection — ${device.name}${device.contact_person ? ` • 👤 ${device.contact_person}` : ''}`} width={520}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Top Reachability Status Banner */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 14px',
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '4px',
          }}
        >
          <div>
            <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>
              Live Reachability
            </div>
            <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <StatusBadge status={currentStatus.status} />
              <LatencyIndicator latencyMs={currentStatus.latency_ms} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '6px' }}>
            {onEditDevice && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  onClose();
                  onEditDevice(device);
                }}
                title="Edit device & location"
              >
                <Edit size={12} /> Edit
              </button>
            )}
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleManualProbe}
              disabled={isProbing}
              title="Send manual probe record"
            >
              <RefreshCw size={12} className={isProbing ? 'spin-icon' : ''} />
              {isProbing ? 'Probing...' : 'Probe'}
            </button>
          </div>
        </div>

        {/* Assigned Officer / Custodian Banner */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 14px',
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '4px',
            fontSize: '12px',
          }}
        >
          <User size={15} style={{ color: device.contact_person ? '#6366f1' : '#94a3b8' }} />
          <div>
            <span style={{ color: '#64748b' }}>Assigned Person: </span>
            {device.contact_person ? (
              <>
                <strong style={{ color: '#0f172a' }}>{device.contact_person}</strong>
                {device.contact_phone && (
                  <span className="mono" style={{ marginLeft: '8px', color: '#0284c7' }}>
                    (Tel: {device.contact_phone})
                  </span>
                )}
              </>
            ) : (
              <span style={{ color: '#94a3b8' }}>Unassigned</span>
            )}
          </div>
        </div>

        {/* 1. Dedicated Physical Location & Connectivity Section */}
        <div
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '4px',
            padding: '12px 14px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600, color: '#1e293b' }}>
              <MapPin size={14} style={{ color: '#059669' }} />
              <span>Physical Location & Connectivity</span>
            </div>

            <LocationBadge
              status={device.location_verification}
              verifiedAt={device.location_verified_at}
            />
          </div>

          <div className="kv-grid" style={{ marginBottom: '10px' }}>
            <span className="kv-key">Building / Office:</span>
            <span className="kv-value">{device.building || <span style={{ color: '#94a3b8' }}>Unrecorded</span>}</span>

            <span className="kv-key">Floor / Level:</span>
            <span className="kv-value">{device.floor || <span style={{ color: '#94a3b8' }}>Unrecorded</span>}</span>

            <span className="kv-key">Room / Section:</span>
            <span className="kv-value">{device.room || <span style={{ color: '#94a3b8' }}>Unrecorded</span>}</span>

            <span className="kv-key">Rack / Cabinet:</span>
            <span className="kv-value">
              {device.rack || <span style={{ color: '#94a3b8' }}>Unrecorded</span>}
              {device.rack_position && (
                <span className="mono" style={{ marginLeft: '6px', color: '#0284c7', fontSize: '11px' }}>
                  ({device.rack_position})
                </span>
              )}
            </span>

            <span className="kv-key">Connected Switch Port:</span>
            <span className="kv-value mono">
              {device.port_number || <span style={{ color: '#94a3b8' }}>Unverified port</span>}
            </span>

            <span className="kv-key">Upstream / Parent Device:</span>
            <span className="kv-value">
              {device.parent_device_name || <span style={{ color: '#94a3b8' }}>None / Standalone</span>}
            </span>

            <span className="kv-key">Verification Date:</span>
            <span className="kv-value mono" style={{ fontSize: '11px' }}>
              {device.location_verified_at
                ? new Date(device.location_verified_at).toLocaleString()
                : <span style={{ color: '#94a3b8' }}>Not verified</span>}
            </span>

            <span className="kv-key">Contact Person:</span>
            <span className="kv-value" style={{ fontWeight: device.contact_person ? 600 : 'normal' }}>
              {device.contact_person || <span style={{ color: '#94a3b8' }}>Unrecorded</span>}
            </span>

            <span className="kv-key">Phone / Intercom:</span>
            <span className="kv-value mono" style={{ color: device.contact_phone ? '#0284c7' : 'inherit' }}>
              {device.contact_phone || <span style={{ color: '#94a3b8' }}>Unrecorded</span>}
            </span>

            <span className="kv-key">Location Notes:</span>
            <span className="kv-value" style={{ fontSize: '11.5px', color: '#475569' }}>
              {device.location_notes || <span style={{ color: '#94a3b8' }}>No location notes</span>}
            </span>
          </div>

          {/* Quick Verification Action */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '4px' }}>
            <button
              className={`btn btn-sm ${isLocationVerified ? 'btn-secondary' : 'btn-primary'}`}
              onClick={handleToggleVerification}
              disabled={isVerifying}
              style={{ fontSize: '11px' }}
            >
              <CheckCircle2 size={12} />
              {isLocationVerified ? 'Revert to Unverified' : 'Mark Location as Verified'}
            </button>
          </div>
        </div>

        {/* 2. Technical Network Attributes Grid */}
        <div>
          <div style={{ fontSize: '11.5px', fontWeight: 600, color: '#334155', marginBottom: '8px' }}>
            Network Interface Specifications
          </div>
          <div className="kv-grid">
            <span className="kv-key">Hardware Role:</span>
            <span className="kv-value">
              <DeviceTypeBadge type={device.device_type} />
            </span>

            <span className="kv-key">IPv4 Target:</span>
            <span className="kv-value mono" style={{ color: '#0284c7', fontWeight: 600 }}>
              {device.ip_address}
            </span>

            <span className="kv-key">Subnet Classification:</span>
            <span className="kv-value">
              {device.matched_subnet ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontWeight: 600, color: '#0369a1' }}>
                    {device.matched_office?.office_name || 'Office'}
                  </span>
                  <span className="mono" style={{ fontSize: '11px', color: '#475569' }}>
                    {device.matched_subnet.subnet_name} ({device.matched_subnet.cidr_prefix})
                  </span>
                </div>
              ) : (
                <span style={{ color: '#64748b', fontSize: '11px', fontStyle: 'italic' }}>
                  {device.network_classification || 'Unassigned / Unknown Network'}
                </span>
              )}
            </span>

            <span className="kv-key">MAC Interface ID:</span>
            <span className="kv-value mono">
              {device.mac_address || <span style={{ color: '#94a3b8' }}>Unrecorded</span>}
            </span>

            <span className="kv-key">Last Probed:</span>
            <span className="kv-value mono" style={{ fontSize: '11px' }}>
              {currentStatus.checked_at ? new Date(currentStatus.checked_at).toLocaleString() : 'Never'}
            </span>
          </div>
        </div>

        {/* 3. Recent Checks */}
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '8px',
            }}
          >
            <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#334155' }}>
              Recent ICMP Checks
            </span>
            <span style={{ fontSize: '11px', color: '#64748b' }}>
              {history.length} records available
            </span>
          </div>

          {history.length === 0 ? (
            <div style={{ fontSize: '11.5px', color: '#94a3b8', fontStyle: 'italic', padding: '10px 0' }}>
              No check history recorded yet for this device.
            </div>
          ) : (
            <div className="table-wrapper" style={{ maxHeight: '160px' }}>
              <table className="table" style={{ fontSize: '11.5px' }}>
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Status</th>
                    <th>Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {history.slice(0, 5).map((h) => (
                    <tr key={h.id}>
                      <td className="mono" style={{ fontSize: '10.5px' }}>
                        {new Date(h.checked_at).toLocaleTimeString()}
                      </td>
                      <td>
                        <StatusBadge status={h.status} />
                      </td>
                      <td>
                        <LatencyIndicator latencyMs={h.latency_ms} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* View Full History Button */}
        <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '12px', marginTop: 'auto' }}>
          <button
            className="btn btn-primary"
            style={{ width: '100%' }}
            onClick={handleViewFullDetails}
          >
            <ExternalLink size={13} />
            Open Comprehensive Device Details & Diagnostics
          </button>
        </div>
      </div>
    </Drawer>
  );
};

export default DeviceQuickDrawer;
