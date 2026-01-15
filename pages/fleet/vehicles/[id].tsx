/**
 * Fleet Vehicle Detail Page
 * View and edit vehicle details with tabbed ownership data
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout/AppLayout';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  Car,
  ArrowLeft,
  Edit,
  Trash2,
  User,
  Fuel,
  TrendingDown,
  MapPin,
  FileText,
  AlertTriangle,
  X,
  Save,
  Wrench,
  XCircle,
  Shield,
  Building2,
  FileCheck,
  Clock,
  Plus,
  ExternalLink,
  Phone,
  Mail,
  DollarSign,
  RefreshCw,
  Loader2,
  Gauge,
  Camera,
  CheckCircle,
  TrendingUp,
  Pencil,
  Receipt,
  ImageIcon,
} from 'lucide-react';
import type {
  VehicleDocument,
  LicenseDisc,
  VehicleFinance,
  VehicleLease,
  VehicleInsurance,
} from '@/modules/fleet/types';

// ============================================================================
// Types
// ============================================================================

interface FleetVehicle {
  id: string;
  registration: string;
  vehicleType: string;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  vin: string | null;
  status: 'active' | 'maintenance' | 'retired';
  ownershipType: string;
  ownerName: string | null;
  fuelRatePerKm: number;
  depreciationRatePerKm: number;
  notes: string | null;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  // New ownership fields
  isFinanced: boolean;
  natisNumber: string | null;
  engineNumber: string | null;
  chassisNumber: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Investigation {
  id: string;
  fileName: string;
  status: string;
  periodStart: string | null;
  periodEnd: string | null;
  totalTrips: number;
  createdAt: string;
}

type TabId = 'overview' | 'odometer' | 'fuel' | 'ownership' | 'documents' | 'insurance';

interface OdometerReading {
  id: string;
  reading: number;
  source: 'manual' | 'vlm';
  vlmConfidence: number | null;
  previousReading: number | null;
  kmSinceLast: number | null;
  discrepancyFlag: boolean;
  discrepancyReason: string | null;
  recordedAt: string;
}

interface OdometerAnomaly {
  id: string;
  anomalyType: string;
  odometerReading: number;
  previousReading: number | null;
  severity: 'warning' | 'critical';
  resolved: boolean;
  detectedAt: string;
}

interface FuelReading {
  id: string;
  vehicleId: string;
  fuelLevel: number;
  source: 'manual' | 'vlm';
  vlmConfidence: number | null;
  previousLevel: number | null;
  levelChange: number | null;
  recordedAt: string;
}

interface FuelTransaction {
  id: string;
  vehicleId: string;
  transactionDate: string;
  amountRand: number;
  litres: number;
  pricePerLitre: number | null;
  odometerReading: number | null;
  kmSinceLastFill: number | null;
  litresPer100km: number | null;
  stationName: string | null;
  stationLocation: string | null;
  receiptPhotoUrl: string | null;
  odometerPhotoUrl: string | null;
  vlmExtracted: boolean;
  vlmConfidence: number | null;
  vlmVerified: boolean;
  source: 'manual' | 'vlm' | 'hybrid';
  createdAt: string;
}

interface FuelSummary {
  totalSpent: number;
  totalLitres: number;
  avgConsumption: number | null;
  transactionCount: number;
}

interface VehicleStatistics {
  odometer: {
    today: number;
    thisWeek: number;
    thisMonth: number;
    lastMonth: number;
    total: number;
    averagePerDay: number;
    latestReading: number;
    earliestReading: number;
    readingsCount: number;
  };
  fuel: {
    currentLevel: number | null;
    averageLevel: number | null;
    lowestLevel: number;
    highestLevel: number;
    readingsCount: number;
  };
  checkIns: {
    totalCheckIns: number;
    thisMonth: number;
    lastCheckIn: string | null;
    passRate: number;
    criticalIssuesCount: number;
  };
  customRange: {
    startDate: string;
    endDate: string;
    totalKm: number;
    startReading: number;
    endReading: number;
    readingsCount: number;
    daysInRange: number;
    averagePerDay: number;
  } | null;
}

interface AssignedDriver {
  assignmentId: string;
  staffId: string;
  staffName: string;
  staffEmail: string | null;
  staffPhone: string | null;
  staffPhotoUrl: string | null;
  assignmentStart: string;
  assignmentEnd: string | null;
  fuelCardNumber: string | null;
  fuelCardLimit: number | null;
  notes: string | null;
  hasValidLicense: boolean;
  licenseExpiry: string | null;
  isActive: boolean;
}

interface StaffOption {
  id: string;
  name: string;
  email: string | null;
  hasValidLicense: boolean;
  hasVehicle: boolean;
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

const ownershipLabels: Record<string, string> = {
  company: 'Company Owned',
  rental: 'Rental',
  leased: 'Leased',
};

// ============================================================================
// Utility Functions
// ============================================================================

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-ZA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatCurrency(amount: number | null): string {
  if (amount === null || amount === undefined) return '-';
  return `R${Number(amount).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getDaysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const now = new Date();
  const date = new Date(dateStr);
  const diff = date.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function getExpiryBadge(dateStr: string | null): { text: string; color: string } {
  const days = getDaysUntil(dateStr);
  if (days === null) return { text: 'No date', color: 'bg-gray-100 text-gray-600' };
  if (days < 0) return { text: `${Math.abs(days)} days overdue`, color: 'bg-red-100 text-red-700' };
  if (days <= 7) return { text: `${days} days left`, color: 'bg-red-100 text-red-700' };
  if (days <= 30) return { text: `${days} days left`, color: 'bg-yellow-100 text-yellow-700' };
  return { text: `${days} days left`, color: 'bg-green-100 text-green-700' };
}

// ============================================================================
// Tab Components
// ============================================================================

function OverviewTab({
  vehicle,
  isEditing,
  editForm,
  setEditForm,
}: {
  vehicle: FleetVehicle;
  isEditing: boolean;
  editForm: Partial<FleetVehicle>;
  setEditForm: (form: Partial<FleetVehicle>) => void;
}) {
  const status = statusConfig[vehicle.status];
  const StatusIcon = status.icon;

  return (
    <div className="space-y-6">
      {/* Vehicle Details */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)] p-6">
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
          Vehicle Details
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
              Registration
            </label>
            {isEditing ? (
              <input
                type="text"
                value={editForm.registration || ''}
                onChange={(e) => setEditForm({ ...editForm, registration: e.target.value })}
                className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg"
              />
            ) : (
              <p className="text-[var(--ff-text-primary)] font-medium">{vehicle.registration}</p>
            )}
          </div>
          <div>
            <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
              Type
            </label>
            {isEditing ? (
              <select
                value={editForm.vehicleType || ''}
                onChange={(e) => setEditForm({ ...editForm, vehicleType: e.target.value })}
                className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg"
              >
                {Object.entries(vehicleTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            ) : (
              <p className="text-[var(--ff-text-primary)]">
                {vehicleTypeLabels[vehicle.vehicleType] || vehicle.vehicleType}
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
              Make
            </label>
            {isEditing ? (
              <input
                type="text"
                value={editForm.make || ''}
                onChange={(e) => setEditForm({ ...editForm, make: e.target.value })}
                className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg"
              />
            ) : (
              <p className="text-[var(--ff-text-primary)]">{vehicle.make || '-'}</p>
            )}
          </div>
          <div>
            <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
              Model
            </label>
            {isEditing ? (
              <input
                type="text"
                value={editForm.model || ''}
                onChange={(e) => setEditForm({ ...editForm, model: e.target.value })}
                className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg"
              />
            ) : (
              <p className="text-[var(--ff-text-primary)]">{vehicle.model || '-'}</p>
            )}
          </div>
          <div>
            <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
              Year
            </label>
            {isEditing ? (
              <input
                type="number"
                value={editForm.year || ''}
                onChange={(e) => setEditForm({ ...editForm, year: parseInt(e.target.value) || null })}
                className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg"
              />
            ) : (
              <p className="text-[var(--ff-text-primary)]">{vehicle.year || '-'}</p>
            )}
          </div>
          <div>
            <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
              Color
            </label>
            {isEditing ? (
              <input
                type="text"
                value={editForm.color || ''}
                onChange={(e) => setEditForm({ ...editForm, color: e.target.value })}
                className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg"
              />
            ) : (
              <p className="text-[var(--ff-text-primary)]">{vehicle.color || '-'}</p>
            )}
          </div>
          <div className="col-span-2">
            <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
              VIN
            </label>
            {isEditing ? (
              <input
                type="text"
                value={editForm.vin || ''}
                onChange={(e) => setEditForm({ ...editForm, vin: e.target.value })}
                className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg"
              />
            ) : (
              <p className="text-[var(--ff-text-primary)] font-mono">{vehicle.vin || '-'}</p>
            )}
          </div>
          <div>
            <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
              Status
            </label>
            {isEditing ? (
              <select
                value={editForm.status || ''}
                onChange={(e) => setEditForm({ ...editForm, status: e.target.value as FleetVehicle['status'] })}
                className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg"
              >
                <option value="active">Active</option>
                <option value="maintenance">Maintenance</option>
                <option value="retired">Retired</option>
              </select>
            ) : (
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
                <StatusIcon className="w-3 h-3" />
                {status.label}
              </span>
            )}
          </div>
          <div>
            <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
              Ownership
            </label>
            {isEditing ? (
              <select
                value={editForm.ownershipType || ''}
                onChange={(e) => setEditForm({ ...editForm, ownershipType: e.target.value })}
                className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg"
              >
                <option value="company">Company Owned</option>
                <option value="rental">Rental</option>
                <option value="leased">Leased</option>
              </select>
            ) : (
              <p className="text-[var(--ff-text-primary)]">
                {ownershipLabels[vehicle.ownershipType] || vehicle.ownershipType}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Cost Rates */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)] p-6">
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
          Cost Rates (for GPS Investigation)
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
              <Fuel className="w-4 h-4 inline mr-1" />
              Fuel Rate (R/km)
            </label>
            {isEditing ? (
              <input
                type="number"
                step="0.01"
                value={editForm.fuelRatePerKm || ''}
                onChange={(e) => setEditForm({ ...editForm, fuelRatePerKm: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg"
              />
            ) : (
              <p className="text-[var(--ff-text-primary)] text-lg font-semibold">
                R{Number(vehicle.fuelRatePerKm).toFixed(2)}
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
              <TrendingDown className="w-4 h-4 inline mr-1" />
              Depreciation Rate (R/km)
            </label>
            {isEditing ? (
              <input
                type="number"
                step="0.01"
                value={editForm.depreciationRatePerKm || ''}
                onChange={(e) => setEditForm({ ...editForm, depreciationRatePerKm: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg"
              />
            ) : (
              <p className="text-[var(--ff-text-primary)] text-lg font-semibold">
                R{Number(vehicle.depreciationRatePerKm).toFixed(2)}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)] p-6">
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
          Notes
        </h2>
        {isEditing ? (
          <textarea
            value={editForm.notes || ''}
            onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
            rows={4}
            className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg"
            placeholder="Add notes about this vehicle..."
          />
        ) : (
          <p className="text-[var(--ff-text-primary)]">
            {vehicle.notes || 'No notes'}
          </p>
        )}
      </div>
    </div>
  );
}

function OwnershipTab({
  vehicle,
  lease,
  finance,
  loadingOwnership,
}: {
  vehicle: FleetVehicle;
  lease: VehicleLease | null;
  finance: VehicleFinance | null;
  loadingOwnership: boolean;
}) {
  if (loadingOwnership) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-48 bg-[var(--ff-bg-tertiary)] rounded-lg"></div>
        <div className="h-48 bg-[var(--ff-bg-tertiary)] rounded-lg"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* NATIS / Registration Info */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)] p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] flex items-center gap-2">
            <FileCheck className="w-5 h-5 text-[var(--ff-primary)]" />
            NATIS / Registration
          </h2>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
              NATIS Number
            </label>
            <p className="text-[var(--ff-text-primary)] font-mono">
              {vehicle.natisNumber || '-'}
            </p>
          </div>
          <div>
            <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
              Engine Number
            </label>
            <p className="text-[var(--ff-text-primary)] font-mono">
              {vehicle.engineNumber || '-'}
            </p>
          </div>
          <div>
            <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
              Chassis Number
            </label>
            <p className="text-[var(--ff-text-primary)] font-mono">
              {vehicle.chassisNumber || '-'}
            </p>
          </div>
          <div>
            <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
              VIN
            </label>
            <p className="text-[var(--ff-text-primary)] font-mono">
              {vehicle.vin || '-'}
            </p>
          </div>
        </div>
      </div>

      {/* Ownership-specific content */}
      {vehicle.ownershipType === 'company' ? (
        // Finance Details for Company Owned
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)] p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-[var(--ff-primary)]" />
              Finance Details
            </h2>
            {!finance && (
              <button className="px-3 py-1.5 text-sm bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary-dark)] flex items-center gap-1.5">
                <Plus className="w-4 h-4" />
                Add Finance
              </button>
            )}
          </div>

          {finance ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
                    Finance Company
                  </label>
                  <p className="text-[var(--ff-text-primary)] font-medium">
                    {finance.financeCompany}
                  </p>
                </div>
                <div>
                  <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
                    Account Number
                  </label>
                  <p className="text-[var(--ff-text-primary)] font-mono">
                    {finance.accountNumber || '-'}
                  </p>
                </div>
                <div>
                  <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
                    Monthly Payment
                  </label>
                  <p className="text-[var(--ff-text-primary)] font-semibold">
                    {formatCurrency(finance.monthlyPayment)}
                  </p>
                </div>
                <div>
                  <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
                    Remaining Balance
                  </label>
                  <p className="text-[var(--ff-text-primary)] font-semibold">
                    {formatCurrency(finance.remainingBalance)}
                  </p>
                </div>
                <div>
                  <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
                    Start Date
                  </label>
                  <p className="text-[var(--ff-text-primary)]">
                    {formatDate(finance.startDate)}
                  </p>
                </div>
                <div>
                  <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
                    End Date
                  </label>
                  <p className="text-[var(--ff-text-primary)]">
                    {formatDate(finance.endDate)}
                  </p>
                </div>
              </div>

              {(finance.contactName || finance.contactPhone || finance.contactEmail) && (
                <div className="pt-4 border-t border-[var(--ff-border-light)]">
                  <h3 className="text-sm font-medium text-[var(--ff-text-primary)] mb-2">Contact</h3>
                  <div className="flex flex-wrap gap-4">
                    {finance.contactName && (
                      <span className="text-sm text-[var(--ff-text-secondary)]">
                        {finance.contactName}
                      </span>
                    )}
                    {finance.contactPhone && (
                      <a href={`tel:${finance.contactPhone}`} className="text-sm text-[var(--ff-primary)] flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        {finance.contactPhone}
                      </a>
                    )}
                    {finance.contactEmail && (
                      <a href={`mailto:${finance.contactEmail}`} className="text-sm text-[var(--ff-primary)] flex items-center gap-1">
                        <Mail className="w-3 h-3" />
                        {finance.contactEmail}
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8">
              <DollarSign className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-2" />
              <p className="text-[var(--ff-text-secondary)]">No finance details recorded</p>
              <p className="text-sm text-[var(--ff-text-tertiary)]">
                {vehicle.isFinanced ? 'Add finance details for this financed vehicle' : 'This vehicle is paid in full'}
              </p>
            </div>
          )}
        </div>
      ) : (
        // Lease/Rental Details
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)] p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] flex items-center gap-2">
              <Building2 className="w-5 h-5 text-[var(--ff-primary)]" />
              {vehicle.ownershipType === 'rental' ? 'Rental Details' : 'Lease Details'}
            </h2>
            {!lease && (
              <button className="px-3 py-1.5 text-sm bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary-dark)] flex items-center gap-1.5">
                <Plus className="w-4 h-4" />
                Add {vehicle.ownershipType === 'rental' ? 'Rental' : 'Lease'}
              </button>
            )}
          </div>

          {lease ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
                    Company
                  </label>
                  <p className="text-[var(--ff-text-primary)] font-medium">
                    {lease.companyName}
                  </p>
                </div>
                <div>
                  <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
                    Contract Number
                  </label>
                  <p className="text-[var(--ff-text-primary)] font-mono">
                    {lease.contractNumber || '-'}
                  </p>
                </div>
                <div>
                  <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
                    Monthly Cost
                  </label>
                  <p className="text-[var(--ff-text-primary)] font-semibold">
                    {formatCurrency(lease.monthlyCost)}
                  </p>
                </div>
                <div>
                  <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
                    Start Date
                  </label>
                  <p className="text-[var(--ff-text-primary)]">
                    {formatDate(lease.startDate)}
                  </p>
                </div>
                <div>
                  <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
                    End Date
                  </label>
                  <div className="flex items-center gap-2">
                    <p className="text-[var(--ff-text-primary)]">
                      {formatDate(lease.endDate)}
                    </p>
                    {lease.endDate && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${getExpiryBadge(lease.endDate).color}`}>
                        {getExpiryBadge(lease.endDate).text}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* KM Limits */}
              {(lease.kmLimitMonthly || lease.kmLimitTotal) && (
                <div className="pt-4 border-t border-[var(--ff-border-light)]">
                  <h3 className="text-sm font-medium text-[var(--ff-text-primary)] mb-2">KM Limits</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs text-[var(--ff-text-secondary)]">Monthly Limit</label>
                      <p className="text-[var(--ff-text-primary)]">
                        {lease.kmLimitMonthly ? `${lease.kmLimitMonthly.toLocaleString()} km` : '-'}
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--ff-text-secondary)]">Total Limit</label>
                      <p className="text-[var(--ff-text-primary)]">
                        {lease.kmLimitTotal ? `${lease.kmLimitTotal.toLocaleString()} km` : '-'}
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--ff-text-secondary)]">Excess Rate</label>
                      <p className="text-[var(--ff-text-primary)]">
                        {lease.excessKmRate ? `R${lease.excessKmRate}/km` : '-'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Inclusions */}
              <div className="pt-4 border-t border-[var(--ff-border-light)]">
                <h3 className="text-sm font-medium text-[var(--ff-text-primary)] mb-2">Inclusions</h3>
                <div className="flex flex-wrap gap-2">
                  {lease.includesMaintenance && (
                    <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs">Maintenance</span>
                  )}
                  {lease.includesTyres && (
                    <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs">Tyres</span>
                  )}
                  {lease.includesFuelCard && (
                    <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs">Fuel Card</span>
                  )}
                  {lease.includesTracking && (
                    <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs">Tracking</span>
                  )}
                  {lease.includesInsurance && (
                    <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs">Insurance</span>
                  )}
                  {!lease.includesMaintenance && !lease.includesTyres && !lease.includesFuelCard && !lease.includesTracking && !lease.includesInsurance && (
                    <span className="text-sm text-[var(--ff-text-tertiary)]">No inclusions</span>
                  )}
                </div>
              </div>

              {/* Contact */}
              {(lease.accountManager || lease.accountManagerPhone || lease.accountManagerEmail) && (
                <div className="pt-4 border-t border-[var(--ff-border-light)]">
                  <h3 className="text-sm font-medium text-[var(--ff-text-primary)] mb-2">Account Manager</h3>
                  <div className="flex flex-wrap gap-4">
                    {lease.accountManager && (
                      <span className="text-sm text-[var(--ff-text-secondary)]">
                        {lease.accountManager}
                      </span>
                    )}
                    {lease.accountManagerPhone && (
                      <a href={`tel:${lease.accountManagerPhone}`} className="text-sm text-[var(--ff-primary)] flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        {lease.accountManagerPhone}
                      </a>
                    )}
                    {lease.accountManagerEmail && (
                      <a href={`mailto:${lease.accountManagerEmail}`} className="text-sm text-[var(--ff-primary)] flex items-center gap-1">
                        <Mail className="w-3 h-3" />
                        {lease.accountManagerEmail}
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8">
              <Building2 className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-2" />
              <p className="text-[var(--ff-text-secondary)]">
                No {vehicle.ownershipType} details recorded
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DocumentsTab({
  vehicle,
  licenseDisc,
  documents,
  loadingDocs,
}: {
  vehicle: FleetVehicle;
  licenseDisc: LicenseDisc | null;
  documents: VehicleDocument[];
  loadingDocs: boolean;
}) {
  if (loadingDocs) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-48 bg-[var(--ff-bg-tertiary)] rounded-lg"></div>
        <div className="h-48 bg-[var(--ff-bg-tertiary)] rounded-lg"></div>
      </div>
    );
  }

  const expiryBadge = licenseDisc ? getExpiryBadge(licenseDisc.expiryDate) : null;

  return (
    <div className="space-y-6">
      {/* License Disc Card */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)] p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] flex items-center gap-2">
            <Car className="w-5 h-5 text-[var(--ff-primary)]" />
            License Disc
          </h2>
          <button className="px-3 py-1.5 text-sm bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary-dark)] flex items-center gap-1.5">
            <Plus className="w-4 h-4" />
            Renew
          </button>
        </div>

        {licenseDisc ? (
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)]">Expiry Date</p>
                <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                  {formatDate(licenseDisc.expiryDate)}
                </p>
              </div>
              {expiryBadge && (
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${expiryBadge.color}`}>
                  {expiryBadge.text}
                </span>
              )}
            </div>

            <div className="grid grid-cols-3 gap-4 pt-4 border-t border-[var(--ff-border-light)]">
              <div>
                <label className="block text-xs text-[var(--ff-text-secondary)]">License Number</label>
                <p className="text-[var(--ff-text-primary)] font-mono">
                  {licenseDisc.licenseNumber || '-'}
                </p>
              </div>
              <div>
                <label className="block text-xs text-[var(--ff-text-secondary)]">Province</label>
                <p className="text-[var(--ff-text-primary)]">
                  {licenseDisc.province || '-'}
                </p>
              </div>
              <div>
                <label className="block text-xs text-[var(--ff-text-secondary)]">Issue Date</label>
                <p className="text-[var(--ff-text-primary)]">
                  {formatDate(licenseDisc.issueDate)}
                </p>
              </div>
            </div>

            {(licenseDisc.cost || licenseDisc.totalPaid) && (
              <div className="grid grid-cols-4 gap-4 pt-4 border-t border-[var(--ff-border-light)]">
                <div>
                  <label className="block text-xs text-[var(--ff-text-secondary)]">Cost</label>
                  <p className="text-[var(--ff-text-primary)]">
                    {formatCurrency(licenseDisc.cost)}
                  </p>
                </div>
                <div>
                  <label className="block text-xs text-[var(--ff-text-secondary)]">Arrears</label>
                  <p className="text-[var(--ff-text-primary)]">
                    {formatCurrency(licenseDisc.arrears)}
                  </p>
                </div>
                <div>
                  <label className="block text-xs text-[var(--ff-text-secondary)]">Penalties</label>
                  <p className="text-[var(--ff-text-primary)]">
                    {formatCurrency(licenseDisc.penalties)}
                  </p>
                </div>
                <div>
                  <label className="block text-xs text-[var(--ff-text-secondary)]">Total Paid</label>
                  <p className="text-[var(--ff-text-primary)] font-semibold">
                    {formatCurrency(licenseDisc.totalPaid)}
                  </p>
                </div>
              </div>
            )}

            {licenseDisc.documentUrl && (
              <div className="pt-4 border-t border-[var(--ff-border-light)]">
                <a
                  href={licenseDisc.documentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-[var(--ff-primary)] flex items-center gap-1 hover:underline"
                >
                  <ExternalLink className="w-4 h-4" />
                  View Document
                </a>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8">
            <Car className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-2" />
            <p className="text-[var(--ff-text-secondary)]">No license disc recorded</p>
            <p className="text-sm text-[var(--ff-text-tertiary)]">Add a license disc to track expiry</p>
          </div>
        )}
      </div>

      {/* Documents List */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)] p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] flex items-center gap-2">
            <FileText className="w-5 h-5 text-[var(--ff-primary)]" />
            Documents
          </h2>
          <button className="px-3 py-1.5 text-sm bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary-dark)] flex items-center gap-1.5">
            <Plus className="w-4 h-4" />
            Upload
          </button>
        </div>

        {documents.length > 0 ? (
          <div className="space-y-3">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between p-3 bg-[var(--ff-bg-primary)] rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-[var(--ff-text-secondary)]" />
                  <div>
                    <p className="font-medium text-[var(--ff-text-primary)]">{doc.documentName}</p>
                    <p className="text-sm text-[var(--ff-text-secondary)]">
                      {doc.documentType} • {formatDate(doc.createdAt)}
                    </p>
                  </div>
                </div>
                {doc.fileUrl && (
                  <a
                    href={doc.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg"
                  >
                    <ExternalLink className="w-4 h-4 text-[var(--ff-primary)]" />
                  </a>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <FileText className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-2" />
            <p className="text-[var(--ff-text-secondary)]">No documents uploaded</p>
          </div>
        )}
      </div>
    </div>
  );
}

function InsuranceTab({
  insurance,
  insuranceHistory,
  loadingInsurance,
}: {
  insurance: VehicleInsurance | null;
  insuranceHistory: VehicleInsurance[];
  loadingInsurance: boolean;
}) {
  if (loadingInsurance) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-48 bg-[var(--ff-bg-tertiary)] rounded-lg"></div>
        <div className="h-48 bg-[var(--ff-bg-tertiary)] rounded-lg"></div>
      </div>
    );
  }

  const expiryBadge = insurance ? getExpiryBadge(insurance.expiryDate) : null;

  return (
    <div className="space-y-6">
      {/* Active Policy */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)] p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] flex items-center gap-2">
            <Shield className="w-5 h-5 text-[var(--ff-primary)]" />
            Current Policy
          </h2>
          <button className="px-3 py-1.5 text-sm bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary-dark)] flex items-center gap-1.5">
            <Plus className="w-4 h-4" />
            {insurance ? 'Renew' : 'Add Policy'}
          </button>
        </div>

        {insurance ? (
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xl font-bold text-[var(--ff-text-primary)]">
                  {insurance.insuranceCompany}
                </p>
                <p className="text-sm text-[var(--ff-text-secondary)]">
                  Policy: {insurance.policyNumber}
                </p>
              </div>
              {expiryBadge && (
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${expiryBadge.color}`}>
                  {expiryBadge.text}
                </span>
              )}
            </div>

            <div className="grid grid-cols-3 gap-4 pt-4 border-t border-[var(--ff-border-light)]">
              <div>
                <label className="block text-xs text-[var(--ff-text-secondary)]">Policy Type</label>
                <p className="text-[var(--ff-text-primary)]">
                  {insurance.policyType || '-'}
                </p>
              </div>
              <div>
                <label className="block text-xs text-[var(--ff-text-secondary)]">Cover Amount</label>
                <p className="text-[var(--ff-text-primary)] font-semibold">
                  {formatCurrency(insurance.coverAmount)}
                </p>
              </div>
              <div>
                <label className="block text-xs text-[var(--ff-text-secondary)]">Expiry Date</label>
                <p className="text-[var(--ff-text-primary)]">
                  {formatDate(insurance.expiryDate)}
                </p>
              </div>
            </div>

            {/* Excess */}
            {(insurance.excessAmount || insurance.excessTheft || insurance.excessThirdParty) && (
              <div className="grid grid-cols-3 gap-4 pt-4 border-t border-[var(--ff-border-light)]">
                <div>
                  <label className="block text-xs text-[var(--ff-text-secondary)]">Standard Excess</label>
                  <p className="text-[var(--ff-text-primary)]">
                    {formatCurrency(insurance.excessAmount)}
                  </p>
                </div>
                <div>
                  <label className="block text-xs text-[var(--ff-text-secondary)]">Theft Excess</label>
                  <p className="text-[var(--ff-text-primary)]">
                    {formatCurrency(insurance.excessTheft)}
                  </p>
                </div>
                <div>
                  <label className="block text-xs text-[var(--ff-text-secondary)]">Third Party Excess</label>
                  <p className="text-[var(--ff-text-primary)]">
                    {formatCurrency(insurance.excessThirdParty)}
                  </p>
                </div>
              </div>
            )}

            {/* Premium */}
            {(insurance.premiumMonthly || insurance.premiumAnnual) && (
              <div className="grid grid-cols-3 gap-4 pt-4 border-t border-[var(--ff-border-light)]">
                <div>
                  <label className="block text-xs text-[var(--ff-text-secondary)]">Monthly Premium</label>
                  <p className="text-[var(--ff-text-primary)] font-semibold">
                    {formatCurrency(insurance.premiumMonthly)}
                  </p>
                </div>
                <div>
                  <label className="block text-xs text-[var(--ff-text-secondary)]">Annual Premium</label>
                  <p className="text-[var(--ff-text-primary)]">
                    {formatCurrency(insurance.premiumAnnual)}
                  </p>
                </div>
                <div>
                  <label className="block text-xs text-[var(--ff-text-secondary)]">Payment Method</label>
                  <p className="text-[var(--ff-text-primary)]">
                    {insurance.paymentMethod || '-'}
                  </p>
                </div>
              </div>
            )}

            {/* Additional Info */}
            <div className="flex flex-wrap gap-2 pt-4 border-t border-[var(--ff-border-light)]">
              {insurance.towingIncluded && (
                <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs">Towing</span>
              )}
              {insurance.carHireIncluded && (
                <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs">Car Hire</span>
              )}
              {insurance.roadsideAssistanceNumber && (
                <a
                  href={`tel:${insurance.roadsideAssistanceNumber}`}
                  className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs flex items-center gap-1"
                >
                  <Phone className="w-3 h-3" />
                  Roadside: {insurance.roadsideAssistanceNumber}
                </a>
              )}
            </div>

            {/* Contact */}
            {(insurance.insurerContactPhone || insurance.insurerClaimsPhone || insurance.insurerEmail) && (
              <div className="pt-4 border-t border-[var(--ff-border-light)]">
                <h3 className="text-sm font-medium text-[var(--ff-text-primary)] mb-2">Contact</h3>
                <div className="flex flex-wrap gap-4">
                  {insurance.insurerClaimsPhone && (
                    <a href={`tel:${insurance.insurerClaimsPhone}`} className="text-sm text-[var(--ff-primary)] flex items-center gap-1">
                      <Phone className="w-3 h-3" />
                      Claims: {insurance.insurerClaimsPhone}
                    </a>
                  )}
                  {insurance.insurerContactPhone && (
                    <a href={`tel:${insurance.insurerContactPhone}`} className="text-sm text-[var(--ff-primary)] flex items-center gap-1">
                      <Phone className="w-3 h-3" />
                      General: {insurance.insurerContactPhone}
                    </a>
                  )}
                  {insurance.insurerEmail && (
                    <a href={`mailto:${insurance.insurerEmail}`} className="text-sm text-[var(--ff-primary)] flex items-center gap-1">
                      <Mail className="w-3 h-3" />
                      {insurance.insurerEmail}
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Broker */}
            {insurance.brokerName && (
              <div className="pt-4 border-t border-[var(--ff-border-light)]">
                <h3 className="text-sm font-medium text-[var(--ff-text-primary)] mb-2">Broker</h3>
                <div className="flex flex-wrap gap-4">
                  <span className="text-sm text-[var(--ff-text-secondary)]">
                    {insurance.brokerName} {insurance.brokerCompany && `(${insurance.brokerCompany})`}
                  </span>
                  {insurance.brokerPhone && (
                    <a href={`tel:${insurance.brokerPhone}`} className="text-sm text-[var(--ff-primary)] flex items-center gap-1">
                      <Phone className="w-3 h-3" />
                      {insurance.brokerPhone}
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8">
            <Shield className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-2" />
            <p className="text-[var(--ff-text-secondary)]">No active insurance policy</p>
            <p className="text-sm text-[var(--ff-text-tertiary)]">Add an insurance policy to track coverage</p>
          </div>
        )}
      </div>

      {/* Policy History */}
      {insuranceHistory.length > 1 && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)] p-6">
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] flex items-center gap-2 mb-4">
            <Clock className="w-5 h-5 text-[var(--ff-text-secondary)]" />
            Policy History
          </h2>
          <div className="space-y-3">
            {insuranceHistory.filter(p => !p.isActive).map((policy) => (
              <div
                key={policy.id}
                className="flex items-center justify-between p-3 bg-[var(--ff-bg-primary)] rounded-lg"
              >
                <div>
                  <p className="font-medium text-[var(--ff-text-primary)]">{policy.insuranceCompany}</p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">
                    {policy.policyNumber} • Expired {formatDate(policy.expiryDate)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function OdometerTab({
  vehicleId,
  odometerHistory,
  odometerAnomalies,
  anomalySummary,
  fuelHistory,
  vehicleStats,
  loading,
  onRefresh,
}: {
  vehicleId: string;
  odometerHistory: OdometerReading[];
  odometerAnomalies: OdometerAnomaly[];
  anomalySummary: { unresolved: number; criticalUnresolved: number };
  fuelHistory: FuelReading[];
  vehicleStats: VehicleStatistics | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [manualReading, setManualReading] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const latestReading = odometerHistory[0];

  const handleAddReading = async () => {
    const reading = parseInt(manualReading, 10);
    if (isNaN(reading) || reading < 0) {
      toast.error('Please enter a valid reading');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/fleet/vehicles/${vehicleId}/odometer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reading, source: 'manual' }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to add reading');
        return;
      }

      toast.success('Odometer reading added');
      setShowAddModal(false);
      setManualReading('');
      onRefresh();
    } catch (err) {
      toast.error('Failed to add reading');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-32 bg-[var(--ff-bg-tertiary)] rounded-lg"></div>
        <div className="h-64 bg-[var(--ff-bg-tertiary)] rounded-lg"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KM Travelled Statistics */}
      {vehicleStats && vehicleStats.odometer.readingsCount > 0 && (
        <div className="bg-gradient-to-r from-blue-500 to-indigo-600 rounded-lg shadow p-6 text-white">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            Distance Travelled
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white/10 rounded-lg p-3">
              <p className="text-xs text-white/70 uppercase">Today</p>
              <p className="text-2xl font-bold">{vehicleStats.odometer.today.toLocaleString()} km</p>
            </div>
            <div className="bg-white/10 rounded-lg p-3">
              <p className="text-xs text-white/70 uppercase">This Week</p>
              <p className="text-2xl font-bold">{vehicleStats.odometer.thisWeek.toLocaleString()} km</p>
            </div>
            <div className="bg-white/10 rounded-lg p-3">
              <p className="text-xs text-white/70 uppercase">This Month</p>
              <p className="text-2xl font-bold">{vehicleStats.odometer.thisMonth.toLocaleString()} km</p>
            </div>
            <div className="bg-white/10 rounded-lg p-3">
              <p className="text-xs text-white/70 uppercase">Last Month</p>
              <p className="text-2xl font-bold">{vehicleStats.odometer.lastMonth.toLocaleString()} km</p>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-6 text-sm text-white/80">
            <div className="flex items-center gap-2">
              <Gauge className="w-4 h-4" />
              <span>Latest: {vehicleStats.odometer.latestReading.toLocaleString()} km</span>
            </div>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              <span>Avg per day: {vehicleStats.odometer.averagePerDay.toLocaleString()} km</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              <span>{vehicleStats.checkIns.totalCheckIns} check-ins ({vehicleStats.checkIns.passRate}% pass rate)</span>
            </div>
          </div>
        </div>
      )}

      {/* Summary Card */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)] p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] flex items-center gap-2">
            <Gauge className="w-5 h-5 text-[var(--ff-primary)]" />
            Odometer Tracking
          </h2>
          <div className="flex gap-2">
            <button
              onClick={onRefresh}
              className="px-3 py-1.5 text-sm border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] flex items-center gap-1.5"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="px-3 py-1.5 text-sm bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary-dark)] flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Add Reading
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6">
          <div>
            <p className="text-sm text-[var(--ff-text-secondary)] mb-1">Current Reading</p>
            <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
              {latestReading ? `${latestReading.reading.toLocaleString()} km` : '-'}
            </p>
            {latestReading && (
              <p className="text-xs text-[var(--ff-text-tertiary)]">
                {formatDate(latestReading.recordedAt)} via {latestReading.source}
              </p>
            )}
          </div>
          <div>
            <p className="text-sm text-[var(--ff-text-secondary)] mb-1">Last Trip</p>
            <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
              {latestReading?.kmSinceLast !== null && latestReading?.kmSinceLast !== undefined
                ? `${latestReading.kmSinceLast.toLocaleString()} km`
                : '-'}
            </p>
          </div>
          <div>
            <p className="text-sm text-[var(--ff-text-secondary)] mb-1">Anomalies</p>
            <div className="flex items-center gap-2">
              {anomalySummary.unresolved > 0 ? (
                <>
                  <span className={`text-2xl font-bold ${anomalySummary.criticalUnresolved > 0 ? 'text-red-600' : 'text-yellow-600'}`}>
                    {anomalySummary.unresolved}
                  </span>
                  {anomalySummary.criticalUnresolved > 0 && (
                    <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded-full">
                      {anomalySummary.criticalUnresolved} critical
                    </span>
                  )}
                </>
              ) : (
                <span className="text-2xl font-bold text-green-600 flex items-center gap-2">
                  <CheckCircle className="w-5 h-5" />
                  None
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Anomalies Alert */}
      {odometerAnomalies.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-red-800">Unresolved Anomalies Detected</p>
              <div className="mt-2 space-y-2">
                {odometerAnomalies.slice(0, 3).map((anomaly) => (
                  <div key={anomaly.id} className="text-sm text-red-700">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium mr-2 ${
                      anomaly.severity === 'critical' ? 'bg-red-200' : 'bg-yellow-200 text-yellow-800'
                    }`}>
                      {anomaly.anomalyType.replace('_', ' ')}
                    </span>
                    {anomaly.odometerReading.toLocaleString()} km
                    {anomaly.previousReading && ` (was ${anomaly.previousReading.toLocaleString()} km)`}
                    <span className="text-red-500 ml-2">{formatDate(anomaly.detectedAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* History Table */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)] p-6">
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          Reading History
        </h2>

        {odometerHistory.length === 0 ? (
          <div className="text-center py-8">
            <Gauge className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-2" />
            <p className="text-[var(--ff-text-secondary)]">No odometer readings recorded</p>
            <p className="text-sm text-[var(--ff-text-tertiary)]">Add your first reading to start tracking</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--ff-border-light)]">
                  <th className="text-left py-2 px-3 text-sm font-medium text-[var(--ff-text-secondary)]">Date</th>
                  <th className="text-right py-2 px-3 text-sm font-medium text-[var(--ff-text-secondary)]">Reading</th>
                  <th className="text-right py-2 px-3 text-sm font-medium text-[var(--ff-text-secondary)]">KM Traveled</th>
                  <th className="text-center py-2 px-3 text-sm font-medium text-[var(--ff-text-secondary)]">Source</th>
                  <th className="text-center py-2 px-3 text-sm font-medium text-[var(--ff-text-secondary)]">Status</th>
                </tr>
              </thead>
              <tbody>
                {odometerHistory.map((reading, idx) => (
                  <tr
                    key={reading.id}
                    className={`border-b border-[var(--ff-border-light)] ${reading.discrepancyFlag ? 'bg-red-50' : ''}`}
                  >
                    <td className="py-3 px-3 text-sm text-[var(--ff-text-primary)]">
                      {formatDate(reading.recordedAt)}
                    </td>
                    <td className="py-3 px-3 text-sm text-right font-mono text-[var(--ff-text-primary)]">
                      {reading.reading.toLocaleString()} km
                    </td>
                    <td className="py-3 px-3 text-sm text-right text-[var(--ff-text-secondary)]">
                      {reading.kmSinceLast !== null ? (
                        <span className={reading.kmSinceLast < 0 ? 'text-red-600' : ''}>
                          {reading.kmSinceLast >= 0 ? '+' : ''}{reading.kmSinceLast.toLocaleString()} km
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="py-3 px-3 text-sm text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
                        reading.source === 'vlm'
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-gray-100 text-gray-700'
                      }`}>
                        {reading.source === 'vlm' ? (
                          <>
                            <Camera className="w-3 h-3" />
                            VLM
                            {reading.vlmConfidence && (
                              <span className="ml-1 opacity-75">
                                ({Math.round(reading.vlmConfidence * 100)}%)
                              </span>
                            )}
                          </>
                        ) : (
                          'Manual'
                        )}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-sm text-center">
                      {reading.discrepancyFlag ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs">
                          <AlertTriangle className="w-3 h-3" />
                          {reading.discrepancyReason || 'Anomaly'}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs">
                          <CheckCircle className="w-3 h-3" />
                          OK
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Fuel History Section */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)] p-6">
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4 flex items-center gap-2">
          <Fuel className="w-5 h-5 text-amber-500" />
          Fuel Level History
        </h2>

        {fuelHistory.length === 0 ? (
          <div className="text-center py-8">
            <Fuel className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-2" />
            <p className="text-[var(--ff-text-secondary)]">No fuel readings recorded</p>
            <p className="text-sm text-[var(--ff-text-tertiary)]">Fuel levels are captured during vehicle check-ins</p>
          </div>
        ) : (
          <>
            {/* Latest Fuel Summary */}
            <div className="grid grid-cols-3 gap-4 mb-6 p-4 bg-[var(--ff-bg-tertiary)] rounded-lg">
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)] mb-1">Current Level</p>
                <div className="flex items-center gap-2">
                  <div className="w-full h-4 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${
                        fuelHistory[0].fuelLevel > 50 ? 'bg-green-500' :
                        fuelHistory[0].fuelLevel > 25 ? 'bg-amber-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${fuelHistory[0].fuelLevel}%` }}
                    />
                  </div>
                  <span className="font-bold text-[var(--ff-text-primary)] whitespace-nowrap">
                    {fuelHistory[0].fuelLevel}%
                  </span>
                </div>
                <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
                  {formatDate(fuelHistory[0].recordedAt)} via {fuelHistory[0].source}
                </p>
              </div>
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)] mb-1">Last Change</p>
                <p className={`text-xl font-bold ${
                  fuelHistory[0].levelChange !== null
                    ? fuelHistory[0].levelChange > 0 ? 'text-green-600' :
                      fuelHistory[0].levelChange < 0 ? 'text-red-600' : 'text-gray-600'
                    : 'text-[var(--ff-text-tertiary)]'
                }`}>
                  {fuelHistory[0].levelChange !== null
                    ? `${fuelHistory[0].levelChange > 0 ? '+' : ''}${fuelHistory[0].levelChange}%`
                    : '-'}
                </p>
              </div>
              <div>
                <p className="text-sm text-[var(--ff-text-secondary)] mb-1">Readings</p>
                <p className="text-xl font-bold text-[var(--ff-text-primary)]">
                  {fuelHistory.length}
                </p>
              </div>
            </div>

            {/* Fuel History Table */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--ff-border-light)]">
                    <th className="text-left py-2 px-3 text-sm font-medium text-[var(--ff-text-secondary)]">Date</th>
                    <th className="text-center py-2 px-3 text-sm font-medium text-[var(--ff-text-secondary)]">Level</th>
                    <th className="text-right py-2 px-3 text-sm font-medium text-[var(--ff-text-secondary)]">Change</th>
                    <th className="text-center py-2 px-3 text-sm font-medium text-[var(--ff-text-secondary)]">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {fuelHistory.map((reading) => (
                    <tr key={reading.id} className="border-b border-[var(--ff-border-light)]">
                      <td className="py-3 px-3 text-sm text-[var(--ff-text-primary)]">
                        {formatDate(reading.recordedAt)}
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2 justify-center">
                          <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className={`h-full ${
                                reading.fuelLevel > 50 ? 'bg-green-500' :
                                reading.fuelLevel > 25 ? 'bg-amber-500' : 'bg-red-500'
                              }`}
                              style={{ width: `${reading.fuelLevel}%` }}
                            />
                          </div>
                          <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                            {reading.fuelLevel}%
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-sm text-right">
                        {reading.levelChange !== null ? (
                          <span className={`font-medium ${
                            reading.levelChange > 0 ? 'text-green-600' :
                            reading.levelChange < 0 ? 'text-red-600' : 'text-gray-600'
                          }`}>
                            {reading.levelChange > 0 ? '+' : ''}{reading.levelChange}%
                          </span>
                        ) : (
                          <span className="text-[var(--ff-text-tertiary)]">-</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-sm text-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
                          reading.source === 'vlm'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-gray-100 text-gray-700'
                        }`}>
                          {reading.source === 'vlm' ? (
                            <>
                              <Camera className="w-3 h-3" />
                              VLM
                              {reading.vlmConfidence && (
                                <span className="ml-1 opacity-75">
                                  ({Math.round(reading.vlmConfidence * 100)}%)
                                </span>
                              )}
                            </>
                          ) : (
                            'Manual'
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Add Reading Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Add Odometer Reading</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 hover:bg-[var(--ff-bg-tertiary)] rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
                  Current Odometer Reading (km)
                </label>
                <input
                  type="number"
                  value={manualReading}
                  onChange={(e) => setManualReading(e.target.value)}
                  placeholder={latestReading ? `Last: ${latestReading.reading.toLocaleString()} km` : 'Enter reading'}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-lg font-mono"
                  autoFocus
                />
              </div>

              {latestReading && manualReading && (
                <div className="p-3 bg-[var(--ff-bg-tertiary)] rounded-lg">
                  <p className="text-sm text-[var(--ff-text-secondary)]">
                    Distance since last reading:
                    <span className={`ml-2 font-medium ${
                      parseInt(manualReading) < latestReading.reading ? 'text-red-600' : 'text-green-600'
                    }`}>
                      {parseInt(manualReading) >= latestReading.reading ? '+' : ''}
                      {(parseInt(manualReading) - latestReading.reading).toLocaleString()} km
                    </span>
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)]"
              >
                Cancel
              </button>
              <button
                onClick={handleAddReading}
                disabled={submitting || !manualReading}
                className="px-4 py-2 bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary-dark)] disabled:opacity-50 flex items-center gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Save
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FuelSpendTab({
  vehicleId,
  transactions,
  summary,
  loading,
  onRefresh,
}: {
  vehicleId: string;
  transactions: FuelTransaction[];
  summary: FuelSummary | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<FuelTransaction | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [receiptPhotoUrl, setReceiptPhotoUrl] = useState<string | null>(null);
  const [receiptPhotoFile, setReceiptPhotoFile] = useState<File | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [formData, setFormData] = useState({
    transactionDate: new Date().toISOString().split('T')[0],
    amountRand: '',
    litres: '',
    pricePerLitre: '',
    odometerReading: '',
    stationName: '',
  });
  const [vlmResults, setVlmResults] = useState<{
    receipt?: {
      amountRand: number | null;
      litres: number | null;
      pricePerLitre: number | null;
      date: string | null;
      stationName: string | null;
      confidence: number;
    };
    odometer?: {
      reading: number | null;
      confidence: number;
    };
  } | null>(null);

  // Upload photo to server and get URL
  const uploadReceiptPhoto = async (file: File): Promise<string | null> => {
    setUploadingPhoto(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', `fleet/vehicles/${vehicleId}/fuel-receipts`);

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        return data.data?.url || data.url || null;
      }
      return null;
    } catch (err) {
      console.error('Upload error:', err);
      return null;
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleReceiptFileSelect = async (file: File) => {
    setReceiptPhotoFile(file);
    // Create preview URL
    const previewUrl = URL.createObjectURL(file);
    setReceiptPhotoUrl(previewUrl);
  };

  const handleScanReceipt = async (receiptBase64: string, odometerBase64?: string) => {
    setScanning(true);
    try {
      const res = await fetch(`/api/fleet/vehicles/${vehicleId}/fuel-transactions?action=scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiptPhotoBase64: receiptBase64,
          odometerPhotoBase64: odometerBase64,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const results = data.data?.vlmResults;
        setVlmResults(results);

        // Pre-fill form with VLM results
        if (results?.receipt) {
          setFormData(prev => ({
            ...prev,
            transactionDate: results.receipt.date || prev.transactionDate,
            amountRand: results.receipt.amountRand?.toString() || prev.amountRand,
            litres: results.receipt.litres?.toString() || prev.litres,
            pricePerLitre: results.receipt.pricePerLitre?.toString() || prev.pricePerLitre,
            stationName: results.receipt.stationName || prev.stationName,
          }));
        }
        if (results?.odometer?.reading) {
          setFormData(prev => ({
            ...prev,
            odometerReading: results.odometer.reading.toString(),
          }));
        }
        toast.success('Receipt scanned! Please review and confirm the details.');
      } else {
        toast.error('Failed to scan receipt');
      }
    } catch (err) {
      toast.error('Failed to scan receipt');
    } finally {
      setScanning(false);
    }
  };

  const handleSubmit = async () => {
    const amount = parseFloat(formData.amountRand);
    const litres = parseFloat(formData.litres);

    if (isNaN(amount) || amount <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }
    if (isNaN(litres) || litres <= 0) {
      toast.error('Please enter valid litres');
      return;
    }

    // For manual entries, receipt photo is required
    if (!vlmResults && !receiptPhotoFile) {
      toast.error('Receipt photo is required for manual entries');
      return;
    }

    setSubmitting(true);
    try {
      // Upload receipt photo if we have a file
      let uploadedReceiptUrl = receiptPhotoUrl;
      if (receiptPhotoFile) {
        const uploaded = await uploadReceiptPhoto(receiptPhotoFile);
        if (!uploaded) {
          toast.error('Failed to upload receipt photo');
          return;
        }
        uploadedReceiptUrl = uploaded;
      }

      const res = await fetch(`/api/fleet/vehicles/${vehicleId}/fuel-transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionDate: formData.transactionDate,
          amountRand: amount,
          litres: litres,
          pricePerLitre: formData.pricePerLitre ? parseFloat(formData.pricePerLitre) : undefined,
          odometerReading: formData.odometerReading ? parseInt(formData.odometerReading, 10) : undefined,
          stationName: formData.stationName || undefined,
          receiptPhotoUrl: uploadedReceiptUrl || undefined,
          source: vlmResults ? 'hybrid' : 'manual',
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Failed to add transaction');
        return;
      }

      toast.success('Fuel transaction added');
      resetForm();
      onRefresh();
    } catch (err) {
      toast.error('Failed to add transaction');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setShowAddModal(false);
    setShowEditModal(false);
    setEditingTransaction(null);
    setFormData({
      transactionDate: new Date().toISOString().split('T')[0],
      amountRand: '',
      litres: '',
      pricePerLitre: '',
      odometerReading: '',
      stationName: '',
    });
    setVlmResults(null);
    setReceiptPhotoUrl(null);
    setReceiptPhotoFile(null);
  };

  const handleEdit = (tx: FuelTransaction) => {
    setEditingTransaction(tx);
    setFormData({
      transactionDate: tx.transactionDate.split('T')[0],
      amountRand: tx.amountRand.toString(),
      litres: tx.litres.toString(),
      pricePerLitre: tx.pricePerLitre?.toString() || '',
      odometerReading: tx.odometerReading?.toString() || '',
      stationName: tx.stationName || '',
    });
    setReceiptPhotoUrl(tx.receiptPhotoUrl);
    setShowEditModal(true);
  };

  const handleUpdateSubmit = async () => {
    if (!editingTransaction) return;

    const amount = parseFloat(formData.amountRand);
    const litres = parseFloat(formData.litres);

    if (isNaN(amount) || amount <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }
    if (isNaN(litres) || litres <= 0) {
      toast.error('Please enter valid litres');
      return;
    }

    // For manual entries without existing receipt, require upload
    if (editingTransaction.source === 'manual' && !editingTransaction.receiptPhotoUrl && !receiptPhotoFile) {
      toast.error('Receipt photo is required');
      return;
    }

    setSubmitting(true);
    try {
      // Upload new receipt photo if provided
      let uploadedReceiptUrl = receiptPhotoUrl;
      if (receiptPhotoFile) {
        const uploaded = await uploadReceiptPhoto(receiptPhotoFile);
        if (!uploaded) {
          toast.error('Failed to upload receipt photo');
          return;
        }
        uploadedReceiptUrl = uploaded;
      }

      const res = await fetch(`/api/fleet/vehicles/${vehicleId}/fuel-transactions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId: editingTransaction.id,
          transactionDate: formData.transactionDate,
          amountRand: amount,
          litres: litres,
          pricePerLitre: formData.pricePerLitre ? parseFloat(formData.pricePerLitre) : undefined,
          odometerReading: formData.odometerReading ? parseInt(formData.odometerReading, 10) : undefined,
          stationName: formData.stationName || undefined,
          receiptPhotoUrl: uploadedReceiptUrl || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Failed to update transaction');
        return;
      }

      toast.success('Fuel transaction updated');
      resetForm();
      onRefresh();
    } catch (err) {
      toast.error('Failed to update transaction');
    } finally {
      setSubmitting(false);
    }
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(value);

  const formatDate = (date: string) =>
    new Date(date).toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric' });

  if (loading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-32 bg-[var(--ff-bg-tertiary)] rounded-lg"></div>
        <div className="h-64 bg-[var(--ff-bg-tertiary)] rounded-lg"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gradient-to-r from-green-500 to-emerald-600 rounded-lg p-4 text-white">
            <p className="text-xs text-white/70 uppercase">Total Spent</p>
            <p className="text-2xl font-bold">{formatCurrency(summary.totalSpent)}</p>
          </div>
          <div className="bg-gradient-to-r from-blue-500 to-indigo-600 rounded-lg p-4 text-white">
            <p className="text-xs text-white/70 uppercase">Total Litres</p>
            <p className="text-2xl font-bold">{summary.totalLitres.toFixed(1)} L</p>
          </div>
          <div className="bg-gradient-to-r from-purple-500 to-pink-600 rounded-lg p-4 text-white">
            <p className="text-xs text-white/70 uppercase">Avg Consumption</p>
            <p className="text-2xl font-bold">
              {summary.avgConsumption ? `${summary.avgConsumption.toFixed(1)} L/100km` : '-'}
            </p>
          </div>
          <div className="bg-gradient-to-r from-orange-500 to-red-600 rounded-lg p-4 text-white">
            <p className="text-xs text-white/70 uppercase">Transactions</p>
            <p className="text-2xl font-bold">{summary.transactionCount}</p>
          </div>
        </div>
      )}

      {/* Actions Bar */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)] p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] flex items-center gap-2">
            <Fuel className="w-5 h-5 text-[var(--ff-primary)]" />
            Fuel Transactions
          </h2>
          <div className="flex gap-2">
            <button
              onClick={onRefresh}
              className="px-3 py-1.5 text-sm border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] flex items-center gap-1.5"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="px-3 py-1.5 text-sm bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary-dark)] flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Add Fill-up
            </button>
          </div>
        </div>
      </div>

      {/* Transactions List */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)] p-6">
        {transactions.length === 0 ? (
          <div className="text-center py-8">
            <Fuel className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-2" />
            <p className="text-[var(--ff-text-secondary)]">No fuel transactions recorded</p>
            <p className="text-sm text-[var(--ff-text-tertiary)]">Add your first fill-up to start tracking</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--ff-border-light)]">
                  <th className="text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase py-3 px-4">Date</th>
                  <th className="text-right text-xs font-medium text-[var(--ff-text-secondary)] uppercase py-3 px-4">Amount</th>
                  <th className="text-right text-xs font-medium text-[var(--ff-text-secondary)] uppercase py-3 px-4">Litres</th>
                  <th className="text-right text-xs font-medium text-[var(--ff-text-secondary)] uppercase py-3 px-4">Price/L</th>
                  <th className="text-right text-xs font-medium text-[var(--ff-text-secondary)] uppercase py-3 px-4">Odometer</th>
                  <th className="text-right text-xs font-medium text-[var(--ff-text-secondary)] uppercase py-3 px-4">L/100km</th>
                  <th className="text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase py-3 px-4">Station</th>
                  <th className="text-center text-xs font-medium text-[var(--ff-text-secondary)] uppercase py-3 px-4">Source</th>
                  <th className="text-center text-xs font-medium text-[var(--ff-text-secondary)] uppercase py-3 px-4">Receipt</th>
                  <th className="text-center text-xs font-medium text-[var(--ff-text-secondary)] uppercase py-3 px-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]">
                    <td className="py-3 px-4 text-sm text-[var(--ff-text-primary)]">{formatDate(tx.transactionDate)}</td>
                    <td className="py-3 px-4 text-sm text-[var(--ff-text-primary)] text-right font-medium">{formatCurrency(tx.amountRand)}</td>
                    <td className="py-3 px-4 text-sm text-[var(--ff-text-primary)] text-right">{tx.litres.toFixed(2)} L</td>
                    <td className="py-3 px-4 text-sm text-[var(--ff-text-secondary)] text-right">
                      {tx.pricePerLitre ? `R${tx.pricePerLitre.toFixed(2)}` : '-'}
                    </td>
                    <td className="py-3 px-4 text-sm text-[var(--ff-text-secondary)] text-right">
                      {tx.odometerReading ? `${tx.odometerReading.toLocaleString()} km` : '-'}
                    </td>
                    <td className="py-3 px-4 text-sm text-[var(--ff-text-secondary)] text-right">
                      {tx.litresPer100km ? `${tx.litresPer100km.toFixed(1)}` : '-'}
                    </td>
                    <td className="py-3 px-4 text-sm text-[var(--ff-text-secondary)]">{tx.stationName || '-'}</td>
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        tx.source === 'vlm'
                          ? 'bg-purple-100 text-purple-700'
                          : tx.source === 'hybrid'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-gray-100 text-gray-700'
                      }`}>
                        {tx.source === 'vlm' ? 'VLM' : tx.source === 'hybrid' ? 'VLM+Manual' : 'Manual'}
                      </span>
                    </td>
                    {/* Receipt Column */}
                    <td className="py-3 px-4 text-center">
                      {tx.receiptPhotoUrl ? (
                        <a
                          href={tx.receiptPhotoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center p-1.5 rounded-lg bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
                          title="View receipt"
                        >
                          <Receipt className="w-4 h-4" />
                        </a>
                      ) : (
                        <span className="inline-flex items-center justify-center p-1.5 rounded-lg bg-gray-100 text-gray-400" title="No receipt">
                          <ImageIcon className="w-4 h-4" />
                        </span>
                      )}
                    </td>
                    {/* Actions Column */}
                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => handleEdit(tx)}
                        className="inline-flex items-center justify-center p-1.5 rounded-lg hover:bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] hover:text-[var(--ff-primary)] transition-colors"
                        title="Edit transaction"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Transaction Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Add Fuel Fill-up</h3>
                <button
                  onClick={() => {
                    setShowAddModal(false);
                    setVlmResults(null);
                  }}
                  className="p-1 hover:bg-[var(--ff-bg-tertiary)] rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Photo Upload Section */}
              <div className="mb-6 p-4 bg-[var(--ff-bg-tertiary)] rounded-lg">
                <p className="text-sm font-medium text-[var(--ff-text-primary)] mb-2 flex items-center gap-2">
                  <Camera className="w-4 h-4" />
                  Scan Receipt (Optional)
                </p>
                <p className="text-xs text-[var(--ff-text-secondary)] mb-3">
                  Upload a receipt photo to automatically extract the details using AI
                </p>
                <input
                  type="file"
                  accept="image/*"
                  className="block w-full text-sm text-[var(--ff-text-secondary)] file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[var(--ff-primary)] file:text-white hover:file:bg-[var(--ff-primary-dark)]"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = async () => {
                        const base64 = (reader.result as string).split(',')[1];
                        await handleScanReceipt(base64);
                      };
                      reader.readAsDataURL(file);
                    }
                  }}
                  disabled={scanning}
                />
                {scanning && (
                  <div className="mt-2 flex items-center gap-2 text-sm text-[var(--ff-primary)]">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Scanning receipt...
                  </div>
                )}
                {vlmResults?.receipt && (
                  <div className="mt-2 p-2 bg-green-50 dark:bg-green-900/20 rounded text-sm text-green-700 dark:text-green-400 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    Receipt scanned ({Math.round((vlmResults.receipt.confidence || 0) * 100)}% confidence)
                  </div>
                )}
              </div>

              {/* Manual Entry Form */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Date *</label>
                  <input
                    type="date"
                    value={formData.transactionDate}
                    onChange={(e) => setFormData({ ...formData, transactionDate: e.target.value })}
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Amount (Rand) *</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="850.50"
                      value={formData.amountRand}
                      onChange={(e) => setFormData({ ...formData, amountRand: e.target.value })}
                      className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Litres *</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="45.25"
                      value={formData.litres}
                      onChange={(e) => setFormData({ ...formData, litres: e.target.value })}
                      className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Price per Litre</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="18.79"
                      value={formData.pricePerLitre}
                      onChange={(e) => setFormData({ ...formData, pricePerLitre: e.target.value })}
                      className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Odometer (km)</label>
                    <input
                      type="number"
                      placeholder="125000"
                      value={formData.odometerReading}
                      onChange={(e) => setFormData({ ...formData, odometerReading: e.target.value })}
                      className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Station Name</label>
                  <input
                    type="text"
                    placeholder="Shell, BP, Engen..."
                    value={formData.stationName}
                    onChange={(e) => setFormData({ ...formData, stationName: e.target.value })}
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)]"
                  />
                </div>

                {/* Receipt Upload for Manual Entries */}
                {!vlmResults && (
                  <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                    <label className="block text-sm font-medium text-amber-800 dark:text-amber-200 mb-2 flex items-center gap-2">
                      <Receipt className="w-4 h-4" />
                      Receipt Photo {!vlmResults ? '*' : ''}
                    </label>
                    <p className="text-xs text-amber-700 dark:text-amber-300 mb-3">
                      Required for manual entries. Take a photo or upload an image of the receipt.
                    </p>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="block w-full text-sm text-[var(--ff-text-secondary)] file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-amber-500 file:text-white hover:file:bg-amber-600"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleReceiptFileSelect(file);
                      }}
                    />
                    {receiptPhotoUrl && (
                      <div className="mt-2 flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                        <CheckCircle className="w-4 h-4" />
                        Receipt selected
                      </div>
                    )}
                    {uploadingPhoto && (
                      <div className="mt-2 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Uploading...
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowAddModal(false);
                    setVlmResults(null);
                  }}
                  className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="px-4 py-2 bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary-dark)] disabled:opacity-50 flex items-center gap-2"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Save Transaction
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Transaction Modal */}
      {showEditModal && editingTransaction && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Edit Fuel Transaction</h3>
                <button
                  onClick={resetForm}
                  className="p-1 hover:bg-[var(--ff-bg-tertiary)] rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Current Receipt Preview */}
              {(editingTransaction.receiptPhotoUrl || receiptPhotoUrl) && (
                <div className="mb-4 p-3 bg-[var(--ff-bg-tertiary)] rounded-lg">
                  <p className="text-xs text-[var(--ff-text-secondary)] mb-2">Current Receipt:</p>
                  <a
                    href={receiptPhotoUrl || editingTransaction.receiptPhotoUrl || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-[var(--ff-primary)] hover:underline flex items-center gap-1"
                  >
                    <Receipt className="w-4 h-4" />
                    View receipt
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}

              {/* Edit Form */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Date *</label>
                  <input
                    type="date"
                    value={formData.transactionDate}
                    onChange={(e) => setFormData({ ...formData, transactionDate: e.target.value })}
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Amount (Rand) *</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="850.50"
                      value={formData.amountRand}
                      onChange={(e) => setFormData({ ...formData, amountRand: e.target.value })}
                      className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Litres *</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="45.25"
                      value={formData.litres}
                      onChange={(e) => setFormData({ ...formData, litres: e.target.value })}
                      className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Price per Litre</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="18.79"
                      value={formData.pricePerLitre}
                      onChange={(e) => setFormData({ ...formData, pricePerLitre: e.target.value })}
                      className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Odometer (km)</label>
                    <input
                      type="number"
                      placeholder="125000"
                      value={formData.odometerReading}
                      onChange={(e) => setFormData({ ...formData, odometerReading: e.target.value })}
                      className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Station Name</label>
                  <input
                    type="text"
                    placeholder="Shell, BP, Engen..."
                    value={formData.stationName}
                    onChange={(e) => setFormData({ ...formData, stationName: e.target.value })}
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)]"
                  />
                </div>

                {/* Upload New Receipt */}
                {editingTransaction.source === 'manual' && (
                  <div className="p-4 bg-[var(--ff-bg-tertiary)] rounded-lg">
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2 flex items-center gap-2">
                      <Camera className="w-4 h-4" />
                      {editingTransaction.receiptPhotoUrl ? 'Replace Receipt Photo' : 'Add Receipt Photo *'}
                    </label>
                    <p className="text-xs text-[var(--ff-text-tertiary)] mb-3">
                      {editingTransaction.receiptPhotoUrl
                        ? 'Upload a new photo to replace the current receipt'
                        : 'Receipt photo is required for manual entries'}
                    </p>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="block w-full text-sm text-[var(--ff-text-secondary)] file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[var(--ff-primary)] file:text-white hover:file:bg-[var(--ff-primary-dark)]"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleReceiptFileSelect(file);
                      }}
                    />
                    {receiptPhotoFile && (
                      <div className="mt-2 flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                        <CheckCircle className="w-4 h-4" />
                        New receipt selected
                      </div>
                    )}
                    {uploadingPhoto && (
                      <div className="mt-2 flex items-center gap-2 text-sm text-[var(--ff-primary)]">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Uploading...
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={resetForm}
                  className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdateSubmit}
                  disabled={submitting}
                  className="px-4 py-2 bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary-dark)] disabled:opacity-50 flex items-center gap-2"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Update Transaction
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function VehicleDetailPage() {
  const router = useRouter();
  const { id, tab } = router.query;

  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [vehicle, setVehicle] = useState<FleetVehicle | null>(null);
  const [investigations, setInvestigations] = useState<Investigation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<FleetVehicle>>({});
  const [saving, setSaving] = useState(false);
  const [retireConfirm, setRetireConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Ownership data
  const [licenseDisc, setLicenseDisc] = useState<LicenseDisc | null>(null);
  const [documents, setDocuments] = useState<VehicleDocument[]>([]);
  const [finance, setFinance] = useState<VehicleFinance | null>(null);
  const [lease, setLease] = useState<VehicleLease | null>(null);
  const [insurance, setInsurance] = useState<VehicleInsurance | null>(null);
  const [insuranceHistory, setInsuranceHistory] = useState<VehicleInsurance[]>([]);
  const [loadingOwnership, setLoadingOwnership] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [loadingInsurance, setLoadingInsurance] = useState(false);

  // Odometer data
  const [odometerHistory, setOdometerHistory] = useState<OdometerReading[]>([]);
  const [odometerAnomalies, setOdometerAnomalies] = useState<OdometerAnomaly[]>([]);
  const [loadingOdometer, setLoadingOdometer] = useState(false);
  const [anomalySummary, setAnomalySummary] = useState<{ unresolved: number; criticalUnresolved: number }>({ unresolved: 0, criticalUnresolved: 0 });

  // Fuel history data
  const [fuelHistory, setFuelHistory] = useState<FuelReading[]>([]);

  // Fuel transactions data (spend tracking)
  const [fuelTransactions, setFuelTransactions] = useState<FuelTransaction[]>([]);
  const [fuelSummary, setFuelSummary] = useState<FuelSummary | null>(null);
  const [fuelLoading, setFuelLoading] = useState(false);

  // Vehicle statistics
  const [vehicleStats, setVehicleStats] = useState<VehicleStatistics | null>(null);

  // Driver assignment data
  const [assignedDriver, setAssignedDriver] = useState<AssignedDriver | null>(null);
  const [loadingAssignment, setLoadingAssignment] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [availableStaff, setAvailableStaff] = useState<StaffOption[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [assigning, setAssigning] = useState(false);
  const [unassigning, setUnassigning] = useState(false);

  // Set initial tab from URL
  useEffect(() => {
    if (tab && typeof tab === 'string' && ['overview', 'odometer', 'ownership', 'documents', 'insurance'].includes(tab)) {
      setActiveTab(tab as TabId);
    }
  }, [tab]);

  // Fetch vehicle data
  useEffect(() => {
    if (!id) return;

    const fetchVehicle = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/fleet/vehicles?id=${id}`);
        const data = await res.json();

        if (!res.ok) {
          setError(data.error || 'Failed to load vehicle');
          return;
        }

        setVehicle(data.data);
        setEditForm(data.data);

        // Fetch investigations for this vehicle
        const invRes = await fetch(`/api/fleet/investigation?vehicleId=${id}`);
        const invData = await invRes.json();
        setInvestigations(invData.data || []);
      } catch (err) {
        setError('Failed to load vehicle');
      } finally {
        setLoading(false);
      }
    };

    fetchVehicle();
  }, [id]);

  // Fetch ownership data when tab changes
  const fetchOwnershipData = useCallback(async () => {
    if (!id) return;
    setLoadingOwnership(true);
    try {
      const [leaseRes, financeRes] = await Promise.all([
        fetch(`/api/fleet/vehicles/${id}/lease`),
        fetch(`/api/fleet/vehicles/${id}/finance`),
      ]);

      if (leaseRes.ok) {
        const leaseData = await leaseRes.json();
        setLease(leaseData.data);
      }
      if (financeRes.ok) {
        const financeData = await financeRes.json();
        setFinance(financeData.data);
      }
    } catch (err) {
      console.error('Failed to fetch ownership data:', err);
    } finally {
      setLoadingOwnership(false);
    }
  }, [id]);

  const fetchDocumentsData = useCallback(async () => {
    if (!id) return;
    setLoadingDocs(true);
    try {
      const [licenseRes, docsRes] = await Promise.all([
        fetch(`/api/fleet/vehicles/${id}/license-disc?current=true`),
        fetch(`/api/fleet/vehicles/${id}/documents?active=true`),
      ]);

      if (licenseRes.ok) {
        const licenseData = await licenseRes.json();
        setLicenseDisc(licenseData.data);
      }
      if (docsRes.ok) {
        const docsData = await docsRes.json();
        setDocuments(docsData.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch documents data:', err);
    } finally {
      setLoadingDocs(false);
    }
  }, [id]);

  const fetchInsuranceData = useCallback(async () => {
    if (!id) return;
    setLoadingInsurance(true);
    try {
      const [currentRes, historyRes] = await Promise.all([
        fetch(`/api/fleet/vehicles/${id}/insurance?current=true`),
        fetch(`/api/fleet/vehicles/${id}/insurance`),
      ]);

      if (currentRes.ok) {
        const currentData = await currentRes.json();
        setInsurance(currentData.data);
      }
      if (historyRes.ok) {
        const historyData = await historyRes.json();
        setInsuranceHistory(historyData.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch insurance data:', err);
    } finally {
      setLoadingInsurance(false);
    }
  }, [id]);

  const fetchOdometerData = useCallback(async () => {
    if (!id) return;
    setLoadingOdometer(true);
    try {
      const [historyRes, anomaliesRes, fuelRes, statsRes] = await Promise.all([
        fetch(`/api/fleet/vehicles/${id}/odometer?limit=20`),
        fetch(`/api/fleet/vehicles/${id}/odometer-anomalies?resolved=false&limit=10`),
        fetch(`/api/fleet/vehicles/${id}/fuel?limit=20`),
        fetch(`/api/fleet/vehicles/${id}/stats`),
      ]);

      if (historyRes.ok) {
        const historyData = await historyRes.json();
        setOdometerHistory(historyData.data || []);
      }
      if (anomaliesRes.ok) {
        const anomaliesData = await anomaliesRes.json();
        setOdometerAnomalies(anomaliesData.data || []);
        if (anomaliesData.meta?.summary) {
          setAnomalySummary({
            unresolved: anomaliesData.meta.summary.unresolved || 0,
            criticalUnresolved: anomaliesData.meta.summary.criticalUnresolved || 0,
          });
        }
      }
      if (fuelRes.ok) {
        const fuelData = await fuelRes.json();
        setFuelHistory(fuelData.data || []);
      }
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setVehicleStats(statsData.data || null);
      }
    } catch (err) {
      console.error('Failed to fetch odometer data:', err);
    } finally {
      setLoadingOdometer(false);
    }
  }, [id]);

  // Fetch driver assignment data
  const fetchAssignmentData = useCallback(async () => {
    if (!id) return;
    setLoadingAssignment(true);
    try {
      const res = await fetch(`/api/fleet/vehicles/${id}/assignment`);
      if (res.ok) {
        const data = await res.json();
        if (data.data?.assigned) {
          setAssignedDriver(data.data.driver);
        } else {
          setAssignedDriver(null);
        }
      }
    } catch (err) {
      console.error('Failed to fetch assignment data:', err);
    } finally {
      setLoadingAssignment(false);
    }
  }, [id]);

  // Fetch fuel transaction data
  const fetchFuelTransactions = useCallback(async () => {
    if (!id) return;
    setFuelLoading(true);
    try {
      const res = await fetch(`/api/fleet/vehicles/${id}/fuel-transactions?limit=50`);
      if (res.ok) {
        const data = await res.json();
        setFuelTransactions(data.data?.transactions || []);
        setFuelSummary(data.data?.summary || null);
      }
    } catch (err) {
      console.error('Failed to fetch fuel transactions:', err);
    } finally {
      setFuelLoading(false);
    }
  }, [id]);

  // Fetch available staff for assignment
  const fetchAvailableStaff = useCallback(async () => {
    setLoadingStaff(true);
    try {
      const res = await fetch('/api/fleet/available-drivers');
      if (res.ok) {
        const data = await res.json();
        const staffList: StaffOption[] = (data.data?.drivers || []).map((s: Record<string, unknown>) => ({
          id: s.id as string,
          name: s.name as string,
          email: s.email as string | null,
          hasValidLicense: s.hasValidLicense as boolean || false,
          hasVehicle: s.hasVehicle as boolean || false,
        }));
        setAvailableStaff(staffList);
      }
    } catch (err) {
      console.error('Failed to fetch staff:', err);
    } finally {
      setLoadingStaff(false);
    }
  }, []);

  // Handle assigning a driver
  const handleAssignDriver = async () => {
    if (!selectedStaffId || !id) return;

    setAssigning(true);
    try {
      const res = await fetch(`/api/fleet/vehicles/${id}/assignment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId: selectedStaffId }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Failed to assign driver');
        return;
      }

      toast.success('Driver assigned successfully');
      setShowAssignModal(false);
      setSelectedStaffId('');
      fetchAssignmentData();
      // Update vehicle data to reflect assignment
      if (vehicle) {
        const staffOption = availableStaff.find(s => s.id === selectedStaffId);
        setVehicle({ ...vehicle, assignedStaffId: selectedStaffId, assignedStaffName: staffOption?.name || null });
      }
    } catch (err) {
      toast.error('Failed to assign driver');
    } finally {
      setAssigning(false);
    }
  };

  // Handle unassigning a driver
  const handleUnassignDriver = async () => {
    if (!id) return;

    setUnassigning(true);
    try {
      const res = await fetch(`/api/fleet/vehicles/${id}/assignment`, {
        method: 'DELETE',
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Failed to unassign driver');
        return;
      }

      toast.success('Driver unassigned successfully');
      setAssignedDriver(null);
      // Update vehicle data
      if (vehicle) {
        setVehicle({ ...vehicle, assignedStaffId: null, assignedStaffName: null });
      }
    } catch (err) {
      toast.error('Failed to unassign driver');
    } finally {
      setUnassigning(false);
    }
  };

  // Fetch assignment on load
  useEffect(() => {
    if (vehicle) {
      fetchAssignmentData();
    }
  }, [vehicle, fetchAssignmentData]);

  // Fetch staff when modal opens
  useEffect(() => {
    if (showAssignModal) {
      fetchAvailableStaff();
    }
  }, [showAssignModal, fetchAvailableStaff]);

  // Fetch tab data on tab change
  useEffect(() => {
    if (!vehicle) return;

    switch (activeTab) {
      case 'odometer':
        fetchOdometerData();
        break;
      case 'fuel':
        fetchFuelTransactions();
        break;
      case 'ownership':
        fetchOwnershipData();
        break;
      case 'documents':
        fetchDocumentsData();
        break;
      case 'insurance':
        fetchInsuranceData();
        break;
    }
  }, [activeTab, vehicle, fetchOdometerData, fetchFuelTransactions, fetchOwnershipData, fetchDocumentsData, fetchInsuranceData]);

  const handleSave = async () => {
    if (!vehicle) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/fleet/vehicles?id=${vehicle.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Failed to save vehicle');
        return;
      }

      setVehicle({ ...vehicle, ...editForm } as FleetVehicle);
      setIsEditing(false);
      toast.success('Vehicle updated successfully');
    } catch (err) {
      toast.error('Failed to save vehicle');
    } finally {
      setSaving(false);
    }
  };

  const handleRetire = async () => {
    if (!vehicle) return;

    setRetiring(true);
    try {
      const res = await fetch(`/api/fleet/vehicles?id=${vehicle.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Failed to retire vehicle');
        return;
      }

      setVehicle({ ...vehicle, status: 'retired' });
      setRetireConfirm(false);
      toast.success(`${vehicle.registration} has been retired`);
    } catch (err) {
      toast.error('Failed to retire vehicle');
    } finally {
      setRetiring(false);
    }
  };

  const handleReactivate = async () => {
    if (!vehicle) return;

    setReactivating(true);
    try {
      const res = await fetch(`/api/fleet/vehicles?id=${vehicle.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Failed to reactivate vehicle');
        return;
      }

      setVehicle({ ...vehicle, status: 'active' });
      toast.success(`${vehicle.registration} is now active`);
    } catch (err) {
      toast.error('Failed to reactivate vehicle');
    } finally {
      setReactivating(false);
    }
  };

  const handlePermanentDelete = async () => {
    if (!vehicle) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/fleet/vehicles?id=${vehicle.id}&permanent=true`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Failed to delete vehicle');
        return;
      }

      toast.success(`${vehicle.registration} has been permanently deleted`);
      router.push('/fleet/vehicles');
    } catch (err) {
      toast.error('Failed to delete vehicle');
    } finally {
      setDeleting(false);
    }
  };

  const handleTabChange = (tabId: TabId) => {
    setActiveTab(tabId);
    // Update URL without navigation
    router.replace(
      { pathname: router.pathname, query: { ...router.query, tab: tabId } },
      undefined,
      { shallow: true }
    );
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-48 bg-[var(--ff-bg-tertiary)] rounded"></div>
          <div className="h-64 bg-[var(--ff-bg-tertiary)] rounded-lg"></div>
        </div>
      </AppLayout>
    );
  }

  if (error || !vehicle) {
    return (
      <AppLayout>
        <div className="text-center py-12">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-2">
            {error || 'Vehicle not found'}
          </h2>
          <Link href="/fleet/vehicles">
            <button className="text-[var(--ff-primary)] hover:underline">
              Back to vehicles
            </button>
          </Link>
        </div>
      </AppLayout>
    );
  }

  const status = statusConfig[vehicle.status];
  const StatusIcon = status.icon;

  const tabs: { id: TabId; label: string; icon: typeof Car }[] = [
    { id: 'overview', label: 'Overview', icon: Car },
    { id: 'odometer', label: 'Odometer', icon: Gauge },
    { id: 'fuel', label: 'Fuel Spend', icon: Fuel },
    { id: 'ownership', label: 'Ownership', icon: Building2 },
    { id: 'documents', label: 'Documents', icon: FileText },
    { id: 'insurance', label: 'Insurance', icon: Shield },
  ];

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/fleet/vehicles">
              <button className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors">
                <ArrowLeft className="w-5 h-5 text-[var(--ff-text-secondary)]" />
              </button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">
                {vehicle.registration}
              </h1>
              <p className="text-[var(--ff-text-secondary)]">
                {vehicle.make} {vehicle.model} {vehicle.year || ''}
              </p>
            </div>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${status.color}`}>
              <StatusIcon className="w-4 h-4" />
              {status.label}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <button
                  onClick={() => {
                    setIsEditing(false);
                    setEditForm(vehicle);
                  }}
                  className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors flex items-center gap-2"
                >
                  <X className="w-4 h-4" />
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary-dark)] transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setIsEditing(true)}
                  className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors flex items-center gap-2"
                >
                  <Edit className="w-4 h-4" />
                  Edit
                </button>
                {vehicle.status === 'retired' ? (
                  <>
                    <button
                      onClick={handleReactivate}
                      disabled={reactivating}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                      {reactivating ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4" />
                      )}
                      {reactivating ? 'Reactivating...' : 'Reactivate'}
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(true)}
                      disabled={deleting}
                      className="px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setRetireConfirm(true)}
                    disabled={retiring}
                    className="px-4 py-2 border border-yellow-400 text-yellow-700 rounded-lg hover:bg-yellow-50 transition-colors flex items-center gap-2 disabled:opacity-50"
                  >
                    <XCircle className="w-4 h-4" />
                    Retire
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Retire Confirmation */}
        {retireConfirm && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <XCircle className="w-6 h-6 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-yellow-800 font-medium">
                  Retire {vehicle.registration}?
                </p>
                <p className="text-yellow-700 text-sm mt-1">
                  This will mark the vehicle as retired. You can reactivate it later if needed.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={() => setRetireConfirm(false)}
                disabled={retiring}
                className="px-4 py-2 border border-yellow-300 text-yellow-700 rounded-lg hover:bg-yellow-100 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleRetire}
                disabled={retiring}
                className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {retiring ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Retiring...
                  </>
                ) : (
                  'Yes, Retire'
                )}
              </button>
            </div>
          </div>
        )}

        {/* Permanent Delete Confirmation */}
        {deleteConfirm && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-red-800 font-semibold">
                  Permanently delete {vehicle.registration}?
                </p>
                <p className="text-red-700 text-sm mt-1">
                  This will permanently remove the vehicle and all associated records (check-ins, documents, license discs, insurance, finance details, GPS investigations). This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={() => setDeleteConfirm(false)}
                disabled={deleting}
                className="px-4 py-2 border border-red-300 text-red-700 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handlePermanentDelete}
                disabled={deleting}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {deleting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Yes, Delete Permanently
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="border-b border-[var(--ff-border-light)]">
          <nav className="flex gap-4">
            {tabs.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => handleTabChange(t.id)}
                  className={`flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm transition-colors ${
                    activeTab === t.id
                      ? 'border-[var(--ff-primary)] text-[var(--ff-primary)]'
                      : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-medium)]'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {t.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2">
            {activeTab === 'overview' && (
              <OverviewTab
                vehicle={vehicle}
                isEditing={isEditing}
                editForm={editForm}
                setEditForm={setEditForm}
              />
            )}
            {activeTab === 'odometer' && (
              <OdometerTab
                vehicleId={vehicle.id}
                odometerHistory={odometerHistory}
                odometerAnomalies={odometerAnomalies}
                anomalySummary={anomalySummary}
                fuelHistory={fuelHistory}
                vehicleStats={vehicleStats}
                loading={loadingOdometer}
                onRefresh={fetchOdometerData}
              />
            )}
            {activeTab === 'fuel' && (
              <FuelSpendTab
                vehicleId={vehicle.id}
                transactions={fuelTransactions}
                summary={fuelSummary}
                loading={fuelLoading}
                onRefresh={fetchFuelTransactions}
              />
            )}
            {activeTab === 'ownership' && (
              <OwnershipTab
                vehicle={vehicle}
                lease={lease}
                finance={finance}
                loadingOwnership={loadingOwnership}
              />
            )}
            {activeTab === 'documents' && (
              <DocumentsTab
                vehicle={vehicle}
                licenseDisc={licenseDisc}
                documents={documents}
                loadingDocs={loadingDocs}
              />
            )}
            {activeTab === 'insurance' && (
              <InsuranceTab
                insurance={insurance}
                insuranceHistory={insuranceHistory}
                loadingInsurance={loadingInsurance}
              />
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Driver Assignment */}
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)] p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                  Assigned Driver
                </h2>
                {!assignedDriver && !loadingAssignment && (
                  <button
                    onClick={() => setShowAssignModal(true)}
                    className="text-sm text-[var(--ff-primary)] hover:underline flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" />
                    Assign
                  </button>
                )}
              </div>
              {loadingAssignment ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="w-6 h-6 text-[var(--ff-text-tertiary)] animate-spin" />
                </div>
              ) : assignedDriver ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    {assignedDriver.staffPhotoUrl ? (
                      <img
                        src={assignedDriver.staffPhotoUrl}
                        alt={assignedDriver.staffName}
                        className="w-12 h-12 rounded-full object-cover"
                      />
                    ) : (
                      <div className="p-3 bg-[var(--ff-bg-tertiary)] rounded-full">
                        <User className="w-6 h-6 text-[var(--ff-text-secondary)]" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <Link href={`/staff/${assignedDriver.staffId}`}>
                        <p className="font-medium text-[var(--ff-text-primary)] hover:text-[var(--ff-primary)] cursor-pointer">
                          {assignedDriver.staffName}
                        </p>
                      </Link>
                      {assignedDriver.staffEmail && (
                        <a href={`mailto:${assignedDriver.staffEmail}`} className="text-sm text-[var(--ff-text-secondary)] hover:underline flex items-center gap-1">
                          <Mail className="w-3 h-3" />
                          {assignedDriver.staffEmail}
                        </a>
                      )}
                      {assignedDriver.staffPhone && (
                        <a href={`tel:${assignedDriver.staffPhone}`} className="text-sm text-[var(--ff-text-secondary)] hover:underline flex items-center gap-1">
                          <Phone className="w-3 h-3" />
                          {assignedDriver.staffPhone}
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="pt-2 border-t border-[var(--ff-border-light)] space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[var(--ff-text-secondary)]">License Status</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs ${
                        assignedDriver.hasValidLicense
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      }`}>
                        {assignedDriver.hasValidLicense ? 'Valid' : 'Invalid/Missing'}
                      </span>
                    </div>
                    {assignedDriver.licenseExpiry && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-[var(--ff-text-secondary)]">License Expiry</span>
                        <span className="text-[var(--ff-text-primary)]">{formatDate(assignedDriver.licenseExpiry)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[var(--ff-text-secondary)]">Assigned Since</span>
                      <span className="text-[var(--ff-text-primary)]">{formatDate(assignedDriver.assignmentStart)}</span>
                    </div>
                    {assignedDriver.fuelCardNumber && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-[var(--ff-text-secondary)]">Fuel Card</span>
                        <span className="text-[var(--ff-text-primary)] font-mono text-xs">{assignedDriver.fuelCardNumber}</span>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={handleUnassignDriver}
                    disabled={unassigning}
                    className="w-full mt-2 px-3 py-2 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {unassigning ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <X className="w-4 h-4" />
                    )}
                    {unassigning ? 'Unassigning...' : 'Unassign Driver'}
                  </button>
                </div>
              ) : (
                <div className="text-center py-4">
                  <User className="w-10 h-10 text-[var(--ff-text-tertiary)] mx-auto mb-2" />
                  <p className="text-[var(--ff-text-secondary)] mb-3">No driver assigned</p>
                  <button
                    onClick={() => setShowAssignModal(true)}
                    className="px-4 py-2 bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary-dark)] transition-colors text-sm flex items-center gap-2 mx-auto"
                  >
                    <Plus className="w-4 h-4" />
                    Assign Driver
                  </button>
                </div>
              )}
            </div>

            {/* Quick Actions */}
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)] p-6">
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
                Quick Actions
              </h2>
              <div className="space-y-2">
                <Link href={`/fleet/investigation?vehicleId=${vehicle.id}`}>
                  <button className="w-full px-4 py-2 text-left hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors flex items-center gap-3">
                    <FileText className="w-5 h-5 text-[var(--ff-primary)]" />
                    <span className="text-[var(--ff-text-primary)]">New GPS Investigation</span>
                  </button>
                </Link>
                <Link href="/fleet/locations">
                  <button className="w-full px-4 py-2 text-left hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors flex items-center gap-3">
                    <MapPin className="w-5 h-5 text-[var(--ff-primary)]" />
                    <span className="text-[var(--ff-text-primary)]">Manage Locations</span>
                  </button>
                </Link>
              </div>
            </div>

            {/* Recent Investigations */}
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)] p-6">
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
                Recent Investigations
              </h2>
              {investigations.length === 0 ? (
                <div className="text-center py-4">
                  <FileText className="w-8 h-8 text-[var(--ff-text-tertiary)] mx-auto mb-2" />
                  <p className="text-[var(--ff-text-secondary)]">No investigations yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {investigations.slice(0, 5).map((inv) => (
                    <Link key={inv.id} href={`/fleet/investigation/${inv.id}`}>
                      <div className="p-3 hover:bg-[var(--ff-bg-tertiary)] rounded-lg cursor-pointer">
                        <p className="text-sm font-medium text-[var(--ff-text-primary)]">
                          {inv.fileName}
                        </p>
                        <p className="text-xs text-[var(--ff-text-secondary)]">
                          {inv.totalTrips} trips &bull; {new Date(inv.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Metadata */}
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)] p-6">
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
                Record Info
              </h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--ff-text-secondary)]">Created</span>
                  <span className="text-[var(--ff-text-primary)]">
                    {new Date(vehicle.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--ff-text-secondary)]">Updated</span>
                  <span className="text-[var(--ff-text-primary)]">
                    {new Date(vehicle.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Assign Driver Modal */}
      {showAssignModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--ff-bg-primary)] rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="p-6 border-b border-[var(--ff-border-light)]">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                  Assign Driver to {vehicle.registration}
                </h3>
                <button
                  onClick={() => {
                    setShowAssignModal(false);
                    setSelectedStaffId('');
                  }}
                  className="p-1 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-[var(--ff-text-secondary)]" />
                </button>
              </div>
            </div>
            <div className="p-6">
              {loadingStaff ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-8 h-8 text-[var(--ff-text-tertiary)] animate-spin" />
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                      Select Staff Member
                    </label>
                    <select
                      value={selectedStaffId}
                      onChange={(e) => setSelectedStaffId(e.target.value)}
                      className="w-full px-3 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg focus:ring-2 focus:ring-[var(--ff-primary)] focus:border-transparent"
                    >
                      <option value="">Choose a staff member...</option>
                      {availableStaff
                        .filter(s => s.hasValidLicense)
                        .map((staff) => (
                          <option key={staff.id} value={staff.id}>
                            {staff.name} {staff.hasVehicle ? '(has vehicle)' : ''}
                          </option>
                        ))}
                    </select>
                    <p className="text-xs text-[var(--ff-text-secondary)] mt-1">
                      Only staff with valid driver&apos;s license are shown
                    </p>
                  </div>
                  {availableStaff.filter(s => !s.hasValidLicense).length > 0 && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                      <p className="text-sm text-yellow-800">
                        <AlertTriangle className="w-4 h-4 inline mr-1" />
                        {availableStaff.filter(s => !s.hasValidLicense).length} staff member(s) hidden due to missing/invalid license
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="p-6 border-t border-[var(--ff-border-light)] flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setShowAssignModal(false);
                  setSelectedStaffId('');
                }}
                className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAssignDriver}
                disabled={!selectedStaffId || assigning}
                className="px-4 py-2 bg-[var(--ff-primary)] text-white rounded-lg hover:bg-[var(--ff-primary-dark)] transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {assigning ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Assigning...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    Assign Driver
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
