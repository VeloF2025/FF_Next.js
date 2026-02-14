// ============= Details Tab Component =============
// Display PO basic information, supplier, financial summary, and delivery terms

import React from 'react';
import { FileText, User, DollarSign, MapPin } from 'lucide-react';
import { GlassCard } from '../../../../../components/ui';
import type { PurchaseOrder } from '../../../../../types/procurement/po.types';
import { formatterService } from '../../../../../services/core/formatting';

interface DetailsTabProps {
  po: PurchaseOrder;
}

export const DetailsTab: React.FC<DetailsTabProps> = ({ po }) => {
  const formatCurrency = (amount: number) =>
    formatterService.currency(amount, { currency: po.currency });

  const formatDate = (date: Date | undefined) =>
    date ? formatterService.date(date, { dateStyle: 'long' }) : '-';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Basic Information */}
      <GlassCard className="p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <FileText className="h-5 w-5 mr-2" />
          Basic Information
        </h3>
        <div className="space-y-3">
          <div>
            <span className="font-medium text-gray-700 dark:text-gray-300">Title:</span>
            <p className="text-gray-900 dark:text-gray-100">{po.title}</p>
          </div>
          {po.description && (
            <div>
              <span className="font-medium text-gray-700 dark:text-gray-300">Description:</span>
              <p className="text-gray-900 dark:text-gray-100">{po.description}</p>
            </div>
          )}
          <div>
            <span className="font-medium text-gray-700 dark:text-gray-300">Order Type:</span>
            <p className="text-gray-900 dark:text-gray-100">{po.orderType}</p>
          </div>
          <div>
            <span className="font-medium text-gray-700 dark:text-gray-300">Created By:</span>
            <p className="text-gray-900 dark:text-gray-100">{po.createdBy}</p>
          </div>
          <div>
            <span className="font-medium text-gray-700 dark:text-gray-300">Created Date:</span>
            <p className="text-gray-900 dark:text-gray-100">{formatDate(po.createdAt)}</p>
          </div>
        </div>
      </GlassCard>

      {/* Supplier Information */}
      <GlassCard className="p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <User className="h-5 w-5 mr-2" />
          Supplier Information
        </h3>
        <div className="space-y-3">
          <div>
            <span className="font-medium text-gray-700 dark:text-gray-300">Name:</span>
            <p className="text-gray-900 dark:text-gray-100">{po.supplier.name}</p>
          </div>
          {po.supplier.code && (
            <div>
              <span className="font-medium text-gray-700 dark:text-gray-300">Code:</span>
              <p className="text-gray-900 dark:text-gray-100">{po.supplier.code}</p>
            </div>
          )}
          {po.supplier.contactPerson && (
            <div>
              <span className="font-medium text-gray-700 dark:text-gray-300">Contact Person:</span>
              <p className="text-gray-900 dark:text-gray-100">{po.supplier.contactPerson}</p>
            </div>
          )}
          {po.supplier.email && (
            <div>
              <span className="font-medium text-gray-700 dark:text-gray-300">Email:</span>
              <p className="text-gray-900 dark:text-gray-100">{po.supplier.email}</p>
            </div>
          )}
          {po.supplier.phone && (
            <div>
              <span className="font-medium text-gray-700 dark:text-gray-300">Phone:</span>
              <p className="text-gray-900 dark:text-gray-100">{po.supplier.phone}</p>
            </div>
          )}
        </div>
      </GlassCard>

      {/* Financial Summary */}
      <GlassCard className="p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <DollarSign className="h-5 w-5 mr-2" />
          Financial Summary
        </h3>
        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="font-medium text-gray-700 dark:text-gray-300">Subtotal:</span>
            <span className="text-gray-900 dark:text-gray-100">{formatCurrency(po.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-medium text-gray-700 dark:text-gray-300">Tax Amount:</span>
            <span className="text-gray-900 dark:text-gray-100">{formatCurrency(po.taxAmount)}</span>
          </div>
          {po.discountAmount && po.discountAmount > 0 && (
            <div className="flex justify-between">
              <span className="font-medium text-gray-700 dark:text-gray-300">Discount:</span>
              <span className="text-gray-900 dark:text-gray-100">-{formatCurrency(po.discountAmount)}</span>
            </div>
          )}
          <div className="flex justify-between border-t pt-3 text-lg font-semibold">
            <span>Total Amount:</span>
            <span>{formatCurrency(po.totalAmount)}</span>
          </div>
        </div>
      </GlassCard>

      {/* Terms & Delivery */}
      <GlassCard className="p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <MapPin className="h-5 w-5 mr-2" />
          Terms & Delivery
        </h3>
        <div className="space-y-3">
          <div>
            <span className="font-medium text-gray-700 dark:text-gray-300">Payment Terms:</span>
            <p className="text-gray-900 dark:text-gray-100">{po.paymentTerms}</p>
          </div>
          <div>
            <span className="font-medium text-gray-700 dark:text-gray-300">Delivery Terms:</span>
            <p className="text-gray-900 dark:text-gray-100">{po.deliveryTerms}</p>
          </div>
          <div>
            <span className="font-medium text-gray-700 dark:text-gray-300">Expected Delivery:</span>
            <p className="text-gray-900 dark:text-gray-100">{formatDate(po.expectedDeliveryDate)}</p>
          </div>
          <div>
            <span className="font-medium text-gray-700 dark:text-gray-300">Delivery Address:</span>
            <div className="text-gray-900 dark:text-gray-100">
              <p>{po.deliveryAddress.street}</p>
              <p>{po.deliveryAddress.city}, {po.deliveryAddress.province}</p>
              <p>{po.deliveryAddress.postalCode}, {po.deliveryAddress.country}</p>
            </div>
          </div>
        </div>
      </GlassCard>
    </div>
  );
};
