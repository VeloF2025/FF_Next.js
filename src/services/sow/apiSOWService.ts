/**
 * API-based SOW Service
 * Uses API endpoints instead of direct database access
 */

import { sowApi } from '@/services/api/sowApi';
import { NeonPoleData, NeonDropData, NeonFibreData, SOWOperationResult } from './types';
import { log } from '@/lib/logger';

export class ApiSOWService {
  /**
   * Initialize database tables for a project
   */
  async initializeTables(projectId: string): Promise<{ success: boolean }> {
    try {
      const result = await sowApi.initializeTables(projectId);
      return { success: result.success };
    } catch (error) {
      log.error('Failed to initialize SOW tables', { data: error }, 'ApiSOWService');
      return { success: false };
    }
  }

  /**
   * Upload poles data
   */
  async uploadPoles(projectId: string, poles: NeonPoleData[]): Promise<SOWOperationResult> {
    try {
      const result = await sowApi.uploadPoles(projectId, poles);
      return {
        success: result.success,
        message: result.message || `Uploaded ${result.upserted || 0} poles`,
        count: result.upserted || 0,
        error: (result.errors || []).join('; ') || undefined
      };
    } catch (error) {
      log.error('Failed to upload poles', { data: error }, 'ApiSOWService');
      return {
        success: false,
        message: 'Failed to upload poles',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Upload drops data
   */
  async uploadDrops(projectId: string, drops: NeonDropData[]): Promise<SOWOperationResult> {
    try {
      const result = await sowApi.uploadDrops(projectId, drops);
      return {
        success: result.success,
        message: result.message || `Uploaded ${result.upserted || 0} drops`,
        count: result.upserted || 0,
        error: (result.errors || []).join('; ') || undefined
      };
    } catch (error) {
      log.error('Failed to upload drops', { data: error }, 'ApiSOWService');
      return {
        success: false,
        message: 'Failed to upload drops',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Upload fibre data
   */
  async uploadFibre(projectId: string, fibres: NeonFibreData[]): Promise<SOWOperationResult> {
    try {
      const result = await sowApi.uploadFibre(projectId, fibres);
      return {
        success: result.success,
        message: result.message || `Uploaded ${result.upserted || 0} fibre sections`,
        count: result.upserted || 0,
        error: (result.errors || []).join('; ') || undefined
      };
    } catch (error) {
      log.error('Failed to upload fibre', { data: error }, 'ApiSOWService');
      return {
        success: false,
        message: 'Failed to upload fibre',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get all project SOW data
   */
  async getProjectSOWData(projectId: string) {
    try {
      const result = await sowApi.getProjectSOWData(projectId);
      return result;
    } catch (error) {
      log.error('Failed to get project SOW data', { data: error }, 'ApiSOWService');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        data: null
      };
    }
  }

  /**
   * Get poles data
   */
  async getPoles(projectId: string) {
    try {
      const result = await sowApi.getPoles(projectId);
      return result.data || [];
    } catch (error) {
      log.error('Failed to get poles', { data: error }, 'ApiSOWService');
      return [];
    }
  }

  /**
   * Get drops data
   */
  async getDrops(projectId: string) {
    try {
      const result = await sowApi.getDrops(projectId);
      return result.data || [];
    } catch (error) {
      log.error('Failed to get drops', { data: error }, 'ApiSOWService');
      return [];
    }
  }

  /**
   * Get fibre data
   */
  async getFibre(projectId: string) {
    try {
      const result = await sowApi.getFibre(projectId);
      return result.data || [];
    } catch (error) {
      log.error('Failed to get fibre', { data: error }, 'ApiSOWService');
      return [];
    }
  }

  /**
   * Check service health
   */
  async checkHealth() {
    try {
      const result = await sowApi.checkHealth();
      return result;
    } catch (error) {
      log.error('Failed to check SOW service health', { data: error }, 'ApiSOWService');
      return { success: false, error: 'Service unavailable' };
    }
  }
}

// Export singleton instance
export const apiSOWService = new ApiSOWService();