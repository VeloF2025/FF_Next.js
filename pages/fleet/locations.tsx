/**
 * Fleet Authorized Locations Page
 * Manage geofencing zones for trip classification
 */

import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { fleetConfig } from '@/modules/navigation';
import {
  MapPin,
  Plus,
  Search,
  Globe,
  Car,
  Building2,
  Home,
  Truck,
  AlertTriangle,
  Pencil,
  Trash2,
} from 'lucide-react';

interface AuthorizedLocation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
  locationType: string;
  isGlobal: boolean;
  vehicleId: string | null;
  vehicleRegistration: string | null;
  isActive: boolean;
  createdAt: string;
}

const defaultTypeConfig = { label: 'Other', icon: MapPin, color: 'bg-gray-100 text-gray-800' };

const locationTypeConfig: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  work_site: { label: 'Work Site', icon: Building2, color: 'bg-blue-100 text-blue-800' },
  accommodation: { label: 'Accommodation', icon: Home, color: 'bg-purple-100 text-purple-800' },
  supplier: { label: 'Supplier', icon: Truck, color: 'bg-green-100 text-green-800' },
  client: { label: 'Client', icon: Building2, color: 'bg-orange-100 text-orange-800' },
  depot: { label: 'Depot', icon: MapPin, color: 'bg-gray-100 text-gray-800' },
  other: defaultTypeConfig,
};

export default function FleetLocationsPage() {
  const [locations, setLocations] = useState<AuthorizedLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  useEffect(() => {
    const fetchLocations = async () => {
      try {
        const params = new URLSearchParams();
        if (showInactive) params.append('active', 'false');

        const res = await fetch(`/api/fleet/locations?${params.toString()}`);
        const data = await res.json();
        setLocations(data.data || []);
        setLoading(false);
      } catch (err) {
        setError('Failed to load locations');
        setLoading(false);
      }
    };

    fetchLocations();
  }, [showInactive]);

  const filteredLocations = locations.filter((loc) =>
    loc.name.toLowerCase().includes(search.toLowerCase())
  );

  const globalLocations = filteredLocations.filter((l) => l.isGlobal);
  const vehicleLocations = filteredLocations.filter((l) => !l.isGlobal);

  return (
    <AppLayout>
        <ModulePage config={fleetConfig}>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Authorized Locations</h1>
            <p className="text-[var(--ff-text-secondary)]">
              Configure geofencing zones for trip classification
            </p>
          </div>
          <button className="px-4 py-2 bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary-dark)] transition-colors flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Add Location
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
              <input
                type="text"
                placeholder="Search locations..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded border-[var(--ff-border-light)]"
            />
            <span className="text-[var(--ff-text-secondary)]">Show inactive</span>
          </label>
        </div>

        {loading ? (
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)] p-8">
            <div className="animate-pulse space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-16 bg-[var(--ff-bg-tertiary)] rounded"></div>
              ))}
            </div>
          </div>
        ) : error ? (
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)] p-8 text-center">
            <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <p className="text-[var(--ff-text-primary)]">{error}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Global Locations */}
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)]">
              <div className="px-6 py-4 border-b border-[var(--ff-border-light)]">
                <div className="flex items-center gap-2">
                  <Globe className="w-5 h-5 text-[var(--ff-primary)]" />
                  <h2 className="font-semibold text-[var(--ff-text-primary)]">Global Locations</h2>
                  <span className="text-sm text-[var(--ff-text-secondary)]">
                    ({globalLocations.length})
                  </span>
                </div>
                <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
                  Apply to all vehicles
                </p>
              </div>
              <div className="divide-y divide-[var(--ff-border-light)]">
                {globalLocations.length === 0 ? (
                  <div className="px-6 py-8 text-center">
                    <MapPin className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
                    <p className="text-[var(--ff-text-secondary)]">No global locations</p>
                  </div>
                ) : (
                  globalLocations.map((location) => {
                    const typeConfig = locationTypeConfig[location.locationType] ?? defaultTypeConfig;
                    const TypeIcon = typeConfig.icon;
                    return (
                      <div key={location.id} className="px-6 py-4 flex items-center justify-between hover:bg-[var(--ff-bg-tertiary)]">
                        <div className="flex items-center gap-4">
                          <div className={`p-2 rounded-lg ${typeConfig.color}`}>
                            <TypeIcon className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="font-medium text-[var(--ff-text-primary)]">{location.name}</p>
                            <p className="text-sm text-[var(--ff-text-secondary)]">
                              {location.lat.toFixed(4)}, {location.lon.toFixed(4)} • {location.radiusKm}km radius
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {!location.isActive && (
                            <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-full">
                              Inactive
                            </span>
                          )}
                          <button className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg">
                            <Pencil className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                          </button>
                          <button className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg">
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Vehicle-Specific Locations */}
            {vehicleLocations.length > 0 && (
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)]">
                <div className="px-6 py-4 border-b border-[var(--ff-border-light)]">
                  <div className="flex items-center gap-2">
                    <Car className="w-5 h-5 text-[var(--ff-primary)]" />
                    <h2 className="font-semibold text-[var(--ff-text-primary)]">Vehicle-Specific Locations</h2>
                    <span className="text-sm text-[var(--ff-text-secondary)]">
                      ({vehicleLocations.length})
                    </span>
                  </div>
                  <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
                    Override for specific vehicles
                  </p>
                </div>
                <div className="divide-y divide-[var(--ff-border-light)]">
                  {vehicleLocations.map((location) => {
                    const typeConfig = locationTypeConfig[location.locationType] ?? defaultTypeConfig;
                    const TypeIcon = typeConfig.icon;
                    return (
                      <div key={location.id} className="px-6 py-4 flex items-center justify-between hover:bg-[var(--ff-bg-tertiary)]">
                        <div className="flex items-center gap-4">
                          <div className={`p-2 rounded-lg ${typeConfig.color}`}>
                            <TypeIcon className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="font-medium text-[var(--ff-text-primary)]">{location.name}</p>
                            <p className="text-sm text-[var(--ff-text-secondary)]">
                              {location.vehicleRegistration} • {location.radiusKm}km radius
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {!location.isActive && (
                            <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-full">
                              Inactive
                            </span>
                          )}
                          <button className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg">
                            <Pencil className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                          </button>
                          <button className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg">
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </ModulePage>
      </AppLayout>
  );
}
