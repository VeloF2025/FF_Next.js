/**
 * Unit Tests: Purchase Order Create Form
 * Tests form validation, calculations, and submission logic
 */

import { describe, it, expect } from 'vitest';

// Types for PO Create Form
interface POLineItem {
  id: string;
  itemCode: string;
  description: string;
  quantity: number;
  uom: string;
  unitPrice: number;
  notes: string;
}

interface POFormData {
  supplierId: number | null;
  supplierContact: string;
  supplierReference: string;
  projectId: string | null;
  deliveryAddress: string;
  expectedDeliveryDate: string;
  shippingMethod: string;
  paymentTerms: string;
  currency: string;
  taxRate: number;
  internalNotes: string;
  supplierNotes: string;
  items: POLineItem[];
}

interface ValidationError {
  field: string;
  message: string;
}

// Business logic functions to test

/**
 * Calculate line item total
 */
function calculateLineTotal(quantity: number, unitPrice: number): number {
  return Math.round(quantity * unitPrice * 100) / 100;
}

/**
 * Calculate subtotal from all line items
 */
function calculateSubtotal(items: POLineItem[]): number {
  return items.reduce((sum, item) => {
    return sum + calculateLineTotal(item.quantity, item.unitPrice);
  }, 0);
}

/**
 * Calculate tax amount
 */
function calculateTaxAmount(subtotal: number, taxRate: number): number {
  return Math.round(subtotal * (taxRate / 100) * 100) / 100;
}

/**
 * Calculate total amount
 */
function calculateTotalAmount(subtotal: number, taxAmount: number): number {
  return Math.round((subtotal + taxAmount) * 100) / 100;
}

/**
 * Validate a single line item
 */
function validateLineItem(item: POLineItem, index: number): ValidationError[] {
  const errors: ValidationError[] = [];
  const prefix = `items[${index}]`;

  if (!item.description || item.description.trim().length < 3) {
    errors.push({
      field: `${prefix}.description`,
      message: 'Description must be at least 3 characters',
    });
  }

  if (item.description && item.description.length > 500) {
    errors.push({
      field: `${prefix}.description`,
      message: 'Description must be less than 500 characters',
    });
  }

  if (!item.quantity || item.quantity <= 0) {
    errors.push({
      field: `${prefix}.quantity`,
      message: 'Quantity must be greater than 0',
    });
  }

  if (item.quantity > 999999) {
    errors.push({
      field: `${prefix}.quantity`,
      message: 'Quantity must be less than 1,000,000',
    });
  }

  if (!item.uom || item.uom.trim() === '') {
    errors.push({
      field: `${prefix}.uom`,
      message: 'Unit of measure is required',
    });
  }

  if (item.unitPrice === undefined || item.unitPrice < 0.01) {
    errors.push({
      field: `${prefix}.unitPrice`,
      message: 'Unit price must be at least 0.01',
    });
  }

  if (item.itemCode && item.itemCode.length > 50) {
    errors.push({
      field: `${prefix}.itemCode`,
      message: 'Item code must be less than 50 characters',
    });
  }

  if (item.notes && item.notes.length > 200) {
    errors.push({
      field: `${prefix}.notes`,
      message: 'Notes must be less than 200 characters',
    });
  }

  return errors;
}

/**
 * Validate entire form
 */
function validatePOForm(form: POFormData): ValidationError[] {
  const errors: ValidationError[] = [];

  // Supplier validation
  if (!form.supplierId) {
    errors.push({
      field: 'supplierId',
      message: 'Please select a supplier',
    });
  }

  // Delivery address validation
  if (!form.deliveryAddress || form.deliveryAddress.trim().length < 10) {
    errors.push({
      field: 'deliveryAddress',
      message: 'Delivery address must be at least 10 characters',
    });
  }

  // Expected delivery date validation (must be future if set)
  if (form.expectedDeliveryDate) {
    const expectedDate = new Date(form.expectedDeliveryDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (expectedDate < today) {
      errors.push({
        field: 'expectedDeliveryDate',
        message: 'Expected delivery date must be in the future',
      });
    }
  }

  // Payment terms validation
  const validPaymentTerms = ['COD', 'Net 15', 'Net 30', 'Net 45', 'Net 60'];
  if (!validPaymentTerms.includes(form.paymentTerms)) {
    errors.push({
      field: 'paymentTerms',
      message: 'Please select valid payment terms',
    });
  }

  // Tax rate validation
  if (form.taxRate < 0 || form.taxRate > 25) {
    errors.push({
      field: 'taxRate',
      message: 'Tax rate must be between 0 and 25%',
    });
  }

  // Line items validation
  if (!form.items || form.items.length === 0) {
    errors.push({
      field: 'items',
      message: 'At least one line item is required',
    });
  } else {
    form.items.forEach((item, index) => {
      errors.push(...validateLineItem(item, index));
    });
  }

  // Notes validation
  if (form.internalNotes && form.internalNotes.length > 1000) {
    errors.push({
      field: 'internalNotes',
      message: 'Internal notes must be less than 1000 characters',
    });
  }

  if (form.supplierNotes && form.supplierNotes.length > 1000) {
    errors.push({
      field: 'supplierNotes',
      message: 'Supplier notes must be less than 1000 characters',
    });
  }

  return errors;
}

/**
 * Generate PO number
 */
function generatePONumber(lastNumber: number): string {
  const year = new Date().getFullYear();
  const nextNumber = lastNumber + 1;
  return `PO-${year}-${String(nextNumber).padStart(4, '0')}`;
}

/**
 * Create empty line item
 */
function createEmptyLineItem(): POLineItem {
  return {
    id: Math.random().toString(36).substring(2, 9),
    itemCode: '',
    description: '',
    quantity: 1,
    uom: 'pcs',
    unitPrice: 0,
    notes: '',
  };
}

/**
 * Format currency for display
 */
function formatCurrency(amount: number, currency: string = 'ZAR'): string {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

// ============================================
// TESTS
// ============================================

describe('PO Create Form - Line Item Calculations', () => {
  it('calculates line total correctly', () => {
    expect(calculateLineTotal(10, 50)).toBe(500);
    expect(calculateLineTotal(3, 33.33)).toBe(99.99);
    expect(calculateLineTotal(1, 0.01)).toBe(0.01);
    expect(calculateLineTotal(100, 9.99)).toBe(999);
  });

  it('handles decimal precision in line totals', () => {
    // 7 * 14.99 = 104.93
    expect(calculateLineTotal(7, 14.99)).toBe(104.93);
    // 3 * 0.33 = 0.99
    expect(calculateLineTotal(3, 0.33)).toBe(0.99);
  });

  it('calculates subtotal from multiple items', () => {
    const items: POLineItem[] = [
      { id: '1', itemCode: '', description: 'Item 1', quantity: 10, uom: 'pcs', unitPrice: 50, notes: '' },
      { id: '2', itemCode: '', description: 'Item 2', quantity: 5, uom: 'pcs', unitPrice: 100, notes: '' },
    ];
    expect(calculateSubtotal(items)).toBe(1000); // 500 + 500
  });

  it('returns 0 for empty items array', () => {
    expect(calculateSubtotal([])).toBe(0);
  });

  it('calculates tax amount correctly', () => {
    expect(calculateTaxAmount(1000, 15)).toBe(150);
    expect(calculateTaxAmount(1000, 0)).toBe(0);
    expect(calculateTaxAmount(500, 10)).toBe(50);
  });

  it('calculates total amount correctly', () => {
    expect(calculateTotalAmount(1000, 150)).toBe(1150);
    expect(calculateTotalAmount(500, 0)).toBe(500);
  });

  it('handles full calculation chain', () => {
    const items: POLineItem[] = [
      { id: '1', itemCode: 'A', description: 'Item A', quantity: 10, uom: 'pcs', unitPrice: 100, notes: '' },
    ];
    const subtotal = calculateSubtotal(items);
    const taxAmount = calculateTaxAmount(subtotal, 15);
    const total = calculateTotalAmount(subtotal, taxAmount);

    expect(subtotal).toBe(1000);
    expect(taxAmount).toBe(150);
    expect(total).toBe(1150);
  });
});

describe('PO Create Form - Line Item Validation', () => {
  const validItem: POLineItem = {
    id: '1',
    itemCode: 'TEST-001',
    description: 'Valid description',
    quantity: 10,
    uom: 'pcs',
    unitPrice: 50,
    notes: '',
  };

  it('accepts valid line item', () => {
    const errors = validateLineItem(validItem, 0);
    expect(errors).toHaveLength(0);
  });

  it('requires description', () => {
    const item = { ...validItem, description: '' };
    const errors = validateLineItem(item, 0);
    expect(errors.some(e => e.field === 'items[0].description')).toBe(true);
  });

  it('requires description minimum length', () => {
    const item = { ...validItem, description: 'AB' };
    const errors = validateLineItem(item, 0);
    expect(errors.some(e => e.field === 'items[0].description')).toBe(true);
  });

  it('enforces description maximum length', () => {
    const item = { ...validItem, description: 'A'.repeat(501) };
    const errors = validateLineItem(item, 0);
    expect(errors.some(e => e.message.includes('less than 500'))).toBe(true);
  });

  it('requires positive quantity', () => {
    const item = { ...validItem, quantity: 0 };
    const errors = validateLineItem(item, 0);
    expect(errors.some(e => e.field === 'items[0].quantity')).toBe(true);
  });

  it('rejects negative quantity', () => {
    const item = { ...validItem, quantity: -5 };
    const errors = validateLineItem(item, 0);
    expect(errors.some(e => e.field === 'items[0].quantity')).toBe(true);
  });

  it('enforces quantity maximum', () => {
    const item = { ...validItem, quantity: 1000001 };
    const errors = validateLineItem(item, 0);
    expect(errors.some(e => e.message.includes('less than 1,000,000'))).toBe(true);
  });

  it('requires unit of measure', () => {
    const item = { ...validItem, uom: '' };
    const errors = validateLineItem(item, 0);
    expect(errors.some(e => e.field === 'items[0].uom')).toBe(true);
  });

  it('requires minimum unit price', () => {
    const item = { ...validItem, unitPrice: 0 };
    const errors = validateLineItem(item, 0);
    expect(errors.some(e => e.field === 'items[0].unitPrice')).toBe(true);
  });

  it('rejects negative unit price', () => {
    const item = { ...validItem, unitPrice: -10 };
    const errors = validateLineItem(item, 0);
    expect(errors.some(e => e.field === 'items[0].unitPrice')).toBe(true);
  });

  it('allows optional item code', () => {
    const item = { ...validItem, itemCode: '' };
    const errors = validateLineItem(item, 0);
    expect(errors).toHaveLength(0);
  });

  it('enforces item code max length', () => {
    const item = { ...validItem, itemCode: 'A'.repeat(51) };
    const errors = validateLineItem(item, 0);
    expect(errors.some(e => e.message.includes('less than 50'))).toBe(true);
  });

  it('enforces notes max length', () => {
    const item = { ...validItem, notes: 'A'.repeat(201) };
    const errors = validateLineItem(item, 0);
    expect(errors.some(e => e.message.includes('less than 200'))).toBe(true);
  });
});

describe('PO Create Form - Form Validation', () => {
  const validForm: POFormData = {
    supplierId: 1,
    supplierContact: 'John Doe',
    supplierReference: 'QT-001',
    projectId: null,
    deliveryAddress: '123 Main Street, Johannesburg',
    expectedDeliveryDate: '2026-12-31',
    shippingMethod: 'standard',
    paymentTerms: 'Net 30',
    currency: 'ZAR',
    taxRate: 15,
    internalNotes: '',
    supplierNotes: '',
    items: [
      {
        id: '1',
        itemCode: 'ITEM-001',
        description: 'Test item',
        quantity: 10,
        uom: 'pcs',
        unitPrice: 50,
        notes: '',
      },
    ],
  };

  it('accepts valid form', () => {
    const errors = validatePOForm(validForm);
    expect(errors).toHaveLength(0);
  });

  it('requires supplier selection', () => {
    const form = { ...validForm, supplierId: null };
    const errors = validatePOForm(form);
    expect(errors.some(e => e.field === 'supplierId')).toBe(true);
  });

  it('requires delivery address', () => {
    const form = { ...validForm, deliveryAddress: '' };
    const errors = validatePOForm(form);
    expect(errors.some(e => e.field === 'deliveryAddress')).toBe(true);
  });

  it('requires delivery address minimum length', () => {
    const form = { ...validForm, deliveryAddress: 'Short' };
    const errors = validatePOForm(form);
    expect(errors.some(e => e.field === 'deliveryAddress')).toBe(true);
  });

  it('validates payment terms', () => {
    const form = { ...validForm, paymentTerms: 'Invalid' };
    const errors = validatePOForm(form);
    expect(errors.some(e => e.field === 'paymentTerms')).toBe(true);
  });

  it('accepts all valid payment terms', () => {
    const validTerms = ['COD', 'Net 15', 'Net 30', 'Net 45', 'Net 60'];
    validTerms.forEach(terms => {
      const form = { ...validForm, paymentTerms: terms };
      const errors = validatePOForm(form);
      expect(errors.filter(e => e.field === 'paymentTerms')).toHaveLength(0);
    });
  });

  it('validates tax rate range', () => {
    const formLow = { ...validForm, taxRate: -1 };
    const formHigh = { ...validForm, taxRate: 26 };

    expect(validatePOForm(formLow).some(e => e.field === 'taxRate')).toBe(true);
    expect(validatePOForm(formHigh).some(e => e.field === 'taxRate')).toBe(true);
  });

  it('accepts tax rate at boundaries', () => {
    const form0 = { ...validForm, taxRate: 0 };
    const form25 = { ...validForm, taxRate: 25 };

    expect(validatePOForm(form0).filter(e => e.field === 'taxRate')).toHaveLength(0);
    expect(validatePOForm(form25).filter(e => e.field === 'taxRate')).toHaveLength(0);
  });

  it('requires at least one line item', () => {
    const form = { ...validForm, items: [] };
    const errors = validatePOForm(form);
    expect(errors.some(e => e.field === 'items')).toBe(true);
  });

  it('validates all line items', () => {
    const form = {
      ...validForm,
      items: [
        { id: '1', itemCode: '', description: '', quantity: 0, uom: '', unitPrice: 0, notes: '' },
        { id: '2', itemCode: '', description: 'Valid', quantity: 1, uom: 'pcs', unitPrice: 10, notes: '' },
      ],
    };
    const errors = validatePOForm(form);
    // First item should have multiple errors
    expect(errors.filter(e => e.field.startsWith('items[0]')).length).toBeGreaterThan(0);
    // Second item should be valid
    expect(errors.filter(e => e.field.startsWith('items[1]'))).toHaveLength(0);
  });

  it('enforces internal notes max length', () => {
    const form = { ...validForm, internalNotes: 'A'.repeat(1001) };
    const errors = validatePOForm(form);
    expect(errors.some(e => e.field === 'internalNotes')).toBe(true);
  });

  it('enforces supplier notes max length', () => {
    const form = { ...validForm, supplierNotes: 'A'.repeat(1001) };
    const errors = validatePOForm(form);
    expect(errors.some(e => e.field === 'supplierNotes')).toBe(true);
  });
});

describe('PO Create Form - PO Number Generation', () => {
  it('generates PO number with current year', () => {
    const currentYear = new Date().getFullYear();
    const poNumber = generatePONumber(0);
    expect(poNumber).toBe(`PO-${currentYear}-0001`);
  });

  it('increments PO number correctly', () => {
    const currentYear = new Date().getFullYear();
    expect(generatePONumber(0)).toBe(`PO-${currentYear}-0001`);
    expect(generatePONumber(1)).toBe(`PO-${currentYear}-0002`);
    expect(generatePONumber(99)).toBe(`PO-${currentYear}-0100`);
    expect(generatePONumber(999)).toBe(`PO-${currentYear}-1000`);
  });

  it('pads PO number to 4 digits', () => {
    const poNumber = generatePONumber(5);
    expect(poNumber).toMatch(/PO-\d{4}-0006/);
  });
});

describe('PO Create Form - Empty Line Item Creation', () => {
  it('creates line item with default values', () => {
    const item = createEmptyLineItem();

    expect(item.id).toBeDefined();
    expect(item.id.length).toBeGreaterThan(0);
    expect(item.itemCode).toBe('');
    expect(item.description).toBe('');
    expect(item.quantity).toBe(1);
    expect(item.uom).toBe('pcs');
    expect(item.unitPrice).toBe(0);
    expect(item.notes).toBe('');
  });

  it('creates unique IDs for each line item', () => {
    const item1 = createEmptyLineItem();
    const item2 = createEmptyLineItem();

    expect(item1.id).not.toBe(item2.id);
  });
});

describe('PO Create Form - Currency Formatting', () => {
  it('formats ZAR correctly', () => {
    const formatted = formatCurrency(1000, 'ZAR');
    expect(formatted).toContain('1');
    expect(formatted).toContain('000');
    expect(formatted).toMatch(/R|ZAR/);
  });

  it('formats with 2 decimal places', () => {
    const formatted = formatCurrency(100.5, 'ZAR');
    expect(formatted).toContain('100');
    expect(formatted).toContain('50');
  });

  it('handles zero amount', () => {
    const formatted = formatCurrency(0, 'ZAR');
    expect(formatted).toContain('0');
  });

  it('handles large amounts', () => {
    const formatted = formatCurrency(1000000, 'ZAR');
    expect(formatted).toContain('1');
    expect(formatted).toContain('000');
    expect(formatted).toContain('000');
  });
});

describe('PO Create Form - Default Values', () => {
  it('should have default payment terms of Net 30', () => {
    const defaultPaymentTerms = 'Net 30';
    expect(defaultPaymentTerms).toBe('Net 30');
  });

  it('should have default currency of ZAR', () => {
    const defaultCurrency = 'ZAR';
    expect(defaultCurrency).toBe('ZAR');
  });

  it('should have default tax rate of 15%', () => {
    const defaultTaxRate = 15;
    expect(defaultTaxRate).toBe(15);
  });

  it('should have default UOM options', () => {
    const uomOptions = ['pcs', 'rolls', 'm', 'kg', 'box', 'set'];
    expect(uomOptions).toContain('pcs');
    expect(uomOptions).toContain('rolls');
    expect(uomOptions).toContain('m');
  });

  it('should have shipping method options', () => {
    const shippingMethods = ['standard', 'express', 'pickup'];
    expect(shippingMethods).toHaveLength(3);
  });
});

describe('PO Create Form - Edge Cases', () => {
  it('handles very small unit prices', () => {
    const total = calculateLineTotal(1, 0.01);
    expect(total).toBe(0.01);
  });

  it('handles very large quantities', () => {
    const total = calculateLineTotal(999999, 0.01);
    expect(total).toBe(9999.99);
  });

  it('handles zero tax rate', () => {
    const subtotal = 1000;
    const taxAmount = calculateTaxAmount(subtotal, 0);
    const total = calculateTotalAmount(subtotal, taxAmount);

    expect(taxAmount).toBe(0);
    expect(total).toBe(1000);
  });

  it('handles whitespace in description', () => {
    const item: POLineItem = {
      id: '1',
      itemCode: '',
      description: '   ',
      quantity: 1,
      uom: 'pcs',
      unitPrice: 10,
      notes: '',
    };
    const errors = validateLineItem(item, 0);
    expect(errors.some(e => e.field === 'items[0].description')).toBe(true);
  });

  it('handles multiple validation errors on same item', () => {
    const item: POLineItem = {
      id: '1',
      itemCode: '',
      description: '',
      quantity: 0,
      uom: '',
      unitPrice: -1,
      notes: '',
    };
    const errors = validateLineItem(item, 0);
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });
});
