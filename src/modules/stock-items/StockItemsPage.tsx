'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useRouter } from 'next/router';
import {
  Package,
  Plus,
  Search,
  Filter,
  Download,
  RefreshCw,
  Boxes,
  DollarSign,
  AlertTriangle,
  X,
} from 'lucide-react';
import { useStockItems } from './hooks/useStockItems';
import { useActiveCheckouts } from './hooks/useToolCheckouts';
import { StockItemRow } from './components/StockItemRow';
import { StockItemModal } from './components/StockItemModal';
import { CheckOutModal, CheckInModal } from './components/CheckOutModal';
import { Pagination } from '@/components/ui/StandardDataTable';
import { ExportCSVButton } from '@/components/shared/ExportCSVButton';
import { useAuth } from '@/contexts/AuthContext';
import { UserRole } from '@/types/auth.types';
import type { StockItem, StockItemFilters, ToolCheckout } from '@/types/stockItem.types';

export function StockItemsPage() {
  const router = useRouter();
  const { hasAnyRole } = useAuth();
  const canManageCheckouts = hasAnyRole([UserRole.PROJECT_MANAGER, UserRole.ADMIN, UserRole.SUPER_ADMIN]);
  const initialCategory = (router.query.category as string) || undefined;
  const [filters, setFilters] = useState<StockItemFilters>({
    page: 1,
    limit: 25,
    sortBy: 'item_code',
    sortOrder: 'asc',
    category: initialCategory,
  });
  const [searchInput, setSearchInput] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedItem, setSelectedItem] = useState<StockItem | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [checkOutItem, setCheckOutItem] = useState<StockItem | null>(null);
  const [checkInData, setCheckInData] = useState<{ item: StockItem; checkout: ToolCheckout } | null>(null);

  const { items, pagination, categories, isLoading, error, mutate } = useStockItems(filters);
  const { checkouts, refetch: refetchCheckouts } = useActiveCheckouts();

  // Build a map of stockItemId -> active checkout for quick lookup
  const checkoutMap = useMemo(() => {
    const map = new Map<string, ToolCheckout>();
    for (const co of checkouts) {
      map.set(co.stockItemId, co);
    }
    return map;
  }, [checkouts]);

  // Sync category from URL query param (for client-side navigation from Categories tab)
  useEffect(() => {
    const urlCategory = (router.query.category as string) || undefined;
    if (urlCategory !== filters.category) {
      setFilters(prev => ({ ...prev, category: urlCategory, page: 1 }));
    }
  }, [router.query.category]);

  // Statistics
  const stats = useMemo(() => {
    return {
      totalItems: pagination?.total || 0,
      totalCategories: categories.length,
      withStock: items.filter((i: StockItem) => i.qtyAvailable > 0).length,
      lowStock: items.filter((i: StockItem) => i.qtyAvailable > 0 && i.qtyAvailable < i.minStockLevel).length,
    };
  }, [items, pagination, categories]);

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setFilters(prev => ({ ...prev, search: searchInput, page: 1 }));
  }, [searchInput]);

  const handleCategoryFilter = useCallback((category: string) => {
    setFilters(prev => ({
      ...prev,
      category: category === prev.category ? undefined : category,
      page: 1,
    }));
  }, []);

  const handleToggleFilter = useCallback((key: 'hasStock' | 'odooOnly') => {
    setFilters(prev => ({ ...prev, [key]: !prev[key], page: 1 }));
  }, []);

  const handlePageChange = useCallback((page: number) => {
    setFilters(prev => ({ ...prev, page }));
  }, []);

  const handleRowClick = useCallback((item: StockItem) => {
    setSelectedItem(item);
  }, []);

  const handleCloseModal = useCallback(() => {
    setSelectedItem(null);
    setShowCreateModal(false);
  }, []);

  const handleSaveSuccess = useCallback(() => {
    mutate();
    refetchCheckouts();
    handleCloseModal();
  }, [mutate, refetchCheckouts, handleCloseModal]);

  const handleCheckOut = useCallback((item: StockItem) => {
    setCheckOutItem(item);
  }, []);

  const handleCheckIn = useCallback((item: StockItem, checkout: ToolCheckout) => {
    setCheckInData({ item, checkout });
  }, []);

  const handleCheckoutSuccess = useCallback(() => {
    setCheckOutItem(null);
    setCheckInData(null);
    mutate();
    refetchCheckouts();
  }, [mutate, refetchCheckouts]);

  const clearFilters = useCallback(() => {
    setFilters({ page: 1, limit: 25, sortBy: 'item_code', sortOrder: 'asc' });
    setSearchInput('');
  }, []);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.search) count++;
    if (filters.category) count++;
    if (filters.hasStock) count++;
    if (filters.odooOnly) count++;
    return count;
  }, [filters]);

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded">
          Error loading stock items: {error.message}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Stock Items</h1>
          <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
            Manage inventory items synced from Odoo
          </p>
        </div>
        <div className="flex gap-2">
          <ExportCSVButton
            endpoint="/api/stock-items/stock-items-export"
            params={{
              search: filters.search,
              category: filters.category,
              hasStock: filters.hasStock ? 'true' : undefined,
              odooOnly: filters.odooOnly ? 'true' : undefined,
            }}
            filenamePrefix="stock-items"
          />
          <button
            onClick={() => mutate()}
            className="flex items-center gap-2 px-4 py-2 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)] text-[var(--ff-text-secondary)]"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
          >
            <Plus className="h-4 w-4" />
            Add Item
          </button>
        </div>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">Total Items</p>
              <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                {pagination?.total?.toLocaleString() || 0}
              </p>
            </div>
            <Package className="h-8 w-8 text-[var(--ff-text-tertiary)]" />
          </div>
        </div>

        <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">Categories</p>
              <p className="text-2xl font-bold text-blue-400">{stats.totalCategories}</p>
            </div>
            <Boxes className="h-8 w-8 text-blue-400" />
          </div>
        </div>

        <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">In Stock (this page)</p>
              <p className="text-2xl font-bold text-green-400">{stats.withStock}</p>
            </div>
            <DollarSign className="h-8 w-8 text-green-400" />
          </div>
        </div>

        <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">Low Stock (this page)</p>
              <p className="text-2xl font-bold text-yellow-400">{stats.lowStock}</p>
            </div>
            <AlertTriangle className="h-8 w-8 text-yellow-400" />
          </div>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
        <div className="flex flex-wrap gap-4 items-center">
          <form onSubmit={handleSearch} className="flex-1 min-w-[250px] max-w-md">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
              <input
                type="text"
                placeholder="Search by code, name, or description..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </form>

          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2 border rounded-lg transition-colors ${
              showFilters || activeFilterCount > 0
                ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                : 'border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'
            }`}
          >
            <Filter className="h-4 w-4" />
            Filters
            {activeFilterCount > 0 && (
              <span className="px-2 py-0.5 bg-blue-600 text-white text-xs rounded-full">
                {activeFilterCount}
              </span>
            )}
          </button>

          {activeFilterCount > 0 && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 px-3 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
            >
              <X className="h-4 w-4" />
              Clear
            </button>
          )}
        </div>

        {/* Filter Panel */}
        {showFilters && (
          <div className="mt-4 pt-4 border-t border-[var(--ff-border-light)]">
            <div className="flex flex-wrap gap-4">
              {/* Category Filter */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-[var(--ff-text-secondary)]">Category</label>
                <select
                  value={filters.category || ''}
                  onChange={(e) => handleCategoryFilter(e.target.value)}
                  className="px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] rounded-lg text-sm text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Categories</option>
                  {categories.map((cat: { value: string; count: number }) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.value} ({cat.count})
                    </option>
                  ))}
                </select>
              </div>

              {/* Toggle Filters */}
              <div className="flex items-end gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.hasStock || false}
                    onChange={() => handleToggleFilter('hasStock')}
                    className="rounded border-[var(--ff-border-light)] text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-[var(--ff-text-primary)]">In Stock Only</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.odooOnly || false}
                    onChange={() => handleToggleFilter('odooOnly')}
                    className="rounded border-[var(--ff-border-light)] text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-[var(--ff-text-primary)]">Odoo Synced Only</span>
                </label>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[var(--ff-border-light)]">
            <thead className="bg-[var(--ff-bg-tertiary)]">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                  Item Code
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                  Category
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                  UOM
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                  Available
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                  Cost
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                  Status
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                  Source
                </th>
                {canManageCheckouts && (
                  <th className="px-4 py-3 text-center text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="bg-[var(--ff-bg-secondary)] divide-y divide-[var(--ff-border-light)]">
              {isLoading ? (
                Array.from({ length: 10 }).map((_: unknown, i: number) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-4 py-4"><div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-48" /></td>
                    <td className="px-4 py-4"><div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-24" /></td>
                    <td className="px-4 py-4"><div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-12" /></td>
                    <td className="px-4 py-4"><div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-16 ml-auto" /></td>
                    <td className="px-4 py-4"><div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-20 ml-auto" /></td>
                    <td className="px-4 py-4"><div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-16 mx-auto" /></td>
                    <td className="px-4 py-4"><div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-12 mx-auto" /></td>
                    {canManageCheckouts && <td className="px-4 py-4"><div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-20 mx-auto" /></td>}
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={canManageCheckouts ? 8 : 7} className="px-4 py-12 text-center text-[var(--ff-text-secondary)]">
                    <Package className="h-12 w-12 mx-auto mb-4 text-[var(--ff-text-tertiary)]" />
                    <p className="mb-2">No stock items found</p>
                    <button
                      onClick={() => setShowCreateModal(true)}
                      className="text-blue-400 hover:text-blue-300"
                    >
                      Add your first item
                    </button>
                  </td>
                </tr>
              ) : (
                items.map((item: StockItem) => (
                  <StockItemRow
                    key={item.id}
                    item={item}
                    onClick={() => handleRowClick(item)}
                    activeCheckout={checkoutMap.get(item.id) || null}
                    canManageCheckouts={canManageCheckouts}
                    onCheckOut={handleCheckOut}
                    onCheckIn={handleCheckIn}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <Pagination
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            totalItems={pagination.total}
            itemsPerPage={pagination.limit}
            onPageChange={handlePageChange}
          />
        )}
      </div>

      {/* Modal for Create/Edit */}
      {(showCreateModal || selectedItem) && (
        <StockItemModal
          item={selectedItem}
          onClose={handleCloseModal}
          onSave={handleSaveSuccess}
        />
      )}

      {/* Check Out Modal */}
      {checkOutItem && (
        <CheckOutModal
          item={checkOutItem}
          onClose={() => setCheckOutItem(null)}
          onSuccess={handleCheckoutSuccess}
        />
      )}

      {/* Check In Modal */}
      {checkInData && (
        <CheckInModal
          checkout={checkInData.checkout}
          itemName={`${checkInData.item.itemCode} - ${checkInData.item.name}`}
          onClose={() => setCheckInData(null)}
          onSuccess={handleCheckoutSuccess}
        />
      )}
    </div>
  );
}
