/**
 * SOW Query Service
 * Routes all database operations through API endpoints
 */

import { sowApi } from '@/services/api/sowApi';
import { SOWData, SOWOperationResult } from './types';
import { log } from '@/lib/logger';

/**
 * SOW data query service
 */
export class SOWQueryService {
  /**
   * Get all project SOW data from API
   */
  static async getProjectSOWData(projectId: string): Promise<SOWOperationResult> {
    try {
      const result = await sowApi.getProjectSOWData(projectId);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch SOW data');
      }

      const data: SOWData = {
        poles: result.data?.poles || [],
        drops: result.data?.drops || [],
        fibre: result.data?.fibre || [],
        summary: result.data?.summary || null
      };

      return {
        success: true,
        data
      };
    } catch (error) {
      log.error('Error fetching SOW data from API:', { data: error }, 'queryService');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        data: {
          poles: [],
          drops: [],
          fibre: [],
          summary: null
        }
      };
    }
  }

  /**
   * Get poles data for a project
   */
  static async getProjectPoles(projectId: string) {
    try {
      const result = await sowApi.getPoles(projectId);
      
      return {
        success: result.success,
        data: result.data || [],
        error: result.error
      };
    } catch (error) {
      log.error('Error fetching poles data:', { data: error }, 'queryService');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        data: []
      };
    }
  }

  /**
   * Get drops data for a project
   */
  static async getProjectDrops(projectId: string) {
    try {
      const result = await sowApi.getDrops(projectId);
      
      return {
        success: result.success,
        data: result.data || [],
        error: result.error
      };
    } catch (error) {
      log.error('Error fetching drops data:', { data: error }, 'queryService');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        data: []
      };
    }
  }

  /**
   * Get fibre data for a project
   */
  static async getProjectFibre(projectId: string) {
    try {
      const result = await sowApi.getFibre(projectId);
      
      return {
        success: result.success,
        data: result.data || [],
        error: result.error
      };
    } catch (error) {
      log.error('Error fetching fibre data:', { data: error }, 'queryService');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        data: []
      };
    }
  }

  /**
   * Search poles by criteria
   */
  static async searchPoles(projectId: string, searchTerm: string) {
    try {
      // Use the general poles endpoint with client-side filtering
      // In production, you'd want to add a search endpoint to the API
      const result = await sowApi.getPoles(projectId);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch poles');
      }

      const searchLower = searchTerm.toLowerCase();
      type PoleRecord = { pole_number?: string; address?: string; municipality?: string; status?: string };
      const filteredPoles = (result.data || []).filter((pole: PoleRecord) =>
        pole.pole_number?.toLowerCase().includes(searchLower) ||
        pole.address?.toLowerCase().includes(searchLower) ||
        pole.municipality?.toLowerCase().includes(searchLower) ||
        pole.status?.toLowerCase().includes(searchLower)
      );
      
      return {
        success: true,
        data: filteredPoles
      };
    } catch (error) {
      log.error('Error searching poles:', { data: error }, 'queryService');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        data: []
      };
    }
  }

  /**
   * Search drops by criteria
   */
  static async searchDrops(projectId: string, searchTerm: string) {
    try {
      // Use the general drops endpoint with client-side filtering
      // In production, you'd want to add a search endpoint to the API
      const result = await sowApi.getDrops(projectId);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch drops');
      }

      const searchLower = searchTerm.toLowerCase();
      type DropRecord = { drop_number?: string; pole_number?: string; cable_type?: string; address?: string };
      const filteredDrops = (result.data || []).filter((drop: DropRecord) =>
        drop.drop_number?.toLowerCase().includes(searchLower) ||
        drop.pole_number?.toLowerCase().includes(searchLower) ||
        drop.cable_type?.toLowerCase().includes(searchLower) ||
        drop.address?.toLowerCase().includes(searchLower)
      );
      
      return {
        success: true,
        data: filteredDrops
      };
    } catch (error) {
      log.error('Error searching drops:', { data: error }, 'queryService');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        data: []
      };
    }
  }
}