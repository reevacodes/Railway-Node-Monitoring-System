# Railway Node Monitoring System — Complete Engineering Walkthrough & Architecture Guide

> **Author / Role**: Senior Engineering Mentor  
> **Audience**: Full-Stack & Systems Engineers  
> **Scope**: Architecture, Low-Level Protocols, Implementation Walkthrough, Database Schemas, Troubleshooting, and Independent Rebuild Guide  

---

## Table of Contents
1. [System Overview & Architecture Mental Model](#1-system-overview--architecture-mental-model)
2. [End-to-End Execution & Data Flow](#2-end-to-end-execution--data-flow)
3. [Database Architecture & Data Models (PostgreSQL)](#3-database-architecture--data-models-postgresql)
4. [Backend Implementation Deep-Dive (`backend/server.js`)](#4-backend-implementation-deep-dive-backendserverjs)
5. [Layer-2 MAC & ARP Ingestion Services](#5-layer-2-mac--arp-ingestion-services)
6. [Frontend Architecture & State Management (React)](#6-frontend-architecture--state-management-react)
7. [Differentiated Dashboard Modules Walkthrough](#7-differentiated-dashboard-modules-walkthrough)
8. [Debugging & Troubleshooting Playbook](#8-debugging--troubleshooting-playbook)
9. [Step-by-Step Guide: How to Rebuild This From Scratch](#9-step-by-step-guide-how-to-rebuild-this-from-scratch)

---

## 1. System Overview & Architecture Mental Model

### The Problem It Solves
In enterprise and railway environments (such as the Jammu Tawi DRM office), dozens of mission-critical workstations, gateways, and switches operate across distinct subnets (`192.168.40.0/24`, `192.168.41.0/24`, `192.168.1.0/24`). Without unified monitoring:
- A workstation failure in a critical cabin (*DRM Cabin, Sr. DEN-Co, Traffic Control*) goes unnoticed until an operations officer complains.
- Network administrators cannot distinguish between an authorized railway PC and an unmanaged/rogue host connected to an office switch or access point.
- There is no historical SLA record to prove whether an outage lasted 30 seconds or 4 hours.

### The 5 Architectural Tiers
Your application solves this by organizing functionality into 5 distinct, decoupled layers:

```mermaid
flowchart TD
    subgraph Tier1 ["Tier 1: Frontend Presentation (Browser)"]
        UI["React 19 + Vite (Port 5173)\nPages: Overview, Device Inventory, MACs, ARP, Topology, Alerts, History"]
        CTX["NetworkContext.jsx\nSingle Source of Truth & 10s Polling Loop"]
    end

    subgraph Tier2 ["Tier 2: Application API Server (Node.js)"]
        EXPRESS["Express Framework (Port 5001)\nCORS, JSON Body Parser (10MB limit)"]
        ROUTES1["Core REST Routes\n/devices, /status/latest, /status/history, /incidents"]
        ROUTES2["Layer-2 Routes\n/api/mac-inventory, /api/arp-snapshots, /api/arp-discoveries"]
    end

    subgraph Tier3 ["Tier 3: Asynchronous Monitoring Daemon"]
        SCHEDULER["setInterval Scheduler (Every 30s)\nConcurrency Lock: monitoringInProgress"]
        PING_ENGINE["execFile('ping.exe', ['-n', '1', '-w', '1500', IP])\nBatch Size: 6 concurrently via Promise.all"]
    end

    subgraph Tier4 ["Tier 4: Ingestion & Reconciliation Engine"]
        CSV_INV["inventory_service.js\nBOM-stripping, Header Normalization, MAC Clean"]
        CSV_ARP["arp_service.js\nSophos XGS2100 Neighbor-Table Ingestion"]
    end

    subgraph Tier5 ["Tier 5: Persistent Relational Storage"]
        PG[("PostgreSQL 16 (Port 5432)\nDatabase: network_monitor\nConnection Pool: pg.Pool")]
    end

    %% Wiring
    UI --> CTX
    CTX -->|"HTTP REST (api.js)"| EXPRESS
    EXPRESS --> ROUTES1
    EXPRESS --> ROUTES2
    ROUTES1 --> PG
    ROUTES2 --> PG
    SCHEDULER --> PING_ENGINE
    PING_ENGINE -->|"ICMP Echo Request/Reply"| OS_NET["Operating System & Physical LAN"]
    PING_ENGINE -->|"INSERT observations"| PG
    CSV_INV -->|"Upsert inventory_mac_records"| PG
    CSV_ARP -->|"Upsert arp_discoveries"| PG
```

### Key Architectural Decisions & Trade-offs
1. **Decoupled Monitoring Daemon**: Pings are **not** triggered when an operator visits the webpage. Pings run continuously on a fixed 30-second server cycle. This prevents network flood attacks if 50 operators open the webpage simultaneously.
2. **Relational PostgreSQL Storage**: Time-series latency logs and inventory records are normalized with foreign keys (`device_id`). This allows sub-second historical analytics across tens of thousands of ping records.
3. **Native OS Pinging via `execFile`**: Web browsers cannot send raw Layer-3 IP or ICMP packets due to sandbox security restrictions. Node.js bridges this gap by spawning Windows `ping.exe`.

---

## 2. End-to-End Execution & Data Flow

Let's follow a single device—**Home Router Airtel (192.168.1.1)**—through the complete system life cycle:

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Network Admin
    participant UI as React UI (Browser)
    participant Context as NetworkContext.jsx
    participant API as Express API (server.js)
    participant DB as PostgreSQL Database
    participant Daemon as Ping Daemon (server.js)
    participant OS as Windows ping.exe
    participant Router as Physical Device (192.168.1.1)

    %% Registration
    Admin->>UI: Fills "Add Device" Form
    UI->>API: POST /devices { name, ip_address: "192.168.1.1", building, room }
    API->>DB: INSERT INTO devices (...) RETURNING *
    DB-->>API: Row ID #18 Created
    API-->>UI: 201 Created JSON

    %% Ping Cycle
    Note over Daemon: 30-second Timer Fires
    Daemon->>DB: SELECT id, name, ip_address FROM devices
    DB-->>Daemon: Returns 25 devices (including #18)
    Daemon->>OS: execFile('ping', ['-n', '1', '-w', '1500', '192.168.1.1'])
    OS->>Router: ICMP Type 8 Echo Request
    Router-->>OS: ICMP Type 0 Echo Reply (2ms, TTL=64)
    OS-->>Daemon: stdout: "Reply from 192.168.1.1: bytes=32 time=2ms TTL=64"
    Daemon->>Daemon: Regex parses: latency = 2, status = "online"
    Daemon->>DB: INSERT INTO status_history (device_id, status, latency_ms) VALUES (18, 'online', 2)

    %% Frontend Polling
    Note over Context: 10-second Polling Timer Fires
    Context->>API: GET /status/latest & GET /status/history
    API->>DB: Query latest status per device & recent history
    DB-->>API: Returns latency = 2ms, status = online
    API-->>Context: JSON response
    Context->>UI: Updates React State
    UI->>Admin: Graph plots 2ms dot; StatusBadge lights up green
```

---

## 3. Database Architecture & Data Models (PostgreSQL)

Located in [`backend/schema.sql`](file:///c:/Projects/Railway%20Node%20monitoring%20System/backend/schema.sql) and [`backend/db.js`](file:///c:/Projects/Railway%20Node%20monitoring%20System/backend/db.js).

### Connection Pooling (`backend/db.js`)
```javascript
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,                   // Maximum concurrent connections
    idleTimeoutMillis: 30000,  // Close idle clients after 30s
    connectionTimeoutMillis: 5000,
});
```
*Why a pool?* Opening and closing a TCP socket and TLS handshake with PostgreSQL on every single query is slow (50–100ms penalty). A `Pool` maintains pre-authenticated, open connections ready to execute queries instantly.

### Table Definitions & Relationships

#### 1. `devices` (Monitored Nodes Inventory)
Stores every managed railway computer, switch, router, and access point.
```sql
CREATE TABLE devices (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    ip_address VARCHAR(45) NOT NULL UNIQUE,
    device_type VARCHAR(50),             -- 'Workstation', 'Switch', 'Router'
    building VARCHAR(100),                -- 'Jammu Tawi (JAT)'
    room VARCHAR(100),                    -- 'DRM Cabin', 'Sr. DEN-Co'
    rack VARCHAR(100),                    -- 'Rack A-01'
    switch_name VARCHAR(100),
    switch_port VARCHAR(50),
    mac_address VARCHAR(17),              -- Normalized format: AA:BB:CC:DD:EE:FF
    location_verification VARCHAR(20) DEFAULT 'unverified',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

#### 2. `status_history` (High-Volume Ping Log)
Every 30 seconds, an entry is inserted for each monitored device.
```sql
CREATE TABLE status_history (
    id BIGSERIAL PRIMARY KEY,
    device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL,          -- 'online', 'offline', 'unknown'
    latency_ms INTEGER,                   -- NULL if offline/timeout
    checked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_status_history_device_checked 
ON status_history(device_id, checked_at DESC);
```
*Why the composite index?* When the frontend loads, it asks for the latest status for each device. The query `DISTINCT ON (device_id) ... ORDER BY device_id, checked_at DESC` scans millions of rows in milliseconds using this index.

#### 3. `inventory_mac_records` (Raw Office Hardware Records)
Parsed from `data/inventory.csv`.
- `id`: Serial Primary Key.
- `mac_address`: Standardized 12-char hex string with colons.
- `normalized_mac`: Stripped uppercase hex (e.g. `D83ADD010203`) for fast indexing.
- `is_multi_mac`: Boolean flag indicating if a PC has both Ethernet and Wi-Fi cards registered.
- `expected_ip`: Statically assigned IP address.

#### 4. `arp_snapshots` & `arp_discoveries` (Sophos Firewall Observations)
Parsed from Sophos XGS2100 exports (`data/arp-ipv4-parsed.csv`).
- `arp_snapshots`: Captures the snapshot metadata (imported timestamp, file name, total count).
- `arp_discoveries`: Each neighbor table row:
  - `ip_address`: Observed IP.
  - `mac_address`: Observed MAC.
  - `interface`: Physical firewall port (`Port1` = DRM LAN, `Port3` = Wireless APs, `Port2` = WAN).
  - `arp_state`: Linux/Sophos neighbor state (`REACHABLE`, `STALE`, `FAILED`).
  - `match_status`: `'matched'` (linked to an office PC) or `'unmatched'` (unmanaged rogue host).

---

## 4. Backend Implementation Deep-Dive (`backend/server.js`)

### 1. The Ping Engine Function
[`backend/server.js:L445-L500`](file:///c:/Projects/Railway%20Node%20monitoring%20System/backend/server.js#L445-L500):
```javascript
function pingDevice(ipAddress) {
    return new Promise((resolve) => {
        // Step 1: Input Validation
        if (typeof ipAddress !== 'string' || !net.isIP(ipAddress.trim())) {
            return resolve({ status: 'unknown', latency_ms: null, reason: 'Invalid IP address' });
        }

        const target = ipAddress.trim();

        // Step 2: Spawn native OS process safely
        execFile(
            'ping',
            ['-n', '1', '-w', '1500', target],
            { timeout: 4000, windowsHide: true },
            (error, stdout, stderr) => {
                const output = `${stdout || ''}\n${stderr || ''}`;

                // Step 3: Handle Process Error & Timeouts
                if (error) {
                    const noReply = /timed out|request timed out|destination host unreachable|could not find host|general failure/i.test(output);
                    return resolve({
                        status: noReply ? 'offline' : 'unknown',
                        latency_ms: null,
                        reason: noReply ? 'No ping reply' : error.message
                    });
                }

                // Step 4: Parse Latency & TTL
                const match = output.match(/time[=<]\s*(\d+)\s*ms/i);
                if (/TTL\s*=/i.test(output)) {
                    return resolve({
                        status: 'online',
                        latency_ms: match ? Number(match[1]) : null,
                        reason: 'Ping reply received',
                    });
                }

                return resolve({ status: 'unknown', latency_ms: null, reason: 'Could not confirm reply' });
            }
        );
    });
}
```

#### Why `execFile` instead of `exec`?
`exec` spawns a full shell command (`cmd.exe /c "ping " + ip`). If an attacker inputs `192.168.1.1 && rm -rf /`, `exec` would execute the malicious command (command injection vulnerability).  
`execFile` invokes `ping.exe` directly, passing arguments as an explicit array of strings (`['-n', '1', '-w', '1500', target]`). Operating system arguments cannot be hijacked.

### 2. Concurrency & Batching in `runMonitoringCycle()`
[`backend/server.js:L502-L564`](file:///c:/Projects/Railway%20Node%20monitoring%20System/backend/server.js#L502-L564):
```javascript
const BATCH_SIZE = 6;
for (let i = 0; i < devices.length; i += BATCH_SIZE) {
    const batch = devices.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (device) => {
        const check = await pingDevice(device.ip_address);
        await pool.query(
            `INSERT INTO status_history (device_id, status, latency_ms) VALUES ($1, $2, $3)`,
            [device.id, check.status, check.latency_ms]
        );
    }));
}
```
*Why batching?*
- If you ping 100 devices one-by-one with a regular `for` loop, and each timeout takes 1.5 seconds: $100 \times 1.5\text{s} = 150\text{ seconds}$! Your 30-second monitoring loop would fall behind immediately.
- If you ping 100 devices simultaneously with a single `Promise.all`: Windows process table can be exhausted, and network switches drop packets due to sudden micro-bursts.
- **Batching 6 at a time** strikes the optimal balance between high concurrency and OS stability.

### 3. Overlap Prevention (Mutex Lock)
```javascript
let monitoringInProgress = false;

async function runMonitoringCycle() {
    if (monitoringInProgress) {
        console.log('Previous cycle still running; skipping this cycle.');
        return;
    }
    monitoringInProgress = true;
    try {
        // ... execute pings ...
    } finally {
        monitoringInProgress = false; // Always release lock, even on error
    }
}
```
If an ICMP sweep takes 35 seconds due to slow network conditions, the 30-second `setInterval` will not start a duplicate competing sweep.

---

## 5. Layer-2 MAC & ARP Ingestion Services

### CSV Data Sanitization (`backend/inventory_service.js`)
When Microsoft Excel exports a CSV file, it often prepends a hidden 3-byte sequence called a **Byte Order Mark (BOM)**: `\uFEFF`. If unhandled, column `MAC` is read by Node.js as `\uFEFFMAC`, causing `row['MAC']` to return `undefined`.

The normalization function resolves this:
```javascript
function normalizeHeader(h) {
    if (!h) return '';
    return h.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
}
```

### MAC Address Normalization
In real life, MAC addresses arrive in completely inconsistent formats:
- Cisco style: `001a.2b3c.4d5e`
- Windows style: `00-1A-2B-3C-4D-5E`
- Raw hex: `001a2b3c4d5e`
- Linux style: `00:1a:2b:3c:4d:5e`

The normalization logic extracts only hexadecimal characters:
```javascript
function normalizeMac(raw) {
    if (!raw) return null;
    const clean = raw.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
    if (clean.length !== 12) return null;
    // Format into standard AA:BB:CC:DD:EE:FF
    return clean.match(/.{1,2}/g).join(':');
}
```

### Hardware Reconciliation Query (`backend/mac_arp_routes.js`)
To correlate the office inventory with live firewall discoveries and ICMP pings, a Common Table Expression (CTE) query is executed:
```sql
WITH latest_arp AS (
    SELECT DISTINCT ON (d.normalized_mac)
        d.normalized_mac,
        d.ip_address AS discovered_ip,
        d.interface AS discovered_interface,
        d.arp_state
    FROM arp_discoveries d
    ORDER BY d.normalized_mac, d.discovered_at DESC
),
latest_device_status AS (
    SELECT DISTINCT ON (device_id)
        device_id,
        status AS ping_status,
        latency_ms AS ping_latency
    FROM status_history
    ORDER BY device_id, checked_at DESC
)
SELECT 
    inv.*,
    la.discovered_ip,
    la.discovered_interface,
    la.arp_state,
    lds.ping_status,
    lds.ping_latency
FROM inventory_mac_records inv
LEFT JOIN latest_arp la ON inv.normalized_mac = la.normalized_mac
LEFT JOIN latest_device_status lds ON inv.device_id = lds.device_id;
```

---

## 6. Frontend Architecture & State Management (React)

Located in [`frontend/src/context/NetworkContext.jsx`](file:///c:/Projects/Railway%20Node%20monitoring%20System/frontend/src/context/NetworkContext.jsx).

### Why Centralized Context?
Without React Context, every page (`Overview`, `DeviceInventory`, `NetworkTopology`) would individually make HTTP requests to `/devices` and `/status/latest`. With 6 open pages or quick tab switches, this would cause dozens of redundant API calls.

`NetworkContext` holds the state once and provides it to all children:
```javascript
export const NetworkProvider = ({ children }) => {
    const [devices, setDevices] = useState([]);
    const [deviceStatuses, setDeviceStatuses] = useState({});
    const [allEvents, setAllEvents] = useState([]);
    const [incidents, setIncidents] = useState([]);

    const refreshData = async () => {
        const [devs, statuses, history] = await Promise.all([
            api.getDevices(),
            api.getLatestStatuses(),
            api.getStatusHistory()
        ]);
        setDevices(devs);
        setDeviceStatuses(statuses);
        setAllEvents(history);
    };

    useEffect(() => {
        refreshData();
        const interval = setInterval(refreshData, 10000); // 10s polling
        return () => clearInterval(interval);
    }, []);

    return (
        <NetworkContext.Provider value={{ devices, deviceStatuses, allEvents, incidents, refreshData }}>
            {children}
        </NetworkContext.Provider>
    );
};
```

---

## 7. Differentiated Dashboard Modules Walkthrough

Each screen is designed to present a **distinct layer of network operations**:

| Page Component | Core Focus | What Makes It Unique |
| :--- | :--- | :--- |
| **[`Overview.jsx`](file:///c:/Projects/Railway%20Node%20monitoring%20System/frontend/src/pages/Overview.jsx)** | Executive NOC Situational Awareness | • **Department Health Matrix**: Progress bars of healthy vs down nodes grouped by room (*DRM Cabin, Sr. DEN-Co*).<br>• **Subnet Distribution**: Telemetry breakdown across `192.168.40.x`, `192.168.41.x`, `192.168.1.x`.<br>• **Response Time Trend**: Recharts time-series area. |
| **[`DeviceInventory.jsx`](file:///c:/Projects/Railway%20Node%20monitoring%20System/frontend/src/pages/DeviceInventory.jsx)** | Fleet Asset & Physical Deployment | • Workstation count, Switch/Router core infrastructure count.<br>• Switch uplink port, rack location, physical verification status.<br>• Quick Filter Pills: `All`, `Online`, `Offline`, `Recently Added (<72h)`. |
| **[`MacInventory.jsx`](file:///c:/Projects/Railway%20Node%20monitoring%20System/frontend/src/pages/MacInventory.jsx)** | Layer-2 Hardware & Correlation | • **OUI Hardware Vendor Intelligence**: Decodes MAC prefix to vendor (HP Inc., Acer, Intel, Cisco, Realtek, Sophos).<br>• **Dual-NIC Tracking**: Highlights multi-homed systems.<br>• **IP Discrepancy Alerts**: Highlights when Sophos-discovered IP diverges from static assignment. |
| **[`ArpDiscovery.jsx`](file:///c:/Projects/Railway%20Node%20monitoring%20System/frontend/src/pages/ArpDiscovery.jsx)** | Firewall Neighbor-Table Telemetry | • **Firewall Port Distribution**: Breakdown across `Port1` (Admin LAN), `Port3` (Wireless APs), and `Port2` (RailTel Gateway).<br>• **Unmanaged Host Isolation**: Distinguishes rogue unknown hosts from registered railway PCs. |
| **[`NetworkTopology.jsx`](file:///c:/Projects/Railway%20Node%20monitoring%20System/frontend/src/pages/NetworkTopology.jsx)** | Logical & Physical Topology Map | • Interactive SVG canvas showing Core Gateway -> Distribution Switches -> Access Workstations.<br>• Filter by Physical Zone/Cabin and Link Health. |
| **[`AvailabilityHistory.jsx`](file:///c:/Projects/Railway%20Node%20monitoring%20System/frontend/src/pages/AvailabilityHistory.jsx)** | Historical SLA & Audit Trail | • 25,000+ ping records with precise millisecond timestamps.<br>• Area Chart prioritizing successful ping responses with `connectNulls={true}` and visible point markers. |

---

## 8. Debugging & Troubleshooting Playbook

### Scenario A: "Everything shows offline / 0ms latency"
1. **Diagnosis**: Check local network IP configuration.
   ```powershell
   ipconfig
   ```
2. **Analysis**: If your machine is on Wi-Fi IP `10.83.158.x` or `192.168.1.x`, packets to `192.168.40.x` cannot route without a physical connection or VPN to the railway office LAN.
3. **Verification**: Run manual ping from terminal:
   ```powershell
   ping -n 1 -w 1500 192.168.40.10
   ```
   If Windows outputs `Destination host unreachable`, the backend is functioning properly—the target is physically unreachable.

### Scenario B: "The graph is completely empty even though one device is online"
1. **Diagnosis**: Recharts SVG `<Area>` behavior.
2. **Root Cause**: If 24 devices are offline (`latency: null`) and 1 is online (`latency: 2`), taking `.slice(0, 40)` of the raw event stream yields 39 nulls and 1 value. An SVG polygon requires at least two connected points, and has `dot={false}` by default.
3. **Fix**:
   - Filter `chartData` to source from active online replies (`status === 'online' && latency_ms !== null`).
   - Enable `connectNulls={true}` and add explicit dot styling:
     ```jsx
     <Area connectNulls={true} dot={{ r: 3.5, fill: '#0284c7' }} />
     ```

### Scenario C: "Database connection failed in backend console"
1. **Diagnosis**: Inspect PostgreSQL service status.
   ```powershell
   Get-Service postgresql*
   ```
2. **Verify Port & Credentials**:
   In `backend/.env`, verify `DATABASE_URL=postgres://postgres:password@localhost:5432/network_monitor`.
   Test direct connection using `psql`:
   ```powershell
   psql -U postgres -d network_monitor -c "SELECT current_database();"
   ```

---

## 9. Step-by-Step Guide: How to Rebuild This From Scratch

If you were to recreate this application from a completely blank directory, follow these 8 progressive steps:

### Step 1: Initialize Database & Schema
```bash
createdb network_monitor
psql -d network_monitor -f backend/schema.sql
```
*Create `devices` and `status_history` tables first.*

### Step 2: Create Minimal Node Backend with Ping Function
Create `server.js`, install `express`, `cors`, `pg`, `dotenv`:
```bash
npm init -y
npm install express cors pg dotenv
```
Write a minimal ping function using `child_process.execFile`:
```javascript
const { execFile } = require('child_process');
execFile('ping', ['-n', '1', '-w', '1500', '127.0.0.1'], (err, stdout) => {
    console.log(stdout);
});
```

### Step 3: Implement Database Connection & Insert Endpoint
Add `pg.Pool`, write `app.post('/devices')` to insert a device, and `app.get('/devices')` to list devices.

### Step 4: Write the Background Ping Scheduler
Add `setInterval(runMonitoringCycle, 30000)`:
1. Select all IPs from `devices`.
2. Ping each using `Promise.all` with a batch size of 6.
3. Insert result into `status_history`.

### Step 5: Implement Ingestion Services for CSV Data
Install `csv-parse` or write custom line-by-line parser for `inventory.csv` and `arp-ipv4-parsed.csv`. Ensure you clean BOM characters (`\uFEFF`) and normalize MAC addresses (`AA:BB:CC:DD:EE:FF`).

### Step 6: Initialize React Frontend with Vite
```bash
npm create vite@latest frontend -- --template react
cd frontend
npm install react-router-dom lucide-react recharts
```

### Step 7: Build `NetworkContext` with 10-Second Polling
Create a shared context that executes `fetch('http://localhost:5001/devices')` and `fetch('http://localhost:5001/status/latest')` on mount and on an interval.

### Step 8: Build the UI Pages & Visual Telemetry
1. Build `DeviceInventory.jsx` (Table with add/edit/delete modal).
2. Build `Overview.jsx` (Department health matrix and latency chart).
3. Build `MacInventory.jsx` and `ArpDiscovery.jsx` for Layer-2 correlation.

---

*This walkthrough document serves as your complete permanent reference manual for the Railway Node Monitoring System.*
