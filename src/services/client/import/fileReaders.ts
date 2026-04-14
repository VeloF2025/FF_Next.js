import * as XLSX from 'xlsx';
import { ClientImportRow, ClientImportResult } from '@/types/client.types';
import { processImportRows } from './processors';

/**
 * Import clients from CSV file
 */
export async function importFromCSV(file: File): Promise<ClientImportResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string;
        const lines = text.split('\n').filter(line => line.trim());
        const headers = lines[0]!.split(',').map(h => h.trim());
        
        const rows: ClientImportRow[] = [];
        
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i]!.split(',').map(v => v.trim());
          const row: Record<string, string> = {};
          
          headers.forEach((header, index) => {
            row[header] = values[index] || '';
          });
          
          rows.push(row as unknown as ClientImportRow);
        }
        
        const result = await processImportRows(rows);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => reject(new Error('Failed to read CSV file'));
    reader.readAsText(file);
  });
}

/**
 * Import clients from Excel file
 */
export async function importFromExcel(file: File): Promise<ClientImportResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        
        // Get first sheet
        const sheetName = workbook.SheetNames[0]!;
        const worksheet = workbook.Sheets[sheetName]!;

        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as ClientImportRow[];
        
        const result = await processImportRows(jsonData);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => reject(new Error('Failed to read Excel file'));
    reader.readAsBinaryString(file);
  });
}