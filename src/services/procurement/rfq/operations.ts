/**
 * RFQ Operations Service
 * Core CRUD operations for RFQ management
 * Fully migrated to use Neon PostgreSQL
 */

import { RFQ, RFQFormData, RFQStatus, RFQItem } from '@/types/procurement.types';
import { RFQCrud } from './rfqCrud';
import type { RfqSubmitResponse, RfqNotificationInput } from './index';
import { log } from '@/lib/logger';

/**
 * RFQ Operations - Direct delegation to RFQCrud for backward compatibility
 */
export class RFQOperations {
  /**
   * Get all RFQs with optional filtering
   */
  static async getAll(filter?: { 
    projectId?: string; 
    status?: RFQStatus; 
    supplierId?: string 
  }): Promise<RFQ[]> {
    try {
      return await RFQCrud.getAll(filter);
    } catch (error) {
      log.error('Error fetching RFQs:', { data: error }, 'operations');
      throw error;
    }
  }

  /**
   * Get RFQ by ID
   */
  static async getById(id: string): Promise<RFQ> {
    try {
      return await RFQCrud.getById(id);
    } catch (error) {
      log.error('Error fetching RFQ:', { data: error }, 'operations');
      throw error;
    }
  }

  /**
   * Create a new RFQ
   */
  static async create(data: RFQFormData): Promise<string> {
    try {
      return await RFQCrud.create(data);
    } catch (error) {
      log.error('Error creating RFQ:', { data: error }, 'operations');
      throw error;
    }
  }

  /**
   * Update an existing RFQ
   */
  static async update(id: string, data: Partial<RFQFormData>): Promise<void> {
    try {
      await RFQCrud.update(id, data);
    } catch (error) {
      log.error('Error updating RFQ:', { data: error }, 'operations');
      throw error;
    }
  }

  /**
   * Delete an RFQ
   */
  static async delete(id: string): Promise<void> {
    try {
      await RFQCrud.delete(id);
    } catch (error) {
      log.error('Error deleting RFQ:', { data: error }, 'operations');
      throw error;
    }
  }

  /**
   * Update RFQ status
   */
  static async updateStatus(id: string, status: RFQStatus, userId?: string): Promise<void> {
    try {
      await RFQCrud.updateStatus(id, status, userId);
    } catch (error) {
      log.error('Error updating RFQ status:', { data: error }, 'operations');
      throw error;
    }
  }

  /**
   * Get RFQs by project ID
   */
  static async getByProjectId(projectId: string): Promise<RFQ[]> {
    try {
      return await RFQCrud.getByProject(projectId);
    } catch (error) {
      log.error('Error fetching RFQs by project:', { data: error }, 'operations');
      throw error;
    }
  }

  /**
   * Get RFQs by status
   */
  static async getByStatus(status: RFQStatus): Promise<RFQ[]> {
    try {
      return await RFQCrud.getByStatus(status);
    } catch (error) {
      log.error('Error fetching RFQs by status:', { data: error }, 'operations');
      throw error;
    }
  }

  /**
   * Generate unique RFQ number
   */
  static generateRFQNumber(): string {
    return `RFQ-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
  }

  /**
   * Check if RFQ exists
   */
  static async exists(id: string): Promise<boolean> {
    try {
      return await RFQCrud.exists(id);
    } catch (error) {
      log.error('Error checking RFQ existence:', { data: error }, 'operations');
      return false;
    }
  }

  /**
   * Get active RFQs
   */
  static async getActive(): Promise<RFQ[]> {
    try {
      return await RFQCrud.getActive();
    } catch (error) {
      log.error('Error fetching active RFQs:', { data: error }, 'operations');
      throw error;
    }
  }

  /**
   * Add items to RFQ
   */
  static async addItems(rfqId: string, items: RFQItem[]): Promise<void> {
    try {
      await RFQCrud.addItems(rfqId, items);
    } catch (error) {
      log.error('Error adding RFQ items:', { data: error }, 'operations');
      throw error;
    }
  }

  /**
   * Get RFQ items
   */
  static async getItems(rfqId: string): Promise<RFQItem[]> {
    try {
      return await RFQCrud.getItems(rfqId);
    } catch (error) {
      log.error('Error fetching RFQ items:', { data: error }, 'operations');
      throw error;
    }
  }

  /**
   * Submit RFQ response
   */
  static async submitResponse(rfqId: string, response: RfqSubmitResponse): Promise<string> {
    try {
      return await RFQCrud.submitResponse(rfqId, response);
    } catch (error) {
      log.error('Error submitting RFQ response:', { data: error }, 'operations');
      throw error;
    }
  }

  /**
   * Get RFQ responses
   */
  static async getResponses(rfqId: string): Promise<RfqSubmitResponse[]> {
    try {
      return await RFQCrud.getResponses(rfqId);
    } catch (error) {
      log.error('Error fetching RFQ responses:', { data: error }, 'operations');
      throw error;
    }
  }

  /**
   * Create RFQ notification
   */
  static async createNotification(rfqId: string, notification: RfqNotificationInput): Promise<void> {
    try {
      await RFQCrud.createNotification(rfqId, notification);
    } catch (error) {
      log.error('Error creating RFQ notification:', { data: error }, 'operations');
      throw error;
    }
  }
}