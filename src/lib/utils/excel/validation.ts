/**
 * Excel File Validation Utilities
 * File validation and pre-processing checks
 */

import { z } from 'zod';
import { RawBOQRow, ParsedBOQItem } from './types';

// File validation
export function validateFile(file: File): { valid: boolean; error?: string } {
  // Check file exists
  if (!file) {
    return { valid: false, error: 'No file provided' };
  }

  // Check file size (max 50MB)
  const maxSize = 50 * 1024 * 1024;
  if (file.size > maxSize) {
    return { valid: false, error: 'File size exceeds 50MB limit' };
  }

  // Check file type
  const validExtensions = ['.xlsx', '.xls', '.csv'];
  const extension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
  
  if (!validExtensions.includes(extension)) {
    return { valid: false, error: `Invalid file type. Supported formats: ${validExtensions.join(', ')}` };
  }

  return { valid: true };
}

// BOQ item validation schema
const BOQItemSchema = z.object({
  lineNumber: z.number().int().positive(),
  itemCode: z.string().nullable(),
  description: z.string().min(1, 'Description is required'),
  uom: z.string().min(1, 'Unit of measure is required'),
  quantity: z.number().positive('Quantity must be positive'),
  phase: z.string().nullable(),
  task: z.string().nullable(),
  site: z.string().nullable(),
  unitPrice: z.number().nonnegative().nullable(),
  totalPrice: z.number().nonnegative().nullable(),
  category: z.string().nullable(),
  subcategory: z.string().nullable(),
  vendor: z.string().nullable(),
  remarks: z.string().nullable(),
});

// Validate parsed BOQ item
export function validateBOQItem(item: Partial<ParsedBOQItem>): { 
  valid: boolean; 
  errors: string[]; 
  data?: ParsedBOQItem 
} {
  try {
    const validated = BOQItemSchema.parse(item);
    return { valid: true, errors: [], data: validated as ParsedBOQItem };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return { valid: false, errors };
    }
    return { valid: false, errors: ['Unknown validation error'] };
  }
}

// Check if row is empty
export function isEmptyRow(row: RawBOQRow): boolean {
  return !row.description && 
         !row.itemCode && 
         !row.quantity && 
         !row.uom;
}

// Check if row is a header row
export function isHeaderRow(row: RawBOQRow): boolean {
  const headerKeywords = [
    'item', 'code', 'description', 'quantity', 'unit', 'uom',
    'price', 'total', 'category', 'phase', 'task', 'site'
  ];
  
  const rowValues = Object.values(row)
    .filter(v => v)
    .map(v => String(v).toLowerCase());
  
  const matchCount = rowValues.filter(value => 
    headerKeywords.some(keyword => value.includes(keyword))
  ).length;
  
  return matchCount >= 3; // At least 3 header keywords found
}

// Check if row is a subtotal/summary row
export function isSummaryRow(row: RawBOQRow): boolean {
  const summaryKeywords = ['total', 'subtotal', 'grand total', 'summary'];
  const description = String(row.description || '').toLowerCase();
  
  return summaryKeywords.some(keyword => description.includes(keyword)) &&
         !row.quantity && !row.uom;
}

// Normalize UOM values
export function normalizeUOM(uom: string): string {
  const uomMap: Record<string, string> = {
    'meters': 'meter',
    'metres': 'meter',
    'm': 'meter',
    'mtr': 'meter',
    'pieces': 'piece',
    'pcs': 'piece',
    'nos': 'piece',
    'number': 'piece',
    'kg': 'kilogram',
    'kgs': 'kilogram',
    'kilogram': 'kilogram',
    'ton': 'tonne',
    'tons': 'tonne',
    'l': 'liter',
    'ltr': 'liter',
    'litre': 'liter',
    'litres': 'liter',
    'liters': 'liter',
    'sq.m': 'sqm',
    'sqm': 'sqm',
    'm2': 'sqm',
    'square meter': 'sqm',
    'cu.m': 'cum',
    'cum': 'cum',
    'm3': 'cum',
    'cubic meter': 'cum'
  };
  
  const normalized = uom.toLowerCase().trim();
  return uomMap[normalized] || uom;
}

// Parse numeric value from string
export function parseNumericValue(value: unknown, locale: string = 'en-US'): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  
  if (typeof value === 'number') {
    return value;
  }
  
  // Convert to string and clean
  let str = String(value).trim();
  
  // Remove currency symbols
  str = str.replace(/[$£€¥₹]/g, '');
  
  // Handle different decimal/thousand separators based on locale
  if (locale === 'de-DE') {
    // German format: 1.234,56
    str = str.replace(/\./g, '').replace(',', '.');
  } else {
    // English format: 1,234.56
    str = str.replace(/,/g, '');
  }
  
  // Parse the number
  const num = parseFloat(str);
  
  return isNaN(num) ? null : num;
}

// Clean and normalize text
export function cleanText(text: unknown): string | null {
  if (text === null || text === undefined || text === '') {
    return null;
  }
  
  return String(text)
    .trim()
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/[\n\r\t]/g, ' '); // Remove line breaks and tabs
}