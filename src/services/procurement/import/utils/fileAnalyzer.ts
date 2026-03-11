/**
 * File Analyzer
 * Analyzes file content structure and properties
 */

import * as XLSX from 'xlsx';

export interface FileAnalysis {
  hasHeaders: boolean;
  columnCount: number;
  sampleData: string[][];
}

/**
 * File content analysis utilities
 */
export class FileAnalyzer {
  /**
   * Analyze file content type based on headers
   */
  static async analyzeFileContent(file: File): Promise<FileAnalysis> {
    const fileExtension = file.name.toLowerCase().split('.').pop();
    
    if (fileExtension === 'csv') {
      return this.analyzeCSVContent(file);
    } else if (['xlsx', 'xls'].includes(fileExtension || '')) {
      return this.analyzeExcelContent(file);
    }
    
    return { hasHeaders: false, columnCount: 0, sampleData: [] };
  }

  /**
   * Analyze CSV content structure
   */
  private static async analyzeCSVContent(file: File): Promise<FileAnalysis> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          const lines = text.split(/\r?\n/).filter(line => line.trim()).slice(0, 5);
          
          if (lines.length === 0) {
            resolve({ hasHeaders: false, columnCount: 0, sampleData: [] });
            return;
          }
          
          const sampleData = lines.map(line => this.parseCSVLine(line));
          const columnCount = sampleData[0]?.length || 0;
          
          // Simple heuristic: if first row has mostly text and subsequent rows have numbers/dates
          const hasHeaders = this.detectHeaders(sampleData);
          
          resolve({ hasHeaders, columnCount, sampleData });
        } catch (error) {
          resolve({ hasHeaders: false, columnCount: 0, sampleData: [] });
        }
      };
      
      reader.onerror = () => resolve({ hasHeaders: false, columnCount: 0, sampleData: [] });
      reader.readAsText(file);
    });
  }

  /**
   * Analyze Excel content structure
   */
  private static async analyzeExcelContent(file: File): Promise<FileAnalysis> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const arrayBuffer = e.target?.result as ArrayBuffer;
          const workbook = XLSX.read(arrayBuffer, { type: 'array' });
          
          const sheetName = workbook.SheetNames[0];
          if (!sheetName) {
            resolve({ hasHeaders: false, columnCount: 0, sampleData: [] });
            return;
          }
          
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet!, {
            header: 1,
            range: 5, // Only read first 5 rows
            defval: '',
            raw: false
          }) as string[][];
          
          const columnCount = jsonData[0]?.length || 0;
          const hasHeaders = this.detectHeaders(jsonData);
          
          resolve({ hasHeaders, columnCount, sampleData: jsonData });
        } catch (error) {
          resolve({ hasHeaders: false, columnCount: 0, sampleData: [] });
        }
      };
      
      reader.onerror = () => resolve({ hasHeaders: false, columnCount: 0, sampleData: [] });
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Parse CSV line for analysis
   */
  private static parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    result.push(current.trim());
    return result.map(field => {
      if (field.startsWith('"') && field.endsWith('"')) {
        return field.slice(1, -1);
      }
      return field;
    });
  }

  /**
   * Detect if first row contains headers
   */
  private static detectHeaders(data: string[][]): boolean {
    if (data.length < 2) return false;
    
    const firstRow = data[0];
    const secondRow = data[1];
    
    if (!firstRow || !secondRow) return false;
    
    let textInFirst = 0;
    let numbersInSecond = 0;
    
    for (let i = 0; i < Math.min(firstRow.length, secondRow.length); i++) {
      const firstValue = firstRow[i]?.toString().trim() || '';
      const secondValue = secondRow[i]?.toString().trim() || '';
      
      // Check if first row has text
      if (firstValue && isNaN(Number(firstValue))) {
        textInFirst++;
      }
      
      // Check if second row has numbers or dates
      if (secondValue && (!isNaN(Number(secondValue)) || this.isDateLike(secondValue))) {
        numbersInSecond++;
      }
    }
    
    // Heuristic: likely headers if first row is mostly text and second row has numbers/dates
    const threshold = Math.ceil(firstRow.length * 0.6);
    return textInFirst >= threshold || numbersInSecond >= threshold;
  }

  /**
   * Check if value looks like a date
   */
  private static isDateLike(value: string): boolean {
    if (!value) return false;
    
    // Common date patterns
    const datePatterns = [
      /^\d{4}-\d{2}-\d{2}$/,          // YYYY-MM-DD
      /^\d{2}\/\d{2}\/\d{4}$/,        // MM/DD/YYYY
      /^\d{2}-\d{2}-\d{4}$/,          // MM-DD-YYYY
      /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,  // M/D/YY or MM/DD/YYYY
    ];
    
    return datePatterns.some(pattern => pattern.test(value));
  }

  /**
   * Get column statistics from sample data
   */
  static analyzeColumns(sampleData: string[][]): Array<{
    index: number;
    hasText: boolean;
    hasNumbers: boolean;
    hasDates: boolean;
    hasEmpty: boolean;
    uniqueValues: number;
  }> {
    if (sampleData.length === 0) return [];
    
    const columnCount = Math.max(...sampleData.map(row => row.length));
    const columnStats = [];
    
    for (let colIndex = 0; colIndex < columnCount; colIndex++) {
      const columnValues = sampleData
        .map(row => row[colIndex] || '')
        .filter(value => value.trim() !== '');
      
      const uniqueValues = new Set(columnValues).size;
      let hasText = false;
      let hasNumbers = false;
      let hasDates = false;
      let hasEmpty = false;
      
      columnValues.forEach(value => {
        if (!value || value.trim() === '') {
          hasEmpty = true;
        } else if (!isNaN(Number(value))) {
          hasNumbers = true;
        } else if (this.isDateLike(value)) {
          hasDates = true;
        } else {
          hasText = true;
        }
      });
      
      columnStats.push({
        index: colIndex,
        hasText,
        hasNumbers,
        hasDates,
        hasEmpty,
        uniqueValues
      });
    }
    
    return columnStats;
  }
}
