/**
 * Excel Parser - File Format Handlers
 * Handles Excel and CSV specific parsing logic
 */

import * as XLSX from 'xlsx';
import * as Papa from 'papaparse';
import { ProgressCallback } from './types';

export class ExcelFileHandler {
  /**
   * Parse Excel (.xlsx) file to raw string array data
   */
  static async parseExcelToRaw(
    file: File,
    onProgress?: ProgressCallback
  ): Promise<{ data: string[][]; error?: string }> {
    try {
      onProgress?.(0.1);
      
      const buffer = await file.arrayBuffer();
      onProgress?.(0.4);
      
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      onProgress?.(0.6);
      
      // Use first worksheet
      const firstSheetName = workbook.SheetNames[0]!;
      const worksheet = workbook.Sheets[firstSheetName];
      
      if (!worksheet) {
        return { data: [], error: 'No worksheets found in the Excel file' };
      }

      // Convert to JSON with header detection
      const rawData = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: '',
        blankrows: false
      }) as string[][];

      onProgress?.(0.8);
      return { data: rawData };
    } catch (error) {
      return {
        data: [],
        error: `Failed to parse Excel file: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Get Excel file metadata
   */
  static async getExcelMetadata(file: File): Promise<{
    sheetNames: string[];
    totalSheets: number;
    fileSize: number;
  }> {
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'buffer', bookProps: true });
      
      return {
        sheetNames: workbook.SheetNames,
        totalSheets: workbook.SheetNames.length,
        fileSize: buffer.byteLength
      };
    } catch (error) {
      return {
        sheetNames: [],
        totalSheets: 0,
        fileSize: file.size
      };
    }
  }
}

export class CSVFileHandler {
  /**
   * Parse CSV file to raw string array data
   */
  static async parseCSVToRaw(
    file: File,
    onProgress?: ProgressCallback
  ): Promise<{ data: string[][]; error?: string }> {
    return new Promise((resolve) => {
      const results: string[][] = [];
      let rowCount = 0;
      let hasError = false;
      let errorMessage = '';

      Papa.parse(file, {
        chunk: (chunk) => {
          if (hasError) return;
          
          results.push(...chunk.data as string[][]);
          rowCount += chunk.data.length;
          onProgress?.(Math.min(rowCount / 1000, 0.8)); // Estimate progress
        },
        complete: () => {
          if (hasError) {
            resolve({ data: [], error: errorMessage });
          } else {
            onProgress?.(0.9);
            resolve({ data: results });
          }
        },
        error: (error) => {
          hasError = true;
          errorMessage = `Failed to parse CSV file: ${error.message}`;
          resolve({ data: [], error: errorMessage });
        },
        skipEmptyLines: true,
        header: false
      });
    });
  }

  /**
   * Get CSV file metadata
   */
  static async getCSVMetadata(file: File): Promise<{
    estimatedRows: number;
    fileSize: number;
    encoding?: string;
  }> {
    // For CSV, we can only estimate without fully parsing
    const averageBytesPerRow = 100; // Rough estimate
    const estimatedRows = Math.floor(file.size / averageBytesPerRow);
    
    return {
      estimatedRows: Math.max(estimatedRows, 1),
      fileSize: file.size,
      encoding: 'utf-8' // Default assumption
    };
  }
}

export class FileTypeDetector {
  /**
   * Detect file type from file extension and MIME type
   */
  static detectFileType(file: File): 'xlsx' | 'csv' | 'unknown' {
    const fileName = file.name.toLowerCase();
    const mimeType = file.type.toLowerCase();

    // Check by extension first
    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      return 'xlsx';
    }
    
    if (fileName.endsWith('.csv')) {
      return 'csv';
    }

    // Check by MIME type
    if (mimeType.includes('spreadsheet') || 
        mimeType.includes('excel') || 
        mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      return 'xlsx';
    }
    
    if (mimeType === 'text/csv') {
      return 'csv';
    }

    return 'unknown';
  }

  /**
   * Validate file before parsing
   */
  static validateFile(file: File): { valid: boolean; error?: string } {
    const maxSize = 50 * 1024 * 1024; // 50MB
    const fileType = this.detectFileType(file);

    if (file.size === 0) {
      return { valid: false, error: 'File is empty' };
    }

    if (file.size > maxSize) {
      return { valid: false, error: 'File size exceeds 50MB limit' };
    }

    if (fileType === 'unknown') {
      return { valid: false, error: 'Unsupported file format. Please use .xlsx or .csv files' };
    }

    return { valid: true };
  }
}