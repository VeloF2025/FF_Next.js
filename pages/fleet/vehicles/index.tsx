/**
 * Fleet Vehicles List Page
 * View and manage all fleet vehicles
 */

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  Car,
  Plus,
  Search,
  MoreHorizontal,
  User,
  Wrench,
  XCircle,
  Eye,
  Edit,
  Trash2,
  FileText,
  AlertTriangle,
} from 'lucide-react';

interface FleetVehicle {
  id: string;
  registration: string;
  vehicleType: string;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  status: 'active' | 'maintenance' | 'retired';
  ownershipType: string;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  createdAt: string;
}

const statusConfig = {
  active: { label: 'Active', color: 'bg-green-100 text-green-800', icon: Car },
  maintenance: { label: 'Maintenance', color: 'bg-yellow-100 text-yellow-800', icon: Wrench },
  retired: { label: 'Retired', color: 'bg-gray-100 text-gray-800', icon: XCircle },
};

const vehicleTypeLabels: Record<string, string> = {
  bakkie: 'Bakkie',
  sedan: 'Sedan',
  van: 'Van',
  truck: 'Truck',
  suv: 'SUV',
  motorcycle: 'Motorcycle',
  other: 'Other',
};

export default function FleetVehiclesPage() {
  const router = useRouter();
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [actionsMenuId, setActionsMenuId] = useState<string | null>(null);
  const actionsMenuRef = useRef<HTMLDivElement>(null);

  // Close actions menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(event.target as Node)) {
        setActionsMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const fetchVehicles = async () => {
      try {
        const params = new URLSearchParams();
        if (search) params.append('search', search);
        if (statusFilter) params.append('status', statusFilter);
        if (typeFilter) params.append('type', typeFilter);

        const res = await fetch(`/api/fleet/vehicles?${params.toString()}`);
        const data = await res.json();
        setVehicles(data.data || []);
        setLoading(false);
      } catch (err) {
        setError('Failed to load vehicles');
        setLoading(false);
      }
    };

    fetchVehicles();
  }, [search, statusFilter, typeFilter]);

  const filteredVehicles = vehicles;

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Fleet Vehicles</h1>
            <p className="text-[var(--ff-text-secondary)]">
              {vehicles.length} vehicle{vehicles.length !== 1 ? 's' : ''} in fleet
            </p>
          </div>
          <button className="px-4 py-2 bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary-dark)] transition-colors flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Add Vehicle
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
              <input
                type="text"
                placeholder="Search by registration, make, or model..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]"
              />
            </div>
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]"
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="maintenance">Maintenance</option>
            <option value="retired">Retired</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]"
          >
            <option value="">All Types</option>
            <option value="bakkie">Bakkie</option>
            <option value="sedan">Sedan</option>
            <option value="van">Van</option>
            <option value="truck">Truck</option>
            <option value="suv">SUV</option>
          </select>
        </div>

        {/* Vehicles Table */}
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
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)]">
            <table className="w-full">
              <thead className="bg-[var(--ff-bg-tertiary)]">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                    Vehicle
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                    Assigned To
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ff-border-light)]">
                {filteredVehicles.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center">
                      <Car className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
                      <p className="text-[var(--ff-text-secondary)]">No vehicles found</p>
                    </td>
                  </tr>
                ) : (
                  filteredVehicles.map((vehicle) => {
                    const status = statusConfig[vehicle.status];
                    const StatusIcon = status.icon;
                    return (
                      <tr
                        key={vehicle.id}
                        className="hover:bg-[var(--ff-bg-tertiary)] cursor-pointer"
                        onClick={() => router.push(`/fleet/vehicles/${vehicle.id}`)}
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-[var(--ff-bg-tertiary)] rounded-lg">
                              <Car className="w-5 h-5 text-[var(--ff-text-secondary)]" />
                            </div>
                            <div>
                              <p className="font-medium text-[var(--ff-text-primary)]">
                                {vehicle.registration}
                              </p>
                              <p className="text-sm text-[var(--ff-text-secondary)]">
                                {vehicle.make} {vehicle.model} {vehicle.year || ''}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-[var(--ff-text-primary)]">
                            {vehicleTypeLabels[vehicle.vehicleType] || vehicle.vehicleType}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
                            <StatusIcon className="w-3 h-3" />
                            {status.label}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {vehicle.assignedStaffName ? (
                            <div className="flex items-center gap-2">
                              <User className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                              <span className="text-[var(--ff-text-primary)]">{vehicle.assignedStaffName}</span>
                            </div>
                          ) : (
                            <span className="text-[var(--ff-text-tertiary)]">Unassigned</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right relative">
                          <button
                            className="p-2 hover:bg-[var(--ff-bg-primary)] rounded-lg transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActionsMenuId(actionsMenuId === vehicle.id ? null : vehicle.id);
                            }}
                          >
                            <MoreHorizontal className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                          </button>
                          {actionsMenuId === vehicle.id && (
                            <div
                              ref={actionsMenuRef}
                              className="absolute right-0 top-full mt-1 w-48 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg shadow-lg z-50"
                            >
                              <button
                                className="w-full px-4 py-2 text-left text-sm text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)] flex items-center gap-2 rounded-t-lg"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  router.push(`/fleet/vehicles/${vehicle.id}`);
                                }}
                              >
                                <Eye className="w-4 h-4" />
                                View Details
                              </button>
                              <button
                                className="w-full px-4 py-2 text-left text-sm text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)] flex items-center gap-2"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  router.push(`/fleet/vehicles/${vehicle.id}?edit=true`);
                                }}
                              >
                                <Edit className="w-4 h-4" />
                                Edit Vehicle
                              </button>
                              <button
                                className="w-full px-4 py-2 text-left text-sm text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)] flex items-center gap-2"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  router.push(`/fleet/investigation?vehicleId=${vehicle.id}`);
                                }}
                              >
                                <FileText className="w-4 h-4" />
                                GPS Investigation
                              </button>
                              <button
                                className="w-full px-4 py-2 text-left text-sm text-red-500 hover:bg-[var(--ff-bg-tertiary)] flex items-center gap-2 rounded-b-lg"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // TODO: Add delete confirmation
                                  alert('Delete functionality coming soon');
                                }}
                              >
                                <Trash2 className="w-4 h-4" />
                                Delete Vehicle
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
