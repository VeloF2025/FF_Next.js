/**
 * BOQ Service Types
 * Type definitions for BOQ-specific operations
 */

// @ts-ignore
import type { BOQException } from '@/lib/neon/schema';

// BOQ Import result interface
export interface BOQImportResult {
  boqId: string;
  itemCount: number;
  mappedItems: number;
  unmappedItems: number;
  exceptionsCount: number;
  exceptions: BOQException[];
}

// BOQ mapping result interface
export interface BOQMappingResult {
  boqId: string;
  totalItems: number;
  mappedItems: number;
  unmappedItems: number;
  exceptions: BOQException[];
  mappingConfidence: number;
}

// API Context type
export interface ApiContext {
  userId: string;
  userName?: string;
  userRole?: string;
  projectId: string;
  permissions: string[];
  ipAddress?: string;
  userAgent?: string;
}

// Import data interface
export interface BOQImportData {
  fileName: string;
  fileSize: number;
  version: string;
  title?: string;
  description?: string;
  rows: Array<{
    lineNumber: number;
    itemCode?: string;
    description: string;
    category?: string;
    subcategory?: string;
    quantity: number;
    uom: string;
    unitPrice?: number;
    totalPrice?: number;
    phase?: string;
    task?: string;
    site?: string;
    location?: string;
    specifications?: string;
    technicalNotes?: string;
  }>;
}

// Exception resolution interface
export interface ExceptionResolution {
  action: 'manual_mapping' | 'catalog_update' | 'item_split' | 'item_ignore';
  catalogItemId?: string;
  catalogItemCode?: string;
  catalogItemName?: string;
  resolutionNotes: string;
}

// Catalog matching result
export interface CatalogMatchResult {
  confidence: number;
  catalogItem: {
    id: string;
    code: string;
    name: string;
  };
  suggestions: Array<{
    id: string;
    code: string;
    name: string;
    confidence: number;
  }>;
}