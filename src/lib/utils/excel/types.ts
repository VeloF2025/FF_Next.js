/**
 * Excel Parser Types & Interfaces
 * Type definitions for Excel/CSV parsing
 */

// Raw data structure from Excel/CSV
export interface RawBOQRow {
  lineNumber?: string | number;
  itemCode?: string;
  description?: string;
  uom?: string;
  quantity?: string | number;
  phase?: string;
  task?: string;
  site?: string;
  unitPrice?: string | number;
  totalPrice?: string | number;
  category?: string;
  subcategory?: string;
  vendor?: string;
  remarks?: string;
}

// Parsed and validated BOQ item
export interface ParsedBOQItem {
  lineNumber: number;
  itemCode: string | null;
  description: string;
  uom: string;
  quantity: number;
  phase: string | null;
  task: string | null;
  site: string | null;
  unitPrice: number | null;
  totalPrice: number | null;
  category: string | null;
  subcategory: string | null;
  vendor: string | null;
  remarks: string | null;
  rawData: RawBOQRow;
}

// Parsing configuration
export interface ParseConfig {
  headerRow?: number; // Row number for headers (0-indexed)
  skipRows?: number; // Number of rows to skip at the top
  columnMapping?: Record<string, string>; // Map custom column names
  strictValidation?: boolean; // Use strict validation mode
  locale?: 'en-US' | 'en-GB' | 'de-DE'; // Locale for number parsing
  dateFormat?: string; // Date format for parsing dates
  validateFormulas?: boolean; // Validate Excel formulas
}

// Parse result
export interface ParseResult {
  success: boolean;
  items: ParsedBOQItem[];
  errors: ParseError[];
  warnings: ParseWarning[];
  metadata: {
    totalRows: number;
    processedRows: number;
    skippedRows: number;
    invalidRows: number;
    processingTime: number;
    fileType: 'xlsx' | 'csv';
  };
}

/** Raw cell value from Excel/CSV parsing */
export type CellValue = string | number | boolean | null | undefined;

// Parse error
export interface ParseError {
  row: number;
  column: string;
  value: CellValue;
  message: string;
  type: 'validation' | 'parsing' | 'format' | 'required';
}

// Parse warning
export interface ParseWarning {
  row: number;
  column: string;
  value: CellValue;
  message: string;
  type: 'format' | 'range' | 'suggestion';
}

// Column mapping definition
export interface ColumnMapping {
  source: string; // Source column name in file
  target: keyof ParsedBOQItem; // Target field name
  required: boolean; // Is this column required
  transform?: (value: CellValue) => CellValue; // Optional transform function
  validate?: (value: CellValue) => boolean; // Optional validation function
}

// Sheet information
export interface SheetInfo {
  name: string;
  index: number;
  rowCount: number;
  columnCount: number;
  hasData: boolean;
}