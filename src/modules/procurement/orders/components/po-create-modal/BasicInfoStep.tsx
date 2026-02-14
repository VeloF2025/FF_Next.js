// ============= Basic Info Step Component =============

import React from 'react';
import { FileText, User, MapPin } from 'lucide-react';
import type { POFormData } from './types';
import { mockSuppliers, SA_PROVINCES } from './types';
import type { POOrderType } from '../../../../../types/procurement/po.types';

interface BasicInfoStepProps {
  formData: POFormData;
  updateFormData: (updates: Partial<POFormData>) => void;
}

export const BasicInfoStep: React.FC<BasicInfoStepProps> = ({
  formData,
  updateFormData
}) => {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Basic Information Section */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-foreground flex items-center">
            <FileText className="h-5 w-5 mr-2" />
            Basic Information
          </h3>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Title *
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => updateFormData({ title: e.target.value })}
              className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter PO title"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Description
            </label>
            <textarea
              value={formData.description || ''}
              onChange={(e) => updateFormData({ description: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter PO description"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Order Type *
            </label>
            <select
              value={formData.orderType}
              onChange={(e) => updateFormData({ orderType: e.target.value as POOrderType })}
              className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="GOODS">Goods</option>
              <option value="SERVICES">Services</option>
              <option value="MIXED">Mixed</option>
            </select>
          </div>
        </div>

        {/* Supplier Information Section */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-foreground flex items-center">
            <User className="h-5 w-5 mr-2" />
            Supplier Information
          </h3>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Supplier *
            </label>
            <select
              value={formData.supplierId}
              onChange={(e) => updateFormData({ supplierId: e.target.value })}
              className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Select a supplier</option>
              {mockSuppliers.map(supplier => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name} ({supplier.code})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                Payment Terms
              </label>
              <select
                value={formData.paymentTerms}
                onChange={(e) => updateFormData({ paymentTerms: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="30 days net">30 days net</option>
                <option value="60 days net">60 days net</option>
                <option value="90 days net">90 days net</option>
                <option value="COD">Cash on Delivery</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                Delivery Terms
              </label>
              <input
                type="text"
                value={formData.deliveryTerms}
                onChange={(e) => updateFormData({ deliveryTerms: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter delivery terms"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Delivery Address Section */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-foreground flex items-center">
          <MapPin className="h-5 w-5 mr-2" />
          Delivery Address
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Street Address *
            </label>
            <input
              type="text"
              value={formData.deliveryAddress.street}
              onChange={(e) => updateFormData({
                deliveryAddress: {
                  ...formData.deliveryAddress,
                  street: e.target.value
                }
              })}
              className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter street address"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              City *
            </label>
            <input
              type="text"
              value={formData.deliveryAddress.city}
              onChange={(e) => updateFormData({
                deliveryAddress: {
                  ...formData.deliveryAddress,
                  city: e.target.value
                }
              })}
              className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter city"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Province *
            </label>
            <select
              value={formData.deliveryAddress.province}
              onChange={(e) => updateFormData({
                deliveryAddress: {
                  ...formData.deliveryAddress,
                  province: e.target.value
                }
              })}
              className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Select province</option>
              {SA_PROVINCES.map(province => (
                <option key={province} value={province}>{province}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Postal Code *
            </label>
            <input
              type="text"
              value={formData.deliveryAddress.postalCode}
              onChange={(e) => updateFormData({
                deliveryAddress: {
                  ...formData.deliveryAddress,
                  postalCode: e.target.value
                }
              })}
              className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter postal code"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Expected Delivery Date
            </label>
            <input
              type="date"
              value={formData.expectedDeliveryDate ?
                new Date(formData.expectedDeliveryDate).toISOString().split('T')[0] :
                ''
              }
              onChange={(e) => {
                if (e.target.value) {
                  updateFormData({ expectedDeliveryDate: new Date(e.target.value) });
                } else {
                  const { expectedDeliveryDate: _expectedDeliveryDate, ...rest } = formData;
                  updateFormData(rest as POFormData);
                }
              }}
              className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
