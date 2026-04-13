import { useState, useMemo } from 'react';
import { 
  Search, 
  Filter, 
  X, 
  ChevronDown, 
  Building2, 
  MapPin, 
  Star,
  CheckCircle,
  AlertCircle,
  Clock,
  XCircle
} from 'lucide-react';
import { useSuppliersPortal } from '../context/SuppliersPortalContext';
import { cn } from '@/lib/utils';

// Filter types
interface SupplierFilters {
  search: string;
  status: string[];
  category: string[];
  location: string[];
  ratingRange: [number, number];
  complianceRange: [number, number];
}

// Status icon mapping
const statusIcons = {
  active: CheckCircle,
  inactive: XCircle,
  pending: Clock,
  suspended: AlertCircle
};

const statusColors = {
  active: 'text-green-400',
  inactive: 'text-gray-400',
  pending: 'text-yellow-400',
  suspended: 'text-red-400'
};

export function SupplierFilter() {
  const {
    selectedSupplier,
    suppliers,
    activeTab,
    setSupplier
  } = useSuppliersPortal();

  const [filters, setFilters] = useState<SupplierFilters>({
    search: '',
    status: [],
    category: [],
    location: [],
    ratingRange: [0, 5],
    complianceRange: [0, 100]
  });

  const [showFilters, setShowFilters] = useState(false);
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);

  // Extract unique filter options from suppliers
  const filterOptions = useMemo(() => {
    const categories = [...new Set(suppliers.map(s => s.category))];
    const locations = [...new Set(suppliers.map(s => s.location).filter(Boolean) as string[])];
    const statuses = [...new Set(suppliers.map(s => s.status))];

    return {
      categories: categories.sort(),
      locations: locations.sort(),
      statuses: statuses.sort()
    };
  }, [suppliers]);

  // Filter suppliers based on current filters
  const filteredSuppliers = useMemo(() => {
    return suppliers.filter(supplier => {
      // Search filter
      if (filters.search && !supplier.name.toLowerCase().includes(filters.search.toLowerCase()) &&
          !supplier.code.toLowerCase().includes(filters.search.toLowerCase())) {
        return false;
      }

      // Status filter
      if (filters.status.length > 0 && !filters.status.includes(supplier.status)) {
        return false;
      }

      // Category filter
      if (filters.category.length > 0 && !filters.category.includes(supplier.category)) {
        return false;
      }

      // Location filter
      if (filters.location.length > 0 && supplier.location && 
          !filters.location.includes(supplier.location)) {
        return false;
      }

      // Rating range filter
      if (supplier.rating < filters.ratingRange[0] || supplier.rating > filters.ratingRange[1]) {
        return false;
      }

      // Compliance range filter
      if (supplier.complianceScore < filters.complianceRange[0] || 
          supplier.complianceScore > filters.complianceRange[1]) {
        return false;
      }

      return true;
    });
  }, [suppliers, filters]);

  // Handle filter changes
  const updateFilter = (key: keyof SupplierFilters, value: SupplierFilters[keyof SupplierFilters]) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const toggleArrayFilter = (key: 'status' | 'category' | 'location', value: string) => {
    setFilters(prev => ({
      ...prev,
      [key]: prev[key].includes(value)
        ? prev[key].filter(item => item !== value)
        : [...prev[key], value]
    }));
  };

  const clearFilters = () => {
    setFilters({
      search: '',
      status: [],
      category: [],
      location: [],
      ratingRange: [0, 5],
      complianceRange: [0, 100]
    });
  };

  const hasActiveFilters = filters.search || 
    filters.status.length > 0 || 
    filters.category.length > 0 || 
    filters.location.length > 0 ||
    filters.ratingRange[0] > 0 || 
    filters.ratingRange[1] < 5 ||
    filters.complianceRange[0] > 0 || 
    filters.complianceRange[1] < 100;

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)]">
      {/* Main Filter Bar */}
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4 flex-1">
            {/* Search Input */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
              <input
                type="text"
                placeholder="Search suppliers..."
                className="w-full pl-10 pr-4 py-2 border border-[var(--ff-border-light)] rounded-md bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={filters.search}
                onChange={(e) => updateFilter('search', e.target.value)}
              />
            </div>

            {/* Supplier Selector for non-dashboard/company-profile tabs */}
            {activeTab !== 'dashboard' && activeTab !== 'company-profile' && (
              <div className="relative">
                <button
                  onClick={() => setShowSupplierDropdown(!showSupplierDropdown)}
                  className={cn(
                    "flex items-center space-x-2 px-3 py-2 border rounded-md text-sm font-medium transition-colors",
                    selectedSupplier
                      ? "bg-blue-500/20 border-blue-500/30 text-blue-400"
                      : "border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]"
                  )}
                >
                  <Building2 className="h-4 w-4" />
                  <span>
                    {selectedSupplier ? selectedSupplier.name : 'Select Supplier'}
                  </span>
                  <ChevronDown className="h-4 w-4" />
                </button>

                {showSupplierDropdown && (
                  <div className="absolute top-full left-0 mt-1 w-80 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-md shadow-lg z-20">
                    <div className="p-2 border-b border-[var(--ff-border-light)]">
                      <input
                        type="text"
                        placeholder="Search suppliers..."
                        className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-md text-sm bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)]"
                        value={filters.search}
                        onChange={(e) => updateFilter('search', e.target.value)}
                      />
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {filteredSuppliers.length === 0 ? (
                        <div className="p-4 text-center text-[var(--ff-text-secondary)] text-sm">
                          No suppliers found
                        </div>
                      ) : (
                        <div className="py-1">
                          <button
                            onClick={() => {
                              setSupplier(undefined);
                              setShowSupplierDropdown(false);
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)] flex items-center space-x-3"
                          >
                            <div className="w-8 h-8 bg-[var(--ff-bg-tertiary)] rounded-lg flex items-center justify-center">
                              <Building2 className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                            </div>
                            <div>
                              <div className="font-medium text-[var(--ff-text-primary)]">All Suppliers</div>
                              <div className="text-xs text-[var(--ff-text-secondary)]">View all supplier data</div>
                            </div>
                          </button>
                          {filteredSuppliers.map(supplier => {
                            const StatusIcon = statusIcons[supplier.status];
                            return (
                              <button
                                key={supplier.id}
                                onClick={() => {
                                  setSupplier(supplier);
                                  setShowSupplierDropdown(false);
                                }}
                                className={cn(
                                  "w-full text-left px-3 py-2 text-sm hover:bg-[var(--ff-bg-hover)] flex items-center space-x-3",
                                  selectedSupplier?.id === supplier.id && "bg-blue-500/20"
                                )}
                              >
                                <div className="w-8 h-8 bg-blue-500/20 rounded-lg flex items-center justify-center">
                                  <Building2 className="w-4 h-4 text-blue-400" />
                                </div>
                                <div className="flex-1">
                                  <div className="font-medium text-[var(--ff-text-primary)]">
                                    {supplier.name}
                                  </div>
                                  <div className="text-xs text-[var(--ff-text-secondary)]">
                                    {supplier.code} • {supplier.category}
                                  </div>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <Star className="w-3 h-3 text-yellow-400 fill-current" />
                                  <span className="text-xs font-medium text-[var(--ff-text-primary)]">
                                    {supplier.rating}
                                  </span>
                                  <StatusIcon className={cn("w-3 h-3", statusColors[supplier.status])} />
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Filter Controls */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={cn(
                "flex items-center space-x-2 px-3 py-2 border rounded-md text-sm font-medium transition-colors",
                showFilters || hasActiveFilters
                  ? "bg-blue-500/20 border-blue-500/30 text-blue-400"
                  : "border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]"
              )}
            >
              <Filter className="h-4 w-4" />
              <span>Filters</span>
              {hasActiveFilters && (
                <span className="bg-blue-500/20 text-blue-400 text-xs rounded-full px-2 py-0.5">
                  Active
                </span>
              )}
            </button>

            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center space-x-1 px-3 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
              >
                <X className="h-4 w-4" />
                <span>Clear</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Expanded Filters */}
      {showFilters && (
        <div className="border-t border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Status Filter */}
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                Status
              </label>
              <div className="space-y-2">
                {filterOptions.statuses.map(status => {
                  const StatusIcon = statusIcons[status];
                  return (
                    <label key={status} className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={filters.status.includes(status)}
                        onChange={() => toggleArrayFilter('status', status)}
                        className="rounded border-[var(--ff-border-light)] text-blue-500 focus:ring-blue-500"
                      />
                      <StatusIcon className={cn("h-4 w-4", statusColors[status])} />
                      <span className="text-sm text-[var(--ff-text-secondary)] capitalize">
                        {status}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Category Filter */}
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                Category
              </label>
              <div className="space-y-2">
                {filterOptions.categories.map(category => (
                  <label key={category} className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={filters.category.includes(category)}
                      onChange={() => toggleArrayFilter('category', category)}
                      className="rounded border-[var(--ff-border-light)] text-blue-500 focus:ring-blue-500"
                    />
                    <span className="text-sm text-[var(--ff-text-secondary)]">{category}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Location Filter */}
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                Location
              </label>
              <div className="space-y-2">
                {filterOptions.locations.map((location: string) => (
                  <label key={location} className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={filters.location.includes(location)}
                      onChange={() => toggleArrayFilter('location', location)}
                      className="rounded border-[var(--ff-border-light)] text-blue-500 focus:ring-blue-500"
                    />
                    <MapPin className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
                    <span className="text-sm text-[var(--ff-text-secondary)]">{location}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Rating and Compliance Ranges */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                  Minimum Rating: {filters.ratingRange[0]}
                </label>
                <input
                  type="range"
                  min="0"
                  max="5"
                  step="0.1"
                  value={filters.ratingRange[0]}
                  onChange={(e) => updateFilter('ratingRange', [parseFloat(e.target.value), filters.ratingRange[1]])}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                  Minimum Compliance: {filters.complianceRange[0]}%
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={filters.complianceRange[0]}
                  onChange={(e) => updateFilter('complianceRange', [parseInt(e.target.value), filters.complianceRange[1]])}
                  className="w-full"
                />
              </div>
            </div>
          </div>

          {/* Results Summary */}
          <div className="mt-4 pt-4 border-t border-[var(--ff-border-light)]">
            <p className="text-sm text-[var(--ff-text-secondary)]">
              Showing {filteredSuppliers.length} of {suppliers.length} suppliers
              {hasActiveFilters && ' (filtered)'}
            </p>
          </div>
        </div>
      )}

      {/* Click outside handler */}
      {showSupplierDropdown && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => setShowSupplierDropdown(false)}
        />
      )}
    </div>
  );
}

export default SupplierFilter;