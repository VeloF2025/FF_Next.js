/**
 * SOW Summary Service
 * Routes all database operations through API endpoints
 */

import { sowApi } from '@/services/api/sowApi';
import { log } from '@/lib/logger';

/**
 * SOW project summary service
 */
export class SOWSummaryService {
  /**
   * Update project summary via API
   */
  static async updateProjectSummary(projectId: string): Promise<{ success: boolean; error?: unknown }> {
    try {
      // The API will handle the summary update when data is uploaded
      // We can trigger a summary refresh by fetching the data
      const result = await sowApi.getProjectSOWData(projectId);
      
      return { success: result.success === true };
    } catch (error) {
      log.error('Error updating project summary:', { data: error }, 'summaryService');
      // Non-critical error, don't throw
      return { success: false, error };
    }
  }

  /**
   * Get project summary data via API
   */
  static async getProjectSummary(projectId: string) {
    try {
      const result = await sowApi.getSOWSummary([projectId]);
      
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to fetch summary');
      }

      // Find the summary for the requested project
      const projectSummary = Array.isArray(result.data) 
        ? result.data.find((s: { project_id?: string }) => s.project_id === projectId)
        : result.data;

      return {
        success: true,
        data: projectSummary || null
      };
    } catch (error) {
      log.error('Error fetching project summary:', { data: error }, 'summaryService');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        data: null
      };
    }
  }

  /**
   * Get all project summaries via API
   */
  static async getAllProjectSummaries() {
    try {
      const result = await sowApi.getSOWSummary();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch summaries');
      }

      return {
        success: true,
        data: result.data || []
      };
    } catch (error) {
      log.error('Error fetching all project summaries:', { data: error }, 'summaryService');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        data: []
      };
    }
  }
}