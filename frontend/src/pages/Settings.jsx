
import React, { useEffect, useState } from 'react';
import { useNetwork } from '../context/NetworkContext';
import {
  Settings as SettingsIcon,
  Server,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';

const STORAGE_KEY = 'railway-console-preferences';

const DEFAULT_PREFERENCES = {
  pollingInterval: '15',
  dateFormat: '24h',
  soundAlerts: false,
};

const loadPreferences = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved
      ? { ...DEFAULT_PREFERENCES, ...JSON.parse(saved) }
      : DEFAULT_PREFERENCES;
  } catch {
    return DEFAULT_PREFERENCES;
  }
};

export const Settings = () => {
  const { backendHealth, refreshData, isRefreshing } = useNetwork();

  const [pollingInterval, setPollingInterval] = useState(
    () => loadPreferences().pollingInterval
  );
  const [dateFormat, setDateFormat] = useState(
    () => loadPreferences().dateFormat
  );
  const [soundAlerts, setSoundAlerts] = useState(
    () => loadPreferences().soundAlerts
  );
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    const preferences = loadPreferences();
    setPollingInterval(preferences.pollingInterval);
    setDateFormat(preferences.dateFormat);
    setSoundAlerts(preferences.soundAlerts);
  }, []);

  const handleSave = (e) => {
    e.preventDefault();
    setSavedSuccess(false);
    setSaveError('');

    const preferences = {
      pollingInterval,
      dateFormat,
      soundAlerts,
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));

      // Verify the browser stored the selected values.
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));

      if (
        saved.pollingInterval !== pollingInterval ||
        saved.dateFormat !== dateFormat ||
        saved.soundAlerts !== soundAlerts
      ) {
        throw new Error('Saved preferences could not be verified.');
      }

      // Let other components in this browser tab respond to changes.
      window.dispatchEvent(
        new CustomEvent('railway-preferences-updated', {
          detail: preferences,
        })
      );

      setSavedSuccess(true);
    } catch (error) {
      setSaveError(
        error?.message || 'Unable to save preferences in this browser.'
      );
    }
  };

  return (
    <div>
      <div className="page-title-strip">
        <div>
          <h1>System Settings</h1>
          <div className="page-subtitle">
            Console parameters, backend API target and operator display configurations
          </div>
        </div>
      </div>

      <div className="overview-split-layout">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">
              <SettingsIcon size={14} />
              <span>Operator Console Preferences</span>
            </div>
          </div>

          <div className="panel-body">
            {savedSuccess && (
              <div
                role="status"
                style={{
                  padding: '8px 12px',
                  backgroundColor: '#ecfdf5',
                  color: '#065f46',
                  border: '1px solid #a7f3d0',
                  borderRadius: '3px',
                  fontSize: '11.5px',
                  marginBottom: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <CheckCircle2 size={14} />
                Preferences saved successfully in this browser.
              </div>
            )}

            {saveError && (
              <div role="alert" style={{ color: '#dc2626', marginBottom: 12 }}>
                {saveError}
              </div>
            )}

            <form onSubmit={handleSave}>
              <div className="form-group">
                <label className="form-label">
                  Frontend Polling Interval (Telemetry Fetch)
                </label>
                <select
                  className="form-select"
                  value={pollingInterval}
                  onChange={(e) => {
                    setPollingInterval(e.target.value);
                    setSavedSuccess(false);
                  }}
                >
                  <option value="10">10 Seconds (High Precision)</option>
                  <option value="15">15 Seconds (Standard NOC Default)</option>
                  <option value="30">30 Seconds (Synchronized with Ping Cycle)</option>
                  <option value="60">60 Seconds (Low Bandwidth)</option>
                </select>
                <div className="form-hint">
                  Frequency at which the frontend queries backend REST endpoints for fresh reachability records.
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">
                  Timestamp Display Format
                </label>
                <select
                  className="form-select"
                  value={dateFormat}
                  onChange={(e) => {
                    setDateFormat(e.target.value);
                    setSavedSuccess(false);
                  }}
                >
                  <option value="24h">
                    24-Hour Military Time (15:28:16) [Railway Standard]
                  </option>
                  <option value="12h">
                    12-Hour AM/PM Time (03:28:16 PM)
                  </option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">
                  Critical Outage Audio Alarm
                </label>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginTop: '6px',
                  }}
                >
                  <input
                    type="checkbox"
                    id="soundAlerts"
                    checked={soundAlerts}
                    onChange={(e) => {
                      setSoundAlerts(e.target.checked);
                      setSavedSuccess(false);
                    }}
                  />
                  <label
                    htmlFor="soundAlerts"
                    style={{
                      fontSize: '12px',
                      color: '#334155',
                      cursor: 'pointer',
                    }}
                  >
                    Play audible chime when an active railway node transitions to offline
                  </label>
                </div>
              </div>

              <div
                style={{
                  marginTop: '20px',
                  borderTop: '1px solid #e2e8f0',
                  paddingTop: '14px',
                }}
              >
                <button type="submit" className="btn btn-primary btn-sm">
                  Save Console Preferences
                </button>
              </div>
            </form>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">
              <Server size={14} style={{ color: '#0284c7' }} />
              <span>Backend &amp; Database Environment</span>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={refreshData}
              disabled={isRefreshing}
            >
              <RefreshCw
                size={11}
                className={isRefreshing ? 'spin-icon' : ''}
              />
              Test Connection
            </button>
          </div>

          <div className="panel-body">
            <div className="kv-grid" style={{ marginBottom: '16px' }}>
              <span className="kv-key">Backend API URL:</span>
              <span className="kv-value mono" style={{ color: '#0284c7' }}>
                {import.meta.env.VITE_API_BASE_URL || 'http://localhost:5001'}
              </span>

              <span className="kv-key">API Reachability:</span>
              <span className="kv-value">
                {backendHealth.healthy ? (
                  <span style={{ color: '#059669', fontWeight: 600 }}>
                    Connected &amp; Verified
                  </span>
                ) : (
                  <span style={{ color: '#dc2626', fontWeight: 600 }}>
                    Unreachable ({backendHealth.error})
                  </span>
                )}
              </span>

              <span className="kv-key">PostgreSQL Database:</span>
              <span className="kv-value mono">
                {backendHealth.database || 'network_monitor'}
              </span>

              <span className="kv-key">API Response Time:</span>
              <span className="kv-value mono">
                {backendHealth.latencyMs !== null
                  ? `${backendHealth.latencyMs} ms`
                  : '—'}
              </span>

              <span className="kv-key">Environment Target:</span>
              <span className="kv-value">
                Development / Local Rail Lab
              </span>
            </div>

            <div
              style={{
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '4px',
                padding: '12px',
                fontSize: '11.5px',
                color: '#64748b',
              }}
            >
              <strong>Security Protocol Notice:</strong> Database credentials
              and passwords are managed in the server's local{' '}
              <code className="mono">.env</code> files. Sensitive keys are not
              exposed in the frontend.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
