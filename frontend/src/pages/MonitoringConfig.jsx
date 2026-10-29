import React from 'react';
import { useNetwork } from '../context/NetworkContext';
import {
  Radio,
  Sliders,
  CheckCircle2,
  Clock,
  Shield,
  Layers,
  Database,
  Terminal,
} from 'lucide-react';

export const MonitoringConfig = () => {
  const { backendHealth } = useNetwork();

  return (
    <div>
      {/* Title Strip */}
      <div className="page-title-strip">
        <div>
          <h1>Monitoring Configuration</h1>
          <div className="page-subtitle">
            Inspection of ICMP daemon timing, probe parameters and networking protocols
          </div>
        </div>
      </div>

      <div className="overview-split-layout">
        {/* Left Column: Active Daemon Settings */}
        <div>
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <Radio size={14} style={{ color: '#0284c7' }} />
                <span>Backend ICMP Daemon Parameters (Live Settings)</span>
              </div>
              <span className="status-badge online">
                <span className="status-dot" />
                Active Daemon
              </span>
            </div>

            <div className="panel-body">
              <div className="kv-grid" style={{ marginBottom: '16px' }}>
                <span className="kv-key">Cycle Interval:</span>
                <span className="kv-value mono">30,000 ms (Every 30 seconds)</span>

                <span className="kv-key">Probe Protocol:</span>
                <span className="kv-value">ICMP Echo Request (Windows native ping.exe)</span>

                <span className="kv-key">Timeout Limit:</span>
                <span className="kv-value mono">1,500 ms (-w 1500)</span>

                <span className="kv-key">Packet Count:</span>
                <span className="kv-value mono">1 packet per target (-n 1)</span>

                <span className="kv-key">Concurrent Execution:</span>
                <span className="kv-value">Sequential with in-flight cycle lock</span>

                <span className="kv-key">Database Store:</span>
                <span className="kv-value mono">PostgreSQL (status_history table)</span>
              </div>

              <div
                style={{
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '4px',
                  padding: '12px',
                  fontSize: '11.5px',
                  color: '#475569',
                  display: 'flex',
                  gap: '8px',
                }}
              >
                <Terminal size={14} style={{ color: '#0284c7', flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <strong>Command Invocation:</strong>
                  <code style={{ display: 'block', margin: '4px 0', color: '#0f172a', fontFamily: 'var(--font-mono)' }}>
                    ping -n 1 -w 1500 &lt;target_ip&gt;
                  </code>
                  Standard Windows ICMP execution with regex latency extraction (<code className="mono">time=&lt;ms&gt;</code>) and TTL confirmation.
                </div>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <Layers size={14} />
                <span>Networking Terminology & Distinctions</span>
              </div>
            </div>

            <div className="panel-body" style={{ fontSize: '12px', color: '#334155', lineHeight: 1.6 }}>
              <div style={{ marginBottom: '12px' }}>
                <strong>1. ICMP Ping vs TCP Connection Checks:</strong>
                <p style={{ color: '#64748b', marginTop: '2px' }}>
                  ICMP (Internet Control Message Protocol) operates at Layer 3 (Network Layer) without port numbers or transport handshake.
                  In contrast, TCP checks connect to a specific Layer 4 listening port (e.g. port 80/443).
                  A device may block ICMP while keeping TCP open, or vice-versa.
                </p>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <strong>2. MAC Address Identifier Scope:</strong>
                <p style={{ color: '#64748b', marginTop: '2px' }}>
                  MAC addresses identify specific network interface cards (NICs) at Layer 2 (Data Link Layer).
                  They do not guarantee permanent identity across routed railway WAN boundaries and can be spoofed or duplicated across virtual interfaces.
                </p>
              </div>

              <div>
                <strong>3. Unreachability vs Outage:</strong>
                <p style={{ color: '#64748b', marginTop: '2px' }}>
                  A failed ping does not conclusively prove a device is physically powered off. Local host firewalls, ACL drop rules, or intermediate switch link failures can cause ICMP timeouts while the physical node remains operational.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Database Schema Profile */}
        <div>
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <Database size={14} style={{ color: '#0284c7' }} />
                <span>Database Integration Status</span>
              </div>
              <span className="mono" style={{ fontSize: '11px', color: '#64748b' }}>
                PostgreSQL 18
              </span>
            </div>

            <div className="panel-body">
              <div className="kv-grid" style={{ marginBottom: '16px' }}>
                <span className="kv-key">Active DB:</span>
                <span className="kv-value mono" style={{ color: '#059669', fontWeight: 600 }}>
                  {backendHealth.database || 'network_monitor'}
                </span>

                <span className="kv-key">Connection Pool:</span>
                <span className="kv-value mono">pg (Node-PostgreSQL)</span>

                <span className="kv-key">Primary Tables:</span>
                <span className="kv-value mono">devices, status_history</span>

                <span className="kv-key">Foreign Key:</span>
                <span className="kv-value mono">status_history.device_id &rarr; devices.id</span>
              </div>

              <div
                style={{
                  backgroundColor: '#f1f5f9',
                  padding: '10px 12px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono)',
                  color: '#334155',
                  lineHeight: 1.5,
                }}
              >
                CREATE TABLE status_history (<br />
                &nbsp;&nbsp;id SERIAL PRIMARY KEY,<br />
                &nbsp;&nbsp;device_id INT REFERENCES devices(id),<br />
                &nbsp;&nbsp;status VARCHAR(20) NOT NULL,<br />
                &nbsp;&nbsp;latency_ms INT NULL,<br />
                &nbsp;&nbsp;checked_at TIMESTAMPTZ DEFAULT NOW()<br />
                );
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MonitoringConfig;
