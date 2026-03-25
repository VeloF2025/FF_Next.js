/**
 * Document Classification Service
 * PRD-033: OCR-First Document Upload Flow
 *
 * Provides VLM prompts, field mappings, and display-name utilities
 * for each supported document type.
 */

/** VLM extraction prompt keyed by document type */
export const VLM_PROMPTS: Record<string, string> = {
  drivers_license: `Extract all fields from this South African driver's license (credit-card size smart card). Return JSON with:
- licenseNumber: The license/card number (alphanumeric, e.g., "6025000170N4")
- idNumber: The 13-digit SA ID number (YYMMDD SSSS C A Z — all digits, never letters)
- fullName: Full name on the license
- dateOfBirth: Date of birth (YYYY-MM-DD format) — must match first 6 digits of idNumber
- validFrom: License valid from date (YYYY-MM-DD)
- validTo: License valid to/expiry date (YYYY-MM-DD)
- licenseCodes: Vehicle codes (e.g., "EB", "C1", "A")
- firstIssueDate: First issue date (YYYY-MM-DD)
- restrictions: Any restrictions (number or text)
CRITICAL: The idNumber is EXACTLY 13 digits. Common OCR errors: O→0, I→1, S→5, B→8. These are ALL digits.
Return ONLY valid JSON, no other text.`,

  id_document: `Extract all fields from this South African ID document (Smart ID card or green ID book). Return JSON with:
- idNumber: The SA ID number - MUST be EXACTLY 13 digits. Count carefully: YYMMDD SSSS C A Z format. If you see only 11-12 digits, look again for missing digits.
- surname: Surname/Last name
- firstName: First names
- dateOfBirth: Date of birth (YYYY-MM-DD format) - first 6 digits of ID = YYMMDD
- gender: Gender (Male/Female)
- citizenship: Citizenship status
- countryOfBirth: Country of birth
CRITICAL: SA ID numbers are always exactly 13 digits. Verify your extracted idNumber has 13 digits before returning.
Return ONLY valid JSON, no other text.`,

  // Alias for sa_id document type (used in UI)
  sa_id: `Extract all fields from this South African ID document (Smart ID card or green ID book). Return JSON with:
- idNumber: The SA ID number - MUST be EXACTLY 13 digits. Count carefully: YYMMDD SSSS C A Z format. If you see only 11-12 digits, look again for missing digits.
- surname: Surname/Last name
- firstName: First names
- dateOfBirth: Date of birth (YYYY-MM-DD format) - first 6 digits of ID = YYMMDD
- gender: Gender (Male/Female)
- citizenship: Citizenship status
- countryOfBirth: Country of birth
CRITICAL: SA ID numbers are always exactly 13 digits. Verify your extracted idNumber has 13 digits before returning.
Return ONLY valid JSON, no other text.`,

  passport: `Extract all fields from this passport document. For South African passports, the number is typically "A" followed by 8 digits. Return JSON with:
- passportNumber: The passport number (SA format: A + 8 digits, e.g., "A12345678")
- surname: Surname/Last name
- firstName: First/Given names
- nationality: Nationality (e.g., "South African" or ISO code "ZAF")
- dateOfBirth: Date of birth (YYYY-MM-DD format)
- gender: Gender (M/F or Male/Female)
- placeOfBirth: Place of birth
- dateOfIssue: Issue date (YYYY-MM-DD)
- dateOfExpiry: Expiry date (YYYY-MM-DD)
- issuingAuthority: Issuing authority/country
If the MRZ (Machine Readable Zone) is visible at the bottom, cross-reference printed fields with MRZ data for accuracy.
Common OCR confusions in MRZ: 0↔O, 1↔I, B↔8, D↔0, S↔5.
Return ONLY valid JSON, no other text.`,

  bank_statement: `Extract key fields from this South African bank statement or bank confirmation letter. Return JSON with:
- bankName: Name of the bank (e.g., ABSA, FNB, Standard Bank, Nedbank, Capitec)
- accountHolder: Account holder full name
- accountNumber: Bank account number (typically 10-13 digits — all digits, no letters)
- branchCode: Branch code if visible (6 digits, e.g., Capitec=470010, FNB=250655)
- accountType: Type of account (savings, cheque, current, transmission, etc.)
- statementDate: Statement date (YYYY-MM-DD) if visible
Common OCR confusions in account numbers: 0↔O, 1↔I, 6↔G, 8↔B — these are ALL digits.
Return ONLY valid JSON, no other text.`,

  // Alias for bank_details document type (used in UI)
  bank_details: `Extract key fields from this South African bank statement or bank confirmation letter. Return JSON with:
- bankName: Name of the bank (e.g., ABSA, FNB, Standard Bank, Nedbank, Capitec)
- accountHolder: Account holder full name
- accountNumber: Bank account number (typically 10-13 digits — all digits, no letters)
- branchCode: Branch code if visible (6 digits, e.g., Capitec=470010, FNB=250655)
- accountType: Type of account (savings, cheque, current, transmission, etc.)
- statementDate: Statement date (YYYY-MM-DD) if visible
Common OCR confusions in account numbers: 0↔O, 1↔I, 6↔G, 8↔B — these are ALL digits.
Return ONLY valid JSON, no other text.`,

  employment_contract: `Extract key details from this South African employment contract/agreement (BCEA-compliant). Focus on the front page, summary sections, and signature page. Return JSON with:
- employeeName: Full name of the employee
- employeeIdNumber: Employee's ID number if visible
- companyName: Name of the employer/company
- companyRegistration: Company registration number if visible
- jobTitle: Position/job title
- department: Department if mentioned
- startDate: Employment start date (YYYY-MM-DD)
- endDate: Contract end date if fixed-term (YYYY-MM-DD), null if permanent
- employmentType: Type (permanent, fixed-term, contract, etc.)
- salary: Salary/wage amount if visible
- salaryPeriod: Payment period (monthly, weekly, hourly)
- workLocation: Work location/address
- signatureDate: Date contract was signed (YYYY-MM-DD)
- employeeSigned: Boolean - true if employee signature is present
- employerSigned: Boolean - true if employer/company representative signature is present
- witnessesSigned: Boolean - true if witness signatures are present (check for witness signature lines)
- signatureNotes: Brief notes about signature status (e.g., "Employee and employer signed, witnesses not signed")
Note: Employee ID numbers are 13-digit SA IDs (YYMMDD SSSS C A Z). Company registration format: "YYYY/NNNNNN/NN". Common OCR confusions: 0↔O, 1↔I, /↔1.
Return ONLY valid JSON, no other text.`,

  proof_of_residence: `Extract address information from this South African proof of residence document (utility bill, bank statement, lease agreement, or municipal account). Return JSON with:
- fullName: Name on the document
- streetAddress: Street address (house number + street name)
- suburb: Suburb/Area name
- city: City/Town
- province: Province (Gauteng, Western Cape, KwaZulu-Natal, Eastern Cape, Free State, Limpopo, Mpumalanga, North West, Northern Cape)
- postalCode: Postal code (4 digits, e.g., 0001=Pretoria, 2001=Johannesburg)
- documentDate: Date on the document (YYYY-MM-DD) — must be recent (within 3 months)
- documentType: Type of document (utility bill, bank statement, municipal account, lease agreement, etc.)
Common OCR confusions in postal codes: 0↔O, 1↔I — postal codes are ALL digits.
Return ONLY valid JSON, no other text.`,

  default: `Extract all visible text and data from this document. Identify the document type and extract relevant fields. Return JSON with:
- documentType: What type of document this appears to be
- extractedText: Key text content from the document
- fields: An object with any identifiable fields and their values
Return ONLY valid JSON, no other text.`,
};

/** Maps VLM response field names to standard field names, keyed by document type */
export const FIELD_MAPPINGS: Record<string, Record<string, string>> = {
  drivers_license: {
    licenseNumber: 'licenseNumber',
    idNumber: 'documentNumber',
    fullName: 'fullName',
    dateOfBirth: 'dateOfBirth',
    validFrom: 'validFrom',
    validTo: 'validTo',
    licenseCodes: 'licenseCodes',
    firstIssueDate: 'issuedDate',
    restrictions: 'restrictions',
  },
  id_document: {
    idNumber: 'documentNumber',
    surname: 'surname',
    firstName: 'firstName',
    dateOfBirth: 'dateOfBirth',
    gender: 'gender',
    citizenship: 'citizenship',
    countryOfBirth: 'countryOfBirth',
  },
  // Alias for sa_id document type (used in UI)
  sa_id: {
    idNumber: 'documentNumber',
    surname: 'surname',
    firstName: 'firstName',
    dateOfBirth: 'dateOfBirth',
    gender: 'gender',
    citizenship: 'citizenship',
    countryOfBirth: 'countryOfBirth',
  },
  passport: {
    passportNumber: 'documentNumber',
    surname: 'surname',
    firstName: 'firstName',
    nationality: 'nationality',
    dateOfBirth: 'dateOfBirth',
    gender: 'gender',
    placeOfBirth: 'placeOfBirth',
    dateOfIssue: 'issuedDate',
    dateOfExpiry: 'expiryDate',
    issuingAuthority: 'issuingAuthority',
  },
  bank_statement: {
    bankName: 'bankName',
    accountHolder: 'accountHolder',
    accountNumber: 'accountNumber',
    branchCode: 'branchCode',
    accountType: 'accountType',
    statementDate: 'documentDate',
  },
  // Alias for bank_details document type (used in UI)
  bank_details: {
    bankName: 'bankName',
    accountHolder: 'accountHolder',
    accountNumber: 'accountNumber',
    branchCode: 'branchCode',
    accountType: 'accountType',
    statementDate: 'documentDate',
  },
  employment_contract: {
    employeeName: 'employeeName',
    employeeIdNumber: 'employeeIdNumber',
    companyName: 'companyName',
    companyRegistration: 'companyRegistration',
    jobTitle: 'jobTitle',
    department: 'department',
    startDate: 'startDate',
    endDate: 'endDate',
    employmentType: 'employmentType',
    salary: 'salary',
    salaryPeriod: 'salaryPeriod',
    workLocation: 'workLocation',
    signatureDate: 'signatureDate',
    employeeSigned: 'employeeSigned',
    employerSigned: 'employerSigned',
    witnessesSigned: 'witnessesSigned',
    signatureNotes: 'signatureNotes',
  },
  proof_of_residence: {
    fullName: 'fullName',
    streetAddress: 'streetAddress',
    suburb: 'suburb',
    city: 'city',
    province: 'province',
    postalCode: 'postalCode',
    documentDate: 'documentDate',
    documentType: 'sourceDocumentType',
  },
};

/** Human-readable display names for each document type */
const DOCUMENT_TYPE_NAMES: Record<string, string> = {
  id_document: 'SA ID Document',
  drivers_license: "Driver's License",
  passport: 'Passport',
  bank_statement: 'Bank Statement',
  proof_of_residence: 'Proof of Residence',
  employment_contract: 'Employment Contract',
  tax_document: 'Tax Document',
  medical_certificate: 'Medical Certificate',
  police_clearance: 'Police Clearance',
  qualification: 'Qualification Certificate',
  certification: 'Professional Certification',
  unknown: 'Unknown Document',
};

/** Return the human-readable display name for a document type code */
export function getDocumentTypeName(type: string): string {
  if (!type) return 'Unknown Document';
  return (
    DOCUMENT_TYPE_NAMES[type] ??
    type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
  );
}

/**
 * Build a top-guesses array for the classification result.
 * Currently returns a single entry; can be enhanced to return multiple guesses
 * when the VLM classification pipeline supports it.
 */
export function buildTopGuesses(classification: {
  documentType: string;
  confidence: number;
}): Array<{ documentType: string; confidence: number; displayName: string }> {
  // TODO: Enhance OCR service to return top-3 classification guesses
  return [
    {
      documentType: classification.documentType,
      confidence: classification.confidence,
      displayName: getDocumentTypeName(classification.documentType),
    },
  ];
}
