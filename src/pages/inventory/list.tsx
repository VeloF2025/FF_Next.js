/**
 * Asset List Page
 *
 * Browse and manage all assets with filtering and search.
 */

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/router';
import { notificationService } from '@/services/core/NotificationService';
import {
  Package,
  Plus,
  Search,
  Filter,
  Download,
  ChevronLeft,
  ChevronRight,
  Eye,
  Edit,
  Trash2,
  CheckCircle,
  AlertTriangle,
  Clock,
  Wrench,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAssets, useCategories, useDeleteAsset } from '@/modules/assets/hooks';
import type { Asset } from '@/modules/assets/types/asset';

const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  available: { label: 'Available', color: 'text-green-700', bgColor: 'bg-green-100' },
  assigned: { label: 'Assigned', color: 'text-blue-700', bgColor: 'bg-blue-100' },
  in_maintenance: { label: 'In Maintenance', color: 'text-orange-700', bgColor: 'bg-orange-100' },
  out_for_calibration: { label: 'Calibration', color: 'text-yellow-700', bgColor: 'bg-yellow-100' },
  retired: { label: 'Retired', color: 'text-gray-700', bgColor: 'bg-gray-100' },
  disposed: { label: 'Disposed', color: 'text-gray-700', bgColor: 'bg-gray-100' },
  lost: { label: 'Lost', color: 'text-red-700', bgColor: 'bg-red-100' },
  damaged: { label: 'Damaged', color: 'text-red-700', bgColor: 'bg-red-100' },
};

const CONDITION_CONFIG: Record<string, { label: string; color: string }> = {
  new: { label: 'New', color: 'text-green-600' },
  excellent: { label: 'Excellent', color: 'text-green-600' },
  good: { label: 'Good', color: 'text-blue-600' },
  fair: { label: 'Fair', color: 'text-yellow-600' },
  poor: { label: 'Poor', color: 'text-orange-600' },
  damaged: { label: 'Damaged', color: 'text-red-600' },
  non_functional: { label: 'Non-Functional', color: 'text-red-600' },
};

export default function AssetListPage() {
  const router = useRouter();
  const { status: queryStatus } = router.query;

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>(
    queryStatus ? [queryStatus as string] : []
  );
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);

  const { data: categories } = useCategories({ isActive: true });
  const deleteAssetMutation = useDeleteAsset();

  const { data, isLoading, error } = useAssets({
    page,
    limit: 25,
    searchTerm: searchTerm || undefined,
    status: statusFilter.length > 0 ? statusFilter : undefined,
    categoryId: categoryFilter.length > 0 ? categoryFilter : undefined,
  });

  const assets = data?.data ?? [];
  const pagination = data?.pagination;

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
  }, []);

  const handleDelete = useCallback(async (asset: Asset) => {
    if (!confirm(`Delete asset "${asset.name}"?`)) return;
    try {
      await deleteAssetMutation.mutateAsync(asset.id);
      notificationService.success('Asset deleted');
    } catch (err) {
      notificationService.error(err instanceof Error ? err.message : 'Delete failed');
    }
  }, [deleteAssetMutation]);

  const statusOptions = Object.entries(STATUS_CONFIG).map(([value, config]) => ({
    value,
    label: config.label,
  }));

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">All Assets</h1>
          <p className="text-gray-600 mt-1">
            {pagination?.total ?? 0} assets in inventory
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => {}}
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            <Download className="h-4 w-4 mr-2" />
            Export
          </button>
          <button
            onClick={() => router.push('/inventory/new')}
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Asset
          </button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-4">
          <form onSubmit={handleSearch} className="flex-1 max-w-md">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search by name, asset number, serial number..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </form>

          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`inline-flex items-center px-4 py-2 text-sm font-medium border rounded-lg ${
              showFilters || statusFilter.length > 0 || categoryFilter.length > 0
                ? 'text-blue-700 bg-blue-50 border-blue-300'
                : 'text-gray-700 bg-white border-gray-300 hover:bg-gray-50'
            }`}
          >
            <Filter className="h-4 w-4 mr-2" />
            Filters
            {(statusFilter.length > 0 || categoryFilter.length > 0) && (
              <span className="ml-2 px-2 py-0.5 text-xs bg-blue-600 text-white rounded-full">
                {statusFilter.length + categoryFilter.length}
              </span>
            )}
          </button>
        </div>

        {/* Filter Panel */}
        {showFilters && (
          <div className="mt-4 pt-4 border-t border-gray-200 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
              <select
                multiple
                value={statusFilter}
                onChange={(e) => {
                  const values = Array.from(e.target.selectedOptions, (o) => o.value);
                  setStatusFilter(values);
                  setPage(1);
                }}
                className="w-full border border-gray-300 rounded-lg p-2 h-32"
              >
                {statusOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
              <select
                multiple
                value={categoryFilter}
                onChange={(e) => {
                  const values = Array.from(e.target.selectedOptions, (o) => o.value);
                  setCategoryFilter(values);
                  setPage(1);
                }}
                className="w-full border border-gray-300 rounded-lg p-2 h-32"
              >
                {categories?.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <button
                onClick={() => {
                  setStatusFilter([]);
                  setCategoryFilter([]);
                  setPage(1);
                }}
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                Clear all filters
              </button>
            </div>
          </div>
        )}
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
          Failed to load assets: {error.message}
        </div>
      )}

      {/* Data Table */}
      {!isLoading && !error && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Asset
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Category
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Condition
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Assigned To
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Calibration
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {assets.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                      No assets found
                    </td>
                  </tr>
                )}
                {assets.map((asset) => {
                  const statusConfig = STATUS_CONFIG[asset.status] || STATUS_CONFIG.available;
                  const conditionConfig = CONDITION_CONFIG[asset.condition] || CONDITION_CONFIG.good;
                  const isCalibrationDue = asset.requiresCalibration && asset.nextCalibrationDate &&
                    new Date(asset.nextCalibrationDate) <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
                  const isCalibrationOverdue = asset.requiresCalibration && asset.nextCalibrationDate &&
                    new Date(asset.nextCalibrationDate) < new Date();

                  return (
                    <tr
                      key={asset.id}
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => setSelectedAsset(asset)}
                    >
                      <td className="px-4 py-4">
                        <div>
                          <p className="font-medium text-gray-900">{asset.name}</p>
                          <p className="text-sm text-gray-500">{asset.assetNumber}</p>
                          {asset.serialNumber && (
                            <p className="text-xs text-gray-400">S/N: {asset.serialNumber}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-600">
                        {/* Would need category lookup */}
                        -
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusConfig.bgColor} ${statusConfig.color}`}>
                          {statusConfig.label}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`text-sm font-medium ${conditionConfig.color}`}>
                          {conditionConfig.label}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-600">
                        {asset.currentAssigneeName || '-'}
                      </td>
                      <td className="px-4 py-4">
                        {asset.requiresCalibration ? (
                          <div className="flex items-center">
                            {isCalibrationOverdue ? (
                              <AlertTriangle className="h-4 w-4 text-red-500 mr-1" />
                            ) : isCalibrationDue ? (
                              <Clock className="h-4 w-4 text-yellow-500 mr-1" />
                            ) : (
                              <CheckCircle className="h-4 w-4 text-green-500 mr-1" />
                            )}
                            <span className={`text-sm ${
                              isCalibrationOverdue ? 'text-red-600' :
                              isCalibrationDue ? 'text-yellow-600' : 'text-gray-600'
                            }`}>
                              {asset.nextCalibrationDate
                                ? new Date(asset.nextCalibrationDate).toLocaleDateString()
                                : 'Not set'}
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">N/A</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => setSelectedAsset(asset)}
                            className="p-1 text-gray-400 hover:text-gray-600"
                            title="View"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => router.push(`/inventory/${asset.id}/edit`)}
                            className="p-1 text-gray-400 hover:text-blue-600"
                            title="Edit"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(asset)}
                            className="p-1 text-gray-400 hover:text-red-600"
                            title="Delete"
                            disabled={asset.status === 'assigned'}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
              <p className="text-sm text-gray-600">
                Showing {((page - 1) * pagination.pageSize) + 1} to{' '}
                {Math.min(page * pagination.pageSize, pagination.total)} of{' '}
                {pagination.total} assets
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(page - 1)}
                  disabled={page === 1}
                  className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm text-gray-600">
                  Page {page} of {pagination.totalPages}
                </span>
                <button
                  onClick={() => setPage(page + 1)}
                  disabled={page >= pagination.totalPages}
                  className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Asset Detail Modal */}
      {selectedAsset && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">{selectedAsset.name}</h2>
                <p className="text-gray-600">{selectedAsset.assetNumber}</p>
              </div>
              <button
                onClick={() => setSelectedAsset(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                &times;
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">Status</p>
                  <p className="font-medium">{STATUS_CONFIG[selectedAsset.status]?.label}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Condition</p>
                  <p className="font-medium">{CONDITION_CONFIG[selectedAsset.condition]?.label}</p>
                </div>
                {selectedAsset.serialNumber && (
                  <div>
                    <p className="text-sm text-gray-500">Serial Number</p>
                    <p className="font-medium">{selectedAsset.serialNumber}</p>
                  </div>
                )}
                {selectedAsset.manufacturer && (
                  <div>
                    <p className="text-sm text-gray-500">Manufacturer</p>
                    <p className="font-medium">{selectedAsset.manufacturer}</p>
                  </div>
                )}
                {selectedAsset.model && (
                  <div>
                    <p className="text-sm text-gray-500">Model</p>
                    <p className="font-medium">{selectedAsset.model}</p>
                  </div>
                )}
                {selectedAsset.currentAssigneeName && (
                  <div>
                    <p className="text-sm text-gray-500">Assigned To</p>
                    <p className="font-medium">{selectedAsset.currentAssigneeName}</p>
                  </div>
                )}
                {selectedAsset.currentLocation && (
                  <div>
                    <p className="text-sm text-gray-500">Location</p>
                    <p className="font-medium">{selectedAsset.currentLocation}</p>
                  </div>
                )}
                {selectedAsset.requiresCalibration && (
                  <div>
                    <p className="text-sm text-gray-500">Next Calibration</p>
                    <p className="font-medium">
                      {selectedAsset.nextCalibrationDate
                        ? new Date(selectedAsset.nextCalibrationDate).toLocaleDateString()
                        : 'Not set'}
                    </p>
                  </div>
                )}
              </div>
              {selectedAsset.notes && (
                <div>
                  <p className="text-sm text-gray-500">Notes</p>
                  <p className="text-gray-700">{selectedAsset.notes}</p>
                </div>
              )}
            </div>
            <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
              {selectedAsset.status === 'available' && (
                <button
                  onClick={() => router.push(`/inventory/checkout?assetId=${selectedAsset.id}`)}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                >
                  Check Out
                </button>
              )}
              <button
                onClick={() => router.push(`/inventory/${selectedAsset.id}/edit`)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Edit
              </button>
              <button
                onClick={() => setSelectedAsset(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

AssetListPage.getLayout = (page: React.ReactElement) => (
  <AppLayout>{page}</AppLayout>
);
