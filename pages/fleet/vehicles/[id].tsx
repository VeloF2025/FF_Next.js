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

type TabId = 'overview' | 'ownership' | 'documents' | 'insurance';

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

  // Set initial tab from URL
  useEffect(() => {
    if (tab && typeof tab === 'string' && ['overview', 'ownership', 'documents', 'insurance'].includes(tab)) {
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

  // Fetch tab data on tab change
  useEffect(() => {
    if (!vehicle) return;

    switch (activeTab) {
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
  }, [activeTab, vehicle, fetchOwnershipData, fetchDocumentsData, fetchInsuranceData]);

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
            {/* Assignment */}
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)] p-6">
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
                Current Assignment
              </h2>
              {vehicle.assignedStaffName ? (
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-[var(--ff-bg-tertiary)] rounded-full">
                    <User className="w-6 h-6 text-[var(--ff-text-secondary)]" />
                  </div>
                  <div>
                    <p className="font-medium text-[var(--ff-text-primary)]">
                      {vehicle.assignedStaffName}
                    </p>
                    <p className="text-sm text-[var(--ff-text-secondary)]">
                      Assigned Driver
                    </p>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4">
                  <User className="w-8 h-8 text-[var(--ff-text-tertiary)] mx-auto mb-2" />
                  <p className="text-[var(--ff-text-secondary)]">Not assigned</p>
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
    </AppLayout>
  );
}
