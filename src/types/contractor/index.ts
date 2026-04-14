/**
 * Contractor types barrel — re-exports all contractor type definitions.
 * Satisfies `@/types/contractor` imports (directory resolution).
 */
export * from '../contractor.types';
export * from '../contractor.core.types';
export * from '../contractor-document.types';
export * from '../contractor-invoice.types';
export * from '../contractor-payment.types';
export * from '../contractor-progress-claim.types';
export * from '../contractor-project.types';
export * from '../contractor-verification.types';

// ServiceTemplate types used by ServiceTemplatesTab
export interface ServiceTemplate {
  id: string;
  name: string;
  description?: string;
  /** 'deliverable' | 'service' */
  category?: string;
  code?: string;
  unit?: string;
  unitPrice?: number;
  baseRate?: number;
  currency?: string;
  isActive?: boolean;
  parentId?: string | null;
  orderIndex: number;
  children?: ServiceTemplate[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ServiceTemplateFormData {
  name: string;
  description?: string;
  category?: string;
  code?: string;
  unit?: string;
  unitPrice?: number;
  baseRate?: number;
  currency?: string;
  isActive?: boolean;
  parentId?: string | null;
  orderIndex?: number;
}

export interface ServiceTemplateSearchParams {
  query?: string;
  category?: string;
  isActive?: boolean;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface ServiceTemplatesTabProps {
  contractorId?: string;
  onServiceTemplateCreate?: (template: ServiceTemplate) => void;
  onServiceTemplateUpdate?: (template: ServiceTemplate) => void;
  onServiceTemplateDelete?: (id: string) => void;
}
