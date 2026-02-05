'use client';

/**
 * Contractor Form - Shared component for Create and Edit
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Contractor, ContractorFormData } from '@/types/contractor.core.types';
import { BUSINESS_TYPES, CONTRACTOR_STATUSES, COMPLIANCE_STATUSES, SA_PROVINCES } from '@/types/contractor.core.types';

interface ContractorFormProps {
  contractor?: Contractor; // If provided, it's edit mode
  onSuccess?: () => void;
}

export function ContractorForm({ contractor, onSuccess }: ContractorFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState<ContractorFormData>({
    // Company
    companyName: contractor?.companyName || '',
    registrationNumber: contractor?.registrationNumber || '',
    businessType: contractor?.businessType || 'pty_ltd',
    industryCategory: contractor?.industryCategory || '',
    yearsInBusiness: contractor?.yearsInBusiness,

    // Contact
    contactPerson: contractor?.contactPerson || '',
    email: contractor?.email || '',
    phone: contractor?.phone || '',
    alternatePhone: contractor?.alternatePhone || '',

    // Address
    physicalAddress: contractor?.physicalAddress || '',
    city: contractor?.city || '',
    province: contractor?.province || '',
    postalCode: contractor?.postalCode || '',

    // Financial
    bankName: contractor?.bankName || '',
    accountNumber: contractor?.accountNumber || '',
    branchCode: contractor?.branchCode || '',

    // Status
    status: contractor?.status || 'pending',
    isActive: contractor?.isActive !== undefined ? contractor.isActive : true, // Default to active for new contractors
    complianceStatus: contractor?.complianceStatus || 'pending',

    // Professional
    specializations: contractor?.specializations || [],
    certifications: contractor?.certifications || [],

    // Metadata
    notes: contractor?.notes || '',
    tags: contractor?.tags || [],
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const url = contractor
        ? `/api/contractors/${contractor.id}`
        : '/api/contractors';
      const method = contractor ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save contractor');
      }

      if (onSuccess) {
        onSuccess();
      } else {
        router.push('/contractors');
        router.refresh();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {error && (
        <div className="sticky top-0 z-50 p-4 bg-red-100 border-2 border-red-400 rounded-lg shadow-lg">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0">
              <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-bold text-red-900 mb-1">Cannot Save Contractor</h3>
              <p className="text-sm text-red-800">{error}</p>
              {error.includes('already exists') && (
                <p className="text-xs text-red-700 mt-2">
                  💡 Tip: Use a different email address or registration number
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              className="flex-shrink-0 text-red-600 hover:text-red-800"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Company Information */}
      <div className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)]">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Company Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              Company Name *
            </label>
            <input
              type="text"
              required
              value={formData.companyName}
              onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              Registration Number *
              {error?.includes('already exists') && (
                <span className="ml-2 text-xs text-red-600">⚠️ May be duplicate</span>
              )}
            </label>
            <input
              type="text"
              required
              value={formData.registrationNumber}
              onChange={(e) => setFormData({ ...formData, registrationNumber: e.target.value })}
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                error?.includes('already exists')
                  ? 'border-red-400 bg-red-50 focus:ring-red-500'
                  : 'border-gray-300 focus:ring-blue-500'
              }`}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              Business Type *
            </label>
            <select
              required
              value={formData.businessType}
              onChange={(e) => setFormData({ ...formData, businessType: e.target.value as any })}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {BUSINESS_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              Industry Category
            </label>
            <input
              type="text"
              value={formData.industryCategory}
              onChange={(e) => setFormData({ ...formData, industryCategory: e.target.value })}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              Years in Business
            </label>
            <input
              type="number"
              min="0"
              value={formData.yearsInBusiness || ''}
              onChange={(e) => setFormData({ ...formData, yearsInBusiness: e.target.value ? parseInt(e.target.value) : undefined })}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Contact Information */}
      <div className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)]">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Contact Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              Contact Person *
            </label>
            <input
              type="text"
              required
              value={formData.contactPerson}
              onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              Email *
              {error?.includes('already exists') && (
                <span className="ml-2 text-xs text-red-600">⚠️ May be duplicate</span>
              )}
            </label>
            <input
              type="email"
              required
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                error?.includes('already exists')
                  ? 'border-red-400 bg-red-50 focus:ring-red-500'
                  : 'border-gray-300 focus:ring-blue-500'
              }`}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              Phone *
            </label>
            <input
              type="tel"
              required
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              Alternate Phone
            </label>
            <input
              type="tel"
              value={formData.alternatePhone}
              onChange={(e) => setFormData({ ...formData, alternatePhone: e.target.value })}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Address */}
      <div className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)]">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Address</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              Physical Address
            </label>
            <textarea
              rows={2}
              value={formData.physicalAddress}
              onChange={(e) => setFormData({ ...formData, physicalAddress: e.target.value })}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              City
            </label>
            <input
              type="text"
              value={formData.city}
              onChange={(e) => setFormData({ ...formData, city: e.target.value })}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              Province
            </label>
            <select
              value={formData.province}
              onChange={(e) => setFormData({ ...formData, province: e.target.value })}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select Province</option>
              {SA_PROVINCES.map((province) => (
                <option key={province} value={province}>
                  {province}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              Postal Code
            </label>
            <input
              type="text"
              value={formData.postalCode}
              onChange={(e) => setFormData({ ...formData, postalCode: e.target.value })}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Banking Details */}
      <div className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)]">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Banking Details</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              Bank Name
            </label>
            <input
              type="text"
              value={formData.bankName}
              onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              Account Number
            </label>
            <input
              type="text"
              value={formData.accountNumber}
              onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              Branch Code
            </label>
            <input
              type="text"
              value={formData.branchCode}
              onChange={(e) => setFormData({ ...formData, branchCode: e.target.value })}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Status */}
      <div className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)]">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Status</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              Contractor Status
            </label>
            <select
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {CONTRACTOR_STATUSES.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              Compliance Status
            </label>
            <select
              value={formData.complianceStatus}
              onChange={(e) => setFormData({ ...formData, complianceStatus: e.target.value as any })}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {COMPLIANCE_STATUSES.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.isActive}
                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">Active</span>
            </label>
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)]">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Additional Information</h3>
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
            Notes
          </label>
          <textarea
            rows={4}
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Any additional notes about this contractor..."
          />
        </div>
      </div>

      {/* Form Actions */}
      <div className="flex items-center justify-end gap-4">
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {isSubmitting ? 'Saving...' : contractor ? 'Update Contractor' : 'Create Contractor'}
        </button>
      </div>
    </form>
  );
}
