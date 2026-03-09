import { 
  ClientImportRow,
  ClientImportError
} from '@/types/client.types';

/**
 * Client Import Validator
 * Validates client import data
 */

/**
 * Validate a single import row
 */
export function validateImportRow(row: ClientImportRow, rowNumber: number): ClientImportError[] {
  const errors: ClientImportError[] = [];
  
  // Validate required fields
  if (!row.name) {
    errors.push({
      row: rowNumber,
      field: 'name',
      message: 'Company name is required'
    });
  }
  
  if (!row.contactPerson) {
    errors.push({
      row: rowNumber,
      field: 'contactPerson',
      message: 'Contact person is required'
    });
  }
  
  if (!row.email) {
    errors.push({
      row: rowNumber,
      field: 'email',
      message: 'Email is required'
    });
  } else if (!isValidEmail(row.email)) {
    errors.push({
      row: rowNumber,
      field: 'email',
      message: 'Invalid email format'
    });
  }
  
  if (!row.phone) {
    errors.push({
      row: rowNumber,
      field: 'phone',
      message: 'Phone is required'
    });
  } else if (!isValidPhone(row.phone)) {
    errors.push({
      row: rowNumber,
      field: 'phone',
      message: 'Invalid phone format'
    });
  }
  
  return errors;
}

/**
 * Validate all import rows
 */
export function validateImportData(rows: ClientImportRow[]): {
  validRows: ClientImportRow[];
  invalidRows: { row: ClientImportRow; errors: ClientImportError[] }[];
  allErrors: ClientImportError[];
} {
  const validRows: ClientImportRow[] = [];
  const invalidRows: { row: ClientImportRow; errors: ClientImportError[] }[] = [];
  const allErrors: ClientImportError[] = [];
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rowNumber = i + 2; // +2 because row 1 is headers, and arrays are 0-indexed
    const errors = validateImportRow(row, rowNumber);

    if (errors.length === 0) {
      validRows.push(row);
    } else {
      invalidRows.push({ row, errors });
      allErrors.push(...errors);
    }
  }
  
  return { validRows, invalidRows, allErrors };
}

/**
 * Validate email format
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate phone format (basic validation)
 */
function isValidPhone(phone: string): boolean {
  // Allow various phone formats
  const phoneRegex = /^[+]?[0-9\s\-()]{10,}$/;
  return phoneRegex.test(phone);
}

/**
 * Check for duplicate entries in import data
 */
export function checkForDuplicates(rows: ClientImportRow[]): {
  duplicateEmails: string[];
  duplicatePhones: string[];
  duplicateNames: string[];
} {
  const seenEmails = new Set<string>();
  const seenPhones = new Set<string>();
  const seenNames = new Set<string>();
  
  const duplicateEmails: string[] = [];
  const duplicatePhones: string[] = [];
  const duplicateNames: string[] = [];
  
  for (const row of rows) {
    if (row.email) {
      const email = row.email.toLowerCase();
      if (seenEmails.has(email) && !duplicateEmails.includes(email)) {
        duplicateEmails.push(email);
      }
      seenEmails.add(email);
    }
    
    if (row.phone) {
      const phone = row.phone.replace(/\s|-|\(|\)/g, '');
      if (seenPhones.has(phone) && !duplicatePhones.includes(phone)) {
        duplicatePhones.push(phone);
      }
      seenPhones.add(phone);
    }
    
    if (row.name) {
      const name = row.name.toLowerCase();
      if (seenNames.has(name) && !duplicateNames.includes(name)) {
        duplicateNames.push(name);
      }
      seenNames.add(name);
    }
  }
  
  return { duplicateEmails, duplicatePhones, duplicateNames };
}