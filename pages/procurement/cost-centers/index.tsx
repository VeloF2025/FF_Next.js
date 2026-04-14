/**
 * Cost Centers Management Page
 * Hierarchical cost allocation for procurement
 */

import React, { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout';
import { StatCard } from '@/components/ui/StatCard';
import {
  Building2,
  Plus,
  Search,
  ChevronRight,
  ChevronDown,
  FolderTree,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  MoreVertical,
  Pencil,
  Trash2,
  Lock,
  Unlock,
  Eye,
} from 'lucide-react';
import type {
  CostCenterSummary,
  CostCenterType,
  CreateCostCenterRequest,
} from '@/types/procurement/costCenter.types';

// Dark theme colors
const COLORS = {
  bg: {
    primary: '#0f1419',
    secondary: '#1a1d23',
    tertiary: '#1e2128',
    hover: '#252a33',
  },
  border: {
    primary: '#2d3139',
    secondary: '#3d4149',
  },
  text: {
    primary: '#ffffff',
    secondary: '#9ca3af',
    muted: '#6b7280',
  },
  accent: {
    blue: '#3b82f6',
    green: '#22c55e',
    yellow: '#eab308',
    red: '#ef4444',
    purple: '#8b5cf6',
  },
};

export default function CostCentersPage() {
  const [costCenters, setCostCenters] = useState<CostCenterSummary[]>([]);
  const [types, setTypes] = useState<CostCenterType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [selectedType, setSelectedType] = useState<string>('');
  const [showInactive, setShowInactive] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'tree'>('list');

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCenter, setEditingCenter] = useState<CostCenterSummary | null>(null);

  // Expanded tree nodes
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<CostCenterSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Stats
  const [stats, setStats] = useState({
    total: 0,
    totalBudget: 0,
    totalCommitted: 0,
    totalActual: 0,
    overBudgetCount: 0,
  });

  // Fetch cost centers
  const fetchCostCenters = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (selectedType) params.set('type_code', selectedType);
      params.set('is_active', showInactive ? 'false' : 'true');
      params.set('limit', '200');

      const res = await fetch(`/api/procurement/cost-centers?${params}`);
      const data = await res.json();

      if (data.success) {
        setCostCenters(data.data.cost_centers || []);

        // Calculate stats
        const centers = data.data.cost_centers || [];
        setStats({
          total: centers.length,
          totalBudget: centers.reduce((sum: number, c: CostCenterSummary) =>
            sum + (parseFloat(String(c.allocated_budget)) || 0), 0),
          totalCommitted: centers.reduce((sum: number, c: CostCenterSummary) =>
            sum + (parseFloat(String(c.committed_amount)) || 0), 0),
          totalActual: centers.reduce((sum: number, c: CostCenterSummary) =>
            sum + (parseFloat(String(c.actual_amount)) || 0), 0),
          overBudgetCount: centers.filter((c: CostCenterSummary) =>
            parseFloat(String(c.actual_amount)) > parseFloat(String(c.allocated_budget))).length,
        });
      } else {
        setError(data.error || 'Failed to fetch cost centers');
      }
    } catch (err) {
      setError('Failed to fetch cost centers');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [search, selectedType, showInactive]);

  // Fetch types
  useEffect(() => {
    async function fetchTypes() {
      try {
        const res = await fetch('/api/procurement/cost-centers/types');
        const data = await res.json();
        if (data.success) {
          setTypes(data.data || []);
        }
      } catch (err) {
        console.error('Failed to fetch types:', err);
      }
    }
    fetchTypes();
  }, []);

  useEffect(() => {
    fetchCostCenters();
  }, [fetchCostCenters]);

  // Build tree structure
  const buildTree = (centers: CostCenterSummary[]): CostCenterSummary[] => {
    const map = new Map<string, CostCenterSummary & { children?: CostCenterSummary[] }>();
    const roots: (CostCenterSummary & { children?: CostCenterSummary[] })[] = [];

    centers.forEach(c => map.set(c.id, { ...c, children: [] }));

    centers.forEach(c => {
      const node = map.get(c.id)!;
      if (c.parent_id && map.has(c.parent_id)) {
        const parent = map.get(c.parent_id)!;
        parent.children = parent.children || [];
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    });

    return roots;
  };

  const toggleNode = (id: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedNodes(newExpanded);
  };

  const formatCurrency = (amount: number | string) => {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(num || 0);
  };

  // Delete handler
  const handleDelete = async (center: CostCenterSummary) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/procurement/cost-centers/${center.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();

      if (data.success) {
        setDeleteConfirm(null);
        fetchCostCenters();
      } else {
        setError(data.error || 'Failed to delete cost center');
      }
    } catch (err) {
      setError('Failed to delete cost center');
      console.error(err);
    } finally {
      setDeleting(false);
    }
  };

  // Tree node renderer
  const renderTreeNode = (
    node: CostCenterSummary & { children?: CostCenterSummary[] },
    level: number = 0
  ): React.ReactNode => {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expandedNodes.has(node.id);
    const utilization = parseFloat(String(node.utilization_percent)) || 0;

    return (
      <div key={node.id}>
        <div
          className="flex items-center gap-2 py-2 px-3 hover:bg-[#252a33] rounded cursor-pointer"
          style={{ paddingLeft: `${level * 24 + 12}px` }}
          onClick={() => hasChildren && toggleNode(node.id)}
        >
          {hasChildren ? (
            isExpanded ? (
              <ChevronDown className="w-4 h-4 text-gray-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-gray-400" />
            )
          ) : (
            <span className="w-4" />
          )}

          <FolderTree className="w-4 h-4 text-blue-400" />

          <span className="flex-1 text-white font-medium">{node.code}</span>
          <span className="text-gray-400 text-sm flex-1">{node.name}</span>

          <span className="text-gray-400 text-sm w-24 text-right">
            {formatCurrency(node.allocated_budget)}
          </span>

          <span className={`text-sm w-20 text-right ${
            utilization > 100 ? 'text-red-400' :
            utilization > 80 ? 'text-yellow-400' : 'text-green-400'
          }`}>
            {utilization.toFixed(1)}%
          </span>

          {node.is_locked && (
            <Lock className="w-4 h-4 text-yellow-400" />
          )}

          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditingCenter(node);
              }}
              className="p-1 hover:bg-[#3d4149] rounded"
              title="Edit"
            >
              <Pencil className="w-4 h-4 text-gray-400" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDeleteConfirm(node);
              }}
              className="p-1 hover:bg-red-500/20 rounded"
              title="Delete"
              disabled={node.is_locked}
            >
              <Trash2 className={`w-4 h-4 ${node.is_locked ? 'text-gray-600' : 'text-gray-400 hover:text-red-400'}`} />
            </button>
          </div>
        </div>

        {hasChildren && isExpanded && (
          <div>
            {node.children!.map(child => renderTreeNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-6" style={{ backgroundColor: COLORS.bg.primary, minHeight: '100vh' }}>
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-white">Cost Centers</h1>
            <p className="text-gray-400">Hierarchical cost allocation and tracking</p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Cost Center
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <StatCard
            label="Total Centers"
            value={stats.total}
            icon={Building2}
            colorType="total"
          />
          <StatCard
            label="Total Budget"
            value={formatCurrency(stats.totalBudget)}
            icon={DollarSign}
            colorType="success"
          />
          <StatCard
            label="Committed"
            value={formatCurrency(stats.totalCommitted)}
            icon={TrendingUp}
            colorType="warning"
          />
          <StatCard
            label="Actual Spend"
            value={formatCurrency(stats.totalActual)}
            icon={DollarSign}
            colorType="financial"
          />
          <StatCard
            label="Over Budget"
            value={stats.overBudgetCount}
            icon={AlertTriangle}
            colorType="error"
          />
        </div>

        {/* Filters */}
        <div
          className="rounded-lg p-4"
          style={{ backgroundColor: COLORS.bg.secondary, border: `1px solid ${COLORS.border.primary}` }}
        >
          <div className="flex flex-wrap gap-4 items-center">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search cost centers..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-lg text-white placeholder-gray-500"
                style={{
                  backgroundColor: COLORS.bg.tertiary,
                  border: `1px solid ${COLORS.border.primary}`,
                }}
              />
            </div>

            {/* Type Filter */}
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="px-4 py-2 rounded-lg text-white"
              style={{
                backgroundColor: COLORS.bg.tertiary,
                border: `1px solid ${COLORS.border.primary}`,
              }}
            >
              <option value="">All Types</option>
              {types.map(type => (
                <option key={type.id} value={type.code}>{type.name}</option>
              ))}
            </select>

            {/* Show Inactive */}
            <label className="flex items-center gap-2 text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="rounded"
              />
              Show Inactive
            </label>

            {/* View Mode */}
            <div className="flex rounded-lg overflow-hidden" style={{ border: `1px solid ${COLORS.border.primary}` }}>
              <button
                onClick={() => setViewMode('list')}
                className={`px-4 py-2 text-sm ${
                  viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-[#1e2128] text-gray-400'
                }`}
              >
                List
              </button>
              <button
                onClick={() => setViewMode('tree')}
                className={`px-4 py-2 text-sm ${
                  viewMode === 'tree' ? 'bg-blue-600 text-white' : 'bg-[#1e2128] text-gray-400'
                }`}
              >
                Tree
              </button>
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400">
            {error}
          </div>
        )}

        {/* Content */}
        <div
          className="rounded-lg overflow-hidden"
          style={{ backgroundColor: COLORS.bg.secondary, border: `1px solid ${COLORS.border.primary}` }}
        >
          {loading ? (
            <div className="p-8 text-center text-gray-400">Loading...</div>
          ) : costCenters.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              No cost centers found. Create your first cost center to get started.
            </div>
          ) : viewMode === 'tree' ? (
            <div className="p-4">
              {buildTree(costCenters).map(node => renderTreeNode(node))}
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr style={{ backgroundColor: COLORS.bg.tertiary }}>
                  <th className="text-left p-4 text-gray-400 font-medium">Code</th>
                  <th className="text-left p-4 text-gray-400 font-medium">Name</th>
                  <th className="text-left p-4 text-gray-400 font-medium">Type</th>
                  <th className="text-right p-4 text-gray-400 font-medium">Budget</th>
                  <th className="text-right p-4 text-gray-400 font-medium">Committed</th>
                  <th className="text-right p-4 text-gray-400 font-medium">Actual</th>
                  <th className="text-right p-4 text-gray-400 font-medium">Utilization</th>
                  <th className="text-center p-4 text-gray-400 font-medium">Status</th>
                  <th className="text-center p-4 text-gray-400 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {costCenters.map(center => {
                  const utilization = parseFloat(String(center.utilization_percent)) || 0;
                  return (
                    <tr
                      key={center.id}
                      className="border-t hover:bg-[#252a33]"
                      style={{ borderColor: COLORS.border.primary }}
                    >
                      <td className="p-4">
                        <span className="text-white font-mono">{center.code}</span>
                      </td>
                      <td className="p-4">
                        <div>
                          <span className="text-white">{center.name}</span>
                          {center.parent_name && (
                            <span className="text-gray-400 text-sm ml-2">
                              ← {center.parent_code}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="px-2 py-1 rounded text-xs bg-blue-500/20 text-blue-400">
                          {center.type_name || '-'}
                        </span>
                      </td>
                      <td className="p-4 text-right text-white font-mono">
                        {formatCurrency(center.allocated_budget)}
                      </td>
                      <td className="p-4 text-right text-yellow-400 font-mono">
                        {formatCurrency(center.committed_amount)}
                      </td>
                      <td className="p-4 text-right text-green-400 font-mono">
                        {formatCurrency(center.actual_amount)}
                      </td>
                      <td className="p-4 text-right">
                        <span className={`font-mono ${
                          utilization > 100 ? 'text-red-400' :
                          utilization > 80 ? 'text-yellow-400' : 'text-green-400'
                        }`}>
                          {utilization.toFixed(1)}%
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {center.is_locked && (
                            <Lock className="w-4 h-4 text-yellow-400" aria-label="Locked" />
                          )}
                          {!center.is_active && (
                            <span className="px-2 py-0.5 rounded text-xs bg-red-500/20 text-red-400">
                              Inactive
                            </span>
                          )}
                          {center.is_active && !center.is_locked && (
                            <span className="px-2 py-0.5 rounded text-xs bg-green-500/20 text-green-400">
                              Active
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => window.location.href = `/procurement/cost-centers/${center.id}`}
                            className="p-1.5 hover:bg-[#3d4149] rounded"
                            title="View Details"
                          >
                            <Eye className="w-4 h-4 text-gray-400" />
                          </button>
                          <button
                            onClick={() => setEditingCenter(center)}
                            className="p-1.5 hover:bg-[#3d4149] rounded"
                            title="Edit"
                          >
                            <Pencil className="w-4 h-4 text-gray-400" />
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(center)}
                            className="p-1.5 hover:bg-red-500/20 rounded"
                            title="Delete"
                            disabled={center.is_locked}
                          >
                            <Trash2 className={`w-4 h-4 ${center.is_locked ? 'text-gray-600' : 'text-gray-400 hover:text-red-400'}`} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Create/Edit Modal */}
        {(showCreateModal || editingCenter) && (
          <CostCenterModal
            costCenter={editingCenter}
            types={types}
            parentOptions={costCenters.filter(c => !editingCenter || c.id !== editingCenter.id)}
            onClose={() => {
              setShowCreateModal(false);
              setEditingCenter(null);
            }}
            onSave={() => {
              setShowCreateModal(false);
              setEditingCenter(null);
              fetchCostCenters();
            }}
          />
        )}

        {/* Delete Confirmation Modal */}
        {deleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div
              className="w-full max-w-md rounded-lg p-6"
              style={{ backgroundColor: COLORS.bg.secondary, border: `1px solid ${COLORS.border.primary}` }}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-full bg-red-500/20">
                  <AlertTriangle className="w-6 h-6 text-red-400" />
                </div>
                <h2 className="text-xl font-bold text-white">Delete Cost Center</h2>
              </div>

              <p className="text-gray-300 mb-2">
                Are you sure you want to delete <strong className="text-white">{deleteConfirm.code}</strong>?
              </p>
              <p className="text-gray-400 text-sm mb-4">
                {deleteConfirm.name}
              </p>

              {(parseFloat(String(deleteConfirm.committed_amount)) > 0 ||
                parseFloat(String(deleteConfirm.actual_amount)) > 0) && (
                <div className="p-3 rounded bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-sm mb-4">
                  <strong>Warning:</strong> This cost center has committed or actual amounts.
                  Deleting will remove all associated tracking data.
                </div>
              )}

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="px-4 py-2 rounded-lg text-gray-400 hover:text-white transition-colors"
                  style={{ border: `1px solid ${COLORS.border.primary}` }}
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(deleteConfirm)}
                  disabled={deleting}
                  className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50"
                >
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

// Modal Component
interface ModalProps {
  costCenter: CostCenterSummary | null;
  types: CostCenterType[];
  parentOptions: CostCenterSummary[];
  onClose: () => void;
  onSave: () => void;
}

function CostCenterModal({ costCenter, types, parentOptions, onClose, onSave }: ModalProps) {
  const [formData, setFormData] = useState<CreateCostCenterRequest>({
    code: costCenter?.code || '',
    name: costCenter?.name || '',
    description: costCenter?.description || '',
    parent_id: costCenter?.parent_id || undefined,
    cost_center_type_id: costCenter?.cost_center_type_id || '',
    allocated_budget: costCenter?.allocated_budget || 0,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const url = costCenter
        ? `/api/procurement/cost-centers/${costCenter.id}`
        : '/api/procurement/cost-centers';

      const res = await fetch(url, {
        method: costCenter ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (data.success) {
        onSave();
      } else {
        setError(data.error || 'Failed to save cost center');
      }
    } catch (err) {
      setError('Failed to save cost center');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="w-full max-w-lg rounded-lg p-6"
        style={{ backgroundColor: COLORS.bg.secondary, border: `1px solid ${COLORS.border.primary}` }}
      >
        <h2 className="text-xl font-bold text-white mb-4">
          {costCenter ? 'Edit Cost Center' : 'Create Cost Center'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Code */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Code *</label>
            <input
              type="text"
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
              required
              className="w-full px-4 py-2 rounded-lg text-white"
              style={{ backgroundColor: COLORS.bg.tertiary, border: `1px solid ${COLORS.border.primary}` }}
              placeholder="e.g., PROJ-001"
            />
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              className="w-full px-4 py-2 rounded-lg text-white"
              style={{ backgroundColor: COLORS.bg.tertiary, border: `1px solid ${COLORS.border.primary}` }}
              placeholder="Cost center name"
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Type</label>
            <select
              value={formData.cost_center_type_id || ''}
              onChange={(e) => setFormData({ ...formData, cost_center_type_id: e.target.value || undefined })}
              className="w-full px-4 py-2 rounded-lg text-white"
              style={{ backgroundColor: COLORS.bg.tertiary, border: `1px solid ${COLORS.border.primary}` }}
            >
              <option value="">Select type...</option>
              {types.map(type => (
                <option key={type.id} value={type.id}>{type.name} (Level {type.hierarchy_level})</option>
              ))}
            </select>
          </div>

          {/* Parent */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Parent Cost Center</label>
            <select
              value={formData.parent_id || ''}
              onChange={(e) => setFormData({ ...formData, parent_id: e.target.value || undefined })}
              className="w-full px-4 py-2 rounded-lg text-white"
              style={{ backgroundColor: COLORS.bg.tertiary, border: `1px solid ${COLORS.border.primary}` }}
            >
              <option value="">None (Root level)</option>
              {parentOptions.map(p => (
                <option key={p.id} value={p.id}>{p.code} - {p.name}</option>
              ))}
            </select>
          </div>

          {/* Budget */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Allocated Budget</label>
            <input
              type="number"
              value={formData.allocated_budget || ''}
              onChange={(e) => setFormData({ ...formData, allocated_budget: parseFloat(e.target.value) || 0 })}
              className="w-full px-4 py-2 rounded-lg text-white"
              style={{ backgroundColor: COLORS.bg.tertiary, border: `1px solid ${COLORS.border.primary}` }}
              placeholder="0.00"
              step="0.01"
              min="0"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Description</label>
            <textarea
              value={formData.description || ''}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-4 py-2 rounded-lg text-white resize-none"
              style={{ backgroundColor: COLORS.bg.tertiary, border: `1px solid ${COLORS.border.primary}` }}
              rows={3}
              placeholder="Optional description..."
            />
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-gray-400 hover:text-white transition-colors"
              style={{ border: `1px solid ${COLORS.border.primary}` }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : costCenter ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
