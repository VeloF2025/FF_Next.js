'use client';

/**
 * Categories Client Component
 * Handles category list with actions
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  FolderOpen,
  Edit,
  Trash2,
  Loader2,
  CheckCircle,
  XCircle,
  Gauge,
  Wrench,
  Laptop,
  PenTool,
} from 'lucide-react';
import type { AssetCategory } from '@/modules/assets/types';

interface CategoriesClientProps {
  initialCategories: AssetCategory[];
}

const typeIcons: Record<string, any> = {
  test_equipment: Gauge,
  splice_equipment: Wrench,
  computing_device: Laptop,
  tools: PenTool,
};

const typeLabels: Record<string, string> = {
  test_equipment: 'Test Equipment',
  splice_equipment: 'Splice Equipment',
  computing_device: 'Computing Device',
  tools: 'Tools',
};

export function CategoriesClient({ initialCategories }: CategoriesClientProps) {
  const router = useRouter();
  const [categories, setCategories] = useState(initialCategories);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Are you sure you want to delete "${name}"? This cannot be undone.`)) {
      return;
    }

    setDeleting(id);
    try {
      const response = await fetch(`/api/assets/categories/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setCategories((prev) => prev.filter((c) => c.id !== id));
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to delete category');
      }
    } catch (error) {
      alert('Failed to delete category');
    } finally {
      setDeleting(null);
    }
  }

  async function handleToggleActive(id: string, isActive: boolean) {
    try {
      const response = await fetch(`/api/assets/categories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !isActive }),
      });

      if (response.ok) {
        setCategories((prev) =>
          prev.map((c) => (c.id === id ? { ...c, isActive: !isActive } : c))
        );
      }
    } catch (error) {
      console.error('Failed to toggle category status');
    }
  }

  // Group by type
  const groupedCategories = categories.reduce((acc, cat) => {
    const type = cat.type || 'other';
    if (!acc[type]) acc[type] = [];
    acc[type].push(cat);
    return acc;
  }, {} as Record<string, AssetCategory[]>);

  return (
    <div className="space-y-6">
      {Object.entries(groupedCategories).map(([type, cats]) => {
        const Icon = typeIcons[type] || FolderOpen;
        return (
          <div key={type} className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center">
              <Icon className="h-5 w-5 text-gray-500 dark:text-gray-400 mr-2" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {typeLabels[type] || type}
              </h2>
              <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">({cats.length})</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      Code
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      Calibration
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      Depreciation
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      Status
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {cats.map((category) => (
                    <tr key={category.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">{category.name}</p>
                          {category.description && (
                            <p className="text-sm text-gray-500 dark:text-gray-400 truncate max-w-xs">
                              {category.description}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-mono text-sm bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-2 py-1 rounded">
                          {category.code}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                        {category.requiresCalibration ? (
                          <span className="inline-flex items-center">
                            <CheckCircle className="h-4 w-4 text-green-500 mr-1" />
                            {category.calibrationIntervalDays} days
                          </span>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500">Not required</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                        {category.depreciationYears
                          ? `${category.depreciationYears} years`
                          : '-'}
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => handleToggleActive(category.id, category.isActive)}
                          className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${
                            category.isActive
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                          }`}
                        >
                          {category.isActive ? (
                            <>
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Active
                            </>
                          ) : (
                            <>
                              <XCircle className="h-3 w-3 mr-1" />
                              Inactive
                            </>
                          )}
                        </button>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end space-x-2">
                          <button
                            onClick={() => router.push(`/inventory/categories/${category.id}/edit`)}
                            className="p-2 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg"
                            title="Edit"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(category.id, category.name)}
                            disabled={deleting === category.id}
                            className="p-2 text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg disabled:opacity-50"
                            title="Delete"
                          >
                            {deleting === category.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {categories.length === 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-8 text-center">
          <FolderOpen className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-4" />
          <p className="text-gray-500 dark:text-gray-400">No categories found</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
            Add a category to start organizing your assets
          </p>
        </div>
      )}
    </div>
  );
}
