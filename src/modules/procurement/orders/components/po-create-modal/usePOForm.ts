// ============= PO Form Hook =============

import { useState, useMemo } from 'react';
import type { POFormData, POTotals } from './types';
import type { CreatePOItemRequest, CreatePORequest } from '../../../../../types/procurement/po.types';

interface UsePOFormProps {
  rfqId?: string;
  quoteId?: string;
  projectId?: string;
}

export const usePOForm = ({ rfqId, quoteId, projectId }: UsePOFormProps) => {
  // Initialize form data
  const [formData, setFormData] = useState<POFormData>(() => {
    const data: POFormData = {
      projectId: projectId || 'proj-001',
      supplierId: '',
      title: '',
      orderType: 'GOODS',
      paymentTerms: '30 days net',
      deliveryTerms: 'DDP - Delivered Duty Paid',
      deliveryAddress: {
        street: '',
        city: '',
        province: '',
        postalCode: '',
        country: 'South Africa'
      },
      items: []
    };
    if (rfqId) data.rfqId = rfqId;
    if (quoteId) data.quoteId = quoteId;
    return data;
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Update form data
  const updateFormData = (updates: Partial<POFormData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
  };

  // Item management
  const addItem = () => {
    const newItem: CreatePOItemRequest & { tempId: string } = {
      tempId: `temp-${Date.now()}`,
      description: '',
      category: '',
      quantity: 1,
      uom: 'pieces',
      unitPrice: 0,
      specifications: {}
    };

    updateFormData({
      items: [...formData.items, newItem]
    });
  };

  const updateItem = (tempId: string, updates: Partial<CreatePOItemRequest>) => {
    updateFormData({
      items: formData.items.map(item =>
        item.tempId === tempId ? { ...item, ...updates } : item
      )
    });
  };

  const removeItem = (tempId: string) => {
    updateFormData({
      items: formData.items.filter(item => item.tempId !== tempId)
    });
  };

  // Calculate totals
  const totals: POTotals = useMemo(() => {
    const subtotal = formData.items.reduce((sum, item) =>
      sum + (item.quantity * item.unitPrice), 0
    );
    const taxAmount = subtotal * 0.15; // 15% VAT
    const total = subtotal + taxAmount;

    return { subtotal, taxAmount, total };
  }, [formData.items]);

  // Validation
  const validateForm = (): string | null => {
    if (!formData.title.trim()) return 'Title is required';
    if (!formData.supplierId) return 'Supplier is required';
    if (formData.items.length === 0) return 'At least one item is required';
    if (!formData.deliveryAddress.street.trim()) return 'Delivery address is required';

    for (const item of formData.items) {
      if (!item.description.trim()) return 'Item description is required';
      if (item.quantity <= 0) return 'Item quantity must be greater than 0';
      if (item.unitPrice < 0) return 'Item unit price cannot be negative';
    }

    return null;
  };

  // Prepare submission data
  const prepareSubmission = (): CreatePORequest => {
    const { items: formItems, ...restFormData } = formData;
    const cleanItems = formItems.map(({ tempId: _tempId, ...item }) => item);

    return {
      ...restFormData,
      items: cleanItems
    };
  };

  return {
    formData,
    loading,
    error,
    totals,
    setLoading,
    setError,
    updateFormData,
    addItem,
    updateItem,
    removeItem,
    validateForm,
    prepareSubmission
  };
};
