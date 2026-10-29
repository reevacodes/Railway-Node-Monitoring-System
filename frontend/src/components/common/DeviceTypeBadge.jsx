import React from 'react';
import { Router, Network, Wifi, Server, Monitor, HardDrive, Shield } from 'lucide-react';

export const DeviceTypeBadge = ({ type }) => {
  const normType = (type || 'unknown').toLowerCase();

  let Icon = Monitor;
  if (normType.includes('router')) Icon = Router;
  else if (normType.includes('switch')) Icon = Network;
  else if (normType.includes('point') || normType.includes('wifi') || normType.includes('ap')) Icon = Wifi;
  else if (normType.includes('server')) Icon = Server;
  else if (normType.includes('firewall') || normType.includes('gateway')) Icon = Shield;
  else if (normType.includes('storage') || normType.includes('nas')) Icon = HardDrive;

  return (
    <span className="device-type-tag">
      <Icon size={12} />
      <span>{type || 'Unspecified'}</span>
    </span>
  );
};

export default DeviceTypeBadge;
