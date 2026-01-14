/**
 * Fleet Vehicle Ownership Types
 * Types for documents, license disc, finance, lease, and insurance tracking
 */

// Document type options
export type VehicleDocumentType =
  | 'natis'
  | 'license_disc'
  | 'finance_agreement'
  | 'lease_contract'
  | 'rental_agreement'
  | 'insurance_policy'
  | 'service_record'
  | 'roadworthy'
  | 'other';

// Finance type options
export type FinanceType = 'instalment_sale' | 'lease_to_own' | 'balloon_payment';

// Lease type options
export type LeaseType = 'lease' | 'rental' | 'operating_lease' | 'finance_lease';

// Insurance policy type options
export type InsurancePolicyType = 'comprehensive' | 'third_party' | 'third_party_fire_theft';

// License disc status
export type LicenseDiscStatus = 'active' | 'expired' | 'renewed';

// Expiring item urgency levels
export type ExpiryUrgency = 'ok' | 'warning' | 'critical' | 'overdue';

// Expiring item types
export type ExpiringItemType = 'license_disc' | 'insurance' | 'lease';

/**
 * Vehicle Document
 * Maps to fleet_vehicle_documents table
 */
export interface VehicleDocument {
  id: string;
  vehicleId: string;
  documentType: VehicleDocumentType;
  documentName: string;
  description: string | null;
  fileUrl: string | null;
  fileSize: number | null;
  mimeType: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  referenceNumber: string | null;
  notes: string | null;
  uploadedBy: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * License Disc Record
 * Maps to fleet_license_disc table
 */
export interface LicenseDisc {
  id: string;
  vehicleId: string;
  licenseNumber: string | null;
  province: string | null;
  issueDate: string | null;
  expiryDate: string;
  cost: number | null;
  arrears: number | null;
  penalties: number | null;
  totalPaid: number | null;
  documentUrl: string | null;
  renewalReminderDays: number;
  reminderSentAt: string | null;
  renewedAt: string | null;
  status: LicenseDiscStatus;
  createdAt: string;
  createdBy: string | null;
}

/**
 * Vehicle Finance Details
 * Maps to fleet_vehicle_finance table
 */
export interface VehicleFinance {
  id: string;
  vehicleId: string;
  financeCompany: string;
  financeType: FinanceType | null;
  accountNumber: string | null;
  vehiclePrice: number | null;
  depositPaid: number | null;
  financeAmount: number | null;
  interestRate: number | null;
  termMonths: number | null;
  monthlyPayment: number | null;
  balloonPayment: number | null;
  startDate: string | null;
  endDate: string | null;
  firstPaymentDate: string | null;
  remainingBalance: number | null;
  paymentsMade: number;
  nextPaymentDate: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  branch: string | null;
  settlementAmount: number | null;
  settlementValidUntil: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Vehicle Lease/Rental Details
 * Maps to fleet_vehicle_lease table
 */
export interface VehicleLease {
  id: string;
  vehicleId: string;
  leaseType: LeaseType;
  companyName: string;
  companyRegistration: string | null;
  companyVat: string | null;
  companyAddress: string | null;
  companyPhone: string | null;
  companyEmail: string | null;
  companyWebsite: string | null;
  contractNumber: string | null;
  quoteNumber: string | null;
  startDate: string;
  endDate: string | null;
  contractDurationMonths: number | null;
  monthlyCost: number | null;
  depositAmount: number | null;
  depositRefundable: boolean;
  kmLimitMonthly: number | null;
  kmLimitTotal: number | null;
  excessKmRate: number | null;
  currentKm: number | null;
  kmLastUpdated: string | null;
  includesMaintenance: boolean;
  includesTyres: boolean;
  includesFuelCard: boolean;
  includesTracking: boolean;
  includesInsurance: boolean;
  accountManager: string | null;
  accountManagerPhone: string | null;
  accountManagerEmail: string | null;
  alternateContactName: string | null;
  alternateContactPhone: string | null;
  returnConditions: string | null;
  earlyTerminationFee: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Vehicle Insurance Policy
 * Maps to fleet_vehicle_insurance table
 */
export interface VehicleInsurance {
  id: string;
  vehicleId: string;
  insuranceCompany: string;
  policyNumber: string;
  policyType: InsurancePolicyType | null;
  coverAmount: number | null;
  excessAmount: number | null;
  excessTheft: number | null;
  excessThirdParty: number | null;
  premiumMonthly: number | null;
  premiumAnnual: number | null;
  paymentMethod: string | null;
  startDate: string | null;
  expiryDate: string;
  insurerContactName: string | null;
  insurerContactPhone: string | null;
  insurerClaimsPhone: string | null;
  insurerEmail: string | null;
  brokerName: string | null;
  brokerCompany: string | null;
  brokerPhone: string | null;
  brokerEmail: string | null;
  roadsideAssistanceNumber: string | null;
  towingIncluded: boolean;
  carHireIncluded: boolean;
  documentUrl: string | null;
  scheduleUrl: string | null;
  isActive: boolean;
  renewalReminderDays: number;
  reminderSentAt: string | null;
  claimsCount: number;
  lastClaimDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Expiring Item (from fleet_expiring_items view)
 * Used for dashboard alerts
 */
export interface ExpiringItem {
  itemType: ExpiringItemType;
  itemId: string;
  vehicleId: string;
  registration: string;
  vehicleName: string;
  itemName: string;
  expiryDate: string;
  daysUntilExpiry: number;
  urgency: ExpiryUrgency;
}

// ============================================================================
// Request/Response Types
// ============================================================================

/**
 * Create Document Request
 */
export interface CreateDocumentRequest {
  documentType: VehicleDocumentType;
  documentName: string;
  description?: string;
  fileUrl?: string;
  fileSize?: number;
  mimeType?: string;
  issueDate?: string;
  expiryDate?: string;
  referenceNumber?: string;
  notes?: string;
}

/**
 * Create License Disc Request
 */
export interface CreateLicenseDiscRequest {
  licenseNumber?: string;
  province?: string;
  issueDate?: string;
  expiryDate: string;
  cost?: number;
  arrears?: number;
  penalties?: number;
  totalPaid?: number;
  documentUrl?: string;
  renewalReminderDays?: number;
}

/**
 * Create/Update Finance Request
 */
export interface UpsertFinanceRequest {
  financeCompany: string;
  financeType?: FinanceType;
  accountNumber?: string;
  vehiclePrice?: number;
  depositPaid?: number;
  financeAmount?: number;
  interestRate?: number;
  termMonths?: number;
  monthlyPayment?: number;
  balloonPayment?: number;
  startDate?: string;
  endDate?: string;
  firstPaymentDate?: string;
  remainingBalance?: number;
  paymentsMade?: number;
  nextPaymentDate?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  branch?: string;
  settlementAmount?: number;
  settlementValidUntil?: string;
  notes?: string;
}

/**
 * Create/Update Lease Request
 */
export interface UpsertLeaseRequest {
  leaseType: LeaseType;
  companyName: string;
  companyRegistration?: string;
  companyVat?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  companyWebsite?: string;
  contractNumber?: string;
  quoteNumber?: string;
  startDate: string;
  endDate?: string;
  contractDurationMonths?: number;
  monthlyCost?: number;
  depositAmount?: number;
  depositRefundable?: boolean;
  kmLimitMonthly?: number;
  kmLimitTotal?: number;
  excessKmRate?: number;
  currentKm?: number;
  includesMaintenance?: boolean;
  includesTyres?: boolean;
  includesFuelCard?: boolean;
  includesTracking?: boolean;
  includesInsurance?: boolean;
  accountManager?: string;
  accountManagerPhone?: string;
  accountManagerEmail?: string;
  alternateContactName?: string;
  alternateContactPhone?: string;
  returnConditions?: string;
  earlyTerminationFee?: number;
  notes?: string;
}

/**
 * Create Insurance Request
 */
export interface CreateInsuranceRequest {
  insuranceCompany: string;
  policyNumber: string;
  policyType?: InsurancePolicyType;
  coverAmount?: number;
  excessAmount?: number;
  excessTheft?: number;
  excessThirdParty?: number;
  premiumMonthly?: number;
  premiumAnnual?: number;
  paymentMethod?: string;
  startDate?: string;
  expiryDate: string;
  insurerContactName?: string;
  insurerContactPhone?: string;
  insurerClaimsPhone?: string;
  insurerEmail?: string;
  brokerName?: string;
  brokerCompany?: string;
  brokerPhone?: string;
  brokerEmail?: string;
  roadsideAssistanceNumber?: string;
  towingIncluded?: boolean;
  carHireIncluded?: boolean;
  documentUrl?: string;
  scheduleUrl?: string;
  notes?: string;
}

// ============================================================================
// Database Row Types (snake_case from PostgreSQL)
// ============================================================================

export interface VehicleDocumentRow {
  id: string;
  vehicle_id: string;
  document_type: string;
  document_name: string;
  description: string | null;
  file_url: string | null;
  file_size: number | null;
  mime_type: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  reference_number: string | null;
  notes: string | null;
  uploaded_by: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LicenseDiscRow {
  id: string;
  vehicle_id: string;
  license_number: string | null;
  province: string | null;
  issue_date: string | null;
  expiry_date: string;
  cost: string | null;
  arrears: string | null;
  penalties: string | null;
  total_paid: string | null;
  document_url: string | null;
  renewal_reminder_days: number;
  reminder_sent_at: string | null;
  renewed_at: string | null;
  status: string;
  created_at: string;
  created_by: string | null;
}

export interface VehicleFinanceRow {
  id: string;
  vehicle_id: string;
  finance_company: string;
  finance_type: string | null;
  account_number: string | null;
  vehicle_price: string | null;
  deposit_paid: string | null;
  finance_amount: string | null;
  interest_rate: string | null;
  term_months: number | null;
  monthly_payment: string | null;
  balloon_payment: string | null;
  start_date: string | null;
  end_date: string | null;
  first_payment_date: string | null;
  remaining_balance: string | null;
  payments_made: number;
  next_payment_date: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  branch: string | null;
  settlement_amount: string | null;
  settlement_valid_until: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface VehicleLeaseRow {
  id: string;
  vehicle_id: string;
  lease_type: string;
  company_name: string;
  company_registration: string | null;
  company_vat: string | null;
  company_address: string | null;
  company_phone: string | null;
  company_email: string | null;
  company_website: string | null;
  contract_number: string | null;
  quote_number: string | null;
  start_date: string;
  end_date: string | null;
  contract_duration_months: number | null;
  monthly_cost: string | null;
  deposit_amount: string | null;
  deposit_refundable: boolean;
  km_limit_monthly: number | null;
  km_limit_total: number | null;
  excess_km_rate: string | null;
  current_km: number | null;
  km_last_updated: string | null;
  includes_maintenance: boolean;
  includes_tyres: boolean;
  includes_fuel_card: boolean;
  includes_tracking: boolean;
  includes_insurance: boolean;
  account_manager: string | null;
  account_manager_phone: string | null;
  account_manager_email: string | null;
  alternate_contact_name: string | null;
  alternate_contact_phone: string | null;
  return_conditions: string | null;
  early_termination_fee: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface VehicleInsuranceRow {
  id: string;
  vehicle_id: string;
  insurance_company: string;
  policy_number: string;
  policy_type: string | null;
  cover_amount: string | null;
  excess_amount: string | null;
  excess_theft: string | null;
  excess_third_party: string | null;
  premium_monthly: string | null;
  premium_annual: string | null;
  payment_method: string | null;
  start_date: string | null;
  expiry_date: string;
  insurer_contact_name: string | null;
  insurer_contact_phone: string | null;
  insurer_claims_phone: string | null;
  insurer_email: string | null;
  broker_name: string | null;
  broker_company: string | null;
  broker_phone: string | null;
  broker_email: string | null;
  roadside_assistance_number: string | null;
  towing_included: boolean;
  car_hire_included: boolean;
  document_url: string | null;
  schedule_url: string | null;
  is_active: boolean;
  renewal_reminder_days: number;
  reminder_sent_at: string | null;
  claims_count: number;
  last_claim_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpiringItemRow {
  item_type: string;
  item_id: string;
  vehicle_id: string;
  registration: string;
  vehicle_name: string;
  item_name: string;
  expiry_date: string;
  days_until_expiry: number;
  urgency: string;
}

// ============================================================================
// Row Converters
// ============================================================================

export function rowToVehicleDocument(row: VehicleDocumentRow): VehicleDocument {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    documentType: row.document_type as VehicleDocumentType,
    documentName: row.document_name,
    description: row.description,
    fileUrl: row.file_url,
    fileSize: row.file_size,
    mimeType: row.mime_type,
    issueDate: row.issue_date,
    expiryDate: row.expiry_date,
    referenceNumber: row.reference_number,
    notes: row.notes,
    uploadedBy: row.uploaded_by,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToLicenseDisc(row: LicenseDiscRow): LicenseDisc {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    licenseNumber: row.license_number,
    province: row.province,
    issueDate: row.issue_date,
    expiryDate: row.expiry_date,
    cost: row.cost ? parseFloat(row.cost) : null,
    arrears: row.arrears ? parseFloat(row.arrears) : null,
    penalties: row.penalties ? parseFloat(row.penalties) : null,
    totalPaid: row.total_paid ? parseFloat(row.total_paid) : null,
    documentUrl: row.document_url,
    renewalReminderDays: row.renewal_reminder_days,
    reminderSentAt: row.reminder_sent_at,
    renewedAt: row.renewed_at,
    status: row.status as LicenseDiscStatus,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export function rowToVehicleFinance(row: VehicleFinanceRow): VehicleFinance {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    financeCompany: row.finance_company,
    financeType: row.finance_type as FinanceType | null,
    accountNumber: row.account_number,
    vehiclePrice: row.vehicle_price ? parseFloat(row.vehicle_price) : null,
    depositPaid: row.deposit_paid ? parseFloat(row.deposit_paid) : null,
    financeAmount: row.finance_amount ? parseFloat(row.finance_amount) : null,
    interestRate: row.interest_rate ? parseFloat(row.interest_rate) : null,
    termMonths: row.term_months,
    monthlyPayment: row.monthly_payment ? parseFloat(row.monthly_payment) : null,
    balloonPayment: row.balloon_payment ? parseFloat(row.balloon_payment) : null,
    startDate: row.start_date,
    endDate: row.end_date,
    firstPaymentDate: row.first_payment_date,
    remainingBalance: row.remaining_balance ? parseFloat(row.remaining_balance) : null,
    paymentsMade: row.payments_made,
    nextPaymentDate: row.next_payment_date,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    branch: row.branch,
    settlementAmount: row.settlement_amount ? parseFloat(row.settlement_amount) : null,
    settlementValidUntil: row.settlement_valid_until,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToVehicleLease(row: VehicleLeaseRow): VehicleLease {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    leaseType: row.lease_type as LeaseType,
    companyName: row.company_name,
    companyRegistration: row.company_registration,
    companyVat: row.company_vat,
    companyAddress: row.company_address,
    companyPhone: row.company_phone,
    companyEmail: row.company_email,
    companyWebsite: row.company_website,
    contractNumber: row.contract_number,
    quoteNumber: row.quote_number,
    startDate: row.start_date,
    endDate: row.end_date,
    contractDurationMonths: row.contract_duration_months,
    monthlyCost: row.monthly_cost ? parseFloat(row.monthly_cost) : null,
    depositAmount: row.deposit_amount ? parseFloat(row.deposit_amount) : null,
    depositRefundable: row.deposit_refundable,
    kmLimitMonthly: row.km_limit_monthly,
    kmLimitTotal: row.km_limit_total,
    excessKmRate: row.excess_km_rate ? parseFloat(row.excess_km_rate) : null,
    currentKm: row.current_km,
    kmLastUpdated: row.km_last_updated,
    includesMaintenance: row.includes_maintenance,
    includesTyres: row.includes_tyres,
    includesFuelCard: row.includes_fuel_card,
    includesTracking: row.includes_tracking,
    includesInsurance: row.includes_insurance,
    accountManager: row.account_manager,
    accountManagerPhone: row.account_manager_phone,
    accountManagerEmail: row.account_manager_email,
    alternateContactName: row.alternate_contact_name,
    alternateContactPhone: row.alternate_contact_phone,
    returnConditions: row.return_conditions,
    earlyTerminationFee: row.early_termination_fee ? parseFloat(row.early_termination_fee) : null,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToVehicleInsurance(row: VehicleInsuranceRow): VehicleInsurance {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    insuranceCompany: row.insurance_company,
    policyNumber: row.policy_number,
    policyType: row.policy_type as InsurancePolicyType | null,
    coverAmount: row.cover_amount ? parseFloat(row.cover_amount) : null,
    excessAmount: row.excess_amount ? parseFloat(row.excess_amount) : null,
    excessTheft: row.excess_theft ? parseFloat(row.excess_theft) : null,
    excessThirdParty: row.excess_third_party ? parseFloat(row.excess_third_party) : null,
    premiumMonthly: row.premium_monthly ? parseFloat(row.premium_monthly) : null,
    premiumAnnual: row.premium_annual ? parseFloat(row.premium_annual) : null,
    paymentMethod: row.payment_method,
    startDate: row.start_date,
    expiryDate: row.expiry_date,
    insurerContactName: row.insurer_contact_name,
    insurerContactPhone: row.insurer_contact_phone,
    insurerClaimsPhone: row.insurer_claims_phone,
    insurerEmail: row.insurer_email,
    brokerName: row.broker_name,
    brokerCompany: row.broker_company,
    brokerPhone: row.broker_phone,
    brokerEmail: row.broker_email,
    roadsideAssistanceNumber: row.roadside_assistance_number,
    towingIncluded: row.towing_included,
    carHireIncluded: row.car_hire_included,
    documentUrl: row.document_url,
    scheduleUrl: row.schedule_url,
    isActive: row.is_active,
    renewalReminderDays: row.renewal_reminder_days,
    reminderSentAt: row.reminder_sent_at,
    claimsCount: row.claims_count,
    lastClaimDate: row.last_claim_date,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToExpiringItem(row: ExpiringItemRow): ExpiringItem {
  return {
    itemType: row.item_type as ExpiringItemType,
    itemId: row.item_id,
    vehicleId: row.vehicle_id,
    registration: row.registration,
    vehicleName: row.vehicle_name,
    itemName: row.item_name,
    expiryDate: row.expiry_date,
    daysUntilExpiry: row.days_until_expiry,
    urgency: row.urgency as ExpiryUrgency,
  };
}
