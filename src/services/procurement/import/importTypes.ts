/**
 * Excel Import Engine - Types and Interfaces
 * Extracted from excelImportEngine.ts for better maintainability
 */

// Core Import Types
export interface ImportProgress {
  phase: 'parsing' | 'validating' | 'mapping' | 'processing' | 'saving' | 'complete' | 'error' | 'cancelled';
  progress: number; // 0-100
  processedRows: number;
  totalRows: number;
  message: string;
  errors: ImportError[];
  warnings: ImportWarning[];
  exceptionsCount?: number;
}

export interface ImportError {
  type: 'validation' | 'mapping' | 'processing' | 'system';
  row: number;
  column?: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ImportWarning {
  type: 'mapping' | 'validation' | 'data';
  row: number;
  column?: string;
  message: string;
  suggestion?: string;
}

export interface ParsedBOQItem {
  lineNumber: number;
  itemCode?: string;
  description: string;
  category?: string;
  quantity: number;
  uom: string;
  unitPrice?: number;
  totalPrice?: number;
  phase?: string;
  task?: string;
  site?: string;
  rawData: Record<string, unknown>;
}

export interface ImportResult {
  success: boolean;
  data: ParsedBOQItem[];
  errors: ImportError[];
  warnings: ImportWarning[];
  stats: ImportStats;
  // Additional properties for BOQ-specific results
  boqId?: string;
  itemsCreated?: number;
  exceptionsCreated?: number;
}

export interface ImportStats {
  totalRows: number;
  validRows: number;
  errorRows: number;
  warningRows: number;
}

// Separate interface for BOQ-specific stats
export interface BOQImportStats {
  totalJobs: number;
  activeJobs: number;
  completedJobs: number;
  failedJobs: number;
  totalItemsProcessed: number;
  totalItemsImported: number;
}

export interface ValidationResult {
  success: boolean;
  data: ParsedBOQItem;
  errors: ImportError[];
  warnings: ImportWarning[];
}

// Column Mapping Configuration
export interface ColumnMapping {
  lineNumber: string[];
  itemCode: string[];
  description: string[];
  category: string[];
  quantity: string[];
  uom: string[];
  unitPrice: string[];
  totalPrice: string[];
  phase: string[];
  task: string[];
  site: string[];
  location: string[];
}

// File Information
export interface FileInfo {
  name: string;
  size: number;
  type: string;
  estimatedRows: number;
  worksheets?: string[];
  hasHeaders?: boolean;
  columnCount?: number;
}

// Default column mapping configuration
export const DEFAULT_COLUMN_MAPPING: ColumnMapping = {
  lineNumber: ['line', 'item', '#', 'no', 'number', 'line_number', 'item_number'],
  itemCode: ['code', 'item_code', 'product_code', 'part_number', 'sku'],
  description: ['description', 'desc', 'item_description', 'details', 'item_details'],
  category: ['category', 'cat', 'group', 'type', 'class'],
  quantity: ['qty', 'quantity', 'amount', 'count'],
  uom: ['uom', 'unit', 'units', 'measure', 'unit_of_measure', 'um'],
  unitPrice: ['unit_price', 'price', 'cost', 'rate', 'unit_cost', 'price_per_unit'],
  totalPrice: ['total', 'total_price', 'total_cost', 'amount', 'line_total'],
  phase: ['phase', 'stage', 'project_phase'],
  task: ['task', 'activity', 'work_item', 'job'],
  site: ['site', 'location', 'area', 'zone'],
  location: ['location', 'position', 'coordinates', 'address']
};

// Validation constants
export const VALIDATION_CONSTANTS = {
  MAX_DESCRIPTION_LENGTH: 500,
  MAX_CATEGORY_LENGTH: 100,
  MAX_UOM_LENGTH: 20,
  MAX_ITEM_CODE_LENGTH: 100,
  MIN_QUANTITY: 0.0001,
  MAX_QUANTITY: 999999999,
  MIN_PRICE: 0,
  MAX_PRICE: 999999999999
};

// Progress callback type
export type ProgressCallback = (progress: ImportProgress) => void;

// Missing exports for backward compatibility
export interface ImportJob {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'processing' | 'cancelled';
  progress: ImportProgress;
  result?: ImportResult;
  startTime: Date;
  endTime?: Date;
  fileInfo: FileInfo;
  config: ImportConfig;
}

export interface ImportConfig {
  columnMapping?: ColumnMapping;
  skipFirstRow?: boolean;
  worksheet?: string;
  validationStrict?: boolean;
  strictValidation?: boolean;
  allowDuplicates?: boolean;
  batchSize?: number;
  chunkSize?: number;
  autoApprove?: boolean;
  createNewItems?: boolean;
  duplicateHandling?: 'skip' | 'update' | 'create';
  minMappingConfidence?: number;
}

// Note: BOQImportService is now available from ./boqImportService.ts