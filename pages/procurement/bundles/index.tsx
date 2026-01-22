/**
 * Stock Bundles Management Page
 * Create and manage bundles/kits of stock items
 * Following UI/UX Specification - Dark Theme
 */

import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout';
import { StatCard, StatCardGrid } from '@/components/ui/StatCard';
import {
  Package,
  Plus,
  Search,
  Edit2,
  Trash2,
  Eye,
  PackagePlus,
  Box,
  DollarSign,
  TrendingUp,
  X,
  Save,
  AlertCircle,
  ChevronRight,
} from 'lucide-react';
import type {
  StockBundle,
  StockBundleItem,
  StockBundleFormData,
  StockBundleItemFormData,
} from '@/types/procurement/bundle.types';
import { BUNDLE_TYPES, PRICE_TYPES } from '@/types/procurement/bundle.types';
import type { StockCategory } from '@/types/procurement/category.types';
import { notificationService } from '@/services/core/NotificationService';

interface StockItem {
  id: string;
  item_code: string;
  name: string;
  category: string;
  standard_cost: number;
  uom: string;
}

export default function BundlesPage() {
  const [bundles, setBundles] = useState<StockBundle[]>([]);
  const [categories, setCategories] = useState<StockCategory[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [showOnlyActive, setShowOnlyActive] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [editingBundle, setEditingBundle] = useState<StockBundle | null>(null);
  const [viewingBundle, setViewingBundle] = useState<(StockBundle & { items: StockBundleItem[] }) | null>(null);

  // Stats
  const totalBundles = bundles.length;
  const activeBundles = bundles.filter(b => b.is_active).length;
  const totalItems = bundles.reduce((sum, b) => sum + (b.item_count || 0), 0);
  const totalValue = bundles.reduce((sum, b) => sum + (b.effective_price || 0), 0);

  const fetchBundles = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (filterType) params.set('bundle_type', filterType);
      if (showOnlyActive) params.set('is_active', 'true');

      const res = await fetch(`/api/procurement/bundles?${params}`);
      const data = await res.json();

      if (data.success) {
        setBundles(data.data);
      } else {
        notificationService.error(data.error || 'Failed to load bundles');
      }
    } catch (error) {
      console.error('Error fetching bundles:', error);
      notificationService.error('Failed to load bundles');
    } finally {
      setIsLoading(false);
    }
  }, [search, filterType, showOnlyActive]);

  const fetchCategories = async () => {
    try {
      const res = await fetch('/api/procurement/categories?is_active=true');
      const data = await res.json();
      if (data.success) setCategories(data.data);
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };

  const fetchStockItems = async () => {
    try {
      const res = await fetch('/api/procurement/stock-items?is_active=true');
      const data = await res.json();
      if (data.success) setStockItems(data.data);
    } catch (error) {
      console.error('Error fetching stock items:', error);
    }
  };

  useEffect(() => {
    fetchBundles();
    fetchCategories();
    fetchStockItems();
  }, [fetchBundles]);

  const handleView = async (bundle: StockBundle) => {
    try {
      const res = await fetch(`/api/procurement/bundles/${bundle.id}`);
      const data = await res.json();
      if (data.success) {
        setViewingBundle(data.data);
        setShowDetailModal(true);
      } else {
        notificationService.error(data.error || 'Failed to load bundle details');
      }
    } catch (error) {
      console.error('Error fetching bundle:', error);
      notificationService.error('Failed to load bundle details');
    }
  };

  const handleEdit = (bundle: StockBundle) => {
    setEditingBundle(bundle);
    setShowModal(true);
  };

  const handleDelete = async (bundle: StockBundle) => {
    if (bundle.usage_count > 0) {
      notificationService.error(`Bundle has been used ${bundle.usage_count} times. Consider deactivating instead.`);
      return;
    }

    if (!confirm(`Delete bundle "${bundle.name}"?`)) return;

    try {
      const res = await fetch(`/api/procurement/bundles/${bundle.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();

      if (data.success) {
        notificationService.success('Bundle deleted');
        fetchBundles();
      } else {
        notificationService.error(data.error || 'Failed to delete bundle');
      }
    } catch (error) {
      console.error('Error deleting bundle:', error);
      notificationService.error('Failed to delete bundle');
    }
  };

  const handleSave = async (formData: StockBundleFormData, items: StockBundleItemFormData[]) => {
    try {
      const isEdit = !!editingBundle;
      const bundleUrl = isEdit
        ? `/api/procurement/bundles/${editingBundle.id}`
        : '/api/procurement/bundles';

      // Save bundle
      const bundleRes = await fetch(bundleUrl, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const bundleData = await bundleRes.json();

      if (!bundleData.success) {
        notificationService.error(bundleData.error || 'Failed to save bundle');
        return;
      }

      const bundleId = bundleData.data.id;

      // Save items (bulk update)
      if (items.length > 0) {
        const itemsRes = await fetch(`/api/procurement/bundles/${bundleId}/items`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items }),
        });
        const itemsData = await itemsRes.json();

        if (!itemsData.success) {
          notificationService.error(itemsData.error || 'Failed to save bundle items');
          return;
        }
      }

      notificationService.success(isEdit ? 'Bundle updated' : 'Bundle created');
      setShowModal(false);
      setEditingBundle(null);
      fetchBundles();
    } catch (error) {
      console.error('Error saving bundle:', error);
      notificationService.error('Failed to save bundle');
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
    }).format(value);
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Bundles / Kits</h1>
            <p className="text-gray-400 text-sm mt-1">
              Create and manage stock item bundles for common installations
            </p>
          </div>
          <button
            onClick={() => {
              setEditingBundle(null);
              setShowModal(true);
            }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg flex items-center gap-2 transition-colors"
          >
            <Plus className="w-5 h-5" />
            New Bundle
          </button>
        </div>

        {/* Stats */}
        <StatCardGrid columns={4}>
          <StatCard
            label="Total Bundles"
            value={totalBundles}
            icon={PackagePlus}
            colorType="total"
          />
          <StatCard
            label="Active Bundles"
            value={activeBundles}
            icon={Package}
            colorType="success"
          />
          <StatCard
            label="Total Items"
            value={totalItems}
            icon={Box}
            colorType="info"
          />
          <StatCard
            label="Total Value"
            value={formatCurrency(totalValue)}
            icon={DollarSign}
            colorType="financial"
          />
        </StatCardGrid>

        {/* Filters */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search bundles..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          >
            <option value="">All Types</option>
            {BUNDLE_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={showOnlyActive}
              onChange={(e) => setShowOnlyActive(e.target.checked)}
              className="rounded border-gray-600 bg-[#1a1d23] text-blue-500 focus:ring-blue-500"
            />
            Active only
          </label>
        </div>

        {/* Bundles Grid */}
        {isLoading ? (
          <div className="p-8 text-center text-gray-400">Loading...</div>
        ) : bundles.length === 0 ? (
          <div className="bg-[#1a1d23] rounded-lg border border-gray-700/50 p-8 text-center">
            <AlertCircle className="w-12 h-12 mx-auto mb-4 text-gray-500" />
            <p className="text-gray-400">No bundles found</p>
            <button
              onClick={() => {
                setEditingBundle(null);
                setShowModal(true);
              }}
              className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg inline-flex items-center gap-2 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create First Bundle
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {bundles.map(bundle => (
              <BundleCard
                key={bundle.id}
                bundle={bundle}
                onView={handleView}
                onEdit={handleEdit}
                onDelete={handleDelete}
                formatCurrency={formatCurrency}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <BundleModal
          bundle={editingBundle}
          categories={categories}
          stockItems={stockItems}
          onSave={handleSave}
          onClose={() => {
            setShowModal(false);
            setEditingBundle(null);
          }}
        />
      )}

      {/* Detail Modal */}
      {showDetailModal && viewingBundle && (
        <BundleDetailModal
          bundle={viewingBundle}
          onClose={() => {
            setShowDetailModal(false);
            setViewingBundle(null);
          }}
          onEdit={() => {
            setShowDetailModal(false);
            setEditingBundle(viewingBundle);
            setShowModal(true);
          }}
          formatCurrency={formatCurrency}
        />
      )}
    </AppLayout>
  );
}

// Bundle Card Component
interface BundleCardProps {
  bundle: StockBundle;
  onView: (bundle: StockBundle) => void;
  onEdit: (bundle: StockBundle) => void;
  onDelete: (bundle: StockBundle) => void;
  formatCurrency: (value: number) => string;
}

function BundleCard({ bundle, onView, onEdit, onDelete, formatCurrency }: BundleCardProps) {
  const typeLabel = BUNDLE_TYPES.find(t => t.value === bundle.bundle_type)?.label || bundle.bundle_type;

  return (
    <div className="bg-[#1a1d23] rounded-lg border border-gray-700/50 overflow-hidden hover:border-gray-600 transition-colors">
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-white font-medium">{bundle.name}</h3>
            <p className="text-xs text-gray-500 font-mono">{bundle.bundle_code}</p>
          </div>
          <div className="flex items-center gap-1">
            <span className={`px-2 py-0.5 text-xs font-medium rounded ${
              bundle.is_active
                ? 'bg-green-500/20 text-green-400'
                : 'bg-red-500/20 text-red-400'
            }`}>
              {bundle.is_active ? 'Active' : 'Inactive'}
            </span>
            {bundle.is_default && (
              <span className="px-2 py-0.5 text-xs font-medium rounded bg-blue-500/20 text-blue-400">
                Default
              </span>
            )}
          </div>
        </div>

        {/* Description */}
        {bundle.description && (
          <p className="text-sm text-gray-400 mb-3 line-clamp-2">{bundle.description}</p>
        )}

        {/* Stats Row */}
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1 text-gray-400">
            <Box className="w-4 h-4" />
            <span>{bundle.item_count || 0} items</span>
          </div>
          <div className="flex items-center gap-1 text-gray-400">
            <TrendingUp className="w-4 h-4" />
            <span>{bundle.usage_count} uses</span>
          </div>
          <span className="px-2 py-0.5 text-xs rounded bg-gray-700 text-gray-300">
            {typeLabel}
          </span>
        </div>

        {/* Price */}
        <div className="mt-3 pt-3 border-t border-gray-700/50">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">
              {bundle.price_type === 'fixed' ? 'Fixed Price' :
               bundle.price_type === 'markup' ? `+${bundle.markup_percentage}% Markup` :
               'Calculated'}
            </span>
            <span className="text-lg font-semibold text-green-400">
              {formatCurrency(bundle.effective_price || 0)}
            </span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 py-3 bg-gray-800/30 border-t border-gray-700/50 flex items-center justify-end gap-2">
        <button
          onClick={() => onView(bundle)}
          className="p-2 text-gray-400 hover:text-white hover:bg-gray-700/50 rounded"
          title="View Details"
        >
          <Eye className="w-4 h-4" />
        </button>
        <button
          onClick={() => onEdit(bundle)}
          className="p-2 text-gray-400 hover:text-white hover:bg-gray-700/50 rounded"
          title="Edit"
        >
          <Edit2 className="w-4 h-4" />
        </button>
        <button
          onClick={() => onDelete(bundle)}
          className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded"
          title="Delete"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// Bundle Modal Component
interface BundleModalProps {
  bundle: StockBundle | null;
  categories: StockCategory[];
  stockItems: StockItem[];
  onSave: (data: StockBundleFormData, items: StockBundleItemFormData[]) => void;
  onClose: () => void;
}

function BundleModal({ bundle, categories, stockItems, onSave, onClose }: BundleModalProps) {
  const [formData, setFormData] = useState<StockBundleFormData>({
    bundle_code: bundle?.bundle_code || '',
    name: bundle?.name || '',
    description: bundle?.description || '',
    category_id: bundle?.category_id || '',
    bundle_type: bundle?.bundle_type || 'kit',
    price_type: bundle?.price_type || 'calculated',
    fixed_price: bundle?.fixed_price || undefined,
    markup_percentage: bundle?.markup_percentage || undefined,
    is_active: bundle?.is_active !== false,
    is_default: bundle?.is_default || false,
    allow_substitution: bundle?.allow_substitution || false,
    notes: bundle?.notes || '',
  });

  const [bundleItems, setBundleItems] = useState<StockBundleItemFormData[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(!!bundle);

  const isEdit = !!bundle;

  // Load existing items if editing
  useEffect(() => {
    if (bundle) {
      const loadItems = async () => {
        try {
          const res = await fetch(`/api/procurement/bundles/${bundle.id}/items`);
          const data = await res.json();
          if (data.success) {
            setBundleItems(data.data.map((item: StockBundleItem) => ({
              stock_item_id: item.stock_item_id,
              quantity: item.quantity,
              price_override: item.price_override,
              is_optional: item.is_optional,
              sort_order: item.sort_order,
            })));
          }
        } catch (error) {
          console.error('Error loading items:', error);
        } finally {
          setIsLoadingItems(false);
        }
      };
      loadItems();
    }
  }, [bundle]);

  const handleAddItem = (itemId: string) => {
    if (bundleItems.some(i => i.stock_item_id === itemId)) {
      notificationService.error('Item already in bundle');
      return;
    }
    setBundleItems(prev => [...prev, {
      stock_item_id: itemId,
      quantity: 1,
      sort_order: prev.length + 1,
    }]);
  };

  const handleRemoveItem = (itemId: string) => {
    setBundleItems(prev => prev.filter(i => i.stock_item_id !== itemId));
  };

  const handleItemQuantityChange = (itemId: string, quantity: number) => {
    setBundleItems(prev => prev.map(i =>
      i.stock_item_id === itemId ? { ...i, quantity } : i
    ));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData, bundleItems);
  };

  // Calculate total price
  const calculatedTotal = bundleItems.reduce((sum, bi) => {
    const item = stockItems.find(si => si.id === bi.stock_item_id);
    return sum + (bi.quantity * (bi.price_override || item?.standard_cost || 0));
  }, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-[#1e2128] rounded-xl border border-gray-700 shadow-2xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between shrink-0">
          <h2 className="text-xl font-semibold text-white">
            {isEdit ? 'Edit Bundle' : 'New Bundle'}
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-6 grid grid-cols-2 gap-6">
            {/* Left Column - Bundle Details */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-gray-300 uppercase tracking-wider">Bundle Details</h3>

              {/* Code & Name */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Code *</label>
                  <input
                    type="text"
                    value={formData.bundle_code}
                    onChange={(e) => setFormData(prev => ({ ...prev, bundle_code: e.target.value.toUpperCase() }))}
                    placeholder="KIT-001"
                    className="w-full px-3 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Type</label>
                  <select
                    value={formData.bundle_type}
                    onChange={(e) => setFormData(prev => ({ ...prev, bundle_type: e.target.value as 'kit' | 'combo' | 'assembly' }))}
                    className="w-full px-3 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                  >
                    {BUNDLE_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Standard Installation Kit"
                  className="w-full px-3 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Bundle description..."
                  rows={2}
                  className="w-full px-3 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Category</label>
                <select
                  value={formData.category_id || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, category_id: e.target.value || undefined }))}
                  className="w-full px-3 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                >
                  <option value="">No Category</option>
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>

              {/* Pricing */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Pricing</label>
                  <select
                    value={formData.price_type}
                    onChange={(e) => setFormData(prev => ({ ...prev, price_type: e.target.value as 'calculated' | 'fixed' | 'markup' }))}
                    className="w-full px-3 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                  >
                    {PRICE_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                {formData.price_type === 'fixed' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">Fixed Price</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.fixed_price || ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, fixed_price: parseFloat(e.target.value) || undefined }))}
                      className="w-full px-3 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                    />
                  </div>
                )}
                {formData.price_type === 'markup' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">Markup %</label>
                    <input
                      type="number"
                      step="0.1"
                      value={formData.markup_percentage || ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, markup_percentage: parseFloat(e.target.value) || undefined }))}
                      className="w-full px-3 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                    />
                  </div>
                )}
              </div>

              {/* Flags */}
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
                    className="rounded border-gray-600 bg-[#1a1d23] text-blue-500 focus:ring-blue-500"
                  />
                  Active
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={formData.is_default}
                    onChange={(e) => setFormData(prev => ({ ...prev, is_default: e.target.checked }))}
                    className="rounded border-gray-600 bg-[#1a1d23] text-blue-500 focus:ring-blue-500"
                  />
                  Default
                </label>
              </div>
            </div>

            {/* Right Column - Bundle Items */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-gray-300 uppercase tracking-wider">Bundle Items</h3>

              {/* Add Item */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Add Item</label>
                <select
                  onChange={(e) => {
                    if (e.target.value) {
                      handleAddItem(e.target.value);
                      e.target.value = '';
                    }
                  }}
                  className="w-full px-3 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                >
                  <option value="">Select item to add...</option>
                  {stockItems
                    .filter(si => !bundleItems.some(bi => bi.stock_item_id === si.id))
                    .map(item => (
                      <option key={item.id} value={item.id}>
                        {item.item_code} - {item.name}
                      </option>
                    ))}
                </select>
              </div>

              {/* Items List */}
              <div className="bg-[#1a1d23] rounded-lg border border-gray-700/50 overflow-hidden max-h-64 overflow-y-auto">
                {isLoadingItems ? (
                  <div className="p-4 text-center text-gray-400">Loading items...</div>
                ) : bundleItems.length === 0 ? (
                  <div className="p-4 text-center text-gray-500">
                    No items added yet
                  </div>
                ) : (
                  <div>
                    {bundleItems.map((bi, idx) => {
                      const item = stockItems.find(si => si.id === bi.stock_item_id);
                      if (!item) return null;
                      const lineTotal = bi.quantity * (bi.price_override || item.standard_cost || 0);

                      return (
                        <div
                          key={bi.stock_item_id}
                          className="flex items-center gap-3 px-3 py-2 border-b border-gray-700/50 last:border-b-0"
                        >
                          <span className="text-gray-500 text-sm w-6">{idx + 1}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm truncate">{item.name}</p>
                            <p className="text-xs text-gray-500">{item.item_code}</p>
                          </div>
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={bi.quantity}
                            onChange={(e) => handleItemQuantityChange(bi.stock_item_id, parseFloat(e.target.value) || 1)}
                            className="w-20 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-white text-sm text-center"
                          />
                          <span className="text-xs text-gray-400 w-8">{item.uom}</span>
                          <span className="text-sm text-green-400 w-24 text-right">
                            R {lineTotal.toFixed(2)}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(bi.stock_item_id)}
                            className="p-1 text-gray-400 hover:text-red-400"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Total */}
              <div className="bg-gray-800/50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Calculated Total:</span>
                  <span className="text-xl font-semibold text-green-400">
                    R {calculatedTotal.toFixed(2)}
                  </span>
                </div>
                {formData.price_type === 'markup' && formData.markup_percentage && (
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-gray-400">With {formData.markup_percentage}% Markup:</span>
                    <span className="text-lg font-semibold text-green-400">
                      R {(calculatedTotal * (1 + formData.markup_percentage / 100)).toFixed(2)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="px-6 py-4 border-t border-gray-700 flex justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg flex items-center gap-2 transition-colors"
            >
              <Save className="w-4 h-4" />
              {isEdit ? 'Save Changes' : 'Create Bundle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Bundle Detail Modal
interface BundleDetailModalProps {
  bundle: StockBundle & { items: StockBundleItem[] };
  onClose: () => void;
  onEdit: () => void;
  formatCurrency: (value: number) => string;
}

function BundleDetailModal({ bundle, onClose, onEdit, formatCurrency }: BundleDetailModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-[#1e2128] rounded-xl border border-gray-700 shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-xl font-semibold text-white">{bundle.name}</h2>
            <p className="text-sm text-gray-500 font-mono">{bundle.bundle_code}</p>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Description */}
          {bundle.description && (
            <p className="text-gray-400">{bundle.description}</p>
          )}

          {/* Items Table */}
          <div>
            <h3 className="text-sm font-medium text-gray-300 uppercase tracking-wider mb-3">Items ({bundle.items.length})</h3>
            <div className="bg-[#1a1d23] rounded-lg border border-gray-700/50 overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-800/30 border-b border-gray-700">
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">Item</th>
                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-400 uppercase">Qty</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-400 uppercase">Unit Price</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-400 uppercase">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {bundle.items.map((item) => (
                    <tr key={item.id} className="border-b border-gray-700/50 last:border-b-0">
                      <td className="px-4 py-3">
                        <p className="text-white text-sm">{item.item_name}</p>
                        <p className="text-xs text-gray-500">{item.item_code}</p>
                      </td>
                      <td className="px-4 py-3 text-center text-gray-300">
                        {item.quantity} {item.effective_uom}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-300">
                        {formatCurrency(item.effective_cost || 0)}
                      </td>
                      <td className="px-4 py-3 text-right text-green-400 font-medium">
                        {formatCurrency(item.line_total || 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-800/30">
                    <td colSpan={3} className="px-4 py-3 text-right text-gray-400 font-medium">
                      Bundle Total:
                    </td>
                    <td className="px-4 py-3 text-right text-green-400 font-semibold text-lg">
                      {formatCurrency(bundle.effective_price || 0)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t border-gray-700 flex justify-end gap-3 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
          >
            Close
          </button>
          <button
            onClick={onEdit}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg flex items-center gap-2 transition-colors"
          >
            <Edit2 className="w-4 h-4" />
            Edit Bundle
          </button>
        </div>
      </div>
    </div>
  );
}
