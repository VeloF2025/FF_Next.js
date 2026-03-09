/**
 * Excel File Reader
 * Core file reading functionality for Excel files
 */

import * as XLSX from 'xlsx';

/**
 * Basic Excel file reading operations
 */
export class ExcelReader {
  /**
   * Read Excel file as workbook
   */
  static async readFile(file: File): Promise<XLSX.WorkBook> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const arrayBuffer = e.target?.result as ArrayBuffer;
          if (!arrayBuffer) {
            throw new Error('Failed to read file content');
          }

          const workbook = XLSX.read(arrayBuffer, { 
            type: 'array',
            cellText: false,
            cellDates: true
          });
          
          resolve(workbook);
        } catch (error) {
          reject(new Error(`Failed to parse Excel file: ${error instanceof Error ? error.message : 'Unknown error'}`));
        }
      };

      reader.onerror = () => reject(new Error('Failed to read Excel file'));
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Get all worksheet names from Excel file
   */
  static async getWorksheetNames(file: File): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const arrayBuffer = e.target?.result as ArrayBuffer;
          const workbook = XLSX.read(arrayBuffer, { 
            type: 'array',
            bookSheets: true
          });
          
          resolve(workbook.SheetNames);
        } catch (error) {
          reject(new Error(`Failed to read Excel file: ${error instanceof Error ? error.message : 'Unknown error'}`));
        }
      };

      reader.onerror = () => reject(new Error('Failed to read Excel file'));
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Get worksheet data range information
   */
  static async getWorksheetInfo(file: File, worksheetName: string): Promise<{
    rowCount: number;
    columnCount: number;
    range: string;
  }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const arrayBuffer = e.target?.result as ArrayBuffer;
          const workbook = XLSX.read(arrayBuffer, { type: 'array' });
          
          if (!workbook.SheetNames.includes(worksheetName)) {
            reject(new Error(`Worksheet "${worksheetName}" not found`));
            return;
          }

          const worksheet = workbook.Sheets[worksheetName];
          
          if (!worksheet || !worksheet['!ref']) {
            resolve({ rowCount: 0, columnCount: 0, range: '' });
            return;
          }

          const range = XLSX.utils.decode_range(worksheet['!ref']!);
          const rowCount = range.e.r + 1; // +1 because range is 0-based
          const columnCount = range.e.c + 1; // +1 because range is 0-based

          resolve({
            rowCount,
            columnCount,
            range: worksheet['!ref']!
          });
        } catch (error) {
          reject(new Error(`Failed to analyze worksheet: ${error instanceof Error ? error.message : 'Unknown error'}`));
        }
      };

      reader.onerror = () => reject(new Error('Failed to read Excel file'));
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Validate Excel file structure
   */
  static async validateExcelStructure(file: File): Promise<{
    isValid: boolean;
    errors: string[];
    worksheets: string[];
  }> {
    try {
      const worksheets = await this.getWorksheetNames(file);
      const errors: string[] = [];
      
      if (worksheets.length === 0) {
        errors.push('Excel file contains no worksheets');
      }
      
      // Additional validation could be added here
      
      return {
        isValid: errors.length === 0,
        errors,
        worksheets
      };
    } catch (error) {
      return {
        isValid: false,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
        worksheets: []
      };
    }
  }
}
