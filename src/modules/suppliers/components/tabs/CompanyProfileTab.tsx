// ============= Company Profile Tab =============
// Supplier profile directory with search, filters, and detail view

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useSuppliersPortal } from '../../context/SuppliersPortalContext';
import { useSupplierFilters } from './company-profile/hooks/useSupplierFilters';
import type { ExtendedSupplier } from './company-profile/types/company-profile.types';
import {
  FilterBar,
  EmptyState,
  SupplierCard,
  SupplierDetailPanel
} from './company-profile/components';

export function CompanyProfileTab() {
  const { selectedSupplier, setSupplier } = useSuppliersPortal();
  const [detailSupplier, setDetailSupplier] = useState<ExtendedSupplier | null>(null);

  // Filter management
  const {
    searchTerm,
    setSearchTerm,
    statusFilter,
    setStatusFilter,
    categoryFilter,
    setCategoryFilter,
    viewMode,
    setViewMode,
    categories,
    filteredSuppliers
  } = useSupplierFilters({ suppliers: [] as ExtendedSupplier[] });

  const handleSupplierSelect = (supplier: ExtendedSupplier) => {
    setSupplier(supplier);
    setDetailSupplier(supplier);
  };

  return (
    <div className="space-y-6">
      {/* Filters and Header */}
      <FilterBar
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        categoryFilter={categoryFilter}
        onCategoryFilterChange={setCategoryFilter}
        categories={categories}
        resultCount={filteredSuppliers.length}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      {/* Layout: Suppliers List + Detail Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Suppliers List */}
        <div className="space-y-4">
          {filteredSuppliers.length === 0 ? (
            <EmptyState />
          ) : (
            <div className={cn("space-y-4", viewMode === 'grid' && "grid grid-cols-1 gap-4")}>
              {filteredSuppliers.map((supplier) => (
                <SupplierCard
                  key={supplier.id}
                  supplier={supplier}
                  isSelected={selectedSupplier?.id === supplier.id}
                  onSelect={() => handleSupplierSelect(supplier)}
                  viewMode={viewMode}
                />
              ))}
            </div>
          )}
        </div>

        {/* Detail Panel */}
        <div className="lg:sticky lg:top-6">
          <SupplierDetailPanel supplier={detailSupplier} />
        </div>
      </div>
    </div>
  );
}

export default CompanyProfileTab;
