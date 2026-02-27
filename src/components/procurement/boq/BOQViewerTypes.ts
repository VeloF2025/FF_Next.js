/**
 * Type definitions for BOQ Viewer components
 */

import { BOQ, BOQItem, BOQItemMappingStatusType, ProcurementStatusType } from '@/types/procurement/boq.types';

export interface BOQViewerProps {
  boqId: string;
  initialMode?: 'view' | 'edit';
  onItemUpdate?: (item: BOQItem) => void;
  onBOQUpdate?: (boq: BOQ) => void;
  className?: string;
}

export interface FilterState {
  search: string;
  mappingStatus: BOQItemMappingStatusType | '';
  procurementStatus: ProcurementStatusType | '';
  phase: string;
  categories: string[]; // Multi-select support
  hasIssues: boolean | null;
}

export interface EditingItem {
  id: string;
  data: Partial<BOQItem>;
}

export type SortField = 'lineNumber' | 'description' | 'quantity' | 'unitPrice' | 'totalPrice' | 'mappingConfidence';
export type SortDirection = 'asc' | 'desc';

export const INITIAL_FILTERS: FilterState = {
  search: '',
  mappingStatus: '',
  procurementStatus: '',
  phase: '',
  categories: [],
  hasIssues: null
};

export const ITEMS_PER_PAGE = 50;

export interface VisibleColumns {
  lineNumber: boolean;
  itemCode: boolean;
  description: boolean;
  category: boolean;
  quantity: boolean;
  uom: boolean;
  unitPrice: boolean;
  totalPrice: boolean;
  mappingStatus: boolean;
  procurementStatus: boolean;
  phase: boolean;
  task: boolean;
  site: boolean;
}

export const DEFAULT_VISIBLE_COLUMNS: VisibleColumns = {
  lineNumber: true,
  itemCode: true,
  description: true,
  category: true,
  quantity: true,
  uom: true,
  unitPrice: true,
  totalPrice: true,
  mappingStatus: true,
  procurementStatus: true,
  phase: false,
  task: false,
  site: false
};