/**
 * Stock Categories Management Page
 * Manage hierarchical categories for stock items
 * Following UI/UX Specification - Dark Theme
 */

import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout';
import { StatCard, StatCardGrid } from '@/components/ui/StatCard';
import {
  Layers,
  Plus,
  Search,
  Edit2,
  Trash2,
  ChevronRight,
  ChevronDown,
  Package,
  X,
  Save,
  FolderTree,
  AlertCircle,
} from 'lucide-react';
import type {
  StockCategory,
  StockCategoryFormData,
} from '@/types/procurement/category.types';
import {
  CATEGORY_ICONS,
  CATEGORY_COLORS,
  TRACKING_TYPES,
  UNITS_OF_MEASURE,
} from '@/types/procurement/category.types';
import toast from 'react-hot-toast';

export default function StockCategoriesPage() {
  const [categories, setCategories] = useState<StockCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showOnlyActive, setShowOnlyActive] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<StockCategory | null>(null);

  // Stats
  const totalCategories = categories.length;
  const activeCategories = categories.filter(c => c.is_active).length;
  const rootCategories = categories.filter(c => !c.parent_id).length;
  const totalItems = categories.reduce((sum, c) => sum + (c.item_count || 0), 0);

  const fetchCategories = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (showOnlyActive) params.set('is_active', 'true');

      const res = await fetch(`/api/procurement/categories?${params}`);
      const data = await res.json();

      if (data.success) {
        setCategories(data.data);
        // Auto-expand root categories
        const roots = data.data
          .filter((c: StockCategory) => !c.parent_id)
          .map((c: StockCategory) => c.id);
        setExpandedIds(new Set(roots));
      } else {
        toast.error(data.error || 'Failed to load categories');
      }
    } catch (error) {
      console.error('Error fetching categories:', error);
      toast.error('Failed to load categories');
    } finally {
      setIsLoading(false);
    }
  }, [search, showOnlyActive]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleEdit = (category: StockCategory) => {
    setEditingCategory(category);
    setShowModal(true);
  };

  const handleDelete = async (category: StockCategory) => {
    if (category.is_system) {
      toast.error('Cannot delete system category');
      return;
    }

    if (!confirm(`Delete category "${category.name}"?`)) return;

    try {
      const res = await fetch(`/api/procurement/categories/${category.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();

      if (data.success) {
        toast.success('Category deleted');
        fetchCategories();
      } else {
        toast.error(data.error || 'Failed to delete category');
      }
    } catch (error) {
      console.error('Error deleting category:', error);
      toast.error('Failed to delete category');
    }
  };

  const handleSave = async (formData: StockCategoryFormData) => {
    try {
      const isEdit = !!editingCategory;
      const url = isEdit
        ? `/api/procurement/categories/${editingCategory.id}`
        : '/api/procurement/categories';

      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await res.json();

      if (data.success) {
        toast.success(isEdit ? 'Category updated' : 'Category created');
        setShowModal(false);
        setEditingCategory(null);
        fetchCategories();
      } else {
        toast.error(data.error || 'Failed to save category');
      }
    } catch (error) {
      console.error('Error saving category:', error);
      toast.error('Failed to save category');
    }
  };

  // Build tree structure
  const rootCats = categories.filter(c => !c.parent_id);
  const getChildren = (parentId: string) =>
    categories.filter(c => c.parent_id === parentId);

  const renderCategory = (category: StockCategory, depth = 0) => {
    const children = getChildren(category.id);
    const hasChildren = children.length > 0;
    const isExpanded = expandedIds.has(category.id);
    const colorClass = CATEGORY_COLORS.find(c => c.value === category.color)?.class || 'bg-gray-500/20 text-gray-400';

    return (
      <div key={category.id}>
        <div
          className={`
            flex items-center gap-3 px-4 py-3 hover:bg-gray-800/50 transition-colors
            border-b border-gray-700/50
          `}
          style={{ paddingLeft: `${16 + depth * 24}px` }}
        >
          {/* Expand/Collapse */}
          <button
            onClick={() => toggleExpand(category.id)}
            className={`w-5 h-5 flex items-center justify-center text-gray-400 hover:text-white ${!hasChildren ? 'invisible' : ''}`}
          >
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>

          {/* Icon */}
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colorClass}`}>
            <Package className="w-4 h-4" />
          </div>

          {/* Name & Code */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-white font-medium">{category.name}</span>
              <span className="text-xs text-gray-500 font-mono">{category.code}</span>
              {category.is_system && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-blue-500/20 text-blue-400">
                  SYSTEM
                </span>
              )}
              {!category.is_active && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-red-500/20 text-red-400">
                  INACTIVE
                </span>
              )}
            </div>
            {category.description && (
              <p className="text-xs text-gray-500 truncate">{category.description}</p>
            )}
          </div>

          {/* Tracking Type */}
          <span className="text-xs text-gray-400 w-20 text-center">
            {category.default_tracking_type}
          </span>

          {/* UOM */}
          <span className="text-xs text-gray-400 w-12 text-center">
            {category.default_uom}
          </span>

          {/* Item Count */}
          <span className="text-sm text-gray-300 w-16 text-right">
            {category.item_count || 0} items
          </span>

          {/* Actions */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => handleEdit(category)}
              className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700/50 rounded"
              title="Edit"
            >
              <Edit2 className="w-4 h-4" />
            </button>
            {!category.is_system && (
              <button
                onClick={() => handleDelete(category)}
                className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded"
                title="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Children */}
        {isExpanded && hasChildren && (
          <div>
            {children.map(child => renderCategory(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Stock Categories</h1>
            <p className="text-gray-400 text-sm mt-1">
              Manage hierarchical categories for stock items
            </p>
          </div>
          <button
            onClick={() => {
              setEditingCategory(null);
              setShowModal(true);
            }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg flex items-center gap-2 transition-colors"
          >
            <Plus className="w-5 h-5" />
            Add Category
          </button>
        </div>

        {/* Stats */}
        <StatCardGrid columns={4}>
          <StatCard
            label="Total Categories"
            value={totalCategories}
            icon={Layers}
            colorType="total"
          />
          <StatCard
            label="Active Categories"
            value={activeCategories}
            icon={FolderTree}
            colorType="success"
          />
          <StatCard
            label="Root Categories"
            value={rootCategories}
            icon={Layers}
            colorType="info"
          />
          <StatCard
            label="Total Stock Items"
            value={totalItems}
            icon={Package}
            colorType="financial"
          />
        </StatCardGrid>

        {/* Filters */}
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search categories..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>
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

        {/* Categories List */}
        <div className="bg-[#1a1d23] rounded-lg border border-gray-700/50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 bg-gray-800/30 border-b border-gray-700">
            <div className="w-5" /> {/* Spacer for expand button */}
            <div className="w-8" /> {/* Spacer for icon */}
            <div className="flex-1 text-xs font-medium text-gray-400 uppercase tracking-wider">
              Category
            </div>
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wider w-20 text-center">
              Tracking
            </div>
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wider w-12 text-center">
              UOM
            </div>
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wider w-16 text-right">
              Items
            </div>
            <div className="w-20" /> {/* Actions */}
          </div>

          {/* Categories */}
          {isLoading ? (
            <div className="p-8 text-center text-gray-400">Loading...</div>
          ) : rootCats.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No categories found</p>
            </div>
          ) : (
            <div>
              {rootCats.map(cat => renderCategory(cat))}
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <CategoryModal
          category={editingCategory}
          categories={categories}
          onSave={handleSave}
          onClose={() => {
            setShowModal(false);
            setEditingCategory(null);
          }}
        />
      )}
    </AppLayout>
  );
}

// Category Edit/Create Modal
interface CategoryModalProps {
  category: StockCategory | null;
  categories: StockCategory[];
  onSave: (data: StockCategoryFormData) => void;
  onClose: () => void;
}

function CategoryModal({ category, categories, onSave, onClose }: CategoryModalProps) {
  const [formData, setFormData] = useState<StockCategoryFormData>({
    code: category?.code || '',
    name: category?.name || '',
    description: category?.description || '',
    parent_id: category?.parent_id || '',
    icon: category?.icon || '',
    color: category?.color || 'blue',
    sort_order: category?.sort_order || 0,
    default_tracking_type: category?.default_tracking_type || 'quantity',
    default_uom: category?.default_uom || 'EA',
    is_active: category?.is_active !== false,
  });

  const isEdit = !!category;
  const isSystem = category?.is_system;

  // Filter out current category and its descendants from parent options
  const parentOptions = categories.filter(c => {
    if (!category) return true;
    if (c.id === category.id) return false;
    if (c.path?.includes(category.code)) return false;
    return true;
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-[#1e2128] rounded-xl border border-gray-700 shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">
            {isEdit ? 'Edit Category' : 'New Category'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Code */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Code *
            </label>
            <input
              type="text"
              value={formData.code}
              onChange={(e) => setFormData(prev => ({ ...prev, code: e.target.value.toUpperCase() }))}
              disabled={isSystem}
              placeholder="e.g., CABLES"
              className="w-full px-3 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none disabled:opacity-50"
              required
            />
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="e.g., Fiber Cables"
              className="w-full px-3 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Optional description..."
              rows={2}
              className="w-full px-3 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-none"
            />
          </div>

          {/* Parent Category */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Parent Category
            </label>
            <select
              value={formData.parent_id || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, parent_id: e.target.value || undefined }))}
              className="w-full px-3 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            >
              <option value="">None (Root Category)</option>
              {parentOptions.map(cat => (
                <option key={cat.id} value={cat.id}>
                  {'—'.repeat(cat.level - 1)} {cat.name}
                </option>
              ))}
            </select>
          </div>

          {/* Color & Sort Order */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Color
              </label>
              <select
                value={formData.color}
                onChange={(e) => setFormData(prev => ({ ...prev, color: e.target.value }))}
                className="w-full px-3 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              >
                {CATEGORY_COLORS.map(color => (
                  <option key={color.value} value={color.value}>
                    {color.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Sort Order
              </label>
              <input
                type="number"
                value={formData.sort_order}
                onChange={(e) => setFormData(prev => ({ ...prev, sort_order: parseInt(e.target.value) || 0 }))}
                className="w-full px-3 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>

          {/* Tracking Type & UOM */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Default Tracking
              </label>
              <select
                value={formData.default_tracking_type}
                onChange={(e) => setFormData(prev => ({ ...prev, default_tracking_type: e.target.value as 'serial' | 'lot' | 'quantity' }))}
                className="w-full px-3 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              >
                {TRACKING_TYPES.map(t => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Default UOM
              </label>
              <select
                value={formData.default_uom}
                onChange={(e) => setFormData(prev => ({ ...prev, default_uom: e.target.value }))}
                className="w-full px-3 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              >
                {UNITS_OF_MEASURE.map(u => (
                  <option key={u.value} value={u.value}>
                    {u.label} ({u.value})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Active */}
          <div>
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={formData.is_active}
                onChange={(e) => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
                className="rounded border-gray-600 bg-[#1a1d23] text-blue-500 focus:ring-blue-500"
              />
              Active
            </label>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
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
              {isEdit ? 'Save Changes' : 'Create Category'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
