/**
 * Contractor services barrel — central exports for all contractor services.
 */
export { contractorService } from '../contractorService';
export * from './contractorClaimsService';
export * from './contractorInvoicesService';
export * from './contractorOnboardingService';
export * from './contractorPaymentsService';
export * from './contractorProjectsService';
export * from './contractorVerificationService';

import type { ServiceTemplate, ServiceTemplateFormData, ServiceTemplateSearchParams } from '@/types/contractor';

/**
 * ServiceTemplateApiService — manages contractor service templates.
 * Provides static CRUD operations for service templates used in the settings panel.
 */
export class ServiceTemplateApiService {
  static async getServiceTemplates(
    params?: ServiceTemplateSearchParams
  ): Promise<{ data: ServiceTemplate[] }> {
    const query = new URLSearchParams();
    if (params?.query) query.set('q', params.query);
    if (params?.category) query.set('category', params.category);
    if (params?.isActive !== undefined) query.set('isActive', String(params.isActive));
    if (params?.sortBy) query.set('sortBy', params.sortBy);
    if (params?.sortOrder) query.set('sortOrder', params.sortOrder);
    const res = await fetch(`/api/contractor/service-templates?${query}`);
    if (!res.ok) throw new Error('Failed to fetch service templates');
    return res.json() as Promise<{ data: ServiceTemplate[] }>;
  }

  static async createServiceTemplate(data: ServiceTemplateFormData): Promise<ServiceTemplate> {
    const res = await fetch('/api/contractor/service-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create service template');
    const json = await res.json() as { data: ServiceTemplate };
    return json.data;
  }

  static async updateServiceTemplate(
    id: string,
    data: Partial<ServiceTemplateFormData>
  ): Promise<ServiceTemplate> {
    const res = await fetch(`/api/contractor/service-templates/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update service template');
    const json = await res.json() as { data: ServiceTemplate };
    return json.data;
  }

  static async deleteServiceTemplate(id: string): Promise<void> {
    const res = await fetch(`/api/contractor/service-templates/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete service template');
  }
}
