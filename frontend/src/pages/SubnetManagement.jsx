import React, { useState, useEffect, useMemo } from 'react';
import api from '../services/api';
import { useNetwork } from '../context/NetworkContext';
import Modal from '../components/common/Modal';
import Drawer from '../components/common/Drawer';
import EmptyState from '../components/common/EmptyState';
import StatusBadge from '../components/common/StatusBadge';
import DeviceTypeBadge from '../components/common/DeviceTypeBadge';
import { formatIndianDateTime } from '../utils/formatters';
import {
  Network,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Server,
  Layers,
  Edit2,
  Trash2,
  Power,
  RotateCcw,
  Building,
  Radio,
  ExternalLink,
  ChevronRight,
  Info,
  ShieldAlert,
  Cpu,
} from 'lucide-react';

const COMMON_CIDR_PRESETS = [
  { prefix: 24, mask: '255.255.255.0', label: '/24 — Standard LAN (254 Usable Hosts)' },
  { prefix: 23, mask: '255.255.254.0', label: '/23 — Combined Supernet (510 Usable Hosts)' },
  { prefix: 25, mask: '255.255.255.128', label: '/25 — Split Subnet (126 Usable Hosts)' },
  { prefix: 22, mask: '255.255.252.0', label: '/22 — Large Complex (1,022 Usable Hosts)' },
  { prefix: 26, mask: '255.255.255.192', label: '/26 — Small Segment (62 Usable Hosts)' },
];

export const SubnetManagement = () => {
  const { showNotification } = useNetwork();

  const [subnets, setSubnets] = useState([]);
  const [offices, setOffices] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);

  // Filters
  const [selectedOfficeFilter, setSelectedOfficeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL'); // 'ALL' | 'ACTIVE' | 'INACTIVE'
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSubnet, setEditingSubnet] = useState(null);
  const [modalError, setModalError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Quick Office Addition inside Modal
  const [isCreatingOffice, setIsCreatingOffice] = useState(false);
  const [newOfficeName, setNewOfficeName] = useState('');
  const [newOfficeCode, setNewOfficeCode] = useState('');
  const [newOfficeDesc, setNewOfficeDesc] = useState('');
  const [isOfficeSubmitting, setIsOfficeSubmitting] = useState(false);

  // Subnet Form Data
  const [formData, setFormData] = useState({
    office_id: '',
    subnet_name: '',
    network_address: '',
    cidr_prefix: 24,
    subnet_mask: '255.255.255.0',
    gateway_ip: '',
    description: '',
    is_active: true,
  });

  // Live Subnet Preview
  const [previewDetails, setPreviewDetails] = useState(null);

  // Drilldown Drawer for assigned devices
  const [selectedSubnetForDevices, setSelectedSubnetForDevices] = useState(null);
  const [subnetDevicesLoading, setSubnetDevicesLoading] = useState(false);
  const [subnetDetailedRecord, setSubnetDetailedRecord] = useState(null);

  // Delete safety modal
  const [subnetToDelete, setSubnetToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // 1. Fetch initial data
  const fetchData = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const [subsRes, offsRes] = await Promise.all([
        api.getSubnets(),
        api.getOffices(),
      ]);
      setSubnets(subsRes || []);
      setOffices(offsRes || []);
    } catch (err) {
      console.error('Fetch subnet data error:', err);
      setErrorMsg(err.message || 'Could not load subnets');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // 2. Compute dynamic summary metrics
  const summaryMetrics = useMemo(() => {
    const total = subnets.length;
    const active = subnets.filter((s) => s.is_active).length;
    const inactive = total - active;
    const totalCapacity = subnets
      .filter((s) => s.is_active)
      .reduce((sum, s) => sum + (s.total_usable_hosts || 0), 0);
    const totalAssignedDevices = subnets
      .filter((s) => s.is_active)
      .reduce((sum, s) => sum + (s.assigned_devices_count || 0), 0);
    const activeOffices = new Set(subnets.filter((s) => s.is_active).map((s) => s.office_id)).size;

    return {
      total,
      active,
      inactive,
      totalCapacity,
      totalAssignedDevices,
      activeOffices,
    };
  }, [subnets]);

  // 3. Filtered subnets
  const filteredSubnets = useMemo(() => {
    return subnets.filter((sub) => {
      // Office filter
      if (selectedOfficeFilter !== 'ALL') {
        if (String(sub.office_id) !== String(selectedOfficeFilter) && sub.office_code !== selectedOfficeFilter) {
          return false;
        }
      }

      // Status filter
      if (statusFilter === 'ACTIVE' && !sub.is_active) return false;
      if (statusFilter === 'INACTIVE' && sub.is_active) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = (sub.subnet_name || '').toLowerCase().includes(q);
        const matchNet = (sub.network_address || '').toLowerCase().includes(q);
        const matchOffice = (sub.office_name || '').toLowerCase().includes(q);
        const matchGateway = (sub.gateway_ip || '').toLowerCase().includes(q);
        const matchRange = (sub.usable_ip_range || '').toLowerCase().includes(q);
        const matchDesc = (sub.description || '').toLowerCase().includes(q);
        if (!matchName && !matchNet && !matchOffice && !matchGateway && !matchRange && !matchDesc) {
          return false;
        }
      }

      return true;
    });
  }, [subnets, selectedOfficeFilter, statusFilter, searchQuery]);

  // 4. Update preview calculation when network_address or cidr_prefix changes
  useEffect(() => {
    if (!formData.network_address) {
      setPreviewDetails(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await api.previewSubnet({
          network: formData.network_address,
          cidr: formData.cidr_prefix,
        });
        setPreviewDetails(res);
        setModalError('');
      } catch (err) {
        setPreviewDetails(null);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [formData.network_address, formData.cidr_prefix]);

  // Open Create Subnet Modal
  const handleOpenCreateModal = () => {
    setEditingSubnet(null);
    setFormData({
      office_id: offices.length > 0 ? offices[0].id : '',
      subnet_name: '',
      network_address: '',
      cidr_prefix: 24,
      subnet_mask: '255.255.255.0',
      gateway_ip: '',
      description: '',
      is_active: true,
    });
    setPreviewDetails(null);
    setModalError('');
    setIsCreatingOffice(false);
    setIsModalOpen(true);
  };

  // Open Edit Subnet Modal
  const handleOpenEditModal = (sub) => {
    setEditingSubnet(sub);
    setFormData({
      office_id: sub.office_id,
      subnet_name: sub.subnet_name,
      network_address: sub.network_address,
      cidr_prefix: sub.cidr_prefix,
      subnet_mask: sub.subnet_mask,
      gateway_ip: sub.gateway_ip || '',
      description: sub.description || '',
      is_active: sub.is_active,
    });
    setPreviewDetails(null);
    setModalError('');
    setIsCreatingOffice(false);
    setIsModalOpen(true);
  };

  // Toggle Active/Inactive Status
  const handleToggleActive = async (sub) => {
    try {
      const updated = await api.toggleSubnetActive(sub.id);
      showNotification(
        `Subnet "${sub.subnet_name}" is now ${updated.is_active ? 'ACTIVE' : 'INACTIVE'}.`,
        'success'
      );
      setSubnets((curr) => curr.map((s) => (s.id === sub.id ? updated : s)));
    } catch (err) {
      showNotification(err.message || 'Could not toggle subnet status', 'error');
    }
  };

  // Handle Form Change
  const handleFormChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => {
      const updated = { ...prev, [name]: type === 'checkbox' ? checked : value };

      // If user selected CIDR preset dropdown
      if (name === 'cidr_prefix') {
        const prefixNum = Number(value);
        const matchedPreset = COMMON_CIDR_PRESETS.find((p) => p.prefix === prefixNum);
        if (matchedPreset) {
          updated.subnet_mask = matchedPreset.mask;
        }
      }

      return updated;
    });
    setModalError('');
  };

  // Quick Create Office inside Modal
  const handleCreateOfficeInline = async (e) => {
    e.preventDefault();
    if (!newOfficeName.trim()) return;
    setIsOfficeSubmitting(true);
    try {
      const created = await api.createOffice({
        name: newOfficeName.trim(),
        code: newOfficeCode.trim() || undefined,
        description: newOfficeDesc.trim() || undefined,
      });
      showNotification(`Office "${created.name}" created successfully.`, 'success');
      setOffices((prev) => [...prev, created]);
      setFormData((prev) => ({ ...prev, office_id: created.id }));
      setIsCreatingOffice(false);
      setNewOfficeName('');
      setNewOfficeCode('');
      setNewOfficeDesc('');
    } catch (err) {
      setModalError(err.message || 'Could not create office');
    } finally {
      setIsOfficeSubmitting(false);
    }
  };

  // Submit Subnet Form (Create or Edit)
  const handleSubmitSubnet = async (e) => {
    e.preventDefault();
    if (!formData.subnet_name.trim()) {
      setModalError('Subnet name is required');
      return;
    }
    if (!formData.network_address.trim()) {
      setModalError('Network address is required');
      return;
    }

    setIsSubmitting(true);
    setModalError('');

    try {
      const payload = {
        office_id: Number(formData.office_id),
        subnet_name: formData.subnet_name.trim(),
        network_address: formData.network_address.trim(),
        cidr_prefix: Number(formData.cidr_prefix),
        subnet_mask: formData.subnet_mask.trim(),
        gateway_ip: formData.gateway_ip.trim() || null,
        description: formData.description.trim() || null,
        is_active: Boolean(formData.is_active),
      };

      if (editingSubnet) {
        const updated = await api.updateSubnet(editingSubnet.id, payload);
        showNotification(`Subnet "${updated.subnet_name}" updated successfully.`, 'success');
        setSubnets((curr) => curr.map((s) => (s.id === updated.id ? updated : s)));
      } else {
        const created = await api.createSubnet(payload);
        showNotification(`Subnet "${created.subnet_name}" registered successfully.`, 'success');
        setSubnets((curr) => [created, ...curr]);
      }
      setIsModalOpen(false);
    } catch (err) {
      setModalError(err.message || 'Failed to save subnet');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Open Devices Drilldown Drawer
  const handleOpenDevicesDrawer = async (sub) => {
    setSelectedSubnetForDevices(sub);
    setSubnetDevicesLoading(true);
    try {
      const detailed = await api.getSubnetById(sub.id);
      setSubnetDetailedRecord(detailed);
    } catch (err) {
      console.error('Fetch subnet devices failed:', err);
      showNotification('Could not load subnet devices', 'error');
    } finally {
      setSubnetDevicesLoading(false);
    }
  };

  // Delete Subnet
  const handleDeleteSubnet = async (force = false) => {
    if (!subnetToDelete) return;
    setIsDeleting(true);
    try {
      await api.deleteSubnet(subnetToDelete.id, force);
      showNotification(`Subnet "${subnetToDelete.subnet_name}" deleted successfully.`, 'success');
      setSubnets((curr) => curr.filter((s) => s.id !== subnetToDelete.id));
      setSubnetToDelete(null);
    } catch (err) {
      showNotification(err.message || 'Could not delete subnet', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div style={{ paddingBottom: '32px' }}>
      {/* 1. Page Title Strip */}
      <div className="page-title-strip">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h1>Subnet Management</h1>
            <span
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '12px',
                backgroundColor: '#e0f2fe',
                color: '#0369a1',
                fontWeight: 600,
              }}
            >
              IPv4 Architecture
            </span>
          </div>
          <div className="page-subtitle">
            Configure dynamic office IP series, CIDR boundaries, automated node classification, and gateway routing
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button className="btn btn-secondary" onClick={fetchData} title="Refresh Subnet List">
            <RotateCcw size={13} className={isLoading ? 'spin' : ''} />
            <span>Refresh</span>
          </button>
          <button className="btn btn-primary" onClick={handleOpenCreateModal}>
            <Plus size={14} />
            <span>Add Subnet</span>
          </button>
        </div>
      </div>

      {/* 2. Metric Summary Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: '12px',
          marginBottom: '18px',
        }}
      >
        <div className="panel" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>
            Configured Subnets
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a' }}>
              {summaryMetrics.total}
            </span>
            <span style={{ fontSize: '12px', color: '#059669', fontWeight: 500 }}>
              {summaryMetrics.active} Active
            </span>
            {summaryMetrics.inactive > 0 && (
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                ({summaryMetrics.inactive} Inactive)
              </span>
            )}
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
            Across all railway administrative divisions
          </div>
        </div>

        <div className="panel" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>
            Covered Offices
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontSize: '24px', fontWeight: 700, color: '#0284c7' }}>
              {offices.length}
            </span>
            <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>
              Offices ({summaryMetrics.activeOffices} Online)
            </span>
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
            DRM, Control, NIA & Custom Divisions
          </div>
        </div>

        <div className="panel" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>
            Addressable IP Capacity
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a' }}>
              {summaryMetrics.totalCapacity.toLocaleString()}
            </span>
            <span style={{ fontSize: '12px', color: '#0284c7', fontWeight: 500 }}>
              Usable Hosts
            </span>
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
            Active /24 and /23 host allocations
          </div>
        </div>

        <div className="panel" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>
            Operating Devices
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontSize: '24px', fontWeight: 700, color: '#059669' }}>
              {summaryMetrics.totalAssignedDevices}
            </span>
            <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>
              Classified Nodes
            </span>
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
            Matched dynamically by IP address
          </div>
        </div>
      </div>

      {/* 3. Filter Bar & Office Selector Strip */}
      <div
        className="panel"
        style={{
          padding: '12px 16px',
          marginBottom: '16px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '12px',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {/* Office Selection Tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#475569', marginRight: '4px' }}>
            Office:
          </span>
          <button
            className={`btn btn-sm ${selectedOfficeFilter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '11.5px', padding: '3px 10px' }}
            onClick={() => setSelectedOfficeFilter('ALL')}
          >
            All Offices ({subnets.length})
          </button>
          {offices.map((off) => {
            const count = subnets.filter((s) => s.office_id === off.id).length;
            const isSelected = String(selectedOfficeFilter) === String(off.id) || selectedOfficeFilter === off.code;
            return (
              <button
                key={off.id}
                className={`btn btn-sm ${isSelected ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: '11.5px', padding: '3px 10px' }}
                onClick={() => setSelectedOfficeFilter(String(off.id))}
              >
                {off.name} ({count})
              </button>
            );
          })}
        </div>

        {/* Search & Status Quick Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', width: '220px' }}>
            <Search
              size={13}
              style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}
            />
            <input
              type="text"
              className="form-input"
              style={{ paddingLeft: '28px', height: '30px', fontSize: '11.5px' }}
              placeholder="Search subnet, CIDR, gateway..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: 0,
                }}
                onClick={() => setSearchQuery('')}
              >
                ×
              </button>
            )}
          </div>

          <select
            className="filter-select"
            style={{ height: '30px', fontSize: '11.5px' }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active Subnets Only</option>
            <option value="INACTIVE">Inactive / Templates Only</option>
          </select>
        </div>
      </div>

      {/* 4. Subnet Data Table */}
      {errorMsg ? (
        <div
          style={{
            padding: '16px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            borderRadius: '4px',
            fontSize: '12px',
          }}
        >
          {errorMsg}
        </div>
      ) : filteredSubnets.length === 0 ? (
        <div className="panel">
          <div className="panel-body">
            <EmptyState
              title="No Matching Subnets Found"
              description={
                searchQuery || selectedOfficeFilter !== 'ALL' || statusFilter !== 'ALL'
                  ? 'No configured subnets match your selected filters. Try clearing filters or click Add Subnet.'
                  : 'No office subnets have been configured yet. Click "+ Add Subnet" to create your first IP series.'
              }
            />
          </div>
        </div>
      ) : (
        <div className="panel" style={{ overflow: 'hidden' }}>
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '130px' }}>Office Division</th>
                  <th>Subnet Name & Description</th>
                  <th style={{ width: '145px' }}>Network / CIDR</th>
                  <th style={{ width: '135px' }}>Subnet Mask</th>
                  <th style={{ width: '190px' }}>Usable Host Range</th>
                  <th style={{ width: '90px' }}>Capacity</th>
                  <th style={{ width: '120px' }}>Gateway IP</th>
                  <th style={{ width: '160px' }}>Assigned Nodes</th>
                  <th style={{ width: '95px' }}>Status</th>
                  <th style={{ width: '150px' }}>Last Updated</th>
                  <th style={{ width: '110px', textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSubnets.map((sub) => {
                  const isActive = sub.is_active;
                  const devCount = sub.assigned_devices_count || 0;
                  const onlineCount = sub.online_count || 0;
                  const offlineCount = sub.offline_count || 0;

                  return (
                    <tr
                      key={sub.id}
                      style={{
                        backgroundColor: isActive ? 'inherit' : '#fafafa',
                        opacity: isActive ? 1 : 0.78,
                      }}
                    >
                      {/* Office Badge */}
                      <td>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontSize: '10.5px',
                            fontWeight: 700,
                            letterSpacing: '0.04em',
                            backgroundColor:
                              sub.office_code === 'DRM'
                                ? '#e0f2fe'
                                : sub.office_code === 'CONTROL'
                                ? '#fef3c7'
                                : sub.office_code === 'NIA'
                                ? '#f3e8ff'
                                : '#f1f5f9',
                            color:
                              sub.office_code === 'DRM'
                                ? '#0369a1'
                                : sub.office_code === 'CONTROL'
                                ? '#92400e'
                                : sub.office_code === 'NIA'
                                ? '#6b21a8'
                                : '#475569',
                          }}
                        >
                          {sub.office_name}
                        </span>
                      </td>

                      {/* Subnet Name */}
                      <td>
                        <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '12.5px' }}>
                          {sub.subnet_name}
                        </div>
                        {sub.description && (
                          <div
                            style={{
                              fontSize: '10.5px',
                              color: '#64748b',
                              marginTop: '2px',
                              maxWidth: '280px',
                              lineHeight: 1.3,
                            }}
                          >
                            {sub.description}
                          </div>
                        )}
                      </td>

                      {/* Network & CIDR */}
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span className="mono" style={{ fontWeight: 700, color: '#0284c7', fontSize: '12px' }}>
                            {sub.network_address}
                          </span>
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 700,
                              padding: '1px 5px',
                              borderRadius: '3px',
                              backgroundColor: '#e2e8f0',
                              color: '#334155',
                            }}
                          >
                            /{sub.cidr_prefix}
                          </span>
                        </div>
                      </td>

                      {/* Subnet Mask */}
                      <td className="mono" style={{ fontSize: '11.5px', color: '#475569' }}>
                        {sub.subnet_mask}
                      </td>

                      {/* Usable Host Range */}
                      <td className="mono" style={{ fontSize: '11px', color: '#0f172a' }}>
                        {sub.usable_ip_range}
                      </td>

                      {/* Usable Hosts Capacity */}
                      <td>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: '#334155' }}>
                          {sub.total_usable_hosts?.toLocaleString()}
                        </span>
                        <span style={{ fontSize: '10px', color: '#94a3b8', marginLeft: '3px' }}>hosts</span>
                      </td>

                      {/* Gateway IP */}
                      <td className="mono" style={{ fontSize: '11.5px' }}>
                        {sub.gateway_ip ? (
                          <span style={{ color: '#059669', fontWeight: 500 }}>{sub.gateway_ip}</span>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>—</span>
                        )}
                      </td>

                      {/* Assigned Devices Drilldown */}
                      <td>
                        <button
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                          onClick={() => handleOpenDevicesDrawer(sub)}
                          title="Click to view assigned devices"
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span
                              style={{
                                fontSize: '12px',
                                fontWeight: 700,
                                color: devCount > 0 ? '#0284c7' : '#94a3b8',
                                textDecoration: devCount > 0 ? 'underline' : 'none',
                              }}
                            >
                              {devCount} Nodes
                            </span>
                            {devCount > 0 && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px' }}>
                                <span style={{ color: '#10b981', fontWeight: 600 }}>{onlineCount} ON</span>
                                <span style={{ color: '#ef4444', fontWeight: 600 }}>{offlineCount} OFF</span>
                              </div>
                            )}
                          </div>
                          {devCount > 0 && (
                            <div
                              style={{
                                width: '110px',
                                height: '4px',
                                backgroundColor: '#e2e8f0',
                                borderRadius: '2px',
                                marginTop: '4px',
                                overflow: 'hidden',
                              }}
                            >
                              <div
                                style={{
                                  width: `${sub.utilization_percentage || 5}%`,
                                  height: '100%',
                                  backgroundColor: '#0284c7',
                                }}
                              />
                            </div>
                          )}
                        </button>
                      </td>

                      {/* Status */}
                      <td>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '2px 8px',
                            borderRadius: '12px',
                            fontSize: '10.5px',
                            fontWeight: 600,
                            backgroundColor: isActive ? '#ecfdf5' : '#f1f5f9',
                            color: isActive ? '#059669' : '#64748b',
                            border: `1px solid ${isActive ? '#a7f3d0' : '#e2e8f0'}`,
                          }}
                        >
                          <span
                            style={{
                              width: '5px',
                              height: '5px',
                              borderRadius: '50%',
                              backgroundColor: isActive ? '#10b981' : '#94a3b8',
                            }}
                          />
                          {isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>

                      {/* Last Updated */}
                      <td style={{ fontSize: '10.5px', color: '#64748b' }}>
                        {formatIndianDateTime(sub.updated_at || sub.created_at)}
                      </td>

                      {/* Action Buttons */}
                      <td style={{ textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          {/* Toggle Active */}
                          <button
                            className="btn btn-sm btn-secondary"
                            style={{
                              padding: '3px 6px',
                              color: isActive ? '#d97706' : '#059669',
                            }}
                            title={isActive ? 'Deactivate Subnet' : 'Activate Subnet'}
                            onClick={() => handleToggleActive(sub)}
                          >
                            <Power size={12} />
                          </button>

                          {/* Edit */}
                          <button
                            className="btn btn-sm btn-secondary"
                            style={{ padding: '3px 6px' }}
                            title="Edit Subnet"
                            onClick={() => handleOpenEditModal(sub)}
                          >
                            <Edit2 size={12} />
                          </button>

                          {/* Delete */}
                          <button
                            className="btn btn-sm btn-secondary"
                            style={{ padding: '3px 6px', color: '#dc2626' }}
                            title="Delete Subnet"
                            onClick={() => setSubnetToDelete(sub)}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5. Add / Edit Subnet Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingSubnet ? `Edit Subnet — ${editingSubnet.subnet_name}` : 'Configure New Railway Subnet'}
        maxWidth={640}
      >
        <form onSubmit={handleSubmitSubnet}>
          {modalError && (
            <div
              style={{
                padding: '9px 12px',
                backgroundColor: '#fef2f2',
                color: '#991b1b',
                border: '1px solid #fecaca',
                borderRadius: '4px',
                fontSize: '11.5px',
                marginBottom: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <AlertTriangle size={14} style={{ flexShrink: 0 }} />
              <span>{modalError}</span>
            </div>
          )}

          {/* Office Selection */}
          <div style={{ marginBottom: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
              <label className="form-label" style={{ marginBottom: 0 }}>
                Railway Office / Division <span className="required">*</span>
              </label>
              <button
                type="button"
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#0284c7',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: 0,
                }}
                onClick={() => setIsCreatingOffice(!isCreatingOffice)}
              >
                {isCreatingOffice ? 'Cancel Office Addition' : '+ New Office'}
              </button>
            </div>

            {isCreatingOffice ? (
              <div
                style={{
                  padding: '10px 12px',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderRadius: '4px',
                  marginBottom: '10px',
                }}
              >
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  Register New Office Division
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '8px', marginBottom: '8px' }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Loco Shed Control"
                    value={newOfficeName}
                    onChange={(e) => setNewOfficeName(e.target.value)}
                  />
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Code (e.g. LOCO)"
                    value={newOfficeCode}
                    onChange={(e) => setNewOfficeCode(e.target.value.toUpperCase())}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={isOfficeSubmitting || !newOfficeName.trim()}
                  onClick={handleCreateOfficeInline}
                >
                  {isOfficeSubmitting ? 'Adding...' : 'Save Office'}
                </button>
              </div>
            ) : (
              <select
                name="office_id"
                className="form-input"
                value={formData.office_id}
                onChange={handleFormChange}
                required
              >
                {offices.map((off) => (
                  <option key={off.id} value={off.id}>
                    {off.name} ({off.code})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Subnet Name */}
          <div className="form-group" style={{ marginBottom: '14px' }}>
            <label className="form-label">
              Subnet Name <span className="required">*</span>
            </label>
            <input
              type="text"
              name="subnet_name"
              className="form-input"
              placeholder="e.g. DRM Primary LAN (40.x)"
              value={formData.subnet_name}
              onChange={handleFormChange}
              required
            />
          </div>

          {/* Network Address & CIDR Prefix */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '12px', marginBottom: '14px' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">
                Network Address <span className="required">*</span>
              </label>
              <input
                type="text"
                name="network_address"
                className="form-input mono"
                placeholder="192.168.40.0"
                value={formData.network_address}
                onChange={handleFormChange}
                required
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">
                CIDR Prefix / Mask <span className="required">*</span>
              </label>
              <select
                name="cidr_prefix"
                className="form-input mono"
                value={formData.cidr_prefix}
                onChange={handleFormChange}
              >
                {COMMON_CIDR_PRESETS.map((p) => (
                  <option key={p.prefix} value={p.prefix}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Live Preview Box */}
          {previewDetails && (
            <div
              style={{
                padding: '10px 14px',
                backgroundColor: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: '4px',
                marginBottom: '14px',
              }}
            >
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#166534', marginBottom: '4px' }}>
                ✓ Subnet Calculation Preview
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '6px',
                  fontSize: '11px',
                  color: '#14532d',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                <div>Mask: <strong>{previewDetails.subnetMask}</strong></div>
                <div>Broadcast: <strong>{previewDetails.broadcastAddress}</strong></div>
                <div>Usable Range: <strong>{previewDetails.usableIpRange}</strong></div>
                <div>Capacity: <strong>{previewDetails.totalUsableHosts} usable hosts</strong></div>
              </div>
            </div>
          )}

          {/* Gateway IP (Optional) */}
          <div className="form-group" style={{ marginBottom: '14px' }}>
            <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Default Gateway IP (Optional)</span>
              <span style={{ fontSize: '10.5px', color: '#64748b' }}>Must be within subnet range</span>
            </label>
            <input
              type="text"
              name="gateway_ip"
              className="form-input mono"
              placeholder="e.g. 192.168.40.1"
              value={formData.gateway_ip}
              onChange={handleFormChange}
            />
          </div>

          {/* Description */}
          <div className="form-group" style={{ marginBottom: '14px' }}>
            <label className="form-label">Description / Operational Notes</label>
            <textarea
              name="description"
              className="form-input"
              rows="2"
              placeholder="e.g. Section Controller desks, S&T relays and switches"
              value={formData.description}
              onChange={handleFormChange}
            />
          </div>

          {/* Active Status Toggle */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 12px',
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '4px',
              marginBottom: '18px',
            }}
          >
            <input
              type="checkbox"
              id="is_active_toggle"
              name="is_active"
              checked={formData.is_active}
              onChange={handleFormChange}
              style={{ width: '16px', height: '16px', cursor: 'pointer' }}
            />
            <label htmlFor="is_active_toggle" style={{ fontSize: '12px', fontWeight: 600, color: '#1e293b', cursor: 'pointer' }}>
              Subnet Active for Automatic Detection
            </label>
            <span style={{ fontSize: '11px', color: '#64748b', marginLeft: 'auto' }}>
              {formData.is_active ? 'Devices matching this series will be classified' : 'Saved as dormant template'}
            </span>
          </div>

          {/* Footer Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setIsModalOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : editingSubnet ? 'Update Subnet' : 'Create Subnet'}
            </button>
          </div>
        </form>
      </Modal>

      {/* 6. Subnet Devices Drilldown Drawer */}
      <Drawer
        isOpen={Boolean(selectedSubnetForDevices)}
        onClose={() => {
          setSelectedSubnetForDevices(null);
          setSubnetDetailedRecord(null);
        }}
        title={`Devices in ${selectedSubnetForDevices?.subnet_name || 'Subnet'}`}
        subtitle={`${selectedSubnetForDevices?.network_address}/${selectedSubnetForDevices?.cidr_prefix} (${selectedSubnetForDevices?.usable_ip_range})`}
      >
        {subnetDevicesLoading ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
            <RotateCcw size={16} className="spin" style={{ display: 'inline-block', marginBottom: '8px' }} />
            <div>Loading assigned network nodes...</div>
          </div>
        ) : !subnetDetailedRecord || !subnetDetailedRecord.assigned_devices || subnetDetailedRecord.assigned_devices.length === 0 ? (
          <div style={{ padding: '24px' }}>
            <EmptyState
              title="No Operating Devices"
              description="No registered or discovered nodes have IP addresses within this subnet's address range."
            />
          </div>
        ) : (
          <div>
            <div
              style={{
                padding: '10px 14px',
                backgroundColor: '#f1f5f9',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '11.5px',
                fontWeight: 600,
                color: '#475569',
              }}
            >
              <span>{subnetDetailedRecord.assigned_devices.length} Total Classified Devices</span>
              <span>{subnetDetailedRecord.total_usable_hosts} Max Hosts</span>
            </div>

            <div style={{ maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' }}>
              {subnetDetailedRecord.assigned_devices.map((dev) => {
                const isOnline = (dev.ping_status || '').toLowerCase() === 'online';
                const isOffline = (dev.ping_status || '').toLowerCase() === 'offline';

                return (
                  <div
                    key={`${dev.classification}-${dev.id}`}
                    style={{
                      padding: '12px 16px',
                      borderBottom: '1px solid #f1f5f9',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          style={{
                            width: '7px',
                            height: '7px',
                            borderRadius: '50%',
                            backgroundColor: isOnline ? '#10b981' : isOffline ? '#ef4444' : '#94a3b8',
                          }}
                        />
                        <span style={{ fontWeight: 600, color: '#0f172a', fontSize: '12px' }}>
                          {dev.name}
                        </span>
                        <span
                          style={{
                            fontSize: '9.5px',
                            padding: '1px 5px',
                            borderRadius: '3px',
                            backgroundColor: dev.classification === 'managed' ? '#e0f2fe' : '#f1f5f9',
                            color: dev.classification === 'managed' ? '#0369a1' : '#64748b',
                            fontWeight: 600,
                          }}
                        >
                          {dev.classification === 'managed' ? 'MANAGED' : 'DISCOVERED'}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '3px' }}>
                        <span className="mono" style={{ fontSize: '11.5px', color: '#0284c7', fontWeight: 600 }}>
                          {dev.ip_address}
                        </span>
                        {dev.mac_address && (
                          <span className="mono" style={{ fontSize: '10px', color: '#64748b' }}>
                            {dev.mac_address}
                          </span>
                        )}
                        <span style={{ fontSize: '10px', color: '#64748b' }}>
                          {dev.device_type}
                        </span>
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <span
                        style={{
                          fontSize: '10.5px',
                          fontWeight: 600,
                          color: isOnline ? '#059669' : isOffline ? '#dc2626' : '#64748b',
                        }}
                      >
                        {isOnline ? 'Online' : isOffline ? 'No Reply' : 'Unprobed'}
                      </span>
                      {dev.latency_ms !== null && dev.latency_ms !== undefined && (
                        <div className="mono" style={{ fontSize: '10px', color: '#059669' }}>
                          {dev.latency_ms} ms
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Drawer>

      {/* 7. Delete Confirmation Modal */}
      {subnetToDelete && (
        <Modal
          isOpen={Boolean(subnetToDelete)}
          onClose={() => setSubnetToDelete(null)}
          title="Delete Subnet Configuration"
          maxWidth={460}
        >
          <div style={{ padding: '6px 0' }}>
            <p style={{ fontSize: '12.5px', color: '#334155', lineHeight: 1.5, marginBottom: '14px' }}>
              Are you sure you want to delete subnet <strong>"{subnetToDelete.subnet_name}"</strong> (
              {subnetToDelete.network_address}/{subnetToDelete.cidr_prefix})?
            </p>

            {subnetToDelete.assigned_devices_count > 0 ? (
              <div
                style={{
                  padding: '10px 12px',
                  backgroundColor: '#fffbeb',
                  border: '1px solid #fde68a',
                  color: '#92400e',
                  borderRadius: '4px',
                  fontSize: '11.5px',
                  marginBottom: '16px',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: '4px' }}>Active Nodes Warning</div>
                There are currently <strong>{subnetToDelete.assigned_devices_count} network nodes</strong> operating
                in this IP series. Deleting this subnet will reclassify those nodes as "Unassigned / Unknown Network".
                Consider deactivating instead of deleting.
              </div>
            ) : null}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button className="btn btn-secondary" onClick={() => setSubnetToDelete(null)} disabled={isDeleting}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                style={{ backgroundColor: '#dc2626', borderColor: '#b91c1c' }}
                onClick={() => handleDeleteSubnet(true)}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default SubnetManagement;
