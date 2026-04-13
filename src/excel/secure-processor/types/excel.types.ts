/**
 * Excel Processing Types
 */

export interface SecureExcelOptions {
  maxFileSize?: number;
  maxRows?: number;
  maxColumns?: number;
  maxCellLength?: number;
  allowFormulas?: boolean;
  allowHTML?: boolean;
  chunkSize?: number;
  useStreaming?: boolean;
}

export interface ExcelReadResult<T = unknown> {
  data: T[];
  errors: Array<{ row: number; column?: string; message: string }>;
  metadata: {
    totalRows: number;
    totalColumns: number;
    worksheetName: string;
    processingTime: number;
    memoryUsed: number;
  };
}

export interface ExcelValidationResult {
  isValid: boolean;
  errors: string[];
  metadata: {
    worksheetCount: number;
    rowCount: number;
    columnCount: number;
    worksheetName: string;
  };
}

export interface ProcessingError {
  row: number;
  column?: string;
  message: string;
}
