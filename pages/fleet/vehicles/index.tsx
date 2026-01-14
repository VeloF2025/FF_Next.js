/**
 * Fleet Vehicles List Page
 * View and manage all fleet vehicles
 */

import { useState, useEffect, useRef, useCallback } from 'react';
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
  Upload,
  Camera,
  CheckCircle,
  Loader2,
  Calendar,
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
  licenseDiscExpiry: string | null;
  expiryStatus: 'ok' | 'warning' | 'critical' | 'expired' | null;
}

const statusConfig = {
  active: { label: 'Active', color: 'bg-green-100 text-green-800', icon: Car },
  maintenance: { label: 'Maintenance', color: 'bg-yellow-100 text-yellow-800', icon: Wrench },
  retired: { label: 'Retired', color: 'bg-gray-100 text-gray-800', icon: XCircle },
};

const expiryStatusConfig = {
  ok: { label: 'Valid', color: 'bg-green-100 text-green-800' },
  warning: { label: 'Expiring', color: 'bg-yellow-100 text-yellow-800' },
  critical: { label: 'Critical', color: 'bg-orange-100 text-orange-800' },
  expired: { label: 'Expired', color: 'bg-red-100 text-red-800' },
};

function formatExpiryDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  const now = new Date();
  const daysUntil = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntil < 0) return `Expired ${Math.abs(daysUntil)}d ago`;
  if (daysUntil === 0) return 'Today';
  if (daysUntil === 1) return 'Tomorrow';
  if (daysUntil <= 30) return `${daysUntil}d left`;
  return date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}

const vehicleTypeLabels: Record<string, string> = {
  bakkie: 'Bakkie',
  sedan: 'Sedan',
  van: 'Van',
  truck: 'Truck',
  suv: 'SUV',
  motorcycle: 'Motorcycle',
  other: 'Other',
};

interface NewVehicleForm {
  registration: string;
  vehicleType: string;
  make: string;
  model: string;
  year: string;
  color: string;
  ownershipType: string;
  vin: string;
  engineNumber: string;
}

const initialFormState: NewVehicleForm = {
  registration: '',
  vehicleType: 'bakkie',
  make: '',
  model: '',
  year: '',
  color: '',
  ownershipType: 'company',
  vin: '',
  engineNumber: '',
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

  // Add Vehicle Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newVehicleForm, setNewVehicleForm] = useState<NewVehicleForm>(initialFormState);
  const [saving, setSaving] = useState(false);

  // Licence Disk OCR state
  const [licenseDiskImage, setLicenseDiskImage] = useState<string | null>(null);
  const [processingOcr, setProcessingOcr] = useState(false);
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const fetchVehicles = useCallback(async () => {
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
  }, [search, statusFilter, typeFilter]);

  useEffect(() => {
    fetchVehicles();
  }, [fetchVehicles]);

  // Process licence disk photo with OCR
  const processLicenseDisk = useCallback(async (base64Image: string) => {
    setProcessingOcr(true);
    setOcrError(null);
    setOcrConfidence(null);

    try {
      const res = await fetch('/api/fleet/vehicles/extract-license-disk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Image }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setOcrError(data.error || 'Failed to process licence disk');
        return;
      }

      const result = data.data;
      setOcrConfidence(result.confidence);

      // Auto-populate form fields from OCR result
      setNewVehicleForm((prev) => ({
        ...prev,
        registration: result.registration || prev.registration,
        vin: result.vin || prev.vin,
        engineNumber: result.engineNumber || prev.engineNumber,
        make: result.make || prev.make,
        model: result.description || prev.model,
        year: result.year?.toString() || prev.year,
        color: result.color || prev.color,
      }));

      if (result.error) {
        setOcrError(result.error);
      }
    } catch (err) {
      setOcrError('Failed to process licence disk photo');
    } finally {
      setProcessingOcr(false);
    }
  }, []);

  // Handle file selection for licence disk
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Validate file type
      if (!file.type.startsWith('image/')) {
        setOcrError('Please select an image file');
        return;
      }

      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        setOcrError('Image must be less than 10MB');
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        setLicenseDiskImage(base64);
        processLicenseDisk(base64);
      };
      reader.readAsDataURL(file);
    },
    [processLicenseDisk]
  );

  const handleAddVehicle = async () => {
    if (!newVehicleForm.registration.trim()) {
      alert('Registration is required');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/fleet/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registration: newVehicleForm.registration.trim().toUpperCase(),
          vehicleType: newVehicleForm.vehicleType,
          make: newVehicleForm.make.trim() || null,
          model: newVehicleForm.model.trim() || null,
          year: newVehicleForm.year ? parseInt(newVehicleForm.year) : null,
          color: newVehicleForm.color.trim() || null,
          ownershipType: newVehicleForm.ownershipType,
          vin: newVehicleForm.vin.trim() || null,
          engineNumber: newVehicleForm.engineNumber.trim() || null,
          status: 'active',
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || 'Failed to add vehicle');
        return;
      }

      const vehicleId = data.data?.id;

      // Reset form and close modal
      setNewVehicleForm(initialFormState);
      setLicenseDiskImage(null);
      setOcrConfidence(null);
      setOcrError(null);
      setShowAddModal(false);

      // Refresh vehicles list
      fetchVehicles();

      // Navigate to the new vehicle
      if (vehicleId) {
        router.push(`/fleet/vehicles/${vehicleId}`);
      }
    } catch (err) {
      alert('Failed to add vehicle');
    } finally {
      setSaving(false);
    }
  };

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
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary-dark)] transition-colors flex items-center gap-2"
          >
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
                    License Disk
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
                    <td colSpan={6} className="px-6 py-12 text-center">
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
                          {vehicle.expiryStatus ? (
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${expiryStatusConfig[vehicle.expiryStatus].color}`}>
                                <Calendar className="w-3 h-3" />
                                {formatExpiryDate(vehicle.licenseDiscExpiry)}
                              </span>
                            </div>
                          ) : (
                            <span className="text-[var(--ff-text-tertiary)] text-sm">No disc</span>
                          )}
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

        {/* Add Vehicle Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between p-4 border-b border-[var(--ff-border-light)] sticky top-0 bg-[var(--ff-bg-secondary)] z-10">
                <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Add New Vehicle</h2>
                <button
                  onClick={() => {
                    setShowAddModal(false);
                    setNewVehicleForm(initialFormState);
                    setLicenseDiskImage(null);
                    setOcrConfidence(null);
                    setOcrError(null);
                  }}
                  className="p-1 hover:bg-[var(--ff-bg-tertiary)] rounded"
                >
                  <XCircle className="w-5 h-5 text-[var(--ff-text-secondary)]" />
                </button>
              </div>
              <div className="p-4 space-y-4">
                {/* Licence Disk Photo Upload */}
                <div className="border-2 border-dashed border-[var(--ff-border-light)] rounded-lg p-4">
                  <div className="text-center">
                    <p className="text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                      Upload Licence Disk Photo
                    </p>
                    <p className="text-xs text-[var(--ff-text-tertiary)] mb-3">
                      Auto-fill vehicle details using OCR
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    {!licenseDiskImage ? (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={processingOcr}
                        className="px-4 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] rounded-lg hover:bg-[var(--ff-border-light)] transition-colors flex items-center gap-2 mx-auto"
                      >
                        <Camera className="w-4 h-4" />
                        Take Photo or Upload
                      </button>
                    ) : (
                      <div className="space-y-3">
                        <div className="relative inline-block">
                          <img
                            src={licenseDiskImage}
                            alt="Licence disk"
                            className="max-h-32 rounded-lg border border-[var(--ff-border-light)]"
                          />
                          {processingOcr && (
                            <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center">
                              <Loader2 className="w-6 h-6 text-white animate-spin" />
                            </div>
                          )}
                        </div>
                        <div className="flex items-center justify-center gap-2">
                          {ocrConfidence !== null && !processingOcr && (
                            <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded ${
                              ocrConfidence >= 0.8
                                ? 'bg-green-100 text-green-800'
                                : ocrConfidence >= 0.5
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-red-100 text-red-800'
                            }`}>
                              <CheckCircle className="w-3 h-3" />
                              {Math.round(ocrConfidence * 100)}% confidence
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setLicenseDiskImage(null);
                              setOcrConfidence(null);
                              setOcrError(null);
                              if (fileInputRef.current) fileInputRef.current.value = '';
                            }}
                            className="text-xs text-red-500 hover:underline"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    )}
                    {ocrError && (
                      <p className="text-xs text-red-500 mt-2">{ocrError}</p>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                    Registration *
                  </label>
                  <input
                    type="text"
                    value={newVehicleForm.registration}
                    onChange={(e) => setNewVehicleForm({ ...newVehicleForm, registration: e.target.value })}
                    placeholder="e.g., GP 123-456"
                    className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                      Vehicle Type
                    </label>
                    <select
                      value={newVehicleForm.vehicleType}
                      onChange={(e) => setNewVehicleForm({ ...newVehicleForm, vehicleType: e.target.value })}
                      className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]"
                    >
                      {Object.entries(vehicleTypeLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                      Ownership
                    </label>
                    <select
                      value={newVehicleForm.ownershipType}
                      onChange={(e) => setNewVehicleForm({ ...newVehicleForm, ownershipType: e.target.value })}
                      className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]"
                    >
                      <option value="company">Company Owned</option>
                      <option value="rental">Rental</option>
                      <option value="leased">Leased</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                      Make
                    </label>
                    <input
                      type="text"
                      value={newVehicleForm.make}
                      onChange={(e) => setNewVehicleForm({ ...newVehicleForm, make: e.target.value })}
                      placeholder="e.g., Toyota"
                      className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                      Model
                    </label>
                    <input
                      type="text"
                      value={newVehicleForm.model}
                      onChange={(e) => setNewVehicleForm({ ...newVehicleForm, model: e.target.value })}
                      placeholder="e.g., Hilux"
                      className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                      Year
                    </label>
                    <input
                      type="number"
                      value={newVehicleForm.year}
                      onChange={(e) => setNewVehicleForm({ ...newVehicleForm, year: e.target.value })}
                      placeholder="e.g., 2023"
                      className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                      Color
                    </label>
                    <input
                      type="text"
                      value={newVehicleForm.color}
                      onChange={(e) => setNewVehicleForm({ ...newVehicleForm, color: e.target.value })}
                      placeholder="e.g., White"
                      className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)]"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                    VIN (Vehicle Identification Number)
                  </label>
                  <input
                    type="text"
                    value={newVehicleForm.vin}
                    onChange={(e) => setNewVehicleForm({ ...newVehicleForm, vin: e.target.value })}
                    placeholder="e.g., AHTFZ29G109011234"
                    className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)] font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                    Engine Number
                  </label>
                  <input
                    type="text"
                    value={newVehicleForm.engineNumber}
                    onChange={(e) => setNewVehicleForm({ ...newVehicleForm, engineNumber: e.target.value })}
                    placeholder="e.g., 2KD-1234567"
                    className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary)] font-mono text-sm"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 p-4 border-t border-[var(--ff-border-light)] sticky bottom-0 bg-[var(--ff-bg-secondary)]">
                <button
                  onClick={() => {
                    setShowAddModal(false);
                    setNewVehicleForm(initialFormState);
                    setLicenseDiskImage(null);
                    setOcrConfidence(null);
                    setOcrError(null);
                  }}
                  className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors text-[var(--ff-text-primary)]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddVehicle}
                  disabled={saving}
                  className="px-4 py-2 bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary-dark)] transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {saving ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      Adding...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      Add Vehicle
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
