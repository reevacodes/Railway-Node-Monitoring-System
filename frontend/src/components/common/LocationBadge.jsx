import React from 'react';
import { MapPin, CheckCircle2, HelpCircle, AlertCircle } from 'lucide-react';

export const LocationBadge = ({ status = 'unverified', verifiedAt = null }) => {
  const normStatus = (status || 'unverified').toLowerCase();

  let className = 'status-badge unknown';
  let label = 'Unverified Location';
  let Icon = HelpCircle;

  if (normStatus === 'verified') {
    className = 'status-badge online';
    label = 'Verified Physical Location';
    Icon = CheckCircle2;
  } else if (normStatus === 'unverified') {
    className = 'status-badge warning';
    label = 'Unverified Location';
    Icon = AlertCircle;
  } else {
    className = 'status-badge unknown';
    label = 'Unknown Location';
    Icon = HelpCircle;
  }

  const tooltip = verifiedAt
    ? `Physically verified on ${new Date(verifiedAt).toLocaleDateString()}`
    : 'Location not yet physically verified by technician';

  return (
    <span className={className} title={tooltip} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      <Icon size={11} />
      <span>{normStatus === 'verified' ? 'Verified' : normStatus === 'unknown' ? 'Unknown' : 'Unverified'}</span>
    </span>
  );
};

export const formatCompactLocation = (device) => {
  if (!device) return '—';
  if (device.room && device.building) {
    return `${device.room} (${device.building})`;
  }
  return device.room || device.building || device.notes || 'No location recorded';
};

export const CompactLocationView = ({ device }) => {
  const isVerified = device?.location_verification === 'verified';
  const locationName = device?.room || device?.building || 'No location recorded';
  const siteName = device?.room && device?.building ? device.building : null;
  const isUnrecorded = !device?.room && !device?.building;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        maxWidth: '240px',
      }}
      title={`Location: ${device?.room || '—'} | Site/Station: ${device?.building || '—'} (${isVerified ? 'Verified' : 'Unverified'})`}
    >
      <MapPin
        size={13}
        style={{
          color: isVerified ? '#059669' : isUnrecorded ? '#94a3b8' : '#0284c7',
          flexShrink: 0,
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25, overflow: 'hidden' }}>
        <span
          style={{
            fontSize: '11.5px',
            fontWeight: 600,
            color: isUnrecorded ? '#94a3b8' : '#0f172a',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {locationName}
        </span>
        {siteName && (
          <span style={{ fontSize: '10px', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {siteName}
          </span>
        )}
      </div>
    </div>
  );
};

export default LocationBadge;
