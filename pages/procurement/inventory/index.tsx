/**
 * Inventory Page - Unified tab interface for stock management
 * Tabs: Stock | Items | Categories | Bundles | Takes | Field
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import type { GetServerSideProps } from 'next';
import { AppLayout } from '@/components/layout';
import { ProcurementTabs } from '@/modules/procurement/components/ProcurementTabs';
import { useTabPersistence } from '@/modules/procurement/hooks';
import { StatCard, StatCardGrid } from '@/components/ui/StatCard';
import {
  Warehouse,
  ArrowLeftRight,
  Boxes,
  FolderTree,
  PackagePlus,
  ClipboardCheck,
  Package,
  Plus,
  Search,
  Loader2,
  Eye,
  Edit2,
  Trash2,
  ChevronRight,
  AlertTriangle,
  TrendingUp,
  DollarSign,
  Box,
  X,
  Settings,
  BarChart3,
  Calendar,
  Filter,
  Download,
} from 'lucide-react';
import { notificationService } from '@/services/core/NotificationService';
import { log } from '@/lib/logger';

// Import bundle modal
import { BundleItemsModal } from '@/components/procurement/bundles';

// Import existing components
import { StockItemsPage } from '@/modules/stock-items';
import StockManagement from '@/modules/procurement/stock/StockManagement';
import {
  FieldStockDashboard,
  LocationList,
  SerialScanner,
  ConsumptionRecorder,
} from '@/modules/procurement/field-stock/components';

interface InventoryPageProps {
  projectId?: string;
}

const TABS = [
  { id: 'stock', label: 'Stock', icon: ArrowLeftRight },
  { id: 'items', label: 'Items', icon: Boxes },
  { id: 'categories', label: 'Categories', icon: FolderTree },
  { id: 'bundles', label: 'Bundles', icon: PackagePlus },
  { id: 'takes', label: 'Takes', icon: ClipboardCheck },
  { id: 'field', label: 'Field', icon: Package },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
] as const;

type TabId = typeof TABS[number]['id'];

// Loading component
function LoadingState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      <span className="ml-2 text-[var(--ff-text-secondary)]">{message}</span>
    </div>
  );
}

// Types for Stock Categories
interface StockCategory {
  id: string;
  name: string;
  code: string;
  description?: string;
  parent_id?: string;
  is_active: boolean;
  item_count?: number;
}

// Types for Bundles
interface StockBundle {
  id: string;
  name: string;
  bundle_code: string;
  description?: string;
  bundle_type: string;
  is_active: boolean;
  item_count?: number;
  calculated_price?: number;
}

// Types for Stock Takes
interface StockTake {
  id: string;
  reference_number: string;
  status: 'draft' | 'in_progress' | 'pending_review' | 'completed' | 'cancelled';
  stock_take_type: string;
  started_at?: string;
  completed_at?: string;
  item_count?: number;
  calc_variance_value?: number;
  total_variance_value?: number;
}

const statusColors: Record<string, string> = {
  draft: 'bg-gray-500/20 text-gray-400',
  in_progress: 'bg-blue-500/20 text-blue-400',
  pending_review: 'bg-yellow-500/20 text-yellow-400',
  completed: 'bg-green-500/20 text-green-400',
  cancelled: 'bg-red-500/20 text-red-300',
};

// Categories Tab Content
function CategoriesTabContent() {
  const [categories, setCategories] = useState<StockCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<StockCategory | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    description: '',
    is_active: true,
  });

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/procurement/categories');
      const data = await res.json();
      if (data.success) {
        setCategories(data.data || []);
      }
    } catch (err) {
      log.error('Failed to fetch categories', err);
    } finally {
      setIsLoading(false);
    }
  };

  const openNewModal = () => {
    setEditingCategory(null);
    setFormData({ code: '', name: '', description: '', is_active: true });
    setShowModal(true);
  };

  const openEditModal = (cat: StockCategory) => {
    setEditingCategory(cat);
    setFormData({
      code: cat.code,
      name: cat.name,
      description: cat.description || '',
      is_active: cat.is_active,
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingCategory(null);
    setFormData({ code: '', name: '', description: '', is_active: true });
  };

  const handleSave = async () => {
    if (!formData.code.trim() || !formData.name.trim()) {
      notificationService.error('Code and name are required');
      return;
    }

    setIsSaving(true);
    try {
      const url = editingCategory
        ? `/api/procurement/categories/${editingCategory.id}`
        : '/api/procurement/categories';
      const method = editingCategory ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await res.json();

      if (data.success) {
        notificationService.success(editingCategory ? 'Category updated' : 'Category created');
        closeModal();
        fetchCategories();
      } else {
        notificationService.error(data.error?.message || 'Failed to save category');
      }
    } catch (err) {
      notificationService.error('Failed to save category');
      log.error('Failed to save category', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (cat: StockCategory) => {
    if (!confirm(`Delete category "${cat.name}"? This cannot be undone.`)) return;

    try {
      const res = await fetch(`/api/procurement/categories/${cat.id}`, { method: 'DELETE' });
      const data = await res.json();

      if (data.success) {
        notificationService.success('Category deleted');
        fetchCategories();
      } else {
        notificationService.error(data.error?.message || 'Failed to delete category');
      }
    } catch (err) {
      notificationService.error('Failed to delete category');
      log.error('Failed to delete category', err);
    }
  };

  const filtered = categories.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.code.toLowerCase().includes(search.toLowerCase())
  );

  const totalCategories = categories.length;
  const activeCategories = categories.filter(c => c.is_active).length;
  const totalItems = categories.reduce((sum, c) => sum + Number(c.item_count || 0), 0);

  if (isLoading) return <LoadingState message="Loading categories..." />;

  return (
    <div className="space-y-6">
      <StatCardGrid columns={3}>
        <StatCard
          label="Total Categories"
          value={totalCategories}
          icon={FolderTree}
          colorType="info"
        />
        <StatCard
          label="Active"
          value={activeCategories}
          icon={FolderTree}
          colorType="success"
        />
        <StatCard
          label="Total Items"
          value={totalItems}
          icon={Box}
          colorType="value"
        />
      </StatCardGrid>

      <div className="flex items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
          <input
            type="text"
            placeholder="Search categories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)]"
          />
        </div>
        <button
          onClick={openNewModal}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Category
        </button>
      </div>

      <div className="grid gap-3">
        {filtered.map((cat) => (
          <div
            key={cat.id}
            className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:border-indigo-500/50 transition-colors cursor-pointer"
            onClick={() => openEditModal(cat)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FolderTree className="h-5 w-5 text-[var(--ff-text-tertiary)]" />
                <div>
                  <p className="font-medium text-[var(--ff-text-primary)]">{cat.name}</p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">{cat.code}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className={`px-2 py-1 rounded text-xs ${cat.is_active ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'}`}>
                  {cat.is_active ? 'Active' : 'Inactive'}
                </span>
                <span className="text-sm text-[var(--ff-text-secondary)]">{Number(cat.item_count || 0)} items</span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(cat); }}
                  className="p-1 text-[var(--ff-text-tertiary)] hover:text-red-400 transition-colors"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-[var(--ff-text-secondary)]">
            No categories found
          </div>
        )}
      </div>

      {/* Category Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={closeModal} />
          <div className="relative bg-[var(--ff-bg-secondary)] rounded-lg shadow-xl w-full max-w-md p-6 border border-[var(--ff-border-light)]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                {editingCategory ? 'Edit Category' : 'New Category'}
              </h2>
              <button onClick={closeModal} className="text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Code *</label>
                <input
                  type="text"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                  placeholder="e.g., ONT, CABLE"
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., ONT Devices"
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Optional description"
                  rows={3}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] resize-none"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="cat-is-active"
                  checked={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                  className="rounded border-[var(--ff-border-light)]"
                />
                <label htmlFor="cat-is-active" className="text-sm text-[var(--ff-text-secondary)]">Active</label>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : (editingCategory ? 'Update' : 'Create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Bundles Tab Content
function BundlesTabContent() {
  const [bundles, setBundles] = useState<StockBundle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showItemsModal, setShowItemsModal] = useState(false);
  const [selectedBundle, setSelectedBundle] = useState<StockBundle | null>(null);
  const [editingBundle, setEditingBundle] = useState<StockBundle | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    bundle_code: '',
    name: '',
    description: '',
    bundle_type: 'installation',
    is_active: true,
  });

  const openItemsModal = (bundle: StockBundle, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedBundle(bundle);
    setShowItemsModal(true);
  };

  const closeItemsModal = () => {
    setShowItemsModal(false);
    setSelectedBundle(null);
    fetchBundles(); // Refresh to get updated item counts
  };

  useEffect(() => {
    fetchBundles();
  }, []);

  const fetchBundles = async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/procurement/bundles');
      const data = await res.json();
      if (data.success) {
        setBundles(data.data || []);
      } else {
        notificationService.error(data.error?.message || 'Failed to load bundles');
      }
    } catch (err) {
      log.error('Failed to fetch bundles', err);
    } finally {
      setIsLoading(false);
    }
  };

  const openNewModal = () => {
    setEditingBundle(null);
    setFormData({ bundle_code: '', name: '', description: '', bundle_type: 'installation', is_active: true });
    setShowModal(true);
  };

  const openEditModal = (bundle: StockBundle) => {
    setEditingBundle(bundle);
    setFormData({
      bundle_code: bundle.bundle_code,
      name: bundle.name,
      description: bundle.description || '',
      bundle_type: bundle.bundle_type,
      is_active: bundle.is_active,
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingBundle(null);
  };

  const handleSave = async () => {
    if (!formData.bundle_code.trim() || !formData.name.trim()) {
      notificationService.error('Code and name are required');
      return;
    }

    setIsSaving(true);
    try {
      const url = editingBundle
        ? `/api/procurement/bundles/${editingBundle.id}`
        : '/api/procurement/bundles';
      const method = editingBundle ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await res.json();

      if (data.success) {
        notificationService.success(editingBundle ? 'Bundle updated' : 'Bundle created');
        closeModal();
        fetchBundles();
      } else {
        notificationService.error(data.error?.message || 'Failed to save bundle');
      }
    } catch (err) {
      notificationService.error('Failed to save bundle');
      log.error('Failed to save bundle', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (bundle: StockBundle) => {
    if (!confirm(`Delete bundle "${bundle.name}"? This cannot be undone.`)) return;

    try {
      const res = await fetch(`/api/procurement/bundles/${bundle.id}`, { method: 'DELETE' });
      const data = await res.json();

      if (data.success) {
        notificationService.success('Bundle deleted');
        fetchBundles();
      } else {
        notificationService.error(data.error?.message || 'Failed to delete bundle');
      }
    } catch (err) {
      notificationService.error('Failed to delete bundle');
      log.error('Failed to delete bundle', err);
    }
  };

  const filtered = bundles.filter(
    (b) =>
      b.name.toLowerCase().includes(search.toLowerCase()) ||
      b.bundle_code.toLowerCase().includes(search.toLowerCase())
  );

  const totalBundles = bundles.length;
  const activeBundles = bundles.filter(b => b.is_active).length;
  const totalValue = bundles.reduce((sum, b) => sum + Number(b.calculated_price || 0), 0);

  if (isLoading) return <LoadingState message="Loading bundles..." />;

  return (
    <div className="space-y-6">
      <StatCardGrid columns={3}>
        <StatCard
          label="Total Bundles"
          value={totalBundles}
          icon={PackagePlus}
          colorType="info"
        />
        <StatCard
          label="Active"
          value={activeBundles}
          icon={PackagePlus}
          colorType="success"
        />
        <StatCard
          label="Total Value"
          value={`R ${totalValue.toFixed(2)}`}
          icon={DollarSign}
          colorType="value"
        />
      </StatCardGrid>

      <div className="flex items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
          <input
            type="text"
            placeholder="Search bundles..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)]"
          />
        </div>
        <button
          onClick={openNewModal}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Bundle
        </button>
      </div>

      <div className="grid gap-3">
        {filtered.map((bundle) => (
          <div
            key={bundle.id}
            onClick={() => openEditModal(bundle)}
            className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:border-indigo-500/50 transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <PackagePlus className="h-5 w-5 text-[var(--ff-text-tertiary)]" />
                <div>
                  <p className="font-medium text-[var(--ff-text-primary)]">{bundle.name}</p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">{bundle.bundle_code} • {bundle.bundle_type}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className={`px-2 py-1 rounded text-xs ${bundle.is_active ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'}`}>
                  {bundle.is_active ? 'Active' : 'Inactive'}
                </span>
                <span className="text-sm text-[var(--ff-text-secondary)]">{Number(bundle.item_count || 0)} items</span>
                <span className="font-medium text-[var(--ff-text-primary)]">R {Number(bundle.calculated_price || 0).toFixed(2)}</span>
                <button
                  onClick={(e) => openItemsModal(bundle, e)}
                  className="p-1 text-[var(--ff-text-tertiary)] hover:text-indigo-400 transition-colors"
                  title="Manage Items"
                >
                  <Settings className="h-4 w-4" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(bundle); }}
                  className="p-1 text-[var(--ff-text-tertiary)] hover:text-red-400 transition-colors"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-[var(--ff-text-secondary)]">
            No bundles found
          </div>
        )}
      </div>

      {/* Bundle Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={closeModal} />
          <div className="relative bg-[var(--ff-bg-secondary)] rounded-lg shadow-xl w-full max-w-md p-6 border border-[var(--ff-border-light)]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                {editingBundle ? 'Edit Bundle' : 'New Bundle'}
              </h2>
              <button onClick={closeModal} className="text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Code *</label>
                <input
                  type="text"
                  value={formData.bundle_code}
                  onChange={(e) => setFormData({ ...formData, bundle_code: e.target.value.toUpperCase() })}
                  placeholder="e.g., INST-FTTH"
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., FTTH Installation Kit"
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Bundle Type</label>
                <select
                  value={formData.bundle_type}
                  onChange={(e) => setFormData({ ...formData, bundle_type: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)]"
                >
                  <option value="installation">Installation</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="repair">Repair</option>
                  <option value="project">Project</option>
                  <option value="custom">Custom</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Optional description"
                  rows={3}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] resize-none"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="bundle-is-active"
                  checked={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                  className="rounded border-[var(--ff-border-light)]"
                />
                <label htmlFor="bundle-is-active" className="text-sm text-[var(--ff-text-secondary)]">Active</label>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : (editingBundle ? 'Update' : 'Create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bundle Items Modal */}
      {showItemsModal && selectedBundle && (
        <BundleItemsModal
          bundle={selectedBundle}
          isOpen={showItemsModal}
          onClose={closeItemsModal}
          onSave={fetchBundles}
        />
      )}
    </div>
  );
}

// Stock Takes Tab Content
function StockTakesTabContent() {
  const [stockTakes, setStockTakes] = useState<StockTake[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    stock_take_type: 'full',
    notes: '',
  });

  useEffect(() => {
    fetchStockTakes();
  }, []);

  const fetchStockTakes = async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/procurement/stock-takes');
      const data = await res.json();
      if (data.success) {
        setStockTakes(data.data || []);
      }
    } catch (err) {
      log.error('Failed to fetch stock takes', err);
    } finally {
      setIsLoading(false);
    }
  };

  const openNewModal = () => {
    setFormData({ stock_take_type: 'full', notes: '' });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
  };

  const handleCreate = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/procurement/stock-takes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await res.json();

      if (data.success) {
        notificationService.success('Stock take created');
        closeModal();
        fetchStockTakes();
      } else {
        notificationService.error(data.error?.message || 'Failed to create stock take');
      }
    } catch (err) {
      notificationService.error('Failed to create stock take');
      log.error('Failed to create stock take', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (take: StockTake) => {
    if (take.status !== 'draft') {
      notificationService.error('Only draft stock takes can be deleted');
      return;
    }
    if (!confirm(`Delete stock take "${take.reference_number}"? This cannot be undone.`)) return;

    try {
      const res = await fetch(`/api/procurement/stock-takes/${take.id}`, { method: 'DELETE' });
      const data = await res.json();

      if (data.success) {
        notificationService.success('Stock take deleted');
        fetchStockTakes();
      } else {
        notificationService.error(data.error?.message || 'Failed to delete stock take');
      }
    } catch (err) {
      notificationService.error('Failed to delete stock take');
      log.error('Failed to delete stock take', err);
    }
  };

  const filtered = stockTakes.filter(
    (st) => st.reference_number.toLowerCase().includes(search.toLowerCase())
  );

  const totalTakes = stockTakes.length;
  const inProgress = stockTakes.filter(st => st.status === 'in_progress').length;
  const totalVariance = stockTakes.reduce((sum, st) => sum + Math.abs(st.calc_variance_value || st.total_variance_value || 0), 0);

  if (isLoading) return <LoadingState message="Loading stock takes..." />;

  return (
    <div className="space-y-6">
      <StatCardGrid columns={3}>
        <StatCard
          label="Total Takes"
          value={totalTakes}
          icon={ClipboardCheck}
          colorType="info"
        />
        <StatCard
          label="In Progress"
          value={inProgress}
          icon={ClipboardCheck}
          colorType="pending"
        />
        <StatCard
          label="Total Variance"
          value={`R ${totalVariance.toLocaleString()}`}
          icon={AlertTriangle}
          colorType="error"
        />
      </StatCardGrid>

      <div className="flex items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
          <input
            type="text"
            placeholder="Search stock takes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)]"
          />
        </div>
        <button
          onClick={openNewModal}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Stock Take
        </button>
      </div>

      <div className="grid gap-3">
        {filtered.map((take) => (
          <div
            key={take.id}
            className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:border-indigo-500/50 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ClipboardCheck className="h-5 w-5 text-[var(--ff-text-tertiary)]" />
                <div>
                  <p className="font-medium text-[var(--ff-text-primary)]">{take.reference_number}</p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">{take.stock_take_type}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className={`px-2 py-1 rounded text-xs ${statusColors[take.status] || 'bg-gray-500/20 text-gray-400'}`}>
                  {take.status.replace('_', ' ')}
                </span>
                <span className="text-sm text-[var(--ff-text-secondary)]">{Number(take.item_count || 0)} items</span>
                {take.status === 'draft' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(take); }}
                    className="p-1 text-[var(--ff-text-tertiary)] hover:text-red-400 transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <ChevronRight className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-[var(--ff-text-secondary)]">
            No stock takes found
          </div>
        )}
      </div>

      {/* Stock Take Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={closeModal} />
          <div className="relative bg-[var(--ff-bg-secondary)] rounded-lg shadow-xl w-full max-w-md p-6 border border-[var(--ff-border-light)]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">New Stock Take</h2>
              <button onClick={closeModal} className="text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Stock Take Type</label>
                <select
                  value={formData.stock_take_type}
                  onChange={(e) => setFormData({ ...formData, stock_take_type: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)]"
                >
                  <option value="full">Full Stock Take</option>
                  <option value="partial">Partial Stock Take</option>
                  <option value="cycle">Cycle Count</option>
                  <option value="spot">Spot Check</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Optional notes about this stock take"
                  rows={3}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] resize-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={isSaving}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {isSaving ? 'Creating...' : 'Create Stock Take'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Bundle Reports Tab Content
interface ReportData {
  summary: Record<string, number>;
  data: any[];
  byType?: Record<string, any>;
  byProject?: Record<string, any>;
  byCategory?: Record<string, any>;
}

type ReportType = 'usage' | 'cost-analysis' | 'consumption' | 'inventory-value';

function BundleReportsTabContent() {
  const [reportType, setReportType] = useState<ReportType>('usage');
  const [isLoading, setIsLoading] = useState(false);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [projectId, setProjectId] = useState('');
  const [bundleType, setBundleType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [projects, setProjects] = useState<{ id: string; project_name: string }[]>([]);

  // Fetch projects for filter dropdown
  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const res = await fetch('/api/projects');
        const data = await res.json();
        if (data.success) {
          setProjects(data.data || []);
        }
      } catch (err) {
        log.error('Failed to fetch projects', err);
      }
    };
    fetchProjects();
  }, []);

  const fetchReport = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (projectId) params.append('projectId', projectId);
      if (bundleType) params.append('bundleType', bundleType);
      if (dateFrom) params.append('dateFrom', dateFrom);
      if (dateTo) params.append('dateTo', dateTo);

      const url = `/api/procurement/bundles/reports/${reportType}?${params.toString()}`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.success) {
        setReportData(data.data);
      } else {
        notificationService.error(data.error?.message || 'Failed to load report');
        setReportData(null);
      }
    } catch (err) {
      log.error('Failed to fetch report', err);
      notificationService.error('Failed to load report');
      setReportData(null);
    } finally {
      setIsLoading(false);
    }
  }, [reportType, projectId, bundleType, dateFrom, dateTo]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const reportTabs = [
    { id: 'usage' as const, label: 'Bundle Usage', icon: TrendingUp },
    { id: 'cost-analysis' as const, label: 'Cost Analysis', icon: DollarSign },
    { id: 'consumption' as const, label: 'Item Consumption', icon: Boxes },
    { id: 'inventory-value' as const, label: 'Inventory Value', icon: Warehouse },
  ];

  const exportReport = () => {
    if (!reportData?.data?.length) {
      notificationService.error('No data to export');
      return;
    }

    // Convert to CSV
    const headers = Object.keys(reportData.data[0]);
    const csvContent = [
      headers.join(','),
      ...reportData.data.map(row =>
        headers.map(h => {
          const val = row[h];
          return typeof val === 'string' && val.includes(',') ? `"${val}"` : val;
        }).join(',')
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bundle-${reportType}-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    notificationService.success('Report exported');
  };

  return (
    <div className="space-y-6">
      {/* Report Type Tabs */}
      <div className="flex gap-2 flex-wrap">
        {reportTabs.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setReportType(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                reportType === tab.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-secondary)]'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4 p-4 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
        <div>
          <label className="block text-xs text-[var(--ff-text-tertiary)] mb-1">Project</label>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)]"
          >
            <option value="">All Projects</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.project_name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-[var(--ff-text-tertiary)] mb-1">Bundle Type</label>
          <select
            value={bundleType}
            onChange={(e) => setBundleType(e.target.value)}
            className="px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)]"
          >
            <option value="">All Types</option>
            <option value="installation">Installation</option>
            <option value="maintenance">Maintenance</option>
            <option value="repair">Repair</option>
            <option value="project">Project</option>
            <option value="custom">Custom</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-[var(--ff-text-tertiary)] mb-1">From Date</label>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="pl-10 pr-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)]"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-[var(--ff-text-tertiary)] mb-1">To Date</label>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="pl-10 pr-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-sm text-[var(--ff-text-primary)]"
            />
          </div>
        </div>

        <button
          onClick={fetchReport}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm transition-colors"
        >
          <Filter className="h-4 w-4" />
          Apply Filters
        </button>

        <button
          onClick={exportReport}
          disabled={!reportData?.data?.length}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      {/* Summary Stats */}
      {reportData?.summary && (
        <StatCardGrid columns={4}>
          {Object.entries(reportData.summary).map(([key, value]) => (
            <StatCard
              key={key}
              label={key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
              value={typeof value === 'number' && key.toLowerCase().includes('value')
                ? `R ${value.toLocaleString()}`
                : value.toLocaleString()
              }
              icon={BarChart3}
              colorType="info"
            />
          ))}
        </StatCardGrid>
      )}

      {/* Report Data */}
      {isLoading ? (
        <LoadingState message="Loading report..." />
      ) : reportData?.data?.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--ff-bg-tertiary)]">
              <tr>
                {Object.keys(reportData.data[0]).map(key => (
                  <th
                    key={key}
                    className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide"
                  >
                    {key.replace(/_/g, ' ')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ff-border-light)]">
              {reportData.data.map((row, idx) => (
                <tr key={idx} className="hover:bg-[var(--ff-bg-secondary)]">
                  {Object.entries(row).map(([key, value], cidx) => (
                    <td key={cidx} className="px-4 py-3 text-[var(--ff-text-primary)]">
                      {typeof value === 'number'
                        ? key.toLowerCase().includes('cost') || key.toLowerCase().includes('value') || key.toLowerCase().includes('price') || key.toLowerCase().includes('revenue')
                          ? `R ${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : value.toLocaleString()
                        : value instanceof Date
                          ? value.toISOString().split('T')[0]
                          : String(value || '-')
                      }
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-12 text-[var(--ff-text-secondary)]">
          <BarChart3 className="h-12 w-12 mx-auto mb-3 text-[var(--ff-text-tertiary)]" />
          <p>No data available for the selected filters</p>
          <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">
            Try adjusting your filters or check if bundles have been used
          </p>
        </div>
      )}
    </div>
  );
}

export default function InventoryPage({ projectId }: InventoryPageProps) {
  const { activeTab, changeTab, isInitialized } = useTabPersistence({
    pageKey: 'inventory',
    defaultTab: 'stock',
    validTabs: TABS.map(t => t.id),
  });

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Module Header - Constant Position */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10">
                <Warehouse className="h-6 w-6 text-purple-500" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Procurement</h1>
                <p className="text-sm text-[var(--ff-text-secondary)]">
                  Manage procurement across all projects
                </p>
              </div>
            </div>
          </div>

          {/* Main Category Tab Navigation - Constant Position */}
          <div className="px-6 border-t border-[var(--ff-border-light)]">
            <ProcurementTabs activeTab="inventory" categoriesOnly />
          </div>
        </div>

        {/* Sub-page Header with Sub-tabs */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-3">
            <div className="flex items-center gap-2">
              <Warehouse className="h-5 w-5 text-indigo-500" />
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Inventory</h2>
            </div>
          </div>

          {/* Sub-tabs */}
          <div className="px-6">
            <nav className="flex gap-1" aria-label="Inventory tabs">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => changeTab(tab.id)}
                    className={`
                      flex items-center gap-2 px-4 py-3 text-sm font-medium
                      border-b-2 transition-colors
                      ${isActive
                        ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                        : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-secondary)]'
                      }
                    `}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {!isInitialized ? (
            <LoadingState message="Loading..." />
          ) : (
            <>
              {activeTab === 'stock' && <StockManagement />}
              {activeTab === 'items' && <StockItemsPage />}
              {activeTab === 'categories' && <CategoriesTabContent />}
              {activeTab === 'bundles' && <BundlesTabContent />}
              {activeTab === 'takes' && <StockTakesTabContent />}
              {activeTab === 'field' && <FieldStockDashboard />}
              {activeTab === 'reports' && <BundleReportsTabContent />}
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { query } = context;
  const projectId = query.projectId as string | undefined;

  return {
    props: {
      projectId: projectId || null,
    },
  };
};
