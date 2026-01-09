/**
 * Supplier Base CRUD Operations
 * Core create, read, update, delete operations
 *
 * NOTE: Firebase Firestore has been removed. This service now uses API endpoints.
 * TODO: Create /api/suppliers endpoints for full functionality
 */

import {
  Supplier,
  SupplierFormData,
  SupplierStatus
} from '@/types/supplier/base.types';
import { SupplierFilter } from './types';
import { log } from '@/lib/logger';

/**
 * Base supplier CRUD operations
 */
export class SupplierBaseCrud {
  /**
   * Get all suppliers with optional filtering
   */
  static async getAll(filter?: SupplierFilter): Promise<Supplier[]> {
    try {
      const params = new URLSearchParams();

      if (filter?.status) {
        params.append('status', filter.status);
      }
      if (filter?.isPreferred !== undefined) {
        params.append('isPreferred', String(filter.isPreferred));
      }
      if (filter?.category) {
        params.append('category', filter.category);
      }

      const queryString = params.toString() ? `?${params.toString()}` : '';
      const response = await fetch(`/api/suppliers${queryString}`);

      if (!response.ok) {
        throw new Error('Failed to fetch suppliers');
      }

      const result = await response.json();
      return result.data || result.suppliers || [];
    } catch (error) {
      log.error('Error fetching suppliers:', { data: error }, 'base');
      throw new Error(`Failed to fetch suppliers: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get supplier by ID
   */
  static async getById(id: string): Promise<Supplier> {
    try {
      const response = await fetch(`/api/suppliers/${id}`);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Supplier with ID '${id}' not found`);
        }
        throw new Error('Failed to fetch supplier');
      }

      const result = await response.json();
      return result.data || result.supplier || result;
    } catch (error) {
      log.error(`Error fetching supplier ${id}:`, { data: error }, 'base');
      if (error instanceof Error && error.message.includes('not found')) {
        throw error;
      }
      throw new Error(`Failed to fetch supplier: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if supplier exists
   */
  static async exists(id: string): Promise<boolean> {
    try {
      const response = await fetch(`/api/suppliers/${id}`);
      return response.ok;
    } catch (error) {
      log.error(`Error checking supplier existence ${id}:`, { data: error }, 'base');
      return false;
    }
  }

  /**
   * Create new supplier
   */
  static async create(data: SupplierFormData): Promise<string> {
    try {
      // Validate required fields
      if (!data.name) {
        throw new Error('Supplier name is required');
      }
      if (!data.email) {
        throw new Error('Supplier email is required');
      }

      // Initialize supplier with defaults
      const supplier = this.initializeSupplierData(data);

      const response = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(supplier),
      });

      if (!response.ok) {
        throw new Error('Failed to create supplier');
      }

      const result = await response.json();
      return result.data?.id || result.id;
    } catch (error) {
      log.error('Error creating supplier:', { data: error }, 'base');
      throw new Error(`Failed to create supplier: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update existing supplier
   */
  static async update(id: string, data: Partial<SupplierFormData>): Promise<void> {
    try {
      const updateData = {
        ...data,
        updatedAt: new Date().toISOString(),
        lastModifiedBy: 'current-user-id' // TODO: Get from auth context
      };

      const response = await fetch(`/api/suppliers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Supplier with ID '${id}' not found`);
        }
        throw new Error('Failed to update supplier');
      }
    } catch (error) {
      log.error(`Error updating supplier ${id}:`, { data: error }, 'base');
      throw new Error(`Failed to update supplier: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete supplier
   */
  static async delete(id: string): Promise<void> {
    try {
      const response = await fetch(`/api/suppliers/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Supplier with ID '${id}' not found`);
        }
        throw new Error('Failed to delete supplier');
      }
    } catch (error) {
      log.error(`Error deleting supplier ${id}:`, { data: error }, 'base');
      throw new Error(`Failed to delete supplier: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Initialize supplier data with defaults
   */
  private static initializeSupplierData(data: SupplierFormData): Omit<Supplier, 'id'> {
    const now = new Date();

    // Initialize rating
    const initialRating = {
      overall: 0,
      totalReviews: 0,
      lastReviewDate: null
    };

    return {
      ...data,
      code: data.code || `SUP-${Date.now()}`,
      companyName: data.name,
      businessType: data.businessType || 'Other',
      isActive: true,

      // Contact information
      primaryContact: {
        name: data.name,
        email: data.email,
        phone: data.phone || ''
      },
      contact: {
        name: data.name,
        email: data.email,
        phone: data.phone || ''
      },

      // Address information
      addresses: {
        physical: {
          street1: data.addresses?.physical?.street1 || '',
          city: '',
          state: '',
          postalCode: '',
          country: 'South Africa'
        }
      },

      // Default values
      rating: initialRating,
      status: data.status || SupplierStatus.PENDING,
      isPreferred: false,
      categories: data.categories || [],

      // Compliance
      complianceStatus: {
        taxCompliant: false,
        beeCompliant: false,
        insuranceValid: false,
        documentsVerified: false
      },

      // Metadata
      documents: [],
      createdAt: now,
      updatedAt: now,
      createdBy: 'current-user-id', // TODO: Get from auth context
      updatedBy: 'current-user-id'
    };
  }
}
