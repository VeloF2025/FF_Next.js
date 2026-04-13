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
  Client
} from '@/types/client.types';
import { clientCrudService } from '../clientCrudService';
import { parseEnumValue, parseServiceTypes, parseTags, parseNumber } from './parsers';

/**
 * Process imported rows and create clients
 */
export async function processImportRows(rows: ClientImportRow[]): Promise<ClientImportResult> {
  const errors: ClientImportError[] = [];
  const clients: Client[] = [];
  let imported = 0;
  let failed = 0;
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rowNumber = i + 2; // +2 because row 1 is headers, and arrays are 0-indexed
    
    try {
      // Validate required fields
      if (!row.name) {
        errors.push({
          row: rowNumber,
          field: 'name',
          message: 'Company name is required'
        });
        failed++;
        continue;
      }
      
      if (!row.contactPerson) {
        errors.push({
          row: rowNumber,
          field: 'contactPerson',
          message: 'Contact person is required'
        });
        failed++;
        continue;
      }
      
      if (!row.email) {
        errors.push({
          row: rowNumber,
          field: 'email',
          message: 'Email is required'
        });
        failed++;
        continue;
      }
      
      if (!row.phone) {
        errors.push({
          row: rowNumber,
          field: 'phone',
          message: 'Phone is required'
        });
        failed++;
        continue;
      }
      
      // Create client form data
      const formData: ClientFormData = {
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
        serviceTypes: parseServiceTypes(row.serviceTypes),
        specialRequirements: ''
      };
      
      // Create client
      const id = await clientCrudService.create(formData);
      
      // Get the created client
      const client = await clientCrudService.getById(id);
      if (client) {
        clients.push(client);
        imported++;
      }
      
    } catch (error: unknown) {
      errors.push({
        row: rowNumber,
        field: 'general',
        message: error instanceof Error ? error.message : 'Failed to import row',
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