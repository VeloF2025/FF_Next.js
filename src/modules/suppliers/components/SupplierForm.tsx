'use client';

import { useState } from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft, Save, Building } from 'lucide-react';
import { notificationService } from '@/services/core/NotificationService';
import { log } from '@/lib/logger';
import {
  SupplierStatus,
  BusinessType,
  EmployeeSize,
  RevenueRange,
  Address,
  ContactInfo
} from '@/types/supplier';
import { PaymentTerms, Currency } from '@/types/supplier/common.types';
import { ProductCategory } from '@/types/supplier/product.types';

interface SupplierFormData {
  name: string;
  tradingName: string;
  registrationNumber: string;
  taxNumber: string;
  status: SupplierStatus;
  businessType: BusinessType;
  categories: ProductCategory[];
  email: string;
  phone: string;
  website: string;
  primaryContact: ContactInfo;
  addresses: {
    physical: Address;
  };
  preferredPaymentTerms: PaymentTerms;
  currency: Currency;
  creditLimit: number;
  leadTime: number;
  minimumOrderValue: number;
  employeeSize: EmployeeSize;
  annualRevenue: RevenueRange;
  notes: string;
  tags: string[];
}

export function SupplierForm() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState<SupplierFormData>({
    name: '',
    tradingName: '',
    registrationNumber: '',
    taxNumber: '',
    status: SupplierStatus.PENDING,
    businessType: BusinessType.DISTRIBUTOR,
    categories: [],
    email: '',
    phone: '',
    website: '',
    primaryContact: {
      name: '',
      email: '',
      phone: '',
      title: '',
      department: '',
    },
    addresses: {
      physical: {
        street1: '',
        street2: '',
        city: 'Johannesburg',
        state: 'Gauteng',
        postalCode: '',
        country: 'South Africa'
      }
    },
    preferredPaymentTerms: PaymentTerms.NET_30,
    currency: Currency.ZAR,
    creditLimit: 0,
    leadTime: 7,
    minimumOrderValue: 0,
    employeeSize: EmployeeSize.SMALL,
    annualRevenue: RevenueRange.UNDER_1M,
    notes: '',
    tags: []
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            ...formData,
            code: `SUP-${Date.now()}`, // Generate a unique code
            isActive: true,
            createdBy: 'current-user', // TODO: Get from auth context
            rating: 0,
            contact: formData.primaryContact
          },
          userId: 'current-user' // TODO: Get from auth context
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create supplier');
      }

      notificationService.success('Supplier created successfully');
      router.push('/suppliers');
    } catch (error) {
      log.error('Failed to save supplier', { error, supplierName: formData.name }, 'SupplierForm');
      notificationService.error(error instanceof Error ? error.message : 'Failed to create supplier. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInputChange = (field: keyof SupplierFormData, value: SupplierFormData[keyof SupplierFormData]) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleNestedChange = (parent: keyof SupplierFormData, field: string, value: unknown) => {
    setFormData(prev => ({
      ...prev,
      [parent]: {
        ...(prev[parent] as Record<string, unknown>),
        [field]: value
      }
    }));
  };

  const handleAddressChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      addresses: {
        ...prev.addresses,
        physical: {
          ...prev.addresses.physical,
          [field]: value
        }
      }
    }));
  };

  const _toggleCategory = (category: ProductCategory) => {
    setFormData(prev => ({
      ...prev,
      categories: prev.categories.includes(category)
        ? prev.categories.filter(c => c !== category)
        : [...prev.categories, category]
    }));
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <button
          onClick={() => router.push('/suppliers')}
          className="inline-flex items-center text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Suppliers
        </button>
      </div>

      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)]">
        <div className="px-6 py-4 border-b border-[var(--ff-border-light)]">
          <div className="flex items-center gap-3">
            <Building className="w-6 h-6 text-blue-400" />
            <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">Add New Supplier</h1>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Basic Information */}
          <div>
            <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Basic Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Company Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => handleInputChange('name', e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Trading Name
                </label>
                <input
                  type="text"
                  value={formData.tradingName}
                  onChange={(e) => handleInputChange('tradingName', e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Registration Number
                </label>
                <input
                  type="text"
                  value={formData.registrationNumber}
                  onChange={(e) => handleInputChange('registrationNumber', e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Tax Number
                </label>
                <input
                  type="text"
                  value={formData.taxNumber}
                  onChange={(e) => handleInputChange('taxNumber', e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Status
                </label>
                <select
                  value={formData.status}
                  onChange={(e) => handleInputChange('status', e.target.value as SupplierStatus)}
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {Object.values(SupplierStatus).map(status => (
                    <option key={status} value={status}>{status.toUpperCase()}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Business Type <span className="text-red-400">*</span>
                </label>
                <select
                  required
                  value={formData.businessType}
                  onChange={(e) => handleInputChange('businessType', e.target.value as BusinessType)}
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {Object.values(BusinessType).map(type => (
                    <option key={type} value={type}>{type.replace(/_/g, ' ').toUpperCase()}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Contact Information */}
          <div>
            <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Contact Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Email <span className="text-red-400">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => handleInputChange('email', e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Phone <span className="text-red-400">*</span>
                </label>
                <input
                  type="tel"
                  required
                  value={formData.phone}
                  onChange={(e) => handleInputChange('phone', e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Website
                </label>
                <input
                  type="url"
                  value={formData.website}
                  onChange={(e) => handleInputChange('website', e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Primary Contact */}
          <div>
            <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Primary Contact Person</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Contact Name
                </label>
                <input
                  type="text"
                  value={formData.primaryContact.name}
                  onChange={(e) => handleNestedChange('primaryContact', 'name', e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={formData.primaryContact.title || ''}
                  onChange={(e) => handleNestedChange('primaryContact', 'title', e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Contact Email
                </label>
                <input
                  type="email"
                  value={formData.primaryContact.email}
                  onChange={(e) => handleNestedChange('primaryContact', 'email', e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Contact Phone
                </label>
                <input
                  type="tel"
                  value={formData.primaryContact.phone}
                  onChange={(e) => handleNestedChange('primaryContact', 'phone', e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Address */}
          <div>
            <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Physical Address</h2>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Street Address
                </label>
                <input
                  type="text"
                  value={formData.addresses.physical.street1}
                  onChange={(e) => handleAddressChange('street1', e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                    City
                  </label>
                  <input
                    type="text"
                    value={formData.addresses.physical.city}
                    onChange={(e) => handleAddressChange('city', e.target.value)}
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                    Province
                  </label>
                  <input
                    type="text"
                    value={formData.addresses.physical.state}
                    onChange={(e) => handleAddressChange('state', e.target.value)}
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                    Postal Code
                  </label>
                  <input
                    type="text"
                    value={formData.addresses.physical.postalCode}
                    onChange={(e) => handleAddressChange('postalCode', e.target.value)}
                    className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Additional Information */}
          <div>
            <h2 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">Additional Information</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Notes
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => handleInputChange('notes', e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--ff-border-light)]">
            <button
              type="button"
              onClick={() => router.push('/suppliers')}
              className="px-6 py-2 text-sm font-medium text-[var(--ff-text-secondary)] bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center px-6 py-2 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <span className="mr-2">Saving...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Create Supplier
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
