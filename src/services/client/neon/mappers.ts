import { Client } from '@/types/client.types';

export interface ClientMetadata {
  alternate_phone?: string;
  website?: string;
  category?: string;
  priority?: string;
  account_manager_id?: string;
  notes?: string;
  tags?: string[];
  last_contact_date?: string;
  created_by?: string;
  last_modified_by?: string;
  credit_limit?: number;
  current_balance?: number;
  credit_rating?: string;
  total_projects?: number;
  active_projects?: number;
  completed_projects?: number;
  total_project_value?: number;
  average_project_value?: number;
  preferred_contact_method?: string;
  communication_language?: string;
  timezone?: string;
  service_types?: string[];
  registration_number?: string;
  vat_number?: string;
}

export interface ClientDbRow {
  id: string;
  name: string;
  contact_person?: string;
  contact_email?: string;
  email?: string;
  phone?: string;
  contact_phone?: string;
  type?: string;
  status?: string;
  address?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  payment_terms?: number;
  created_at?: string;
  updated_at?: string;
  metadata?: ClientMetadata;
}

/**
 * Maps database row to Client interface
 */
export function mapDbToClient(dbClient: ClientDbRow): Client {
  const meta = dbClient.metadata ?? {};
  return {
    id: dbClient.id,
    name: dbClient.name,
    contactPerson: dbClient.contact_person || dbClient.contact_email?.split('@')[0] || '',
    email: dbClient.email || dbClient.contact_email || '',
    phone: dbClient.phone || dbClient.contact_phone || '',
    alternativePhone: meta.alternate_phone || '',
    website: meta.website || '',
    industry: dbClient.type || 'Other',
    category: meta.category || 'STANDARD',
    status: dbClient.status || 'ACTIVE',
    priority: meta.priority || 'MEDIUM',
    accountManagerId: meta.account_manager_id || '',
    accountManagerName: '',
    address: dbClient.address || '',
    city: dbClient.city || '',
    province: dbClient.state || '',
    postalCode: dbClient.postal_code || '',
    country: dbClient.country || 'South Africa',
    notes: meta.notes || '',
    tags: meta.tags || [],
    lastContactDate: meta.last_contact_date,
    paymentTerms: dbClient.payment_terms ? `Net ${dbClient.payment_terms}` : 'Net 30',
    createdAt: dbClient.created_at,
    updatedAt: dbClient.updated_at,
    createdBy: meta.created_by || '',
    lastModifiedBy: meta.last_modified_by || '',
    // Required fields with defaults
    creditLimit: meta.credit_limit || 0,
    currentBalance: meta.current_balance || 0,
    creditRating: meta.credit_rating || 'UNRATED',
    totalProjects: meta.total_projects || 0,
    activeProjects: meta.active_projects || 0,
    completedProjects: meta.completed_projects || 0,
    totalProjectValue: meta.total_project_value || 0,
    averageProjectValue: meta.average_project_value || 0,
    preferredContactMethod: meta.preferred_contact_method || 'EMAIL',
    communicationLanguage: meta.communication_language || 'English',
    timezone: meta.timezone || 'Africa/Johannesburg',
    serviceTypes: meta.service_types || [],
    registrationNumber: meta.registration_number || '',
    vatNumber: meta.vat_number || ''
  } as unknown as Client;
}

/**
 * Build metadata object from client form data
 */
export function buildMetadata(data: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};

  if (data.website !== undefined) metadata.website = data.website;
  if (data.category !== undefined) metadata.category = data.category;
  if (data.priority !== undefined) metadata.priority = data.priority;
  if (data.accountManagerId !== undefined) metadata.account_manager_id = data.accountManagerId;
  if (data.notes !== undefined) metadata.notes = data.notes;
  if (data.tags !== undefined) metadata.tags = data.tags;
  if (data.contractValue !== undefined) metadata.contract_value = data.contractValue;

  return metadata;
}

/**
 * Extract payment terms as number
 */
export function extractPaymentTerms(paymentTerms?: string): number {
  if (!paymentTerms) return 30;
  const match = paymentTerms.match(/\d+/);
  return match ? parseInt(match[0]) : 30;
}
