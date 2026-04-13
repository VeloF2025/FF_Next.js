/**
 * BOQ API Extensions - Core Types
 * Shared types for BOQ API extensions
 */

import { BOQ, BOQItem, BOQException, BOQWithItems } from '@/types/procurement/boq.types';
import { ProcurementContext } from '@/types/procurement/base.types';

export interface CreateBOQData {
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

export interface CreateBOQItemData {
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

export interface CreateBOQExceptionData {
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

export type { 
  BOQ, 
  BOQItem, 
  BOQException, 
  BOQWithItems, 
  ProcurementContext 
};