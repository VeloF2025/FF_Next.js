/**
 * Asset Categories Page
 *
 * Manage asset categories with CRUD operations.
 */

import { useState, useCallback } from 'react';
import { notificationService } from '@/services/core/NotificationService';
import {
  FolderOpen,
  Plus,
  Edit,
  Trash2,
  CheckCircle,
  XCircle,
  Clock,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  useCategories,
  useCategoryTypes,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
} from '@/modules/assets/hooks';
import type { AssetCategory } from '@/modules/assets/types/asset';

interface CategoryFormData {
  name: string;
  code: string;
  type: string;
  description: string;
  requiresCalibration: boolean;
  calibrationIntervalDays: number | '';
  depreciationYears: number | '';
}

const initialFormData: CategoryFormData = {
  name: '',
  code: '',
  type: 'test_equipment',
  description: '',
  requiresCalibration: false,
  calibrationIntervalDays: '',
  depreciationYears: '',
};

export default function CategoriesPage() {
  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<AssetCategory | null>(null);
  const [formData, setFormData] = useState<CategoryFormData>(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: categories, isLoading, error } = useCategories();
  const { data: categoryTypes } = useCategoryTypes();
  const createMutation = useCreateCategory();
  const updateMutation = useUpdateCategory();
  const deleteMutation = useDeleteCategory();

  const handleOpenModal = useCallback((category?: AssetCategory) => {
    if (category) {
      setEditingCategory(category);
      setFormData({
        name: category.name,
        code: category.code,
        type: category.type,
        description: category.description || '',
        requiresCalibration: category.requiresCalibration,
        calibrationIntervalDays: category.calibrationIntervalDays || '',
        depreciationYears: category.depreciationYears || '',
      });
    } else {
      setEditingCategory(null);
      setFormData(initialFormData);
    }
    setShowModal(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setShowModal(false);
    setEditingCategory(null);
    setFormData(initialFormData);
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const data = {
        name: formData.name,
        code: formData.code,
        type: formData.type,
        description: formData.description || undefined,
        requiresCalibration: formData.requiresCalibration,
        calibrationIntervalDays: formData.calibrationIntervalDays
          ? Number(formData.calibrationIntervalDays)
          : undefined,
        depreciationYears: formData.depreciationYears
          ? Number(formData.depreciationYears)
          : undefined,
      };

      if (editingCategory) {
        await updateMutation.mutateAsync({ id: editingCategory.id, data });
      } else {
        await createMutation.mutateAsync(data);
      }
      handleCloseModal();
      notificationService.success(editingCategory ? 'Category updated' : 'Category created');
    } catch (err) {
      notificationService.error(err instanceof Error ? err.message : 'Operation failed');
    } finally {
      setIsSubmitting(false);
    }
  }, [formData, editingCategory, createMutation, updateMutation, handleCloseModal]);

  const handleDelete = useCallback(async (category: AssetCategory) => {
    if (!confirm(`Delete category "${category.name}"?`)) return;
    try {
      await deleteMutation.mutateAsync(category.id);
      notificationService.success('Category deleted');
    } catch (err) {
      notificationService.error(err instanceof Error ? err.message : 'Delete failed');
    }
  }, [deleteMutation]);

  const handleToggleActive = useCallback(async (category: AssetCategory) => {
    try {
      await updateMutation.mutateAsync({
        id: category.id,
        data: { isActive: !category.isActive },
      });
      notificationService.success(category.isActive ? 'Category deactivated' : 'Category activated');
    } catch (err) {
      notificationService.error(err instanceof Error ? err.message : 'Update failed');
    }
  }, [updateMutation]);

  // Group categories by type
  const categoriesByType = categories?.reduce((acc, cat) => {
    if (!acc[cat.type]) acc[cat.type] = [];
    acc[cat.type].push(cat);
    return acc;
  }, {} as Record<string, AssetCategory[]>) || {};

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Asset Categories</h1>
          <p className="text-gray-600 mt-1">
            Manage equipment types and their settings
          </p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Category
        </button>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          Failed to load categories: {error.message}
        </div>
      )}

      {/* Categories Grid by Type */}
      {!isLoading && !error && (
        <div className="space-y-6">
          {Object.entries(categoriesByType).map(([type, cats]) => (
            <div key={type} className="bg-white rounded-lg border border-gray-200">
              <div className="p-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900 capitalize">
                  {type.replace(/_/g, ' ')}
                </h2>
              </div>
              <div className="divide-y divide-gray-200">
                {cats.map((category) => (
                  <div
                    key={category.id}
                    className="p-4 flex items-center justify-between hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${
                        category.isActive ? 'bg-blue-100' : 'bg-gray-100'
                      }`}>
                        <FolderOpen className={`h-5 w-5 ${
                          category.isActive ? 'text-blue-600' : 'text-gray-400'
                        }`} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-gray-900">{category.name}</p>
                          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                            {category.code}
                          </span>
                          {!category.isActive && (
                            <span className="text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded">
                              Inactive
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 mt-1">
                          {category.requiresCalibration && (
                            <span className="text-xs text-blue-600 flex items-center">
                              <Clock className="h-3 w-3 mr-1" />
                              Calibration: {category.calibrationIntervalDays} days
                            </span>
                          )}
                          {category.depreciationYears && (
                            <span className="text-xs text-gray-500">
                              Depreciation: {category.depreciationYears} years
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleActive(category)}
                        className={`p-2 rounded-lg ${
                          category.isActive
                            ? 'text-green-600 hover:bg-green-50'
                            : 'text-gray-400 hover:bg-gray-100'
                        }`}
                        title={category.isActive ? 'Deactivate' : 'Activate'}
                      >
                        {category.isActive ? (
                          <CheckCircle className="h-4 w-4" />
                        ) : (
                          <XCircle className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        onClick={() => handleOpenModal(category)}
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                        title="Edit"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(category)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {Object.keys(categoriesByType).length === 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
              <FolderOpen className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No categories found</p>
              <button
                onClick={() => handleOpenModal()}
                className="mt-4 text-blue-600 hover:text-blue-800"
              >
                Create your first category
              </button>
            </div>
          )}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-lg w-full mx-4">
            <form onSubmit={handleSubmit}>
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-xl font-semibold text-gray-900">
                  {editingCategory ? 'Edit Category' : 'Add Category'}
                </h2>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Name *
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Code *
                    </label>
                    <input
                      type="text"
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      required
                      disabled={!!editingCategory}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Type *
                  </label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    required
                  >
                    {(categoryTypes || ['test_equipment', 'splice_equipment', 'computing', 'tools', 'vehicles', 'safety']).map((type) => (
                      <option key={type} value={type}>
                        {type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="requiresCalibration"
                    checked={formData.requiresCalibration}
                    onChange={(e) => setFormData({ ...formData, requiresCalibration: e.target.checked })}
                    className="h-4 w-4 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <label htmlFor="requiresCalibration" className="text-sm text-gray-700">
                    Requires Calibration
                  </label>
                </div>

                {formData.requiresCalibration && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Calibration Interval (days)
                    </label>
                    <input
                      type="number"
                      value={formData.calibrationIntervalDays}
                      onChange={(e) => setFormData({ ...formData, calibrationIntervalDays: e.target.value ? Number(e.target.value) : '' })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      min={1}
                    />
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Depreciation Years
                  </label>
                  <input
                    type="number"
                    value={formData.depreciationYears}
                    onChange={(e) => setFormData({ ...formData, depreciationYears: e.target.value ? Number(e.target.value) : '' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    min={1}
                  />
                </div>
              </div>
              <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : editingCategory ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

CategoriesPage.getLayout = (page: React.ReactElement) => (
  <AppLayout>{page}</AppLayout>
);
