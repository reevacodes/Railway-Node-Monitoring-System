import React from 'react';
import { CheckCircle2, Clock, AlertTriangle, HelpCircle, Shield, Radio } from 'lucide-react';

export const ArpStateBadge = ({ state }) => {
  const normState = (state || 'UNKNOWN').toUpperCase();

  let className = 'status-badge unknown';
  let label = normState;
  let tooltip = '';
  let Icon = HelpCircle;

  if (normState === 'REACHABLE' || normState.includes('COMPLETE')) {
    className = 'status-badge online';
    label = normState.includes('COMPLETE') ? 'COMPLETE' : 'REACHABLE';
    tooltip = 'Neighbor cache confirmed active reachability';
    Icon = CheckCircle2;
  } else if (normState === 'STALE') {
    className = 'status-badge warning';
    label = 'STALE';
    tooltip = 'Normal ARP state: Valid cache entry awaiting traffic confirmation. Does NOT imply device is offline.';
    Icon = Clock;
  } else if (normState === 'FAILED' || normState.includes('INCOMPLETE')) {
    className = 'status-badge offline';
    label = normState.includes('INCOMPLETE') ? 'INCOMPLETE' : 'FAILED';
    tooltip = 'No ARP response received / unresolved neighbor entry';
    Icon = AlertTriangle;
  } else if (normState === 'PERMANENT') {
    className = 'status-badge online';
    label = 'PERMANENT';
    tooltip = 'Static permanent ARP entry configured on firewall';
    Icon = Shield;
  } else {
    className = 'status-badge unknown';
    label = normState || 'NOT OBSERVED';
    tooltip = 'Not observed in the active firewall ARP snapshot';
    Icon = HelpCircle;
  }

  return (
    <span className={className} title={tooltip} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      <Icon size={11} />
      <span>{label}</span>
    </span>
  );
};

export const ArpMatchBadge = ({ status }) => {
  if (status === 'matched') {
    return (
      <span
        className="status-badge online"
        title="MAC address successfully matched with an office inventory record"
        style={{ fontSize: '10.5px' }}
      >
        <CheckCircle2 size={10} />
        <span>Inventory Matched</span>
      </span>
    );
  }

  if (status === 'no_mac') {
    return (
      <span
        className="status-badge offline"
        title="Neighbor entry has no MAC address (failed ARP resolution)"
        style={{ fontSize: '10.5px' }}
      >
        <AlertTriangle size={10} />
        <span>No MAC (Failed)</span>
      </span>
    );
  }

  return (
    <span
      className="status-badge unknown"
      title="Host observed by firewall ARP table but not registered in office PC inventory"
      style={{ fontSize: '10.5px' }}
    >
      <Radio size={10} />
      <span>Unmatched Host</span>
    </span>
  );
};

export default ArpStateBadge;
