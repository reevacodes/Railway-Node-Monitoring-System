import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';

const NetworkContext = createContext(null);

export const NetworkProvider = ({ children }) => {
  const [devices, setDevices] = useState([]);
  const [deviceStatuses, setDeviceStatuses] = useState({});
  const [deviceHistories, setDeviceHistories] = useState({});
  const [backendHealth, setBackendHealth] = useState({
    healthy: false,
    database: '',
    latencyMs: null,
    lastChecked: null,
    error: null,
  });
  const [lastRefresh, setLastRefresh] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [notification, setNotification] = useState(null);
  const [arpSummary, setArpSummary] = useState(null);

  const isMounted = useRef(true);
  const refreshTimerRef = useRef(null);
  const inFlightRef = useRef(false);

  const showNotification = useCallback((message, type = 'info') => {
    setNotification({ message, type, id: Date.now() });
    setTimeout(() => {
      setNotification((curr) => (curr?.message === message ? null : curr));
    }, 4000);
  }, []);

  const fetchAllData = useCallback(async (isSilent = false) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    if (!isSilent) setIsRefreshing(true);

    try {
      // 1. Health check
      let healthRes;
      try {
        healthRes = await api.checkHealth();
        setBackendHealth({
          healthy: healthRes.healthy,
          database: healthRes.database,
          latencyMs: healthRes.latencyMs,
          lastChecked: new Date().toLocaleTimeString(),
          error: null,
        });
      } catch (err) {
        setBackendHealth({
          healthy: false,
          database: '',
          latencyMs: null,
          lastChecked: new Date().toLocaleTimeString(),
          error: err.message || 'Cannot reach API',
        });
      }

      // 2. Devices
      let deviceList = [];
      try {
        deviceList = await api.getDevices();
        if (Array.isArray(deviceList)) {
          setDevices(deviceList);
        }
      } catch (err) {
        console.error('Failed to load devices:', err);
      }

      // 3. For each device, fetch latest history to determine current status & latency
      if (Array.isArray(deviceList) && deviceList.length > 0) {
        const statuses = {};
        const histories = {};

        await Promise.all(
          deviceList.map(async (dev) => {
            try {
              const hist = await api.getDeviceHistory(dev.id);
              if (Array.isArray(hist)) {
                histories[dev.id] = hist;
                if (hist.length > 0) {
                  // Most recent status record (ORDER BY checked_at DESC)
                  statuses[dev.id] = hist[0];
                } else {
                  statuses[dev.id] = {
                    status: 'unknown',
                    latency_ms: null,
                    checked_at: null,
                    untested: true,
                  };
                }
              }
            } catch (err) {
              console.warn(`Could not load history for device ${dev.id}`, err);
              statuses[dev.id] = {
                status: 'unknown',
                latency_ms: null,
                checked_at: null,
                error: true,
              };
            }
          })
        );

        setDeviceStatuses(statuses);
        setDeviceHistories(histories);
      } else {
        setDeviceStatuses({});
        setDeviceHistories({});
      }

      // 4. Fetch Sophos ARP discovery summary
      try {
        const arpSum = await api.getArpSummary();
        if (arpSum) setArpSummary(arpSum);
      } catch (err) {
        console.warn('Could not load ARP summary:', err);
      }

      setLastRefresh(new Date());
    } catch (err) {
      console.error('Data refresh error:', err);
    } finally {
      inFlightRef.current = false;
      if (isMounted.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  // Polling cycle every 15 seconds as specified in requirements
  useEffect(() => {
    isMounted.current = true;
    fetchAllData(false);

    refreshTimerRef.current = setInterval(() => {
      fetchAllData(true);
    }, 15000);

    return () => {
      isMounted.current = false;
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [fetchAllData]);

  const addDevice = async (deviceData) => {
    try {
      const created = await api.createDevice(deviceData);
      showNotification(`Device "${created.name}" registered successfully.`, 'success');
      await fetchAllData(false);
      return created;
    } catch (err) {
      showNotification(err.message || 'Failed to register device.', 'error');
      throw err;
    }
  };

  const editDevice = async (id, deviceData) => {
    try {
      const updated = await api.updateDevice(id, deviceData);
      showNotification(`Device "${updated.name}" updated successfully.`, 'success');
      await fetchAllData(false);
      return updated;
    } catch (err) {
      showNotification(err.message || 'Failed to update device.', 'error');
      throw err;
    }
  };

  const verifyLocation = async (id, status = 'verified') => {
    try {
      const updated = await api.verifyDeviceLocation(id, status);
      showNotification(`Physical location marked as ${status.toUpperCase()} for "${updated.name}".`, 'success');
      await fetchAllData(false);
      return updated;
    } catch (err) {
      showNotification(err.message || 'Failed to verify location.', 'error');
      throw err;
    }
  };

  const removeDevice = async (id, name) => {
    try {
      await api.deleteDevice(id);
      showNotification(`Device "${name || id}" removed.`, 'success');
      await fetchAllData(false);
    } catch (err) {
      showNotification(err.message || 'Failed to remove device.', 'error');
      throw err;
    }
  };


  const probeDevice = async (id, simulatedStatus = null, latency = null) => {
    try {
      // The backend accepts { status, latency_ms }
      // If none provided, test probe records online with simulated latency or check
      const statusToRecord = simulatedStatus || 'online';
      const latencyToRecord = latency !== undefined ? latency : Math.floor(Math.random() * 25) + 5;
      
      const record = await api.recordStatusCheck(id, {
        status: statusToRecord,
        latency_ms: statusToRecord === 'online' ? latencyToRecord : null,
      });

      showNotification(`Probe recorded for device #${id}: ${statusToRecord.toUpperCase()}`, 'info');
      await fetchAllData(true);
      return record;
    } catch (err) {
      showNotification(`Probe check failed: ${err.message}`, 'error');
      throw err;
    }
  };

  // Compile unified incidents list (offline, unknown, degraded > 120ms)
  const incidents = devices
    .map((dev) => {
      const statusObj = deviceStatuses[dev.id] || { status: 'unknown' };
      return {
        device: dev,
        status: statusObj.status || 'unknown',
        latency_ms: statusObj.latency_ms,
        last_checked: statusObj.checked_at,
        isDegraded: statusObj.latency_ms && statusObj.latency_ms > 100,
      };
    })
    .filter((item) => item.status === 'offline' || item.status === 'unknown' || item.isDegraded);

  // Compile flat chronological event log across all devices
  const allEvents = Object.entries(deviceHistories).flatMap(([devId, histList]) => {
    const dev = devices.find((d) => String(d.id) === String(devId));
    return (histList || []).map((h) => ({
      ...h,
      deviceName: dev?.name || `Device #${devId}`,
      deviceType: dev?.device_type || 'Unknown',
      ipAddress: dev?.ip_address || '—',
      device: dev || null,
    }));
  }).sort((a, b) => new Date(b.checked_at) - new Date(a.checked_at));


  const uploadArpSnapshot = async (payload) => {
    try {
      const result = await api.importArpSnapshot(payload);
      showNotification(`ARP snapshot imported: ${result.matchedInventoryCount} matched, ${result.unmatchedCount} unmatched.`, 'success');
      await fetchAllData(false);
      return result;
    } catch (err) {
      showNotification(err.message || 'Failed to import ARP snapshot.', 'error');
      throw err;
    }
  };

  const reimportInventory = async (payload) => {
    try {
      const result = await api.importMacInventory(payload);
      showNotification(`Inventory synced: ${result.totalInventoryRecords} devices in inventory.`, 'success');
      await fetchAllData(false);
      return result;
    } catch (err) {
      showNotification(err.message || 'Failed to import inventory.', 'error');
      throw err;
    }
  };

  const value = {
    devices,
    deviceStatuses,
    deviceHistories,
    backendHealth,
    arpSummary,
    lastRefresh,
    isLoading,
    isRefreshing,
    globalSearch,
    setGlobalSearch,
    notification,
    showNotification,
    incidents,
    allEvents,
    refreshData: () => fetchAllData(false),
    addDevice,
    editDevice,
    verifyLocation,
    removeDevice,
    probeDevice,
    uploadArpSnapshot,
    reimportInventory,
  };



  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
};

export const useNetwork = () => {
  const context = useContext(NetworkContext);
  if (!context) {
    throw new Error('useNetwork must be used within a NetworkProvider');
  }
  return context;
};
export default NetworkContext;
