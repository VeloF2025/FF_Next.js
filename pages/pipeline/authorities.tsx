/**
 * Pipeline Service Authorities Management Page
 * /pipeline/authorities - Manage authority contacts database
 */

import type { NextPage } from 'next';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  ArrowLeft,
  Building,
  Plus,
  Search,
  Filter,
  Edit,
  Trash2,
  Phone,
  Mail,
  MapPin,
  Clock,
  DollarSign,
  RefreshCw,
  X,
  Save,
  Loader2,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import type { ServiceAuthorityWithType } from '@/modules/pipeline/types';

interface ApprovalType {
  id: string;
  name: string;
  code: string;
  category: string;
}

const AuthoritiesPage: NextPage = () => {
  const [authorities, setAuthorities] = useState<ServiceAuthorityWithType[]>([]);
  const [approvalTypes, setApprovalTypes] = useState<ApprovalType[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterProvince, setFilterProvince] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    approval_type_id: '',
    authority_name: '',
    department: '',
    province: '',
    municipality: '',
    contact_name: '',
    contact_title: '',
    contact_email: '',
    contact_phone: '',
    contact_mobile: '',
    physical_address: '',
    typical_turnaround_days: '',
    application_fee: '',
    notes: '',
  });

  useEffect(() => {
    loadApprovalTypes();
  }, []);

  useEffect(() => {
    loadAuthorities();
  }, [search, filterType, filterProvince, page]);

  const loadApprovalTypes = async () => {
    try {
      const res = await fetch('/api/pipeline/approval-types');
      const data = await res.json();
      if (data.success) {
        setApprovalTypes(data.data || []);
      }
    } catch (err) {
      console.error('Failed to load approval types:', err);
    }
  };

  const loadAuthorities = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
      });
      if (search) params.set('search', search);
      if (filterType) params.set('approval_type_id', filterType);
      if (filterProvince) params.set('province', filterProvince);

      const res = await fetch(`/api/pipeline/authorities?${params}`);
      const data = await res.json();

      if (data.success) {
        setAuthorities(data.data.authorities || []);
        setTotalPages(data.data.totalPages || 1);
        setTotal(data.data.total || 0);
      }
    } catch (err) {
      console.error('Failed to load authorities:', err);
    } finally {
      setLoading(false);
    }
  };

  const openCreateModal = () => {
    setEditingId(null);
    setFormData({
      approval_type_id: '',
      authority_name: '',
      department: '',
      province: '',
      municipality: '',
      contact_name: '',
      contact_title: '',
      contact_email: '',
      contact_phone: '',
      contact_mobile: '',
      physical_address: '',
      typical_turnaround_days: '',
      application_fee: '',
      notes: '',
    });
    setFormError(null);
    setShowModal(true);
  };

  const openEditModal = (authority: ServiceAuthorityWithType) => {
    setEditingId(authority.id);
    setFormData({
      approval_type_id: authority.approval_type_id,
      authority_name: authority.authority_name,
      department: authority.department || '',
      province: authority.province || '',
      municipality: authority.municipality || '',
      contact_name: authority.contact_name || '',
      contact_title: authority.contact_title || '',
      contact_email: authority.contact_email || '',
      contact_phone: authority.contact_phone || '',
      contact_mobile: authority.contact_mobile || '',
      physical_address: authority.physical_address || '',
      typical_turnaround_days: authority.typical_turnaround_days?.toString() || '',
      application_fee: authority.application_fee?.toString() || '',
      notes: authority.notes || '',
    });
    setFormError(null);
    setShowModal(true);
  };

  const handleFormChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setFormError(null);

    try {
      if (!formData.authority_name.trim()) {
        throw new Error('Authority name is required');
      }
      if (!formData.approval_type_id) {
        throw new Error('Approval type is required');
      }

      const payload = {
        ...formData,
        typical_turnaround_days: formData.typical_turnaround_days
          ? parseInt(formData.typical_turnaround_days)
          : null,
        application_fee: formData.application_fee
          ? parseFloat(formData.application_fee)
          : null,
      };

      const url = editingId
        ? `/api/pipeline/authorities/${editingId}`
        : '/api/pipeline/authorities';
      const method = editingId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to save');
      }

      setShowModal(false);
      loadAuthorities();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to deactivate this authority?')) return;

    try {
      const res = await fetch(`/api/pipeline/authorities/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        loadAuthorities();
      }
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  };

  const provinces = [
    'Eastern Cape',
    'Free State',
    'Gauteng',
    'KwaZulu-Natal',
    'Limpopo',
    'Mpumalanga',
    'Northern Cape',
    'North West',
    'Western Cape',
  ];

  return (
    <AppLayout>
      <div className="p-6">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <Link
                href="/pipeline"
                className="p-2 rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-[var(--ff-text-primary)] flex items-center gap-2">
                  <Building className="w-7 h-7 text-[var(--ff-accent)]" />
                  Service Authorities
                </h1>
                <p className="text-[var(--ff-text-secondary)] mt-1">
                  Manage authority contacts for approval processes
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={loadAuthorities}
                className="p-2 rounded-lg border border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)] transition-colors"
                title="Refresh"
              >
                <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={openCreateModal}
                className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-accent)] text-white rounded-lg hover:bg-[var(--ff-accent-hover)] transition-colors"
              >
                <Plus className="w-5 h-5" />
                Add Authority
              </button>
            </div>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-4 mb-6">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-[var(--ff-text-secondary)]" />
              <input
                type="text"
                placeholder="Search authorities..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="w-full pl-10 pr-4 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
              />
            </div>

            <select
              value={filterType}
              onChange={(e) => {
                setFilterType(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
            >
              <option value="">All Types</option>
              {approvalTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>

            <select
              value={filterProvince}
              onChange={(e) => {
                setFilterProvince(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
            >
              <option value="">All Provinces</option>
              {provinces.map((prov) => (
                <option key={prov} value={prov}>
                  {prov}
                </option>
              ))}
            </select>
          </div>

          {/* Stats */}
          <div className="mb-4 text-sm text-[var(--ff-text-secondary)]">
            {total} {total === 1 ? 'authority' : 'authorities'} found
          </div>

          {/* Table */}
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)] overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-[var(--ff-bg-tertiary)]">
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                    Authority
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                    Type
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                    Location
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                    Contact
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                    Turnaround
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ff-border-light)]">
                {loading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i}>
                      <td colSpan={6} className="px-4 py-4">
                        <div className="h-6 bg-[var(--ff-bg-tertiary)] rounded animate-pulse" />
                      </td>
                    </tr>
                  ))
                ) : authorities.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-[var(--ff-text-secondary)]">
                      No authorities found. Add one to get started.
                    </td>
                  </tr>
                ) : (
                  authorities.map((auth) => (
                    <tr key={auth.id} className="hover:bg-[var(--ff-bg-tertiary)] transition-colors">
                      <td className="px-4 py-4">
                        <div className="font-medium text-[var(--ff-text-primary)]">
                          {auth.authority_name}
                        </div>
                        {auth.department && (
                          <div className="text-xs text-[var(--ff-text-secondary)]">
                            {auth.department}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                          {auth.approval_type_name || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-sm">
                        {auth.municipality && (
                          <div className="text-[var(--ff-text-primary)]">{auth.municipality}</div>
                        )}
                        <div className="text-[var(--ff-text-secondary)]">{auth.province || '-'}</div>
                      </td>
                      <td className="px-4 py-4">
                        {auth.contact_name && (
                          <div className="text-sm text-[var(--ff-text-primary)]">{auth.contact_name}</div>
                        )}
                        {auth.contact_email && (
                          <div className="flex items-center gap-1 text-xs text-[var(--ff-text-secondary)]">
                            <Mail className="w-3 h-3" />
                            {auth.contact_email}
                          </div>
                        )}
                        {auth.contact_phone && (
                          <div className="flex items-center gap-1 text-xs text-[var(--ff-text-secondary)]">
                            <Phone className="w-3 h-3" />
                            {auth.contact_phone}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-sm">
                        {auth.typical_turnaround_days ? (
                          <div className="flex items-center gap-1 text-[var(--ff-text-primary)]">
                            <Clock className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                            ~{auth.typical_turnaround_days} days
                          </div>
                        ) : (
                          <span className="text-[var(--ff-text-secondary)]">-</span>
                        )}
                        {auth.application_fee && (
                          <div className="flex items-center gap-1 text-xs text-[var(--ff-text-secondary)]">
                            <DollarSign className="w-3 h-3" />R{auth.application_fee}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openEditModal(auth)}
                            className="p-1.5 rounded hover:bg-[var(--ff-bg-primary)] transition-colors"
                            title="Edit"
                          >
                            <Edit className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                          </button>
                          <button
                            onClick={() => handleDelete(auth.id)}
                            className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                            title="Deactivate"
                          >
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-[var(--ff-border-light)] flex items-center justify-between">
                <p className="text-sm text-[var(--ff-text-secondary)]">
                  Page {page} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-2 border border-[var(--ff-border-light)] rounded disabled:opacity-50 hover:bg-[var(--ff-bg-tertiary)]"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="p-2 border border-[var(--ff-border-light)] rounded disabled:opacity-50 hover:bg-[var(--ff-bg-tertiary)]"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)] px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                {editingId ? 'Edit Authority' : 'Add New Authority'}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 rounded hover:bg-[var(--ff-bg-tertiary)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-2 text-red-700 dark:text-red-300 text-sm">
                  <AlertCircle className="w-4 h-4" />
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    Authority Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    name="authority_name"
                    value={formData.authority_name}
                    onChange={handleFormChange}
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    Approval Type <span className="text-red-500">*</span>
                  </label>
                  <select
                    name="approval_type_id"
                    value={formData.approval_type_id}
                    onChange={handleFormChange}
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
                  >
                    <option value="">Select type...</option>
                    {approvalTypes.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    Department
                  </label>
                  <input
                    type="text"
                    name="department"
                    value={formData.department}
                    onChange={handleFormChange}
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    Province
                  </label>
                  <select
                    name="province"
                    value={formData.province}
                    onChange={handleFormChange}
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
                  >
                    <option value="">Select province...</option>
                    {provinces.map((prov) => (
                      <option key={prov} value={prov}>
                        {prov}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    Municipality
                  </label>
                  <input
                    type="text"
                    name="municipality"
                    value={formData.municipality}
                    onChange={handleFormChange}
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    Contact Name
                  </label>
                  <input
                    type="text"
                    name="contact_name"
                    value={formData.contact_name}
                    onChange={handleFormChange}
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    Contact Title
                  </label>
                  <input
                    type="text"
                    name="contact_title"
                    value={formData.contact_title}
                    onChange={handleFormChange}
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    name="contact_email"
                    value={formData.contact_email}
                    onChange={handleFormChange}
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    Phone
                  </label>
                  <input
                    type="tel"
                    name="contact_phone"
                    value={formData.contact_phone}
                    onChange={handleFormChange}
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    Typical Turnaround (days)
                  </label>
                  <input
                    type="number"
                    name="typical_turnaround_days"
                    value={formData.typical_turnaround_days}
                    onChange={handleFormChange}
                    min="0"
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    Application Fee (ZAR)
                  </label>
                  <input
                    type="number"
                    name="application_fee"
                    value={formData.application_fee}
                    onChange={handleFormChange}
                    min="0"
                    step="0.01"
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    Physical Address
                  </label>
                  <input
                    type="text"
                    name="physical_address"
                    value={formData.physical_address}
                    onChange={handleFormChange}
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                    Notes
                  </label>
                  <textarea
                    name="notes"
                    value={formData.notes}
                    onChange={handleFormChange}
                    rows={3}
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] resize-none"
                  />
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 bg-[var(--ff-bg-secondary)] border-t border-[var(--ff-border-light)] px-6 py-4 flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)]"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-accent)] text-white rounded-lg hover:bg-[var(--ff-accent-hover)] disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    {editingId ? 'Update' : 'Create'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
};

export default AuthoritiesPage;
