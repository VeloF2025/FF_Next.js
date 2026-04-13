import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { log } from '@/lib/logger';

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
export async function processCSV(file: File, _type: string): Promise<Record<string, unknown>[]> {
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
        log.warn('CSV parsing warnings:', { data: parseResult.errors }, 'fileReaders');
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
export async function processExcel(file: File, _type: string): Promise<Record<string, unknown>[]> {
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