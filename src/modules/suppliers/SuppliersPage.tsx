'use client';

import { useState } from 'react';
import { Plus, Search, Star, Building2, AlertCircle, LayoutGrid, List } from 'lucide-react';
import { useSuppliers } from './hooks/useSuppliers';
import { SupplierCard } from './components/SupplierCard';
import { SupplierListRow } from './components/SupplierListRow';
import { SupplierStatus, ProductCategory } from '@/types/supplier.types';
import { Button } from '@/shared/components/ui/Button';
import { Input } from '@/shared/components/ui/Input';
import { useRouter } from 'next/router';
import { PermissionGate } from '@/components/PermissionGate';
import { ExportCSVButton } from '@/components/shared/ExportCSVButton';

export function SuppliersPage() {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<SupplierStatus | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<ProductCategory | 'all'>('all');
  const [showPreferredOnly, setShowPreferredOnly] = useState(false);
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  
  const { data: suppliers, isLoading, error } = useSuppliers({
    ...(statusFilter !== 'all' && { status: statusFilter }),
    ...(categoryFilter !== 'all' && { category: categoryFilter as string }),
    ...(showPreferredOnly && { isPreferred: true })
  });

  const filteredSuppliers = suppliers?.filter(supplier => {
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      return (
        (supplier.name || supplier.companyName || '').toLowerCase().includes(search) ||
        (supplier.registrationNumber || supplier.registrationNo || '').toLowerCase().includes(search) ||
        (supplier.email || '').toLowerCase().includes(search)
      );
    }
    return true;
  });

  const handleCreate = () => {
    router.push('/suppliers/new');
  };

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded">
          Error loading suppliers: {error.message}
        </div>
      </div>
    );
  }

  // Calculate statistics
  const stats = {
    total: suppliers?.length || 0,
    active: suppliers?.filter(s => s.status === SupplierStatus.ACTIVE).length || 0,
    preferred: suppliers?.filter(s => s.isPreferred).length || 0,
    averageRating: suppliers && suppliers.length > 0
      ? suppliers.reduce((sum, s) => sum + (typeof s.rating === 'number' ? s.rating : s.rating.overall), 0) / suppliers.length
      : 0,
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Suppliers</h1>
          <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
            Manage suppliers, products, and performance tracking
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg p-1">
            <button
              onClick={() => setViewMode('card')}
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'card' ? 'bg-[var(--ff-primary-500)] text-white' : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'}`}
              title="Card view"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-[var(--ff-primary-500)] text-white' : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'}`}
              title="List view"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
          <ExportCSVButton
            endpoint="/api/suppliers/suppliers-export"
            params={{
              status: statusFilter !== 'all' ? statusFilter : undefined,
              category: categoryFilter !== 'all' ? categoryFilter : undefined,
              isPreferred: showPreferredOnly ? 'true' : undefined,
              search: searchTerm || undefined,
            }}
            filenamePrefix="suppliers"
          />
          <PermissionGate permission="procurement.sourcing" action="create">
            <Button
              onClick={handleCreate}
              className="flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Add Supplier
            </Button>
          </PermissionGate>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
        <div className="flex flex-wrap gap-4">
          <form onSubmit={(e) => e.preventDefault()} className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
              <Input
                type="text"
                placeholder="Search suppliers..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 w-full"
              />
            </div>
          </form>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as SupplierStatus | 'all')}
            className="px-4 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] rounded-lg text-sm text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="all">All Status</option>
            <option value={SupplierStatus.ACTIVE}>Active</option>
            <option value={SupplierStatus.INACTIVE}>Inactive</option>
            <option value={SupplierStatus.PENDING}>Pending</option>
            <option value={SupplierStatus.SUSPENDED}>Suspended</option>
            <option value={SupplierStatus.BLACKLISTED}>Blacklisted</option>
          </select>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as ProductCategory | 'all')}
            className="px-4 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] rounded-lg text-sm text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="all">All Categories</option>
            <option value={ProductCategory.FIBER_CABLE}>Fiber Cable</option>
            <option value={ProductCategory.NETWORK_EQUIPMENT}>Network Equipment</option>
            <option value={ProductCategory.CONNECTORS}>Connectors</option>
            <option value={ProductCategory.TEST_EQUIPMENT}>Test Equipment</option>
            <option value={ProductCategory.CONSUMABLES}>Consumables</option>
          </select>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showPreferredOnly}
              onChange={(e) => setShowPreferredOnly(e.target.checked)}
              className="rounded border-[var(--ff-border-light)] text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-[var(--ff-text-primary)]">Preferred Only</span>
          </label>
        </div>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">Total Suppliers</p>
              <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{stats.total}</p>
            </div>
            <Building2 className="h-8 w-8 text-[var(--ff-text-tertiary)]" />
          </div>
        </div>

        <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">Active</p>
              <p className="text-2xl font-bold text-green-400">{stats.active}</p>
            </div>
            <div className="p-2 bg-green-500/20 rounded-lg">
              <Building2 className="h-6 w-6 text-green-400" />
            </div>
          </div>
        </div>

        <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">Preferred</p>
              <p className="text-2xl font-bold text-blue-400">{stats.preferred}</p>
            </div>
            <Star className="h-8 w-8 text-yellow-400 fill-current" />
          </div>
        </div>

        <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">Avg Rating</p>
              <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                {stats.averageRating.toFixed(1)}
              </p>
            </div>
            <div className="flex">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  className={`h-4 w-4 ${
                    star <= Math.round(stats.averageRating)
                      ? 'text-yellow-400 fill-current'
                      : 'text-[var(--ff-text-tertiary)]'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Suppliers List */}
      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)] animate-pulse">
              <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-3/4 mb-2"></div>
              <div className="h-3 bg-[var(--ff-bg-tertiary)] rounded w-1/2 mb-4"></div>
              <div className="space-y-2">
                <div className="h-3 bg-[var(--ff-bg-tertiary)] rounded"></div>
                <div className="h-3 bg-[var(--ff-bg-tertiary)] rounded"></div>
              </div>
            </div>
          ))}
        </div>
      ) : filteredSuppliers && filteredSuppliers.length > 0 ? (
        viewMode === 'card' ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredSuppliers.map((supplier) => (
              <SupplierCard key={supplier.id} supplier={supplier} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {/* List header */}
            <div className="flex items-center gap-4 px-4 py-2 text-[11px] font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide">
              <div className="flex-1">Supplier</div>
              <div className="hidden md:block w-36 shrink-0">Category</div>
              <div className="hidden lg:block w-48 shrink-0">Contact</div>
              <div className="hidden sm:block w-24 shrink-0 text-right">Rating</div>
              <div className="w-6 shrink-0" />
            </div>
            {filteredSuppliers.map((supplier) => (
              <SupplierListRow key={supplier.id} supplier={supplier} />
            ))}
          </div>
        )
      ) : (
        <div className="bg-[var(--ff-bg-secondary)] p-12 rounded-lg border border-[var(--ff-border-light)] text-center">
          <Building2 className="h-12 w-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
          <p className="text-[var(--ff-text-secondary)] mb-4">No suppliers found</p>
          <PermissionGate permission="procurement.sourcing" action="create">
            <Button onClick={handleCreate}>
              Add First Supplier
            </Button>
          </PermissionGate>
        </div>
      )}

      {/* Alert for pending suppliers */}
      {suppliers && suppliers.filter(s => s.status === SupplierStatus.PENDING).length > 0 && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-yellow-400 mt-0.5" />
          <div>
            <p className="font-medium text-yellow-400">Pending Approvals</p>
            <p className="text-sm text-yellow-400/80 mt-1">
              {suppliers.filter(s => s.status === SupplierStatus.PENDING).length} supplier(s)
              pending verification and approval.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}