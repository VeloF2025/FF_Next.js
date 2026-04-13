/**
 * BOQ API Types
 * Type definitions for BOQ API operations
 */

// Re-export types from main procurement types
export type { 
  BOQ, 
  BOQItem, 
  BOQException, 
  BOQWithItems 
} from '@/types/procurement/boq.types';

export type { 
  ProcurementContext 
} from '@/types/procurement/base.types';

// Additional API-specific types
export interface BOQCreateData {
  version: string;
  title: string;
  description: string;
  status?: string;
  mappingStatus?: string;
  mappingConfidence?: number;
  fileName: string;
  fileSize: number;
  totalItems?: number;
  mappedItems?: number;
  exceptionsCount?: number;
  totalEstimatedValue: number;
  currency?: string;
}

export interface BOQItemCreateData {
  boqId: string;
  lineNumber: number;
  itemCode: string;
  description: string;
  category: string;
  subcategory: string;
  quantity: number;
  uom: string;
  unitPrice: number;
  totalPrice: number;
  phase: string;
  task: string;
  site: string;
  catalogItemId?: string;
  catalogItemCode?: string;
  catalogItemName?: string;
  mappingConfidence?: number;
  mappingStatus?: string;
}

export interface BOQExceptionCreateData {
  boqId: string;
  boqItemId?: string;
  exceptionType?: string;
  severity?: string;
  issueDescription: string;
  suggestedAction: string;
  suggestions?: Record<string, unknown>[];
  status?: string;
  priority?: string;
}