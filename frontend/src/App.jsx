import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { NetworkProvider } from './context/NetworkContext';
import AppLayout from './components/layout/AppLayout';
import Overview from './pages/Overview';
import DeviceInventory from './pages/DeviceInventory';
import DeviceDetails from './pages/DeviceDetails';
import NetworkTopology from './pages/NetworkTopology';
import AvailabilityHistory from './pages/AvailabilityHistory';
import EventsAlerts from './pages/EventsAlerts';
import DeviceManagement from './pages/DeviceManagement';
import MonitoringConfig from './pages/MonitoringConfig';
import Settings from './pages/Settings';
import MacInventory from './pages/MacInventory';
import ArpDiscovery from './pages/ArpDiscovery';

export const App = () => {
  return (
    <NetworkProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            <Route index element={<Overview />} />
            <Route path="overview" element={<Navigate to="/" replace />} />
            <Route path="devices" element={<DeviceInventory />} />
            <Route path="devices/:id" element={<DeviceDetails />} />
            <Route path="devices/manage" element={<DeviceManagement />} />
            <Route path="topology" element={<NetworkTopology />} />
            <Route path="mac-inventory" element={<MacInventory />} />
            <Route path="arp-discovery" element={<ArpDiscovery />} />
            <Route path="history" element={<AvailabilityHistory />} />
            <Route path="alerts" element={<EventsAlerts />} />
            <Route path="monitoring-config" element={<MonitoringConfig />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </NetworkProvider>
  );
};

export default App;
