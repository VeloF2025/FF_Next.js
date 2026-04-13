/**
 * OCR Field Mapping Configuration
 * PRD Reference: PRD-032 Section 5 - Document Type Field Mappings
 *
 * Defines document type detection patterns, field extraction rules,
 * and validation logic for SA documents.
 */

import {
  type DocumentTypeConfig,
  type ValidationRule,
  OcrEntityType,
} from '@/types/ocr.types';

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate South African ID Number using Luhn algorithm variant
 * SA ID format: YYMMDD SSSS C A Z
 * - YYMMDD: Date of birth
 * - SSSS: Gender (0000-4999 female, 5000-9999 male)
 * - C: Citizenship (0 = SA citizen, 1 = permanent resident)
 * - A: Usually 8
 * - Z: Checksum digit
 */
export function validateSAID(id: string): { valid: boolean; message: string } {
  // Remove spaces
  const cleanId = id.replace(/\s/g, '');

  // Check format
  if (!/^\d{13}$/.test(cleanId)) {
    return { valid: false, message: 'SA ID must be exactly 13 digits' };
  }

  const digits = cleanId.split('').map(Number);

  // Luhn algorithm for SA ID
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    let digit = digits[i] ?? 0;
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }

  const checkDigit = (10 - (sum % 10)) % 10;
  const isValid = checkDigit === digits[12];

  if (!isValid) {
    return { valid: false, message: 'Invalid SA ID checksum' };
  }

  // Validate date portion
  const _year = parseInt(cleanId.substring(0, 2), 10);
  const month = parseInt(cleanId.substring(2, 4), 10);
  const day = parseInt(cleanId.substring(4, 6), 10);

  if (month < 1 || month > 12) {
    return { valid: false, message: 'Invalid birth month in SA ID' };
  }

  if (day < 1 || day > 31) {
    return { valid: false, message: 'Invalid birth day in SA ID' };
  }

  return { valid: true, message: 'Valid SA ID' };
}

/**
 * Extract date of birth from SA ID
 */
export function extractDOBFromSAID(id: string): string | null {
  const cleanId = id.replace(/\s/g, '');
  if (!/^\d{13}$/.test(cleanId)) return null;

  const yy = cleanId.substring(0, 2);
  const mm = cleanId.substring(2, 4);
  const dd = cleanId.substring(4, 6);

  // Determine century (assume 00-29 is 2000s, 30-99 is 1900s)
  const year = parseInt(yy, 10);
  const fullYear = year <= 29 ? 2000 + year : 1900 + year;

  return `${fullYear}-${mm}-${dd}`;
}

/**
 * Extract gender from SA ID
 */
export function extractGenderFromSAID(id: string): 'male' | 'female' | null {
  const cleanId = id.replace(/\s/g, '');
  if (!/^\d{13}$/.test(cleanId)) return null;

  const genderDigits = parseInt(cleanId.substring(6, 10), 10);
  return genderDigits >= 5000 ? 'male' : 'female';
}

/**
 * Extract citizenship from SA ID
 */
export function extractCitizenshipFromSAID(id: string): 'citizen' | 'resident' | null {
  const cleanId = id.replace(/\s/g, '');
  if (!/^\d{13}$/.test(cleanId)) return null;

  const citizenDigit = parseInt(cleanId.substring(10, 11), 10);
  return citizenDigit === 0 ? 'citizen' : 'resident';
}

/**
 * Validate South African bank account number
 */
export function validateBankAccount(accountNumber: string): { valid: boolean; message: string } {
  const cleanAccount = accountNumber.replace(/[\s-]/g, '');

  if (!/^\d{9,12}$/.test(cleanAccount)) {
    return { valid: false, message: 'Bank account must be 9-12 digits' };
  }

  return { valid: true, message: 'Valid bank account format' };
}

/**
 * Validate South African bank branch code
 */
export function validateBranchCode(branchCode: string): { valid: boolean; message: string } {
  const cleanCode = branchCode.replace(/[\s-]/g, '');

  if (!/^\d{6}$/.test(cleanCode)) {
    return { valid: false, message: 'Branch code must be exactly 6 digits' };
  }

  return { valid: true, message: 'Valid branch code format' };
}

/**
 * Validate CIPC registration number
 * Format: YYYY/NNNNNN/NN (e.g., 2020/123456/07)
 */
export function validateCIPCRegistration(regNumber: string): { valid: boolean; message: string } {
  const cleanReg = regNumber.replace(/\s/g, '');

  if (!/^\d{4}\/\d{6}\/\d{2}$/.test(cleanReg)) {
    return { valid: false, message: 'CIPC registration must be in format YYYY/NNNNNN/NN' };
  }

  const year = parseInt(cleanReg.substring(0, 4), 10);
  if (year < 1900 || year > new Date().getFullYear()) {
    return { valid: false, message: 'Invalid registration year' };
  }

  return { valid: true, message: 'Valid CIPC registration format' };
}

/**
 * Validate South African tax number
 */
export function validateTaxNumber(taxNumber: string): { valid: boolean; message: string } {
  const cleanTax = taxNumber.replace(/[\s-]/g, '');

  if (!/^\d{10}$/.test(cleanTax)) {
    return { valid: false, message: 'Tax number must be exactly 10 digits' };
  }

  return { valid: true, message: 'Valid tax number format' };
}

// ============================================================================
// South African Bank Lookup
// ============================================================================

export const SA_BANK_CODES: Record<string, string> = {
  '250655': 'ABSA Bank',
  '051001': 'Standard Bank',
  '198765': 'Standard Bank',
  '001255': 'First National Bank (FNB)',
  '250355': 'First National Bank (FNB)',
  '470010': 'Capitec Bank',
  '462005': 'Nedbank',
  '580105': 'Investec Bank',
  '632005': 'African Bank',
  '431010': 'Bidvest Bank',
  '679000': 'TymeBank',
  '678910': 'Bank Zero',
  '430000': 'Discovery Bank',
};

export function lookupBankFromBranchCode(branchCode: string): string | null {
  const cleanCode = branchCode.replace(/[\s-]/g, '');
  return SA_BANK_CODES[cleanCode] || null;
}

// ============================================================================
// Document Type Configurations
// ============================================================================

/**
 * SA ID Document Configuration
 */
export const SA_ID_CONFIG: DocumentTypeConfig = {
  documentType: 'id_document',
  displayName: 'ID Document',
  keywords: [
    // === SA ID Documents ===
    // Primary identifiers (appear on both old and new IDs)
    'REPUBLIC OF SOUTH AFRICA',
    'IDENTITY',
    // Smart ID Card specific
    'NATIONAL IDENTITY CARD',
    'IDENTITY NUMBER',
    'SURNAME',
    'NATIONALITY',
    // Old ID Book specific
    'DEPARTMENT OF HOME AFFAIRS',
    'ID NUMBER',
    // Afrikaans variants (old ID books)
    'REPUBLIEK VAN SUID-AFRIKA',
    'IDENTITEIT',
    'IDENTITEITSNOMMER',

    // === International Passports ===
    // English
    'PASSPORT',
    'GIVEN NAMES',
    'DATE OF EXPIRY',
    'DATE OF ISSUE',
    'PASSPORT NO',
    'PLACE OF BIRTH',
    'DATE OF BIRTH',
    'AUTHORITY',
    'TYPE',
    'CODE',
    'MACHINE READABLE',
    // French
    'PASSEPORT',
    'NOM',
    'PRÉNOMS',
    'DATE DE NAISSANCE',
    'LIEU DE NAISSANCE',
    'DATE DE DÉLIVRANCE',
    "DATE D'EXPIRATION",
    // German
    'REISEPASS',
    'NACHNAME',
    'VORNAMEN',
    'GEBURTSDATUM',
    'GEBURTSORT',
    'AUSSTELLUNGSDATUM',
    'GÜLTIG BIS',
    // Spanish
    'PASAPORTE',
    'APELLIDOS',
    'NOMBRE',
    'FECHA DE NACIMIENTO',
    'LUGAR DE NACIMIENTO',
    'FECHA DE EXPEDICIÓN',
    'FECHA DE CADUCIDAD',
    // Portuguese
    'PASSAPORTE',
    'APELIDOS',
    'NOMES',
    'DATA DE NASCIMENTO',
    'LOCAL DE NASCIMENTO',
    // Italian
    'PASSAPORTO',
    'COGNOME',
    'NOME',
    'DATA DI NASCITA',
    'LUOGO DI NASCITA',
    // Dutch
    'PASPOORT',
    'ACHTERNAAM',
    'VOORNAMEN',
    'GEBOORTEDATUM',
    'GEBOORTEPLAATS',
    // Generic international
    'MRZ',
    'ICAO',
    'TRAVEL DOCUMENT',
    'ISSUING STATE',
    'HOLDER',
    'EXPIRY',
    'VALID',
  ],
  patterns: [
    /\d{13}/, // SA ID number (13 digits)
    /\d{1,2}\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*\d{4}/i, // Date: "03 FEB 1978"
    /[A-Z]{1,2}\d{6,9}/, // Generic passport number (1-2 letters + 6-9 digits)
    /\d{9}/, // Numeric passport numbers (some countries)
    /P[<>][A-Z]{3}/, // MRZ first line pattern (P<XXX or P>XXX)
    /[A-Z0-9<]{30,44}/, // MRZ line pattern (30-44 alphanumeric chars with <)
  ],
  entityType: OcrEntityType.STAFF,
  fieldMappings: [
    // === SA ID Number variants ===
    {
      ocrLabel: 'Identity Number',
      entityField: 'idNumber',
      validationRules: [
        { type: 'custom', value: 'validateSAID', errorMessage: 'Invalid SA ID number' },
      ],
    },
    {
      ocrLabel: 'Identity No',
      entityField: 'idNumber',
      validationRules: [
        { type: 'custom', value: 'validateSAID', errorMessage: 'Invalid SA ID number' },
      ],
    },
    {
      ocrLabel: 'ID Number',
      entityField: 'idNumber',
      validationRules: [
        { type: 'custom', value: 'validateSAID', errorMessage: 'Invalid SA ID number' },
      ],
    },

    // === Passport Number (multiple languages) ===
    { ocrLabel: 'Passport No', entityField: 'passportNumber' },
    { ocrLabel: 'Passport Number', entityField: 'passportNumber' },
    { ocrLabel: 'Passeport No', entityField: 'passportNumber' },
    { ocrLabel: 'Reisepass Nr', entityField: 'passportNumber' },
    { ocrLabel: 'Pasaporte No', entityField: 'passportNumber' },
    { ocrLabel: 'Passaporto No', entityField: 'passportNumber' },
    { ocrLabel: 'Paspoort Nr', entityField: 'passportNumber' },

    // === Surname / Last Name (multiple languages) ===
    { ocrLabel: 'Surname', entityField: 'lastName' },
    { ocrLabel: 'Nom', entityField: 'lastName' },
    { ocrLabel: 'Nachname', entityField: 'lastName' },
    { ocrLabel: 'Apellidos', entityField: 'lastName' },
    { ocrLabel: 'Apelidos', entityField: 'lastName' },
    { ocrLabel: 'Cognome', entityField: 'lastName' },
    { ocrLabel: 'Achternaam', entityField: 'lastName' },

    // === First Name / Given Names (multiple languages) ===
    { ocrLabel: 'Names', entityField: 'firstName' },
    { ocrLabel: 'First Names', entityField: 'firstName' },
    { ocrLabel: 'Given names', entityField: 'firstName' },
    { ocrLabel: 'Given Names', entityField: 'firstName' },
    { ocrLabel: 'Prénoms', entityField: 'firstName' },
    { ocrLabel: 'Prenoms', entityField: 'firstName' },
    { ocrLabel: 'Vornamen', entityField: 'firstName' },
    { ocrLabel: 'Nombre', entityField: 'firstName' },
    { ocrLabel: 'Nomes', entityField: 'firstName' },

    // === Date of Birth (multiple languages) ===
    { ocrLabel: 'Date of Birth', entityField: 'dateOfBirth', transform: 'parseDate' },
    { ocrLabel: 'Date of birth', entityField: 'dateOfBirth', transform: 'parseDate' },
    { ocrLabel: 'Date de naissance', entityField: 'dateOfBirth', transform: 'parseDate' },
    { ocrLabel: 'Geburtsdatum', entityField: 'dateOfBirth', transform: 'parseDate' },
    { ocrLabel: 'Fecha de nacimiento', entityField: 'dateOfBirth', transform: 'parseDate' },
    { ocrLabel: 'Data de nascimento', entityField: 'dateOfBirth', transform: 'parseDate' },
    { ocrLabel: 'Data di nascita', entityField: 'dateOfBirth', transform: 'parseDate' },
    { ocrLabel: 'Geboortedatum', entityField: 'dateOfBirth', transform: 'parseDate' },

    // === Place of Birth (multiple languages) ===
    { ocrLabel: 'Place of birth', entityField: 'placeOfBirth' },
    { ocrLabel: 'Place of Birth', entityField: 'placeOfBirth' },
    { ocrLabel: 'Lieu de naissance', entityField: 'placeOfBirth' },
    { ocrLabel: 'Geburtsort', entityField: 'placeOfBirth' },
    { ocrLabel: 'Lugar de nacimiento', entityField: 'placeOfBirth' },
    { ocrLabel: 'Local de nascimento', entityField: 'placeOfBirth' },
    { ocrLabel: 'Luogo di nascita', entityField: 'placeOfBirth' },
    { ocrLabel: 'Geboorteplaats', entityField: 'placeOfBirth' },

    // === Date of Issue (multiple languages) ===
    { ocrLabel: 'Date of issue', entityField: 'issuedDate', transform: 'parseDate' },
    { ocrLabel: 'Date of Issue', entityField: 'issuedDate', transform: 'parseDate' },
    { ocrLabel: 'Date de délivrance', entityField: 'issuedDate', transform: 'parseDate' },
    { ocrLabel: 'Ausstellungsdatum', entityField: 'issuedDate', transform: 'parseDate' },
    { ocrLabel: 'Fecha de expedición', entityField: 'issuedDate', transform: 'parseDate' },

    // === Date of Expiry (multiple languages) ===
    { ocrLabel: 'Date of expiry', entityField: 'expiryDate', transform: 'parseDate' },
    { ocrLabel: 'Date of Expiry', entityField: 'expiryDate', transform: 'parseDate' },
    { ocrLabel: "Date d'expiration", entityField: 'expiryDate', transform: 'parseDate' },
    { ocrLabel: 'Gültig bis', entityField: 'expiryDate', transform: 'parseDate' },
    { ocrLabel: 'Fecha de caducidad', entityField: 'expiryDate', transform: 'parseDate' },

    // === Gender / Sex (multiple languages) ===
    { ocrLabel: 'Sex', entityField: 'gender' },
    { ocrLabel: 'Gender', entityField: 'gender', transform: 'extractGenderFromSAID' },
    { ocrLabel: 'Sexe', entityField: 'gender' },
    { ocrLabel: 'Geschlecht', entityField: 'gender' },
    { ocrLabel: 'Sexo', entityField: 'gender' },
    { ocrLabel: 'Sesso', entityField: 'gender' },
    { ocrLabel: 'Geslacht', entityField: 'gender' },

    // === Nationality / Citizenship (multiple languages) ===
    { ocrLabel: 'Nationality', entityField: 'nationality' },
    { ocrLabel: 'Nationalité', entityField: 'nationality' },
    { ocrLabel: 'Staatsangehörigkeit', entityField: 'nationality' },
    { ocrLabel: 'Nacionalidad', entityField: 'nationality' },
    { ocrLabel: 'Nacionalidade', entityField: 'nationality' },
    { ocrLabel: 'Nazionalità', entityField: 'nationality' },
    { ocrLabel: 'Nationaliteit', entityField: 'nationality' },
    { ocrLabel: 'Country of Birth', entityField: 'countryOfBirth' },
    { ocrLabel: 'Citizenship', entityField: 'nationality', transform: 'extractCitizenshipFromSAID' },
    { ocrLabel: 'Status', entityField: 'citizenshipStatus' },
  ],
};

/**
 * SA Driver's License Configuration
 */
export const DRIVERS_LICENSE_CONFIG: DocumentTypeConfig = {
  documentType: 'drivers_license',
  displayName: "Driver's License",
  keywords: [
    // SA Driving License (English)
    'DRIVING LICENCE',
    'DRIVING LICENSE',
    "DRIVER'S LICENSE",
    "DRIVER'S LICENCE",
    // SA Driving License (Afrikaans)
    'BESTUURSLISENSIE',
    'BESTUURDERLISENSIE',
    // SA Driving License (Portuguese - on SA cards)
    'CARTA DE CONDUCAO',
    // Common fields
    'LIC. NO',
    'LISENSIENR',
    'LICENSE NUMBER',
    'LICENCE NUMBER',
    'VALID/GELDIG',
    'CODE/KODE',
    'VEH.RESTR',
    'VOERTUIGBEPERKING',
    'FIRST ISSUE',
    'EERSTE UITREIKING',
    'DRIVER RESTRICTIONS',
    'PrDP CATEGORIES',
    'VEHICLE RESTRICTIONS',
    // SADC regional
    'SADC',
    'ZA',
    'SOUTH AFRICA',
  ],
  patterns: [
    /\d{13}/, // SA ID number on license
    /\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}\/\d{2}\/\d{4}/, // Valid date range: 08/11/2016 - 15/11/2021
    /\d{2}\/\d{2}\/\d{4}/, // Single date format
    /\d{8,12}[A-Z]{2}\d{2}/, // License number format like 30040008RD49
    /(?:CODE|KODE)\s*[:\s]*[A-Z]{1,2}\d?/i, // License code like EB, B, C1
    /(?:RESTR|BEPERK)[.:]?\s*\d/i, // Restrictions
  ],
  entityType: OcrEntityType.STAFF,
  fieldMappings: [
    // Name
    { ocrLabel: 'Name', entityField: 'fullName' },
    // ID Number
    {
      ocrLabel: 'ID No',
      entityField: 'idNumber',
      validationRules: [
        { type: 'custom', value: 'validateSAID', errorMessage: 'Invalid SA ID number' },
      ],
    },
    {
      ocrLabel: 'IDNo',
      entityField: 'idNumber',
      validationRules: [
        { type: 'custom', value: 'validateSAID', errorMessage: 'Invalid SA ID number' },
      ],
    },
    // Birth date
    { ocrLabel: 'Birth/Geboorte', entityField: 'dateOfBirth', transform: 'parseDate' },
    { ocrLabel: 'Birth', entityField: 'dateOfBirth', transform: 'parseDate' },
    { ocrLabel: 'Geboorte', entityField: 'dateOfBirth', transform: 'parseDate' },
    // Gender
    { ocrLabel: 'Sex', entityField: 'gender' },
    { ocrLabel: 'Gender', entityField: 'gender' },
    // License number
    { ocrLabel: 'Lic. No', entityField: 'licenseNumber' },
    { ocrLabel: 'Lic.No', entityField: 'licenseNumber' },
    { ocrLabel: 'Lisensienr', entityField: 'licenseNumber' },
    { ocrLabel: 'License No', entityField: 'licenseNumber' },
    { ocrLabel: 'Licence No', entityField: 'licenseNumber' },
    // Valid dates
    { ocrLabel: 'Valid/Geldig', entityField: 'validityPeriod' },
    { ocrLabel: 'Valid', entityField: 'validFrom', transform: 'parseDate' },
    { ocrLabel: 'Geldig', entityField: 'validFrom', transform: 'parseDate' },
    // License code
    { ocrLabel: 'Code/Kode', entityField: 'licenseCode' },
    { ocrLabel: 'Code', entityField: 'licenseCode' },
    { ocrLabel: 'Kode', entityField: 'licenseCode' },
    // Vehicle restrictions
    { ocrLabel: 'Veh.restr', entityField: 'vehicleRestrictions' },
    { ocrLabel: 'Voertuigbeperking', entityField: 'vehicleRestrictions' },
    // Driver restrictions
    { ocrLabel: 'Restr', entityField: 'driverRestrictions' },
    { ocrLabel: 'Beperk', entityField: 'driverRestrictions' },
    // First issue date
    { ocrLabel: 'First issue', entityField: 'firstIssueDate', transform: 'parseDate' },
    { ocrLabel: 'Eerste uitreiking', entityField: 'firstIssueDate', transform: 'parseDate' },
    // Issued location
    { ocrLabel: 'Issued/Uitgereik', entityField: 'issuedAt' },
    { ocrLabel: 'Issued', entityField: 'issuedAt' },
    { ocrLabel: 'Uitgereik', entityField: 'issuedAt' },
    // PrDP category
    { ocrLabel: 'PrDP', entityField: 'prdpCategory' },
  ],
};

/**
 * Bank Confirmation Letter Configuration (Staff)
 */
export const STAFF_BANK_CONFIRMATION_CONFIG: DocumentTypeConfig = {
  documentType: 'bank_details',
  displayName: 'Bank Confirmation Letter',
  keywords: [
    'BANK',
    'CONFIRMATION',
    'ACCOUNT',
    'ACCOUNT HOLDER',
    'BRANCH',
    'ACCOUNT NUMBER',
    'BANKING DETAILS',
    'CONFIRMATION LETTER',
  ],
  patterns: [
    /\d{9,12}/, // Account number
    /\d{6}/, // Branch code
  ],
  entityType: OcrEntityType.STAFF,
  fieldMappings: [
    {
      ocrLabel: 'Bank Name',
      entityField: 'bankName',
    },
    {
      ocrLabel: 'Account Number',
      entityField: 'bankAccountNumber',
      validationRules: [
        { type: 'custom', value: 'validateBankAccount', errorMessage: 'Invalid bank account number' },
      ],
    },
    {
      ocrLabel: 'Branch Code',
      entityField: 'bankBranchCode',
      validationRules: [
        { type: 'custom', value: 'validateBranchCode', errorMessage: 'Invalid branch code' },
      ],
    },
    {
      ocrLabel: 'Account Type',
      entityField: 'bankAccountType',
      validationRules: [
        {
          type: 'enum',
          value: ['cheque', 'savings', 'current', 'transmission'],
          errorMessage: 'Invalid account type',
        },
      ],
    },
  ],
};

/**
 * Tax Document (IRP5) Configuration
 */
export const TAX_DOCUMENT_CONFIG: DocumentTypeConfig = {
  documentType: 'tax_document',
  displayName: 'Tax Document (IRP5)',
  keywords: [
    'IRP5',
    'SARS',
    'SOUTH AFRICAN REVENUE SERVICE',
    'TAX CERTIFICATE',
    'EMPLOYEES TAX CERTIFICATE',
    'TAX REFERENCE',
    'INCOME TAX',
  ],
  patterns: [
    /\d{10}/, // Tax number
    /IRP5/i,
  ],
  entityType: OcrEntityType.STAFF,
  fieldMappings: [
    {
      ocrLabel: 'Tax Reference',
      entityField: 'taxNumber',
      validationRules: [
        { type: 'custom', value: 'validateTaxNumber', errorMessage: 'Invalid tax number' },
      ],
    },
    {
      ocrLabel: 'Tax Number',
      entityField: 'taxNumber',
      validationRules: [
        { type: 'custom', value: 'validateTaxNumber', errorMessage: 'Invalid tax number' },
      ],
    },
  ],
};

/**
 * CIPC Registration Configuration (Contractor)
 */
export const CIPC_REGISTRATION_CONFIG: DocumentTypeConfig = {
  documentType: 'cipc_registration',
  displayName: 'CIPC Company Registration',
  keywords: [
    'CIPC',
    'COMPANIES AND INTELLECTUAL PROPERTY COMMISSION',
    'COMPANY REGISTRATION',
    'REGISTRATION CERTIFICATE',
    'CK NUMBER',
    'REGISTRATION NUMBER',
    'NOTICE OF REGISTRATION',
  ],
  patterns: [
    /\d{4}\/\d{6}\/\d{2}/, // CIPC registration format
    /CK\s*\d+/i,
  ],
  entityType: OcrEntityType.CONTRACTOR,
  fieldMappings: [
    {
      ocrLabel: 'Company Name',
      entityField: 'companyName',
    },
    {
      ocrLabel: 'Registration Number',
      entityField: 'registrationNumber',
      validationRules: [
        { type: 'custom', value: 'validateCIPCRegistration', errorMessage: 'Invalid CIPC registration' },
      ],
    },
    {
      ocrLabel: 'CK Number',
      entityField: 'registrationNumber',
    },
    {
      ocrLabel: 'Directors',
      entityField: 'metadata.directors',
    },
    {
      ocrLabel: 'Registration Date',
      entityField: 'metadata.registrationDate',
      transform: 'parseDate',
    },
  ],
};

/**
 * Contractor Bank Confirmation Configuration
 */
export const CONTRACTOR_BANK_CONFIRMATION_CONFIG: DocumentTypeConfig = {
  documentType: 'bank_confirmation',
  displayName: 'Bank Confirmation Letter',
  keywords: [
    'BANK',
    'CONFIRMATION',
    'ACCOUNT',
    'BUSINESS ACCOUNT',
    'COMPANY ACCOUNT',
    'BRANCH',
    'ACCOUNT NUMBER',
  ],
  patterns: [
    /\d{9,12}/, // Account number
    /\d{6}/, // Branch code
  ],
  entityType: OcrEntityType.CONTRACTOR,
  fieldMappings: [
    {
      ocrLabel: 'Bank Name',
      entityField: 'bankName',
    },
    {
      ocrLabel: 'Account Number',
      entityField: 'accountNumber',
      validationRules: [
        { type: 'custom', value: 'validateBankAccount', errorMessage: 'Invalid bank account number' },
      ],
    },
    {
      ocrLabel: 'Branch Code',
      entityField: 'branchCode',
      validationRules: [
        { type: 'custom', value: 'validateBranchCode', errorMessage: 'Invalid branch code' },
      ],
    },
  ],
};

/**
 * Tax Clearance Certificate Configuration (Contractor)
 */
export const TAX_CLEARANCE_CONFIG: DocumentTypeConfig = {
  documentType: 'tax_clearance',
  displayName: 'Tax Clearance Certificate',
  keywords: [
    'TAX CLEARANCE',
    'SARS',
    'GOOD STANDING',
    'TAX COMPLIANCE STATUS',
    'TCS',
    'VALID UNTIL',
  ],
  patterns: [
    /\d{10}/, // Tax number
    /valid\s*(until|to)/i,
  ],
  entityType: OcrEntityType.CONTRACTOR,
  fieldMappings: [
    {
      ocrLabel: 'Tax Reference',
      entityField: 'taxNumber',
      validationRules: [
        { type: 'custom', value: 'validateTaxNumber', errorMessage: 'Invalid tax number' },
      ],
    },
    {
      ocrLabel: 'Valid Until',
      entityField: 'taxClearanceExpiry',
      transform: 'parseDate',
    },
    {
      ocrLabel: 'Expiry Date',
      entityField: 'taxClearanceExpiry',
      transform: 'parseDate',
    },
  ],
};

/**
 * BEE Certificate Configuration (Contractor)
 */
export const BEE_CERTIFICATE_CONFIG: DocumentTypeConfig = {
  documentType: 'bee_certificate',
  displayName: 'BEE Certificate',
  keywords: [
    'B-BBEE',
    'BEE',
    'BROAD-BASED BLACK ECONOMIC EMPOWERMENT',
    'VERIFICATION CERTIFICATE',
    'BEE LEVEL',
    'CONTRIBUTOR LEVEL',
    'EXEMPTED MICRO ENTERPRISE',
    'EME',
    'QSE',
  ],
  patterns: [
    /level\s*[1-8]/i,
    /EME/i,
    /QSE/i,
  ],
  entityType: OcrEntityType.CONTRACTOR,
  fieldMappings: [
    {
      ocrLabel: 'BEE Level',
      entityField: 'beeLevel',
      validationRules: [
        {
          type: 'enum',
          value: ['1', '2', '3', '4', '5', '6', '7', '8', 'EME', 'QSE', 'Non-compliant'],
          errorMessage: 'Invalid BEE level',
        },
      ],
    },
    {
      ocrLabel: 'Valid Until',
      entityField: 'beeCertificateExpiry',
      transform: 'parseDate',
    },
    {
      ocrLabel: 'Expiry Date',
      entityField: 'beeCertificateExpiry',
      transform: 'parseDate',
    },
  ],
};

// ============================================================================
// All Document Configs
// ============================================================================

export const ALL_DOCUMENT_CONFIGS: DocumentTypeConfig[] = [
  SA_ID_CONFIG,
  DRIVERS_LICENSE_CONFIG,
  STAFF_BANK_CONFIRMATION_CONFIG,
  TAX_DOCUMENT_CONFIG,
  CIPC_REGISTRATION_CONFIG,
  CONTRACTOR_BANK_CONFIRMATION_CONFIG,
  TAX_CLEARANCE_CONFIG,
  BEE_CERTIFICATE_CONFIG,
];

/**
 * Get document config by type
 */
export function getDocumentConfig(documentType: string): DocumentTypeConfig | null {
  return ALL_DOCUMENT_CONFIGS.find(c => c.documentType === documentType) || null;
}

/**
 * Get all configs for an entity type
 */
export function getConfigsForEntityType(entityType: OcrEntityType): DocumentTypeConfig[] {
  return ALL_DOCUMENT_CONFIGS.filter(c => c.entityType === entityType);
}

/**
 * Classify document based on text content
 */
export function classifyDocument(text: string): {
  documentType: string;
  confidence: number;
  matchedKeywords: string[];
  matchedPatterns: string[];
} | null {
  const upperText = text.toUpperCase();
  let bestMatch: {
    config: DocumentTypeConfig;
    keywordScore: number;
    patternScore: number;
    matchedKeywords: string[];
    matchedPatterns: string[];
  } | null = null;

  for (const config of ALL_DOCUMENT_CONFIGS) {
    // Count keyword matches
    const matchedKeywords = config.keywords.filter(kw => upperText.includes(kw.toUpperCase()));
    const keywordScore = matchedKeywords.length / config.keywords.length;

    // Count pattern matches
    const matchedPatterns: string[] = [];
    for (const pattern of config.patterns) {
      if (pattern.test(text)) {
        matchedPatterns.push(pattern.source);
      }
    }
    const patternScore = matchedPatterns.length / config.patterns.length;

    // Combined score
    const totalScore = keywordScore * 0.6 + patternScore * 0.4;

    if (!bestMatch || totalScore > bestMatch.keywordScore * 0.6 + bestMatch.patternScore * 0.4) {
      bestMatch = {
        config,
        keywordScore,
        patternScore,
        matchedKeywords,
        matchedPatterns,
      };
    }
  }

  if (!bestMatch || (bestMatch.keywordScore === 0 && bestMatch.patternScore === 0)) {
    return null;
  }

  const confidence = bestMatch.keywordScore * 0.6 + bestMatch.patternScore * 0.4;

  return {
    documentType: bestMatch.config.documentType,
    confidence,
    matchedKeywords: bestMatch.matchedKeywords,
    matchedPatterns: bestMatch.matchedPatterns,
  };
}

// ============================================================================
// Field Validation Runner
// ============================================================================

/**
 * Run validation rules on a field value
 */
export function validateField(
  value: string,
  rules: ValidationRule[]
): { valid: boolean; message: string } {
  for (const rule of rules) {
    switch (rule.type) {
      case 'regex': {
        const regex = new RegExp(rule.value as string);
        if (!regex.test(value)) {
          return { valid: false, message: rule.errorMessage };
        }
        break;
      }

      case 'enum': {
        const allowedValues = rule.value as string[];
        if (!allowedValues.includes(value)) {
          return { valid: false, message: rule.errorMessage };
        }
        break;
      }

      case 'custom': {
        const funcName = rule.value as string;
        let result: { valid: boolean; message: string } | undefined;

        switch (funcName) {
          case 'validateSAID':
            result = validateSAID(value);
            break;
          case 'validateBankAccount':
            result = validateBankAccount(value);
            break;
          case 'validateBranchCode':
            result = validateBranchCode(value);
            break;
          case 'validateCIPCRegistration':
            result = validateCIPCRegistration(value);
            break;
          case 'validateTaxNumber':
            result = validateTaxNumber(value);
            break;
          default:
            result = { valid: true, message: 'Unknown validation function' };
        }

        if (!result.valid) {
          return result;
        }
        break;
      }

      case 'range': {
        const numValue = parseFloat(value);
        const rangeValues = rule.value as number[];
        const min = rangeValues[0] ?? 0;
        const max = rangeValues[1] ?? Infinity;
        if (isNaN(numValue) || numValue < min || numValue > max) {
          return { valid: false, message: rule.errorMessage };
        }
        break;
      }
    }
  }

  return { valid: true, message: 'Valid' };
}

// ============================================================================
// OCR-Eligible Document Types for Staff/Contractor Documents
// ============================================================================

/**
 * Maps staff document types (from DOCUMENT_TYPE_LABELS) to OCR document configs
 * Only these document types will show the "Extract Data" button
 */
export const OCR_ELIGIBLE_DOCUMENT_TYPES: Record<string, string> = {
  // Staff document types → OCR document types
  'sa_id': 'id_document',
  'passport': 'id_document', // Can extract basic info
  'drivers_license': 'drivers_license', // SA Driver's License
  'bank_confirmation': 'bank_details',
  'banking_details': 'bank_details',
  'irp5': 'tax_document',
  'tax_return': 'tax_document',
  // Contractor document types
  'cipc_registration': 'cipc_registration',
  'tax_clearance': 'tax_clearance',
  'bee_certificate': 'bee_certificate',
};

/**
 * Check if a document type is eligible for OCR extraction
 */
export function isOcrEligible(documentType: string): boolean {
  return documentType in OCR_ELIGIBLE_DOCUMENT_TYPES;
}

/**
 * Get the OCR document type for a staff/contractor document type
 */
export function getOcrDocumentType(documentType: string): string | null {
  return OCR_ELIGIBLE_DOCUMENT_TYPES[documentType] || null;
}
