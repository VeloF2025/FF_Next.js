'use client';

import { useState } from 'react';
import { Plus, Search, Star, Building2, AlertCircle } from 'lucide-react';
import { useSuppliers } from './hooks/useSuppliers';
import { SupplierCard } from './components/SupplierCard';
import { SupplierStatus, ProductCategory } from '@/types/supplier.types';
import { Button } from '@/shared/components/ui/Button';
import { Input } from '@/shared/components/ui/Input';
import { useRouter } from 'next/router';

export function SuppliersPage() {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<SupplierStatus | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<ProductCategory | 'all'>('all');
  const [showPreferredOnly, setShowPreferredOnly] = useState(false);
  
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
        <Button
          onClick={handleCreate}
          className="flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Add Supplier
        </Button>
      </div>

      {/* Filters */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
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
          </div>

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
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredSuppliers.map((supplier) => (
            <SupplierCard key={supplier.id} supplier={supplier} />
          ))}
        </div>
      ) : (
        <div className="bg-[var(--ff-bg-secondary)] p-12 rounded-lg border border-[var(--ff-border-light)] text-center">
          <Building2 className="h-12 w-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
          <p className="text-[var(--ff-text-secondary)] mb-4">No suppliers found</p>
          <Button onClick={handleCreate}>
            Add First Supplier
          </Button>
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