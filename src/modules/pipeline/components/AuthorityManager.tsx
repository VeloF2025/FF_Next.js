/**
 * Authority Manager Component
 * Admin interface for CRUD operations on service authorities
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Search,
  Plus,
  Edit2,
  Trash2,
  Building2,
  Phone,
  Mail,
  MapPin,
  Clock,
  DollarSign,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  Filter,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { log } from '@/lib/logger';
import type {
  ServiceAuthorityWithType,
  CreateServiceAuthorityInput,
  UpdateServiceAuthorityInput,
  PipelineApprovalType,
} from '../types';

interface AuthorityManagerProps {
  currentUserId?: string;
}

const SA_PROVINCES = [
  'Eastern Cape',
  'Free State',
  'Gauteng',
  'KwaZulu-Natal',
  'Limpopo',
  'Mpumalanga',
  'North West',
  'Northern Cape',
  'Western Cape',
];

export function AuthorityManager({ currentUserId }: AuthorityManagerProps) {
  // List state
  const [authorities, setAuthorities] = useState<ServiceAuthorityWithType[]>([]);
  const [approvalTypes, setApprovalTypes] = useState<PipelineApprovalType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  // Filters
  const [search, setSearch] = useState('');
  const [filterApprovalType, setFilterApprovalType] = useState('');
  const [filterProvince, setFilterProvince] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Edit/Create modal
  const [editingAuthority, setEditingAuthority] = useState<ServiceAuthorityWithType | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState<CreateServiceAuthorityInput>({
    approval_type_id: '',
    authority_name: '',
  });

  // Load approval types
  useEffect(() => {
    async function loadApprovalTypes() {
      try {
        const res = await fetch('/api/pipeline/approval-types');
        const data = await res.json();
        if (data.success) {
          setApprovalTypes(data.data);
        }
      } catch (err) {
        log.error('Failed to load approval types', { error: err }, 'AuthorityManager');
      }
    }
    loadApprovalTypes();
  }, []);

  // Load authorities
  const loadAuthorities = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', page.toString());
      params.set('limit', limit.toString());
      if (search) params.set('search', search);
      if (filterApprovalType) params.set('approval_type_id', filterApprovalType);
      if (filterProvince) params.set('province', filterProvince);

      const res = await fetch(`/api/pipeline/authorities?${params}`);
      const data = await res.json();

      if (data.success) {
        setAuthorities(data.data.authorities);
        setTotal(data.data.total);
        setTotalPages(data.data.totalPages);
      } else {
        throw new Error(data.error || 'Failed to load authorities');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load authorities');
    } finally {
      setLoading(false);
    }
  }, [page, search, filterApprovalType, filterProvince]);

  useEffect(() => {
    loadAuthorities();
  }, [loadAuthorities]);

  // Reset form when opening create modal
  function handleOpenCreate() {
    setFormData({
      approval_type_id: filterApprovalType || '',
      province: filterProvince || undefined,
      authority_name: '',
    });
    setShowCreateModal(true);
  }

  // Open edit modal
  function handleOpenEdit(authority: ServiceAuthorityWithType) {
    setEditingAuthority(authority);
    setFormData({
      approval_type_id: authority.approval_type_id,
      province: authority.province || undefined,
      municipality: authority.municipality || undefined,
      region: authority.region || undefined,
      authority_name: authority.authority_name,
      department: authority.department || undefined,
      contact_name: authority.contact_name || undefined,
      contact_title: authority.contact_title || undefined,
      contact_email: authority.contact_email || undefined,
      contact_phone: authority.contact_phone || undefined,
      contact_mobile: authority.contact_mobile || undefined,
      physical_address: authority.physical_address || undefined,
      postal_address: authority.postal_address || undefined,
      office_hours: authority.office_hours || undefined,
      website: authority.website || undefined,
      typical_turnaround_days: authority.typical_turnaround_days || undefined,
      application_fee: authority.application_fee || undefined,
      notes: authority.notes || undefined,
    });
  }

  // Save authority
  async function handleSave() {
    if (!formData.approval_type_id || !formData.authority_name?.trim()) {
      setError('Approval type and authority name are required');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const url = editingAuthority
        ? `/api/pipeline/authorities/${editingAuthority.id}`
        : '/api/pipeline/authorities';
      const method = editingAuthority ? 'PUT' : 'POST';

      // Note: created_by/updated_by not sent - FK references staff table, not users
      const body = formData;

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save authority');
      }

      setShowCreateModal(false);
      setEditingAuthority(null);
      loadAuthorities();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  // Delete authority
  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/pipeline/authorities/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        throw new Error('Failed to delete authority');
      }

      setDeleteConfirm(null);
      loadAuthorities();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  // Close modals
  function handleCloseModal() {
    setShowCreateModal(false);
    setEditingAuthority(null);
    setError(null);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">
            Service Authorities
          </h1>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            Manage contact information for approval authorities
          </p>
        </div>
        <button
          onClick={handleOpenCreate}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-accent)] text-white rounded-lg hover:bg-[var(--ff-accent-hover)]"
        >
          <Plus className="w-4 h-4" />
          Add Authority
        </button>
      </div>

      {/* Search and Filters */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search authorities..."
              className="w-full pl-10 pr-4 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] bg-[var(--ff-bg-primary)]"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2 border border-[var(--ff-border-light)] rounded-lg ${
              showFilters ? 'bg-[var(--ff-bg-tertiary)]' : 'hover:bg-[var(--ff-bg-tertiary)]'
            }`}
          >
            <Filter className="w-4 h-4" />
            Filters
            {(filterApprovalType || filterProvince) && (
              <span className="w-5 h-5 text-xs bg-[var(--ff-accent)] text-white rounded-full flex items-center justify-center">
                {[filterApprovalType, filterProvince].filter(Boolean).length}
              </span>
            )}
          </button>
        </div>

        {showFilters && (
          <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-[var(--ff-border-light)]">
            <div className="w-64">
              <label className="block text-xs text-[var(--ff-text-secondary)] mb-1">
                Approval Type
              </label>
              <select
                value={filterApprovalType}
                onChange={(e) => {
                  setFilterApprovalType(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-sm"
              >
                <option value="">All Types</option>
                {approvalTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-48">
              <label className="block text-xs text-[var(--ff-text-secondary)] mb-1">
                Province
              </label>
              <select
                value={filterProvince}
                onChange={(e) => {
                  setFilterProvince(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-sm"
              >
                <option value="">All Provinces</option>
                {SA_PROVINCES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={() => {
                  setFilterApprovalType('');
                  setFilterProvince('');
                  setSearch('');
                  setPage(1);
                }}
                className="text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
              >
                Clear filters
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && !showCreateModal && !editingAuthority && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Results */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--ff-accent)]" />
        </div>
      ) : authorities.length === 0 ? (
        <div className="text-center py-12 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
          <Building2 className="w-12 h-12 mx-auto text-[var(--ff-text-tertiary)] mb-4" />
          <p className="text-[var(--ff-text-secondary)]">No authorities found</p>
          {(search || filterApprovalType || filterProvince) && (
            <button
              onClick={() => {
                setSearch('');
                setFilterApprovalType('');
                setFilterProvince('');
              }}
              className="mt-2 text-sm text-[var(--ff-accent)] hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Table */}
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[var(--ff-bg-tertiary)] text-left text-sm">
                  <tr>
                    <th className="px-4 py-3 font-medium text-[var(--ff-text-secondary)]">
                      Authority
                    </th>
                    <th className="px-4 py-3 font-medium text-[var(--ff-text-secondary)]">
                      Type
                    </th>
                    <th className="px-4 py-3 font-medium text-[var(--ff-text-secondary)]">
                      Location
                    </th>
                    <th className="px-4 py-3 font-medium text-[var(--ff-text-secondary)]">
                      Contact
                    </th>
                    <th className="px-4 py-3 font-medium text-[var(--ff-text-secondary)]">
                      Turnaround
                    </th>
                    <th className="px-4 py-3 font-medium text-[var(--ff-text-secondary)] text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ff-border-light)]">
                  {authorities.map((authority) => (
                    <tr key={authority.id} className="hover:bg-[var(--ff-bg-tertiary)]">
                      <td className="px-4 py-3">
                        <div className="font-medium text-[var(--ff-text-primary)]">
                          {authority.authority_name}
                        </div>
                        {authority.department && (
                          <div className="text-xs text-[var(--ff-text-secondary)]">
                            {authority.department}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--ff-text-secondary)]">
                        {authority.approval_type_name || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--ff-text-secondary)]">
                        {[authority.municipality, authority.province]
                          .filter(Boolean)
                          .join(', ') || '-'}
                      </td>
                      <td className="px-4 py-3">
                        {authority.contact_name ? (
                          <div className="text-sm">
                            <div className="text-[var(--ff-text-primary)]">
                              {authority.contact_name}
                            </div>
                            {authority.contact_email && (
                              <div className="text-xs text-[var(--ff-text-secondary)]">
                                {authority.contact_email}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-[var(--ff-text-tertiary)]">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--ff-text-secondary)]">
                        {authority.typical_turnaround_days
                          ? `${authority.typical_turnaround_days} days`
                          : '-'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleOpenEdit(authority)}
                            className="p-2 hover:bg-[var(--ff-bg-primary)] rounded"
                            title="Edit"
                          >
                            <Edit2 className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                          </button>
                          {deleteConfirm === authority.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleDelete(authority.id)}
                                className="p-2 bg-red-100 hover:bg-red-200 rounded text-red-600"
                                title="Confirm Delete"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(null)}
                                className="p-2 hover:bg-[var(--ff-bg-primary)] rounded"
                                title="Cancel"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirm(authority.id)}
                              className="p-2 hover:bg-red-50 rounded"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4 text-red-500" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--ff-text-secondary)]">
              Showing {(page - 1) * limit + 1} to{' '}
              {Math.min(page * limit, total)} of {total} authorities
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-2 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-secondary)] disabled:opacity-50"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-[var(--ff-text-secondary)]">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-2 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-secondary)] disabled:opacity-50"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* Create/Edit Modal */}
      {(showCreateModal || editingAuthority) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={handleCloseModal} />
          <div className="relative w-full max-w-2xl bg-[var(--ff-bg-primary)] rounded-lg shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-[var(--ff-bg-primary)] px-6 py-4 border-b border-[var(--ff-border-light)]">
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                {editingAuthority ? 'Edit Authority' : 'Add New Authority'}
              </h2>
            </div>

            <div className="p-6 space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                {/* Approval Type */}
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                    Approval Type *
                  </label>
                  <select
                    value={formData.approval_type_id}
                    onChange={(e) =>
                      setFormData({ ...formData, approval_type_id: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)]"
                  >
                    <option value="">Select type...</option>
                    {approvalTypes.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Authority Name */}
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                    Authority Name *
                  </label>
                  <input
                    type="text"
                    value={formData.authority_name}
                    onChange={(e) =>
                      setFormData({ ...formData, authority_name: e.target.value })
                    }
                    placeholder="e.g., City of Tshwane"
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)]"
                  />
                </div>

                {/* Department */}
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                    Department
                  </label>
                  <input
                    type="text"
                    value={formData.department || ''}
                    onChange={(e) =>
                      setFormData({ ...formData, department: e.target.value })
                    }
                    placeholder="e.g., Water & Sanitation Department"
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)]"
                  />
                </div>

                {/* Province */}
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                    Province
                  </label>
                  <select
                    value={formData.province || ''}
                    onChange={(e) =>
                      setFormData({ ...formData, province: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)]"
                  >
                    <option value="">Select province...</option>
                    {SA_PROVINCES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Municipality */}
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                    Municipality
                  </label>
                  <input
                    type="text"
                    value={formData.municipality || ''}
                    onChange={(e) =>
                      setFormData({ ...formData, municipality: e.target.value })
                    }
                    placeholder="e.g., Tshwane"
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)]"
                  />
                </div>

                {/* Divider */}
                <div className="col-span-2 border-t border-[var(--ff-border-light)] my-2" />

                {/* Contact Name */}
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                    Contact Name
                  </label>
                  <input
                    type="text"
                    value={formData.contact_name || ''}
                    onChange={(e) =>
                      setFormData({ ...formData, contact_name: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)]"
                  />
                </div>

                {/* Contact Title */}
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                    Contact Title
                  </label>
                  <input
                    type="text"
                    value={formData.contact_title || ''}
                    onChange={(e) =>
                      setFormData({ ...formData, contact_title: e.target.value })
                    }
                    placeholder="e.g., Director"
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)]"
                  />
                </div>

                {/* Contact Email */}
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={formData.contact_email || ''}
                    onChange={(e) =>
                      setFormData({ ...formData, contact_email: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)]"
                  />
                </div>

                {/* Contact Phone */}
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={formData.contact_phone || ''}
                    onChange={(e) =>
                      setFormData({ ...formData, contact_phone: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)]"
                  />
                </div>

                {/* Divider */}
                <div className="col-span-2 border-t border-[var(--ff-border-light)] my-2" />

                {/* Turnaround Days */}
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                    Typical Turnaround (days)
                  </label>
                  <input
                    type="number"
                    value={formData.typical_turnaround_days || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        typical_turnaround_days: e.target.value ? parseInt(e.target.value) : undefined,
                      })
                    }
                    min="1"
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)]"
                  />
                </div>

                {/* Application Fee */}
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                    Application Fee (R)
                  </label>
                  <input
                    type="number"
                    value={formData.application_fee || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        application_fee: e.target.value ? parseFloat(e.target.value) : undefined,
                      })
                    }
                    min="0"
                    step="0.01"
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)]"
                  />
                </div>

                {/* Notes */}
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                    Notes
                  </label>
                  <textarea
                    value={formData.notes || ''}
                    onChange={(e) =>
                      setFormData({ ...formData, notes: e.target.value })
                    }
                    rows={3}
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)]"
                  />
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 bg-[var(--ff-bg-primary)] px-6 py-4 border-t border-[var(--ff-border-light)] flex justify-end gap-3">
              <button
                onClick={handleCloseModal}
                disabled={saving}
                className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-secondary)]"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-accent)] text-white rounded-lg hover:bg-[var(--ff-accent-hover)] disabled:opacity-50"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingAuthority ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AuthorityManager;
