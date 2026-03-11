import { 
  ClientImportRow,
  ClientImportResult,
  ClientImportError,
  ClientFormData,
  ClientStatus,
  ClientCategory,
  ClientPriority,
  PaymentTerms,
  CreditRating,
  ContactMethod,
  ServiceType,
  Client
} from '@/types/client.types';
import { clientCrudService } from '../clientCrudService';
import { validateImportData } from './validator';
import { parseEnumValue, parseServiceTypes, parseTags, parseNumber } from './parser';

/**
 * Client Import Processor
 * Processes validated client import data
 */

/**
 * Process imported rows and create clients
 */
export async function processImportRows(rows: ClientImportRow[]): Promise<ClientImportResult> {
  const { validRows, invalidRows, allErrors } = validateImportData(rows);
  
  const errors: ClientImportError[] = [...allErrors];
  const clients: Client[] = [];
  let imported = 0;
  let failed = invalidRows.length;
  
  // Process valid rows
  for (let i = 0; i < validRows.length; i++) {
    const row = validRows[i]!;
    const originalIndex = rows.indexOf(row);
    const rowNumber = originalIndex + 2; // +2 because row 1 is headers, and arrays are 0-indexed
    
    try {
      // Create client form data
      const formData = transformRowToFormData(row);
      
      // Create client
      const id = await clientCrudService.create(formData);
      
      // Get the created client
      const client = await clientCrudService.getById(id);
      if (client) {
        clients.push(client);
        imported++;
      }
      
    } catch (error: any) {
      errors.push({
        row: rowNumber,
        field: 'general',
        message: error.message || 'Failed to import row',
        value: row
      });
      failed++;
    }
  }
  
  return {
    success: failed === 0,
    imported,
    failed,
    errors,
    clients
  };
}

/**
 * Transform import row to client form data
 */
export function transformRowToFormData(row: ClientImportRow): ClientFormData {
  return {
    name: row.name,
    contactPerson: row.contactPerson,
    email: row.email,
    phone: row.phone,
    address: {
      street: row.address || '',
      city: row.city || 'Johannesburg',
      state: row.province || 'Gauteng',
      postalCode: row.postalCode || '',
      country: row.country || 'South Africa',
    },
    city: row.city || 'Johannesburg',
    province: row.province || 'Gauteng',
    postalCode: row.postalCode || '',
    country: row.country || 'South Africa',
    registrationNumber: row.registrationNumber || '',
    vatNumber: row.vatNumber || '',
    industry: row.industry || 'General',
    website: row.website || '',
    alternativeEmail: row.alternativeEmail || '',
    alternativePhone: row.alternativePhone || '',
    creditLimit: parseNumber(row.creditLimit, 100000),
    paymentTerms: parseEnumValue(row.paymentTerms, PaymentTerms, PaymentTerms.NET_30),
    creditRating: parseEnumValue(row.creditRating, CreditRating, CreditRating.UNRATED),
    status: parseEnumValue(row.status, ClientStatus, ClientStatus.PROSPECT),
    category: parseEnumValue(row.category, ClientCategory, ClientCategory.SME),
    priority: parseEnumValue(row.priority, ClientPriority, ClientPriority.MEDIUM),
    preferredContactMethod: parseEnumValue(row.preferredContactMethod, ContactMethod, ContactMethod.EMAIL),
    communicationLanguage: row.communicationLanguage || 'English',
    timezone: row.timezone || 'Africa/Johannesburg',
    notes: row.notes || '',
    tags: parseTags(row.tags),
    serviceTypes: parseServiceTypes(row.serviceTypes, ServiceType),
    specialRequirements: ''
  };
}

/**
 * Preview import data without saving
 */
export async function previewImportData(rows: ClientImportRow[]): Promise<{
  preview: ClientFormData[];
  validCount: number;
  invalidCount: number;
  errors: ClientImportError[];
}> {
  const { validRows, invalidRows, allErrors } = validateImportData(rows);
  
  const preview = validRows.map(row => transformRowToFormData(row));
  
  return {
    preview,
    validCount: validRows.length,
    invalidCount: invalidRows.length,
    errors: allErrors
  };
}