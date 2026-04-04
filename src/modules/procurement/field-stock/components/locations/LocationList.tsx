/**
 * LocationList Component
 * Displays list of stock locations with filters and actions
 */

'use client';

import { useState } from 'react';
import { MapPin, Plus, Search, Filter, Building2, Truck, User, Package } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useLocations } from '../../hooks';
import type { StockLocation, LocationType } from '../../types';

interface LocationListProps {
  onSelectLocation?: (location: StockLocation) => void;
  selectedLocationId?: string;
  showCreateButton?: boolean;
  onCreateClick?: () => void;
}

const locationTypeIcons: Record<LocationType, React.ReactNode> = {
  warehouse: <Building2 className="h-4 w-4" />,
  site_store: <Package className="h-4 w-4" />,
  transit: <Truck className="h-4 w-4" />,
  technician: <User className="h-4 w-4" />,
  customer: <MapPin className="h-4 w-4" />,
  scrap: <Package className="h-4 w-4" />,
  adjustment: <Package className="h-4 w-4" />,
};

const locationTypeLabels: Record<LocationType, string> = {
  warehouse: 'Warehouse',
  site_store: 'Site Store',
  transit: 'In Transit',
  technician: 'Technician Van',
  customer: 'Customer',
  scrap: 'Scrap',
  adjustment: 'Adjustment',
};

const locationTypeColors: Record<LocationType, string> = {
  warehouse: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  site_store: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  transit: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  technician: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  customer: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  scrap: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  adjustment: 'bg-secondary text-gray-800 dark:bg-gray-700 dark:text-gray-300',
};

export function LocationList({
  onSelectLocation,
  selectedLocationId,
  showCreateButton = true,
  onCreateClick,
}: LocationListProps) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<LocationType | ''>('');
  const [showFilters, setShowFilters] = useState(false);

  const { locations, loading, error, fetchLocations } = useLocations({
    filters: {
      search: search || undefined,
      locationType: typeFilter || undefined,
      isActive: true,
    },
    autoFetch: true,
  });

  const handleSearch = (value: string) => {
    setSearch(value);
    fetchLocations({
      search: value || undefined,
      locationType: typeFilter || undefined,
      isActive: true,
    });
  };

  const handleTypeFilter = (type: LocationType | '') => {
    setTypeFilter(type);
    fetchLocations({
      search: search || undefined,
      locationType: type || undefined,
      isActive: true,
    });
  };

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
        <p className="font-medium">Error loading locations</p>
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with Search and Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search locations..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-card py-2 pl-10 pr-4 text-sm text-foreground placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
              showFilters
                ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                : 'border-border bg-card text-muted-foreground hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            <Filter className="h-4 w-4" />
            Filters
          </button>

          {showCreateButton && (
            <button
              onClick={onCreateClick}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              Add Location
            </button>
          )}
        </div>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="rounded-lg border border-border bg-background p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleTypeFilter('')}
              className={`rounded-full px-3 py-1 text-sm font-medium ${
                typeFilter === ''
                  ? 'bg-blue-600 text-white'
                  : 'bg-card text-muted-foreground hover:bg-secondary dark:text-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              All Types
            </button>
            {Object.entries(locationTypeLabels).map(([type, label]) => (
              <button
                key={type}
                onClick={() => handleTypeFilter(type as LocationType)}
                className={`rounded-full px-3 py-1 text-sm font-medium ${
                  typeFilter === type
                    ? 'bg-blue-600 text-white'
                    : 'bg-card text-muted-foreground hover:bg-secondary dark:text-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && <LoadingSpinner className="h-32" label="" />}

      {/* Location List */}
      {!loading && locations.length === 0 && (
        <div className="rounded-lg border border-border bg-background p-8 text-center dark:border-gray-700 dark:bg-gray-800">
          <MapPin className="mx-auto h-12 w-12 text-gray-400" />
          <p className="mt-2 text-muted-foreground">No locations found</p>
          <p className="text-sm text-muted-foreground">
            {search ? 'Try a different search term' : 'Create your first location to get started'}
          </p>
        </div>
      )}

      {!loading && locations.length > 0 && (
        <div className="divide-y divide-gray-200 rounded-lg border border-border bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-800">
          {locations.map((location) => (
            <button
              key={location.id}
              onClick={() => onSelectLocation?.(location)}
              className={`flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-accent ${
                selectedLocationId === location.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
              }`}
            >
              <div className="flex items-center gap-4">
                <div className={`rounded-lg p-2 ${locationTypeColors[location.locationType]}`}>
                  {locationTypeIcons[location.locationType]}
                </div>
                <div>
                  <p className="font-medium text-foreground">{location.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {location.code}
                    {location.assignedToName && ` • ${location.assignedToName}`}
                  </p>
                </div>
              </div>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  locationTypeColors[location.locationType]
                }`}
              >
                {locationTypeLabels[location.locationType]}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
