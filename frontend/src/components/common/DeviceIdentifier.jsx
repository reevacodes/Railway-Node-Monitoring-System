import React from 'react';

/**
 * Standard device identifier with contact person underneath.
 * Follows the Device Inventory typography and styling standard across the application.
 */
export const DeviceIdentifier = ({
  name,
  contactPerson,
  contactPhone,
  isNew = false,
  showUnassigned = true,
  unassignedText = 'Unassigned',
  extraBadge = null,
  style = {},
  nameStyle = {},
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, color: '#0f172a', ...nameStyle }}>
          {name || '—'}
        </span>
        {isNew && (
          <span
            style={{
              fontSize: '9.5px',
              padding: '1px 5px',
              backgroundColor: '#ede9fe',
              color: '#6d28d9',
              borderRadius: '3px',
              fontWeight: 600,
            }}
            title="Commissioned in the last 72 hours"
          >
            NEW
          </span>
        )}
        {extraBadge}
      </div>

      {contactPerson ? (
        <div
          style={{
            fontSize: '11px',
            color: '#1e293b',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            marginTop: '2px',
          }}
        >
          <span style={{ color: '#6366f1', fontSize: '11px', flexShrink: 0 }}>👤</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {contactPerson}
          </span>
          {contactPhone && (
            <span
              className="mono"
              style={{ color: '#0284c7', fontWeight: 400, fontSize: '10.5px', whiteSpace: 'nowrap' }}
            >
              • {contactPhone}
            </span>
          )}
        </div>
      ) : showUnassigned ? (
        <div style={{ fontSize: '10.5px', color: '#94a3b8', marginTop: '2px' }}>
          {unassignedText}
        </div>
      ) : null}
    </div>
  );
};

export default DeviceIdentifier;

