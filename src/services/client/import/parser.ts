import * as XLSX from 'xlsx';
import { 
  ClientImportRow
} from '@/types/client.types';

/**
 * Client Import Parser
 * Handles parsing of CSV and Excel files
 */

/**
 * Import clients from CSV file
 */
export async function parseCSVFile(file: File): Promise<ClientImportRow[]> {
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
        
        resolve(rows);
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
export async function parseExcelFile(file: File): Promise<ClientImportRow[]> {
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
        
        resolve(jsonData);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => reject(new Error('Failed to read Excel file'));
    reader.readAsBinaryString(file);
  });
}

/**
 * Parse service types from comma-separated string
 */
export function parseServiceTypes<T>(servicesString: string | undefined, ServiceType: Record<string, T>): T[] {
  if (!servicesString) return [];

  const services: T[] = [];
  const servicesList = servicesString.split(',').map(s => s.trim());
  
  for (const service of servicesList) {
    const parsedService = parseEnumValue(service, ServiceType, null);
    if (parsedService) {
      services.push(parsedService);
    }
  }
  
  return services;
}

/**
 * Parse tags from comma-separated string
 */
export function parseTags(tagsString: string | undefined): string[] {
  if (!tagsString) return [];
  return tagsString.split(',').map(t => t.trim()).filter(t => t.length > 0);
}

/**
 * Parse number with fallback
 */
export function parseNumber(value: string | number | undefined, defaultValue: number): number {
  if (value === undefined || value === '') return defaultValue;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return isNaN(num) ? defaultValue : num;
}

/**
 * Helper to parse enum values
 */
export function parseEnumValue<T>(value: string | undefined, enumType: Record<string, T>, defaultValue: T): T {
  if (!value) return defaultValue;
  
  const upperValue = value.toUpperCase().replace(/\s+/g, '_');
  const enumValues = Object.values(enumType) as string[];
  
  for (const enumValue of enumValues) {
    if (enumValue.toUpperCase().replace(/\s+/g, '_') === upperValue) {
      return enumValue as T;
    }
  }
  
  return defaultValue;
}

/**
 * Get import template as Blob
 */
export function generateImportTemplate(): Blob {
  const templateData = [
    {
      name: 'Example Client',
      code: 'CLI001',
      email: 'client@example.com',
      phone: '+27123456789',
      status: 'ACTIVE',
      category: 'BUSINESS',
      priority: 'HIGH',
      website: 'https://example.com',
      'registration Number': 'REG123456',
      'vat Number': 'VAT123456',
      'tax Number': 'TAX123456',
      'physical Address': '123 Main Street',
      'physical City': 'Johannesburg',
      'physical Province': 'Gauteng',
      'physical Postal Code': '2000',
      'physical Country': 'South Africa',
      'postal Address': 'PO Box 123',
      'postal City': 'Johannesburg',
      'postal Province': 'Gauteng',
      'postal Postal Code': '2001',
      'postal Country': 'South Africa',
      'billing Address': '123 Main Street',
      'billing City': 'Johannesburg',
      'billing Province': 'Gauteng',
      'billing Postal Code': '2000',
      'billing Country': 'South Africa',
      'contact First Name': 'John',
      'contact Last Name': 'Doe',
      'contact Email': 'john@example.com',
      'contact Phone': '+27123456789',
      'contact Position': 'Manager',
      'contact Preferred Method': 'EMAIL',
      'payment Terms': 'NET_30',
      'credit Limit': '100000',
      'credit Rating': 'GOOD',
      services: 'INSTALLATION,MAINTENANCE',
      tags: 'premium,vip',
      notes: 'Important client'
    }
  ];

  const ws = XLSX.utils.json_to_sheet(templateData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Clients');
  
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}