import { neonService } from '@/services/neonService';
import type { NeonPole, PoleFilters } from '../types/pole.types';
import { POLE_QUERIES } from '../queries/poleQueries';

export class PoleDataService {
  /**
   * Get all poles for a project
   */
  async getPolesByProject(projectId: string): Promise<NeonPole[]> {
    const result = await neonService.query<NeonPole>(POLE_QUERIES.getPolesByProject, [projectId]);
    
    if (result.success) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to fetch poles');
  }

  /**
   * Get a single pole by ID
   */
  async getPoleById(id: number): Promise<NeonPole | null> {
    const result = await neonService.query<NeonPole>(POLE_QUERIES.getPoleById, [id]);
    
    if (result.success && result.data.length > 0) {
      return result.data[0];
    }
    return null;
  }

  /**
   * Search poles with filters
   */
  async searchPoles(filters: PoleFilters): Promise<NeonPole[]> {
    let query = POLE_QUERIES.searchPolesBase;
    const params: (string | number)[] = [];
    let paramIndex = 1;
    
    if (filters.projectId) {
      query += ` AND p.project_id = $${paramIndex++}`;
      params.push(filters.projectId);
    }
    
    if (filters.status) {
      query += ` AND p.status = $${paramIndex++}`;
      params.push(filters.status);
    }
    
    if (filters.phase) {
      query += ` AND p.phase = $${paramIndex++}`;
      params.push(filters.phase);
    }
    
    if (filters.search) {
      query += ` AND (p.pole_number ILIKE $${paramIndex} OR p.location ILIKE $${paramIndex})`;
      params.push(`%${filters.search}%`);
      paramIndex++;
    }
    
    query += ` GROUP BY p.id ORDER BY p.pole_number`;
    
    const result = await neonService.query<NeonPole>(query, params);
    
    if (result.success) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to search poles');
  }

  /**
   * Update pole status
   */
  async updatePoleStatus(id: number, status: string): Promise<void> {
    const result = await neonService.execute(POLE_QUERIES.updatePoleStatus, [status, id]);
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to update pole status');
    }
  }

  /**
   * Bulk import poles from CSV data
   */
  async bulkImportPoles(projectId: string, poles: { pole_number: string; location?: string }[]): Promise<number> {
    // Prepare bulk insert query
    const values = poles.map((_pole, index) => {
      const offset = index * 4;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
    }).join(', ');
    
    const query = POLE_QUERIES.bulkImportPoles.replace('{values}', values);
    
    // Flatten parameters
    const params = poles.flatMap(pole => [
      pole.pole_number,
      projectId,
      pole.location || '',
      'pending'
    ]);
    
    const result = await neonService.execute(query, params);
    
    if (result.success) {
      return poles.length;
    }
    
    throw new Error(result.error || 'Failed to import poles');
  }
}