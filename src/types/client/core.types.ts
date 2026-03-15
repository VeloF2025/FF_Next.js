/**
 * Core Client Types
 * Primary client interface and address structures
 */

/** Timestamp values from Neon PostgreSQL are returned as strings or Date objects */
type Timestamp = string | Date;

import {
  ClientStatus, 
  ClientCategory, 
  ClientPriority,
  PaymentTerms,
  CreditRating,
  ContactMethod,
  ServiceType
} from './enums';

export interface Client {
  id?: string;
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  
  // Address Information
  address: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  billingAddress?: AddressFormData;
  
  // Business Information
  registrationNumber?: string;
  vatNumber?: string;
  taxNumber?: string;
  organizationType?: string;
  industry: string;
  website?: string;
  
  // Contact Details
  alternativeEmail?: string;
  alternativePhone?: string;
  faxNumber?: string;
  contactPosition?: string;
  
  // Financial Information
  creditLimit: number;
  currentBalance: number;
  outstandingBalance?: number;
  totalRevenue?: number;
  paymentTerms: PaymentTerms;
  creditRating: CreditRating;
  
  // Status and Categories
  status: ClientStatus;
  category: ClientCategory;
  priority: ClientPriority;
  
  // Project Metrics (auto-calculated)
  totalProjects: number;
  activeProjects: number;
  completedProjects: number;
  totalProjectValue: number;
  averageProjectValue: number;
  
  // Relationship Management
  accountManagerId?: string;
  accountManagerName?: string;
  salesRepresentativeId?: string;
  salesRepresentativeName?: string;
  
  // Communication Preferences
  preferredContactMethod: ContactMethod;
  
  // Additional fields from ClientFormData
  taxExempt?: boolean;
  requiresPO?: boolean;
  autoApproveOrders?: boolean;
  allowBackorders?: boolean;
  communicationLanguage: string;
  timezone: string;
  
  // Notes and History
  notes?: string;
  tags: string[];
  lastContactDate?: Timestamp;
  nextFollowUpDate?: Timestamp;
  
  // Service Preferences
  serviceTypes: ServiceType[];
  preferredContractors?: string[];
  specialRequirements?: string;
  
  // Audit Fields
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  lastModifiedBy: string;
}

export interface AddressFormData {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  sameAsPhysical?: boolean;
}

export interface ClientDropdownOption {
  id: string;
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  status: ClientStatus;
  category: ClientCategory;
}