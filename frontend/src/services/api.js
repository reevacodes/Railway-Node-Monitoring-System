/**
 * Central API Service for Railway Network Monitoring Console
 * Handles requests to Express backend (default: http://localhost:5001)
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5001';

class ApiService {
  constructor() {
    this.baseUrl = API_BASE_URL;
    this.abortControllers = new Map();
  }

  getEndpoint(path) {
    return `${this.baseUrl}${path.startsWith('/') ? path : '/' + path}`;
  }

  // Cancel any ongoing request for a specific key
  cancelRequest(key) {
    if (this.abortControllers.has(key)) {
      this.abortControllers.get(key).abort();
      this.abortControllers.delete(key);
    }
  }

  async request(path, options = {}, key = null) {
    if (key) {
      this.cancelRequest(key);
      const controller = new AbortController();
      this.abortControllers.set(key, controller);
      options.signal = controller.signal;
    }

    const url = this.getEndpoint(path);
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };

    try {
      const response = await fetch(url, { ...options, headers });
      if (key) {
        this.abortControllers.delete(key);
      }

      if (!response.ok) {
        let errorData = {};
        try {
          errorData = await response.json();
        } catch {
          errorData = { error: response.statusText || `HTTP ${response.status}` };
        }
        const error = new Error(errorData.error || `Request failed with status ${response.status}`);
        error.status = response.status;
        error.data = errorData;
        throw error;
      }

      return await response.json();
    } catch (err) {
      if (key) {
        this.abortControllers.delete(key);
      }
      if (err.name === 'AbortError') {
        throw new Error('Request cancelled');
      }
      throw err;
    }
  }

  /**
   * 1. Health Check
   * GET /health -> { status: 'ok', database: string }
   */
  async checkHealth() {
    const startTime = performance.now();
    const data = await this.request('/health', { method: 'GET' }, 'health');
    const latency = Math.round(performance.now() - startTime);
    return {
      healthy: data?.status === 'ok',
      database: data?.database || 'unknown',
      latencyMs: latency,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 2. Device Inventory
   * GET /devices -> Array<{ id, name, ip_address, mac_address, device_type, notes, created_at }>
   */
  async getDevices() {
    return this.request('/devices', { method: 'GET' }, 'devices');
  }

  /**
   * 3. Register New Device
   * POST /devices
   * Payload: { name, ip_address, mac_address?, device_type?, notes?, building?, floor?, room?, rack?, rack_position?, port_number?, parent_device_id?, parent_device_name?, location_notes?, location_verification? }
   */
  async createDevice(deviceData) {
    return this.request('/devices', {
      method: 'POST',
      body: JSON.stringify(deviceData),
    });
  }

  /**
   * 3b. Update Device Details & Physical Location
   * PUT /devices/:id
   */
  async updateDevice(id, deviceData) {
    return this.request(`/devices/${id}`, {
      method: 'PUT',
      body: JSON.stringify(deviceData),
    });
  }

  /**
   * 3c. Verify Physical Location
   * POST /devices/:id/verify-location
   */
  async verifyDeviceLocation(id, status = 'verified') {
    return this.request(`/devices/${id}/verify-location`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
  }

  /**
   * 4. Delete Device
   * DELETE /devices/:id
   */
  async deleteDevice(id) {
    return this.request(`/devices/${id}`, {
      method: 'DELETE',
    });
  }


  /**
   * 5. Manual Ping Check / Probe Record
   * POST /devices/:id/check
   * Payload: { status: 'online' | 'offline' | 'unknown', latency_ms?: number | null }
   */
  async recordStatusCheck(id, { status, latency_ms = null }) {
    return this.request(`/devices/${id}/check`, {
      method: 'POST',
      body: JSON.stringify({ status, latency_ms }),
    });
  }

  /**
   * 6. Status History for a Device
   * GET /devices/:id/history -> Array<{ id, device_id, status, checked_at, latency_ms }>
   */
  async getDeviceHistory(id) {
    return this.request(`/devices/${id}/history`, { method: 'GET' }, `history-${id}`);
  }

  /**
   * 6b. Recent Events Stream across all devices (Optimized)
   * GET /events/recent?limit=150
   */
  async getRecentEvents(limit = 150) {
    return this.request(`/events/recent?limit=${limit}`, { method: 'GET' }, 'recent-events');
  }

  buildQuery(params = {}) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, val]) => {
      if (
        val !== undefined &&
        val !== null &&
        val !== '' &&
        val !== 'undefined' &&
        val !== 'null' &&
        val !== 'ALL'
      ) {
        searchParams.append(key, String(val).trim());
      }
    });
    const str = searchParams.toString();
    return str ? `?${str}` : '';
  }

  /**
   * 7. MAC Inventory Endpoints
   */
  async getMacInventory(params = {}) {
    const endpoint = `/api/mac-inventory${this.buildQuery(params)}`;
    return this.request(endpoint, { method: 'GET' }, 'mac-inventory');
  }

  async getMacInventoryItem(id) {
    return this.request(`/api/mac-inventory/${id}`, { method: 'GET' }, `mac-inv-${id}`);
  }

  async importMacInventory(data = {}) {
    return this.request('/api/mac-inventory/import', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * 8. Sophos ARP Discovery Endpoints
   */
  async getArpSnapshots() {
    return this.request('/api/arp/snapshots', { method: 'GET' }, 'arp-snapshots');
  }

  async getArpSnapshot(id) {
    return this.request(`/api/arp/snapshots/${id}`, { method: 'GET' }, `arp-snap-${id}`);
  }

  async importArpSnapshot(data = {}) {
    return this.request('/api/arp/snapshots/import', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getArpDiscoveries(params = {}) {
    const endpoint = `/api/arp/discoveries${this.buildQuery(params)}`;
    return this.request(endpoint, { method: 'GET' }, 'arp-discoveries');
  }

  async getArpSummary() {
    return this.request('/api/arp/summary', { method: 'GET' }, 'arp-summary');
  }

  async compareArpSnapshots(baseId, targetId) {
    const endpoint = `/api/arp/snapshots/compare?base_id=${baseId}&target_id=${targetId}`;
    return this.request(endpoint, { method: 'GET' }, `arp-compare-${baseId}-${targetId}`);
  }

  async getArpPollerStatus() {
    return this.request('/api/arp/poller/status', { method: 'GET' }, 'arp-poller-status');
  }

  async pollArpNow() {
    return this.request('/api/arp/poller/poll-now', { method: 'POST' });
  }

  /**
   * 9. Discovered Devices Monitoring & Direct Editing
   */
  async getDiscoveredDevices(params = {}) {
    const endpoint = `/api/discovered-devices${this.buildQuery(params)}`;
    return this.request(endpoint, { method: 'GET' }, 'discovered-devices');
  }

  async getDiscoveredDevice(id) {
    return this.request(`/api/discovered-devices/${id}`, { method: 'GET' }, `discovered-dev-${id}`);
  }

  async updateDiscoveredDevice(id, data) {
    return this.request(`/api/discovered-devices/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async registerDiscoveredDevice(id) {
    return this.request(`/api/discovered-devices/${id}/register`, {
      method: 'POST',
    });
  }

  async pingDiscoveredDevice(id) {
    return this.request(`/api/discovered-devices/${id}/ping`, {
      method: 'POST',
    });
  }

  async pingAllDiscoveredDevices() {
    return this.request('/api/discovered-devices/ping-all', {
      method: 'POST',
    });
  }

  /**
   * 10. Unified Overview Dashboard Endpoints
   */
  async getUnifiedOverviewSummary(params = {}) {
    const endpoint = `/api/overview/unified-summary${this.buildQuery(params)}`;
    return this.request(endpoint, { method: 'GET' }, 'unified-summary');
  }

  async getUnifiedOverviewDevices(params = {}) {
    const endpoint = `/api/overview/unified-devices${this.buildQuery(params)}`;
    return this.request(endpoint, { method: 'GET' }, 'unified-devices');
  }

  /**
   * 11. Subnet & Office Management Endpoints
   */
  async getOffices() {
    return this.request('/api/offices', { method: 'GET' });
  }

  async createOffice(data) {
    return this.request('/api/offices', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getSubnets(params = {}) {
    const endpoint = `/api/subnets${this.buildQuery(params)}`;
    return this.request(endpoint, { method: 'GET' });
  }

  async getSubnetById(id) {
    return this.request(`/api/subnets/${id}`, { method: 'GET' });
  }

  async createSubnet(data) {
    return this.request('/api/subnets', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateSubnet(id, data) {
    return this.request(`/api/subnets/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async toggleSubnetActive(id) {
    return this.request(`/api/subnets/${id}/toggle`, {
      method: 'PATCH',
    });
  }

  async deleteSubnet(id, force = false) {
    return this.request(`/api/subnets/${id}?force=${force}`, {
      method: 'DELETE',
    });
  }

  async classifyIp(ip) {
    return this.request(`/api/subnets/classify-ip?ip=${encodeURIComponent(ip)}`, {
      method: 'GET',
    });
  }

  async getTopologyHierarchy() {
    return this.request('/api/subnets/topology-hierarchy', { method: 'GET' });
  }

  async previewSubnet(params) {
    const endpoint = `/api/subnets/preview${this.buildQuery(params)}`;
    return this.request(endpoint, { method: 'GET' });
  }
}

export const api = new ApiService();
export default api;

