import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { log } from '@/lib/logger';

/**
 * SOW Data Parser
 * Handles file parsing for SOW data
 */

/**
 * Process uploaded file (Excel or CSV)
 */
export async function processFile(file: File, type: 'poles' | 'drops' | 'fibre'): Promise<Record<string, unknown>[]> {
  const fileExtension = file.name.split('.').pop()?.toLowerCase();
  
  if (fileExtension === 'csv') {
    return processCSV(file, type);
  } else if (['xlsx', 'xls'].includes(fileExtension || '')) {
    return processExcel(file, type);
  } else {
    throw new Error('Unsupported file format. Please upload Excel (.xlsx, .xls) or CSV files.');
  }
}

/**
 * Process CSV file
 */
async function processCSV(file: File, _type: string): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parseResult = Papa.parse(text, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true
      });
      
      if (parseResult.errors.length > 0) {
        log.warn('CSV parsing warnings:', { data: parseResult.errors }, 'parser');
      }
      resolve(parseResult.data as Record<string, unknown>[]);
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    
    reader.readAsText(file);
  });
}

/**
 * Process Excel file
 */
async function processExcel(file: File, _type: string): Promise<Record<string, unknown>[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { 
    type: 'array',
    cellDates: true,
    cellNF: false,
    cellText: false 
  });
  
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Excel file has no sheets');
  const worksheet = workbook.Sheets[sheetName]!;
  const data = XLSX.utils.sheet_to_json(worksheet, {
    raw: false,
    dateNF: 'yyyy-mm-dd'
  });
  
  return data as Record<string, unknown>[];
}

/**
 * Helper function to extract value from multiple possible column names
 * Handles case-insensitive and whitespace-tolerant matching
 */
export function extractValue(row: Record<string, unknown>, possibleKeys: string[]): string | undefined {
  for (const key of possibleKeys) {
    // Try exact match
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
      return String(row[key]).trim();
    }

    // Try case-insensitive and whitespace-tolerant match
    // Excel exports often have trailing spaces in column names
    const normalizedKey = key.toLowerCase().trim();
    const foundKey = Object.keys(row).find(k =>
      k.toLowerCase().trim() === normalizedKey
    );

    if (foundKey && row[foundKey] !== undefined && row[foundKey] !== null && row[foundKey] !== '') {
      return String(row[foundKey]).trim();
    }
  }
  return undefined;
}

/**
 * Helper function to extract number
 */
export function extractNumber(row: Record<string, unknown>, possibleKeys: string[]): number | undefined {
  const value = extractValue(row, possibleKeys);
  if (value) {
    const num = parseFloat(value);
    return isNaN(num) ? undefined : num;
  }
  return undefined;
}

/**
 * Helper function to extract date
 */
export function extractDate(row: Record<string, unknown>, possibleKeys: string[]): string | undefined {
  const value = extractValue(row, possibleKeys);
  if (value) {
    try {
      // Handle various date formats
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    } catch (e) {
      log.warn('Failed to parse date:', { data: value }, 'parser');
    }
  }
  return undefined;
}

/**
 * Helper function to parse boolean
 */
export function parseBoolean(row: Record<string, unknown>, possibleKeys: string[]): boolean | undefined {
  const value = extractValue(row, possibleKeys);
  if (value) {
    const lowerValue = value.toLowerCase();
    if (['yes', 'true', '1', 'complete', 'completed'].includes(lowerValue)) {
      return true;
    } else if (['no', 'false', '0', 'incomplete', 'pending'].includes(lowerValue)) {
      return false;
    }
  }
  return undefined;
}