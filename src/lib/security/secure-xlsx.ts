/**
 * Secure XLSX Wrapper
 * Provides security controls around xlsx library usage to mitigate known vulnerabilities
 */

import * as XLSX from 'xlsx';
import { log } from '@/lib/logger';

// Security limits
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_ROWS = 100000;
const MAX_COLUMNS = 1000;
const MAX_CELL_LENGTH = 10000;

// Dangerous patterns to detect
const DANGEROUS_PATTERNS = [
  /javascript:/i,
  /vbscript:/i,
  /data:text\/html/i,
  /<script/i,
  /eval\(/i,
  /Function\(/i,
  /document\./i,
  /window\./i
];

export interface SecureXLSXOptions {
  maxFileSize?: number;
  maxRows?: number;
  maxColumns?: number;
  maxCellLength?: number;
  allowHTML?: boolean;
  allowFormulas?: boolean;
}

export class SecureXLSX {
  private static validateFileSize(buffer: ArrayBuffer, maxSize: number = MAX_FILE_SIZE): void {
    if (buffer.byteLength > maxSize) {
      throw new Error(`File size exceeds maximum allowed size of ${maxSize / 1024 / 1024}MB`);
    }
  }

  private static validateCellContent(cellValue: unknown, maxLength: number = MAX_CELL_LENGTH): string {
    if (cellValue == null) return '';
    
    const stringValue = String(cellValue).trim();
    
    // Check length
    if (stringValue.length > maxLength) {
      throw new Error(`Cell content exceeds maximum length of ${maxLength} characters`);
    }
    
    // Check for dangerous patterns
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(stringValue)) {
        throw new Error(`Cell content contains potentially dangerous pattern: ${pattern.source}`);
      }
    }
    
    return stringValue;
  }

  private static sanitizeWorksheet(
    worksheet: XLSX.WorkSheet, 
    options: SecureXLSXOptions = {}
  ): XLSX.WorkSheet {
    const {
      maxRows = MAX_ROWS,
      maxColumns = MAX_COLUMNS,
      maxCellLength = MAX_CELL_LENGTH,
      allowHTML = false,
      allowFormulas = false
    } = options;

    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
    
    // Validate sheet size
    if (range.e.r > maxRows) {
      throw new Error(`Worksheet exceeds maximum rows: ${range.e.r} > ${maxRows}`);
    }
    
    if (range.e.c > maxColumns) {
      throw new Error(`Worksheet exceeds maximum columns: ${range.e.c} > ${maxColumns}`);
    }

    // Sanitize each cell
    const sanitizedWorksheet: XLSX.WorkSheet = { 
      '!ref': worksheet['!ref'] || ''
    };
    
    for (let row = range.s.r; row <= range.e.r; row++) {
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
        const cell = worksheet[cellAddress];
        
        if (cell) {
          // Block formulas if not allowed
          if (!allowFormulas && cell.f) {
            throw new Error(`Formula detected in cell ${cellAddress}: ${cell.f}. Formulas are not allowed.`);
          }
          
          // Validate and sanitize cell content
          if (cell.v != null) {
            const sanitizedValue = this.validateCellContent(cell.v, maxCellLength);
            
            // Remove HTML if not allowed
            if (!allowHTML && typeof sanitizedValue === 'string') {
              const htmlStripped = sanitizedValue.replace(/<[^>]*>/g, '');
              if (htmlStripped !== sanitizedValue) {
                log.warn(`HTML content removed from cell ${cellAddress}`, undefined, 'secure-xlsx');
              }
              cell.v = htmlStripped;
            } else {
              cell.v = sanitizedValue;
            }
          }
          
          sanitizedWorksheet[cellAddress] = { ...cell };
          
          // Remove formula if present and not allowed
          if (!allowFormulas && sanitizedWorksheet[cellAddress].f) {
            delete sanitizedWorksheet[cellAddress].f;
          }
        }
      }
    }
    
    return sanitizedWorksheet;
  }

  /**
   * Securely read an Excel file from ArrayBuffer
   */
  static read(buffer: ArrayBuffer, options: SecureXLSXOptions = {}): XLSX.WorkBook {
    try {
      // Validate file size
      this.validateFileSize(buffer, options.maxFileSize);
      
      // Parse workbook with minimal options for security
      const workbook = XLSX.read(buffer, {
        type: 'array',
        cellFormula: options.allowFormulas || false,
        cellHTML: options.allowHTML || false,
        cellNF: false,
        cellStyles: false,
        cellDates: true,
        sheetStubs: false,
        dense: false
      });
      
      // Sanitize all worksheets
      const sanitizedWorkbook: XLSX.WorkBook = {
        SheetNames: workbook.SheetNames,
        Sheets: {},
        Props: workbook.Props || {}
      };
      
      workbook.SheetNames.forEach(sheetName => {
        sanitizedWorkbook.Sheets[sheetName] = this.sanitizeWorksheet(
          workbook.Sheets[sheetName],
          options
        );
      });
      
      return sanitizedWorkbook;
    } catch (error) {
      log.error('Secure XLSX read failed:', { data: error }, 'secure-xlsx');
      throw new Error(`Secure XLSX parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Securely convert worksheet to JSON
   */
  static sheetToJSON<T = Record<string, unknown>>(worksheet: XLSX.WorkSheet, options: SecureXLSXOptions = {}): T[] {
    try {
      const sanitizedWorksheet = this.sanitizeWorksheet(worksheet, options);
      
      return XLSX.utils.sheet_to_json(sanitizedWorksheet, {
        defval: '',
        blankrows: false,
        raw: false
      });
    } catch (error) {
      log.error('Secure sheet to JSON conversion failed:', { data: error }, 'secure-xlsx');
      throw new Error(`Secure JSON conversion failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Securely write workbook to buffer
   */
  static write(workbook: XLSX.WorkBook, options: SecureXLSXOptions = {}): ArrayBuffer {
    try {
      // Sanitize all worksheets before writing
      const sanitizedWorkbook: XLSX.WorkBook = {
        SheetNames: workbook.SheetNames,
        Sheets: {},
        Props: workbook.Props || {}
      };
      
      workbook.SheetNames.forEach(sheetName => {
        sanitizedWorkbook.Sheets[sheetName] = this.sanitizeWorksheet(
          workbook.Sheets[sheetName],
          options
        );
      });
      
      return XLSX.write(sanitizedWorkbook, {
        type: 'array',
        bookType: 'xlsx',
        compression: true
      });
    } catch (error) {
      log.error('Secure XLSX write failed:', { data: error }, 'secure-xlsx');
      throw new Error(`Secure XLSX write failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

// Convenience functions
export const secureXLSXRead = SecureXLSX.read.bind(SecureXLSX);
export const secureSheetToJSON = SecureXLSX.sheetToJSON.bind(SecureXLSX);
export const secureXLSXWrite = SecureXLSX.write.bind(SecureXLSX);

export default SecureXLSX;