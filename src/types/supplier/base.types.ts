/**
 * Base supplier types and interfaces
 */

import { ProductCategory, Currency, PaymentTerms } from './common.types';
import { SupplierPerformance } from './performance.types';

export interface SupplierContract {
  id: string;
  contractNumber: string;
  startDate: Date | string;
  endDate: Date | string;
  value?: number;
  status: 'active' | 'expired' | 'terminated';
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  companyName?: string; // Alternative to name
  tradingName?: string;
  registrationNumber?: string;
  registrationNo?: string; // Alternative to registrationNumber
  taxNumber?: string;
  status: SupplierStatus;
  businessType: BusinessType;
  category?: ProductCategory; // Single primary category
  categories: ProductCategory[];
  rating: number | {
    overall: number;
    totalReviews?: number;
  };
  primaryContact: ContactInfo;
  contact: ContactInfo; // Alias for primaryContact - used in components
  alternativeContacts?: AlternativeContact[];
  industry?: string; // Industry classification
  province?: string; // Province/state for South Africa
  addresses: {
    physical: Address;
    postal?: Address;
    billing?: Address;
  };
  bankingInfo?: BankingInfo;
  complianceStatus?: ComplianceStatus;
  documents?: SupplierDocument[];
  certifications?: Certification[];
  website?: string;
  email: string;
  phone: string;
  fax?: string;
  notes?: string;
  tags?: string[];
  employeeSize?: EmployeeSize;
  annualRevenue?: RevenueRange;
  establishedDate?: Date | string;
  preferredPaymentTerms?: PaymentTerms;
  currency?: Currency;
  creditLimit?: number;
  leadTime?: number; // in days
  minimumOrderValue?: number;
  blacklisted?: boolean;
  blacklistReason?: string;
  blacklistedAt?: Date | string;
  blacklistedBy?: string;
  inactiveReason?: string;
  inactivatedAt?: Date | string;
  performance?: SupplierPerformance;
  performanceMetrics?: SupplierPerformanceMetrics;
  contracts?: SupplierContract[];
  priceListIds?: string[];
  sla?: ServiceLevelAgreement;
  integrations?: {
    apiEnabled?: boolean;
    ediEnabled?: boolean;
    portalUrl?: string;
  };
  metadata?: {
    source?: string;
    importedDate?: Date | string;
    lastVerified?: Date | string;
    verifiedBy?: string;
  };
  createdBy: string;
  createdAt: Date | string;
  updatedBy?: string;
  updatedAt?: Date | string;
  isActive: boolean;
  isPreferred?: boolean;
  isVerified?: boolean;
  vatRegistered?: boolean; // Drives PO VAT rate: 15% if registered, 0% if not
  attachments?: Attachment[];
  compliance?: {
    beeLevel?: number;
    taxCompliant?: boolean;
    vatRegistered?: boolean;
  };
  insuranceValid?: boolean; // Insurance status
  
  // Additional properties used by statistics and scorecard services
  overallScore?: number; // Calculated overall performance score
  yearsInBusiness?: number; // Years in business since establishment
  lastContact?: Date | string; // Last contact date with supplier
  isBlacklisted?: boolean; // Alias for blacklisted property
}

export interface ContactInfo {
  name: string;
  title?: string;
  email: string;
  phone: string;
  mobile?: string;
  department?: string;
  isPrimary?: boolean;
}

export interface AlternativeContact {
  type: 'sales' | 'accounts' | 'technical' | 'emergency';
  contact: ContactInfo;
}

export interface Address {
  street1: string;
  street2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
}

export interface BankingInfo {
  bankName: string;
  accountName: string;
  accountNumber: string;
  branchCode: string;
  swiftCode?: string;
  iban?: string;
}

export interface ComplianceStatus {
  taxCompliant: boolean;
  beeCompliant?: boolean;
  beeLevel?: number;
  isoCompliant?: boolean;
  isoCertifications?: string[];
  documentsVerified?: boolean;
  insuranceValid?: boolean;
  lastAuditDate?: Date | string;
  nextAuditDate?: Date | string;
}

export interface SupplierDocument {
  id: string;
  type: DocumentType;
  name: string;
  url: string;
  expiryDate?: Date | string;
  uploadedDate: Date | string;
  uploadedBy: string;
  status?: 'pending' | 'approved' | 'rejected' | 'expired';
  verificationStatus?: 'verified' | 'pending' | 'rejected';
}

export interface Certification {
  name: string;
  type?: string;
  status?: string;
  issuingBody: string;
  certificateNumber: string;
  issueDate: Date | string;
  expiryDate?: Date | string;
  documentUrl?: string;
}

export interface ServiceLevelAgreement {
  responseTime: number; // in hours
  resolutionTime: number; // in hours
  uptime?: number; // percentage
  penalties?: string;
  escalationProcess?: string;
}

export interface Attachment {
  id: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: Date | string;
  uploadedBy: string;
  category?: string;
  description?: string;
}

// Enums
export enum SupplierStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  PENDING = 'pending',
  SUSPENDED = 'suspended',
  BLACKLISTED = 'blacklisted',
  ARCHIVED = 'archived'
}

export enum BusinessType {
  MANUFACTURER = 'manufacturer',
  DISTRIBUTOR = 'distributor',
  WHOLESALER = 'wholesaler',
  RETAILER = 'retailer',
  SERVICE_PROVIDER = 'service_provider',
  CONTRACTOR = 'contractor',
  CONSULTANT = 'consultant',
  OTHER = 'other'
}

export enum DocumentType {
  TAX_CLEARANCE = 'tax_clearance',
  BEE_CERTIFICATE = 'bee_certificate',
  COMPANY_REGISTRATION = 'company_registration',
  BANK_CONFIRMATION = 'bank_confirmation',
  INSURANCE = 'insurance',
  CONTRACT = 'contract',
  NDA = 'nda',
  QUALITY_CERT = 'quality_cert',
  PRICE_LIST = 'price_list',
  CATALOG = 'catalog',
  OTHER = 'other'
}

export enum EmployeeSize {
  MICRO = '1-10',
  SMALL = '11-50',
  MEDIUM = '51-250',
  LARGE = '251-1000',
  ENTERPRISE = '1000+'
}

export enum RevenueRange {
  UNDER_1M = 'under_1m',
  ONE_TO_5M = '1m_5m',
  FIVE_TO_10M = '5m_10m',
  TEN_TO_50M = '10m_50m',
  FIFTY_TO_100M = '50m_100m',
  OVER_100M = 'over_100m'
}

// Additional performance metrics interface
export interface SupplierPerformanceMetrics {
  deliveryScore: number;
  qualityScore: number;
  priceScore: number;
  serviceScore: number;
  overallScore: number;
}

// Re-export from performance and common types for backwards compatibility
export type { PaymentTerms, Currency } from './common.types';
export type { 
  SupplierPerformance, 
  SupplierRating, 
  SupplierReview,
  PerformancePeriod,
  ContractType,
  ContractStatus,
  IssueType
} from './performance.types';

// Additional types that might be needed
export interface SupplierFormData {
  id?: string;
  name: string;
  code?: string;
  companyName?: string;
  email: string;
  phone: string;
  status: SupplierStatus;
  businessType: BusinessType;
  categories: ProductCategory[];
  addresses: {
    physical: Address;
    postal?: Address;
    billing?: Address;
  };
  primaryContact: ContactInfo;
  registrationNumber?: string;
  taxNumber?: string;
  vatRegistered?: boolean;
  notes?: string;
}