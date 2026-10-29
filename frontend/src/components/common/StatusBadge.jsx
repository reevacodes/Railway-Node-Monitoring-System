import React from 'react';

export const StatusBadge = ({ status, isDegraded = false }) => {
  const normStatus = (status || 'unknown').toLowerCase();

  let label = 'Unknown';
  let className = 'status-badge unknown';

  if (normStatus === 'online') {
    if (isDegraded) {
      label = 'Degraded';
      className = 'status-badge warning';
    } else {
      label = 'Online';
      className = 'status-badge online';
    }
  } else if (normStatus === 'offline') {
    label = 'Offline / No reply';
    className = 'status-badge offline';
  } else if (normStatus === 'warning') {
    label = 'Warning';
    className = 'status-badge warning';
  } else {
    label = 'Unverified';
    className = 'status-badge unknown';
  }

  return (
    <span className={className}>
      <span className="status-dot" />
      {label}
    </span>
  );
};

export default StatusBadge;
