/**
 * Client Import Types
 * CSV/Excel import structures and validation
 */

import { Client } from './core.types';

export interface ClientImportRow {
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  address?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: string;
  registrationNumber?: string;
  vatNumber?: string;
  industry?: string;
  website?: string;
  alternativeEmail?: string;
  alternativePhone?: string;
  creditLimit?: string | number;
  paymentTerms?: string;
  creditRating?: string;
  status?: string;
  category?: string;
  priority?: string;
  preferredContactMethod?: string;
  communicationLanguage?: string;
  timezone?: string;
  notes?: string;
  tags?: string;
  serviceTypes?: string;
}

export interface ClientImportResult {
  success: boolean;
  imported: number;
  failed: number;
  errors: ClientImportError[];
  clients: Client[];
}

export interface ClientImportError {
  row: number;
  field: string;
  message: string;
  value?: unknown;
}