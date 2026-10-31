import React, { useState } from 'react';
import { useNetwork } from '../context/NetworkContext';
import DeviceTypeBadge from '../components/common/DeviceTypeBadge';
import StatusBadge from '../components/common/StatusBadge';
import { LocationBadge, CompactLocationView } from '../components/common/LocationBadge';
import DeviceFormModal from '../components/devices/DeviceFormModal';
import EmptyState from '../components/common/EmptyState';
import {
  Sliders,
  Plus,
  Trash2,
  RefreshCw,
  Info,
  Server,
  AlertTriangle,
  Edit,
  MapPin,
  CheckCircle2,
} from 'lucide-react';

export const DeviceManagement = () => {
  const { devices, deviceStatuses, removeDevice, probeDevice, verifyLocation } = useNetwork();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [deviceToEdit, setDeviceToEdit] = useState(null);
  const [actionInProgress, setActionInProgress] = useState(null);

  const handleDelete = async (dev) => {
    if (window.confirm(`Are you sure you want to permanently remove "${dev.name}" from the database?`)) {
      setActionInProgress(`delete-${dev.id}`);
      try {
        await removeDevice(dev.id, dev.name);
      } finally {
        setActionInProgress(null);
      }
    }
  };

  const handleTestProbe = async (dev) => {
    setActionInProgress(`probe-${dev.id}`);
    try {
      await probeDevice(dev.id);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleToggleVerification = async (dev) => {
    setActionInProgress(`verify-${dev.id}`);
    try {
      const nextStatus = dev.location_verification === 'verified' ? 'unverified' : 'verified';
      await verifyLocation(dev.id, nextStatus);
    } finally {
      setActionInProgress(null);
    }
  };

  return (
    <div>
      {/* Title Strip */}
      <div className="page-title-strip">
        <div>
          <h1>Device Management</h1>
          <div className="page-subtitle">
            Configure node registrations, IP allocations, hardware roles and physical locations
          </div>
        </div>

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
          <Plus size={14} /> Add New Node
        </button>
      </div>

      {/* Info Callout */}
      <div
        style={{
          backgroundColor: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '4px',
          padding: '12px 16px',
          marginBottom: '20px',
          display: 'flex',
          gap: '12px',
          alignItems: 'flex-start',
        }}
      >
        <Info size={16} style={{ color: '#0284c7', marginTop: '2px', flexShrink: 0 }} />
        <div style={{ fontSize: '12px', color: '#475569', lineHeight: 1.5 }}>
          <strong>Physical Location & Network Management Policy:</strong> Registered nodes are automatically probed every 30 seconds.
          Record physical installation coordinates (Building, Room, Rack, Switch Port) to expedite dispatch and troubleshooting.
          Mark locations as <strong>Verified</strong> only after on-site physical inspection.
        </div>
      </div>

      {/* Main Panel */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">
            <Server size={14} />
            <span>Registered Node Directory ({devices.length} Nodes)</span>
          </div>
          <span style={{ fontSize: '11px', color: '#64748b' }}>PostgreSQL: devices table</span>
        </div>

        <div className="panel-body" style={{ padding: '0' }}>
          {devices.length === 0 ? (
            <EmptyState
              title="No Registered Nodes"
              description="Get started by registering railway trackside or NOC devices."
              action={
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
                  <Plus size={13} /> Register First Device
                </button>
              }
            />
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: '45px' }}>ID</th>
                    <th>Device Name</th>
                    <th>Office</th>
                    <th>Hardware Role</th>
                    <th>Target IP Address</th>
                    <th>MAC Interface</th>
                    <th>Physical Location</th>
                    <th>Location Status</th>
                    <th>Switch Port</th>
                    <th style={{ textAlign: 'right' }}>Admin Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((dev) => (
                    <tr key={dev.id}>
                      <td className="mono" style={{ color: '#64748b' }}>
                        #{dev.id}
                      </td>
                      <td style={{ fontWeight: 600 }}>{dev.name}</td>
                      <td>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: '4px',
                            background:
                              dev.office === 'DRM'
                                ? '#eff6ff'
                                : dev.office === 'CONTROL'
                                ? '#ecfdf5'
                                : dev.office === 'NIA'
                                ? '#fef3c7'
                                : '#f1f5f9',
                            color:
                              dev.office === 'DRM'
                                ? '#1d4ed8'
                                : dev.office === 'CONTROL'
                                ? '#047857'
                                : dev.office === 'NIA'
                                ? '#b45309'
                                : '#64748b',
                            border: `1px solid ${
                              dev.office === 'DRM'
                                ? '#bfdbfe'
                                : dev.office === 'CONTROL'
                                ? '#a7f3d0'
                                : dev.office === 'NIA'
                                ? '#fde68a'
                                : '#cbd5e1'
                            }`,
                          }}
                        >
                          {dev.office || 'DRM'}
                        </span>
                      </td>
                      <td>
                        <DeviceTypeBadge type={dev.device_type} />
                      </td>
                      <td className="mono" style={{ fontWeight: 500, color: '#0284c7' }}>
                        {dev.ip_address}
                      </td>
                      <td className="mono" style={{ fontSize: '11px', color: dev.mac_address ? '#334155' : '#94a3b8' }}>
                        {dev.mac_address || 'Unrecorded'}
                      </td>
                      <td>
                        <CompactLocationView device={dev} />
                      </td>
                      <td>
                        <LocationBadge
                          status={dev.location_verification}
                          verifiedAt={dev.location_verified_at}
                        />
                      </td>
                      <td className="mono" style={{ fontSize: '11px', color: dev.port_number ? '#0f172a' : '#94a3b8' }}>
                        {dev.port_number || 'Unverified'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '5px' }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            title="Edit Node & Location"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDeviceToEdit(dev);
                              setIsAddModalOpen(true);
                            }}
                          >
                            <Edit size={11} />
                            <span>Edit</span>
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            title="Toggle Verification"
                            onClick={() => handleToggleVerification(dev)}
                            disabled={actionInProgress === `verify-${dev.id}`}
                          >
                            <CheckCircle2 size={11} style={{ color: dev.location_verification === 'verified' ? '#059669' : '#94a3b8' }} />
                            <span>{dev.location_verification === 'verified' ? 'Verified' : 'Verify'}</span>
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            title="Send Test Probe Check"
                            onClick={() => handleTestProbe(dev)}
                            disabled={actionInProgress === `probe-${dev.id}`}
                          >
                            <RefreshCw
                              size={11}
                              className={actionInProgress === `probe-${dev.id}` ? 'spin-icon' : ''}
                            />
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            title="Delete Node from Database"
                            onClick={() => handleDelete(dev)}
                            disabled={actionInProgress === `delete-${dev.id}`}
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Add / Edit Modal */}
      <DeviceFormModal
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          setDeviceToEdit(null);
        }}
        initialDevice={deviceToEdit}
      />
    </div>
  );
};

export default DeviceManagement;
