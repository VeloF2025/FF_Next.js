/**
 * File Info Extractor
 * Unified interface for file information extraction using modular components
 */

import * as XLSX from 'xlsx';
import type { FileInfo } from '../importTypes';
import { FileValidator } from './fileValidator';
import { FileAnalyzer } from './fileAnalyzer';
import { EncodingDetector } from './encodingDetector';

/**
 * Main File Info Extractor class - provides backward compatibility
 * Uses the new modular components internally
 */
export class FileInfoExtractor {
  /**
   * Get file information without fully processing the content
   */
  static async getFileInfo(file: File): Promise<FileInfo> {
    const fileExtension = file.name.toLowerCase().split('.').pop();
    
    if (fileExtension === 'csv') {
      return this.getCSVInfo(file);
    } else if (['xlsx', 'xls'].includes(fileExtension || '')) {
      return this.getExcelInfo(file);
    } else {
      throw new Error(`Unsupported file type: ${fileExtension}`);
    }
  }

  /**
   * Get CSV file information
   */
  private static async getCSVInfo(file: File): Promise<FileInfo> {
    // For CSV, estimate rows by file size (rough approximation)
    const estimatedRows = Math.max(1, Math.floor(file.size / 80)); // ~80 bytes per row estimate
    
    // Analyze content for better estimates
    const analysis = await FileAnalyzer.analyzeFileContent(file);
    
    return {
      name: file.name,
      size: file.size,
      type: 'csv',
      estimatedRows: analysis.sampleData.length > 0 ? 
        Math.max(estimatedRows, analysis.sampleData.length * 10) : estimatedRows,
      hasHeaders: analysis.hasHeaders,
      columnCount: analysis.columnCount
    };
  }

  /**
   * Get Excel file information
   */
  private static getExcelInfo(file: File): Promise<FileInfo> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const fileData = e.target?.result as ArrayBuffer;
          const workbook = XLSX.read(fileData, { 
            type: 'array',
            bookSheets: true, // Only read sheet info, not content
            bookProps: true
          });
          
          const worksheets = workbook.SheetNames;
          
          // Get row count from first sheet
          let estimatedRows = 0;
          let columnCount = 0;
          if (worksheets.length > 0) {
            const firstSheet = workbook.Sheets[worksheets[0]!];
            if (firstSheet && firstSheet['!ref']) {
              const range = XLSX.utils.decode_range(firstSheet['!ref']);
              estimatedRows = range.e.r + 1; // +1 because range is 0-based
              columnCount = range.e.c + 1; // +1 because range is 0-based
            }
          }

          resolve({
            name: file.name,
            size: file.size,
            type: 'excel',
            estimatedRows: Math.max(1, estimatedRows),
            worksheets,
            columnCount
          });
        } catch (error) {
          reject(new Error(`Failed to analyze Excel file: ${error instanceof Error ? error.message : 'Unknown error'}`));
        }
      };

      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Detect file encoding for better text processing
   * @deprecated Use EncodingDetector.detectFileEncoding instead
   */
  static detectFileEncoding(file: File): Promise<string> {
    return EncodingDetector.detectFileEncoding(file);
  }

  /**
   * Analyze file content type based on headers
   * @deprecated Use FileAnalyzer.analyzeFileContent instead
   */
  static async analyzeFileContent(file: File): Promise<{
    hasHeaders: boolean;
    columnCount: number;
    sampleData: string[][];
  }> {
    return FileAnalyzer.analyzeFileContent(file);
  }

  /**
   * Get file size in human-readable format
   * @deprecated Use FileValidator.formatFileSize instead
   */
  static formatFileSize(bytes: number): string {
    return FileValidator.formatFileSize(bytes);
  }

  /**
   * Validate file before processing
   * @deprecated Use FileValidator.validateFile instead
   */
  static validateFile(file: File): { isValid: boolean; errors: string[] } {
    return FileValidator.validateFile(file);
  }

  /**
   * Get comprehensive file information including analysis
   */
  static async getDetailedFileInfo(file: File): Promise<FileInfo & {
    encoding?: string;
    analysis?: {
      hasHeaders: boolean;
      columnCount: number;
      sampleData: string[][];
    };
    validation?: {
      isValid: boolean;
      errors: string[];
    };
  }> {
    const basicInfo = await this.getFileInfo(file);
    const encoding = await EncodingDetector.detectFileEncoding(file);
    const analysis = await FileAnalyzer.analyzeFileContent(file);
    const validation = FileValidator.validateFile(file);

    return {
      ...basicInfo,
      encoding,
      analysis,
      validation
    };
  }

  /**
   * Quick file validation and basic info
   */
  static async getQuickFileInfo(file: File): Promise<{
    name: string;
    size: string;
    type: string;
    isValid: boolean;
    errors: string[];
  }> {
    const validation = FileValidator.validateFile(file);
    const fileExtension = FileValidator.getFileExtension(file.name) || 'unknown';
    
    return {
      name: file.name,
      size: FileValidator.formatFileSize(file.size),
      type: fileExtension,
      isValid: validation.isValid,
      errors: validation.errors
    };
  }
}

// Re-export the new modular components
export { FileValidator } from './fileValidator';
export { FileAnalyzer } from './fileAnalyzer';
export { EncodingDetector } from './encodingDetector';