import React, { useState, useEffect } from 'react';
import Modal from '../common/Modal';
import { useNetwork } from '../../context/NetworkContext';
import { MapPin, Server, Network, CheckCircle2, Info } from 'lucide-react';

const DEVICE_TYPES = [
  'PC',
  'PC / Workstation',
  'Router',
  'Managed Switch',
  'Core Switch',
  'Access Point',
  'Signaling Server',
  'Trackside Sensor Gateway',
  'NOC Workstation',
  'CCTV Stream Gateway',
  'Firewall / UTM',
];

const COMMON_BUILDINGS = [
  'DRM Office Complex',
  'Railway Control Office',
  'Platform 1 Station Building',
  'Platform 2 Station Building',
  'Signaling & Telecom (S&T) Relay Room',
  'Traction Substation (TSS)',
  'Loco Shed Control Center',
  'Goods Yard Operations Room',
];

const COMMON_ROOMS = [
  'Central Server Room',
  'Section Controller Hall',
  'Network Operations Center (NOC)',
  'Station Master Cabin',
  'Relay & Power Equipment Room',
  'Security & CCTV Monitoring Cell',
  'Telecommunications Bay',
  'DRM Cabin / Office PC Desk',
  'User Workstation / PC Desk',
];

export const DeviceFormModal = ({ isOpen, onClose, initialDevice = null }) => {
  const { addDevice, editDevice, devices } = useNetwork();
  const isEditing = Boolean(initialDevice && initialDevice.id);

  const [formData, setFormData] = useState({
    name: '',
    ip_address: '',
    mac_address: '',
    device_type: 'Router',
    notes: '',
    building: '',
    floor: '',
    room: '',
    rack: '',
    rack_position: '',
    port_number: '',
    parent_device_id: '',
    parent_device_name: '',
    location_notes: '',
    location_verification: 'unverified',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (initialDevice) {
      setFormData({
        name: initialDevice.name || '',
        ip_address: initialDevice.ip_address || '',
        mac_address: initialDevice.mac_address || '',
        device_type: initialDevice.device_type || 'Router',
        notes: initialDevice.notes || '',
        building: initialDevice.building || '',
        floor: initialDevice.floor || '',
        room: initialDevice.room || '',
        rack: initialDevice.rack || '',
        rack_position: initialDevice.rack_position || '',
        port_number: initialDevice.port_number || '',
        parent_device_id: initialDevice.parent_device_id ? String(initialDevice.parent_device_id) : '',
        parent_device_name: initialDevice.parent_device_name || '',
        location_notes: initialDevice.location_notes || '',
        location_verification: initialDevice.location_verification || 'unverified',
      });
    } else {
      setFormData({
        name: '',
        ip_address: '',
        mac_address: '',
        device_type: 'Router',
        notes: '',
        building: '',
        floor: '',
        room: '',
        rack: '',
        rack_position: '',
        port_number: '',
        parent_device_id: '',
        parent_device_name: '',
        location_notes: '',
        location_verification: 'unverified',
      });
    }
    setErrorMsg('');
  }, [initialDevice, isOpen]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => {
      const updated = { ...prev, [name]: value };
      // If parent device dropdown changed, auto-sync parent_device_name
      if (name === 'parent_device_id') {
        const found = devices.find((d) => String(d.id) === String(value));
        if (found) {
          updated.parent_device_name = found.name;
        } else if (!value) {
          updated.parent_device_name = '';
        }
      }
      return updated;
    });
    setErrorMsg('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setErrorMsg('Device name is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        name: formData.name.trim(),
        ip_address: formData.ip_address.trim() || null,
        mac_address: formData.mac_address.trim() || null,
        device_type: formData.device_type,
        notes: formData.notes.trim() || null,
        building: formData.building.trim() || null,
        floor: formData.floor.trim() || null,
        room: formData.room.trim() || null,
        rack: formData.rack.trim() || null,
        rack_position: formData.rack_position.trim() || null,
        port_number: formData.port_number.trim() || null,
        parent_device_id: formData.parent_device_id ? Number(formData.parent_device_id) : null,
        parent_device_name: formData.parent_device_name.trim() || null,
        location_notes: formData.location_notes.trim() || null,
        location_verification: formData.location_verification || 'unverified',
      };

      if (isEditing) {
        await editDevice(initialDevice.id, payload);
      } else {
        await addDevice(payload);
      }
      onClose();
    } catch (err) {
      setErrorMsg(err.message || 'Failed to save device information');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? `Edit Device & Physical Location — ${initialDevice.name}` : 'Register Railway Network Node'}
      maxWidth={620}
    >
      <form onSubmit={handleSubmit}>
        {errorMsg && (
          <div
            style={{
              padding: '8px 12px',
              backgroundColor: '#fef2f2',
              color: '#991b1b',
              border: '1px solid #fecaca',
              borderRadius: '3px',
              fontSize: '11.5px',
              marginBottom: '14px',
            }}
          >
            {errorMsg}
          </div>
        )}

        {/* Section 1: Device Identity */}
        <div style={{ marginBottom: '18px' }}>
          <div
            style={{
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: '#475569',
              marginBottom: '10px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Server size={13} style={{ color: '#0284c7' }} />
            <span>1. Network Identity & Core Attributes</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div className="form-group" style={{ marginBottom: '8px' }}>
              <label className="form-label">
                Device Name <span className="required">*</span>
              </label>
              <input
                type="text"
                name="name"
                className="form-input"
                placeholder="e.g. DRM Core Switch 01"
                value={formData.name}
                onChange={handleChange}
                required
              />
            </div>

            <div className="form-group" style={{ marginBottom: '8px' }}>
              <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>IP Address</span>
                <span style={{ fontSize: '10.5px', color: '#64748b', fontWeight: 'normal' }}>
                  Optional — Auto-discovered
                </span>
              </label>
              <input
                type="text"
                name="ip_address"
                className="form-input mono"
                placeholder="e.g. 192.168.1.10 (or auto from firewall)"
                value={formData.ip_address}
                onChange={handleChange}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div className="form-group" style={{ marginBottom: '8px' }}>
              <label className="form-label">MAC Interface ID</label>
              <input
                type="text"
                name="mac_address"
                className="form-input mono"
                placeholder="AA:BB:CC:DD:EE:01"
                value={formData.mac_address}
                onChange={handleChange}
              />
            </div>

            <div className="form-group" style={{ marginBottom: '8px' }}>
              <label className="form-label">Device Type / Role</label>
              <select
                name="device_type"
                className="form-select"
                value={formData.device_type}
                onChange={handleChange}
              >
                {!DEVICE_TYPES.includes(formData.device_type) && formData.device_type && (
                  <option value={formData.device_type}>
                    {formData.device_type}
                  </option>
                )}
                {DEVICE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Section 2: Physical Device Location Hierarchy */}
        <div style={{ marginBottom: '18px', borderTop: '1px solid #e2e8f0', paddingTop: '14px' }}>
          <div
            style={{
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: '#475569',
              marginBottom: '10px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <MapPin size={13} style={{ color: '#059669' }} />
            <span>2. Physical Location Hierarchy (Optional)</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div className="form-group" style={{ marginBottom: '8px' }}>
              <label className="form-label">Building / Office</label>
              <input
                type="text"
                name="building"
                className="form-input"
                list="building-suggestions"
                placeholder="e.g. DRM Office Complex"
                value={formData.building}
                onChange={handleChange}
              />
              <datalist id="building-suggestions">
                {COMMON_BUILDINGS.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </div>

            <div className="form-group" style={{ marginBottom: '8px' }}>
              <label className="form-label">Floor</label>
              <input
                type="text"
                name="floor"
                className="form-input"
                placeholder="e.g. Ground Floor, 1st Floor"
                value={formData.floor}
                onChange={handleChange}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div className="form-group" style={{ marginBottom: '8px' }}>
              <label className="form-label">Room / Section</label>
              <input
                type="text"
                name="room"
                className="form-input"
                list="room-suggestions"
                placeholder="e.g. Central Server Room"
                value={formData.room}
                onChange={handleChange}
              />
              <datalist id="room-suggestions">
                {COMMON_ROOMS.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </div>

            <div className="form-group" style={{ marginBottom: '8px' }}>
              <label className="form-label">Rack / Cabinet</label>
              <input
                type="text"
                name="rack"
                className="form-input"
                placeholder="e.g. Rack A, Cabinet 02"
                value={formData.rack}
                onChange={handleChange}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div className="form-group" style={{ marginBottom: '8px' }}>
              <label className="form-label">Rack Position</label>
              <input
                type="text"
                name="rack_position"
                className="form-input mono"
                placeholder="e.g. U12, Shelf 2, Ceiling Bay"
                value={formData.rack_position}
                onChange={handleChange}
              />
            </div>

            <div className="form-group" style={{ marginBottom: '8px' }}>
              <label className="form-label">Location Verification State</label>
              <select
                name="location_verification"
                className="form-select"
                value={formData.location_verification}
                onChange={handleChange}
              >
                <option value="unverified">Unverified (Pending physical check)</option>
                <option value="verified">Verified (Confirmed by technician)</option>
                <option value="unknown">Unknown (Not inspected)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Section 3: Verified Physical Port & Upstream Device */}
        <div style={{ marginBottom: '16px', borderTop: '1px solid #e2e8f0', paddingTop: '14px' }}>
          <div
            style={{
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: '#475569',
              marginBottom: '10px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Network size={13} style={{ color: '#0284c7' }} />
            <span>3. Physical Port & Upstream Link (Verified Only)</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div className="form-group" style={{ marginBottom: '8px' }}>
              <label className="form-label">Switch Port Number</label>
              <input
                type="text"
                name="port_number"
                className="form-input mono"
                placeholder="e.g. Port 24, GigE 0/1"
                value={formData.port_number}
                onChange={handleChange}
              />
              <div className="form-hint">Physical switch port connected if verified.</div>
            </div>

            <div className="form-group" style={{ marginBottom: '8px' }}>
              <label className="form-label">Parent / Upstream Device</label>
              <select
                name="parent_device_id"
                className="form-select"
                value={formData.parent_device_id}
                onChange={handleChange}
              >
                <option value="">None / Standalone Root</option>
                {devices
                  .filter((d) => !initialDevice || d.id !== initialDevice.id)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.ip_address} - {d.device_type})
                    </option>
                  ))}
              </select>
              <div className="form-hint">Direct physical parent device if verified.</div>
            </div>
          </div>

          <div className="form-group" style={{ marginTop: '8px' }}>
            <label className="form-label">Physical Location Notes</label>
            <textarea
              name="location_notes"
              className="form-textarea"
              placeholder="e.g. Demarcation key held by Telecom Inspector; wall socket #14..."
              value={formData.location_notes}
              onChange={handleChange}
              style={{ height: '56px' }}
            />
          </div>
        </div>

        <div className="modal-footer" style={{ margin: '18px -18px -18px -18px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose?.();
            }}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
            {isSubmitting
              ? 'Saving...'
              : isEditing
              ? 'Update Node & Location'
              : 'Add Node with Physical Location'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default DeviceFormModal;
