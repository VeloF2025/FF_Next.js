import { useState, useEffect } from 'react';
import type { RFQInvitation, QuoteFormData, QuoteFormErrors, QuoteLineItem } from './types';

export const useQuoteForm = (rfq: RFQInvitation | null) => {
  const [formData, setFormData] = useState<QuoteFormData>({
    currency: 'ZAR',
    validityPeriod: 30,
    paymentTerms: '30 days net',
    deliveryTerms: 'Ex Works',
    lineItems: []
  });
  const [errors, setErrors] = useState<QuoteFormErrors>({});

  // Initialize line items from RFQ items
  useEffect(() => {
    if (rfq?.items && formData.lineItems?.length === 0) {
      const initialLineItems: QuoteLineItem[] = rfq.items.map(item => ({
        itemId: item.id,
        itemCode: item.itemCode,
        itemName: item.itemName,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: 0,
        totalPrice: 0,
        deliveryTime: 7,
        notes: ''
      }));
      setFormData(prev => ({ ...prev, lineItems: initialLineItems }));
    }
  }, [rfq, formData.lineItems?.length]);

  const updateLineItem = (index: number, field: keyof QuoteLineItem, value: string | number | undefined) => {
    const newLineItems = [...(formData.lineItems || [])];
    newLineItems[index] = { ...newLineItems[index], [field]: value } as QuoteLineItem;

    // Calculate total price for the line item
    if (field === 'unitPrice' || field === 'quantity') {
      newLineItems[index]!.totalPrice = newLineItems[index]!.unitPrice * newLineItems[index]!.quantity;
    }

    setFormData(prev => ({ ...prev, lineItems: newLineItems }));

    // Calculate total amount
    const totalAmount = newLineItems.reduce((sum, item) => sum + item.totalPrice, 0);
    setFormData(prev => ({ ...prev, totalAmount }));
  };

  const addLineItem = () => {
    const newItem: QuoteLineItem = {
      itemId: `custom-${Date.now()}`,
      itemCode: '',
      itemName: '',
      quantity: 1,
      unit: 'each',
      unitPrice: 0,
      totalPrice: 0,
      deliveryTime: 7
    };
    setFormData(prev => ({
      ...prev,
      lineItems: [...(prev.lineItems || []), newItem]
    }));
  };

  const removeLineItem = (index: number) => {
    const newLineItems = (formData.lineItems || []).filter((_, i) => i !== index);
    setFormData(prev => ({ ...prev, lineItems: newLineItems }));

    // Recalculate total
    const totalAmount = newLineItems.reduce((sum, item) => sum + item.totalPrice, 0);
    setFormData(prev => ({ ...prev, totalAmount }));
  };

  const validateStep = (step: number): boolean => {
    const newErrors: QuoteFormErrors = {};

    if (step === 1) {
      // Validate line items
      if (!formData.lineItems || formData.lineItems.length === 0) {
        newErrors.lineItems = 'At least one line item is required';
      } else {
        formData.lineItems.forEach((item, index) => {
          if (!item.unitPrice || item.unitPrice <= 0) {
            newErrors[`unitPrice_${index}`] = 'Unit price is required';
          }
          if (!item.deliveryTime || item.deliveryTime <= 0) {
            newErrors[`deliveryTime_${index}`] = 'Delivery time is required';
          }
        });
      }
    }

    if (step === 2) {
      // Validate quote details
      if (!formData.validityPeriod || formData.validityPeriod <= 0) {
        newErrors.validityPeriod = 'Validity period is required';
      }
      if (!formData.paymentTerms) {
        newErrors.paymentTerms = 'Payment terms are required';
      }
      if (!formData.deliveryTerms) {
        newErrors.deliveryTerms = 'Delivery terms are required';
      }
      if (!formData.estimatedDeliveryDate) {
        newErrors.estimatedDeliveryDate = 'Estimated delivery date is required';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const updateFormData = (updates: Partial<QuoteFormData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
  };

  return {
    formData,
    errors,
    updateLineItem,
    addLineItem,
    removeLineItem,
    validateStep,
    updateFormData
  };
};
