import { neonService } from '@/services/neonService';
import type { ProjectStatistics } from '../types/pole.types';
import { POLE_QUERIES } from '../queries/poleQueries';

export class StatisticsService {
  /**
   * Get statistics for a project
   */
  async getProjectStatistics(projectId: string): Promise<ProjectStatistics> {
    const result = await neonService.query(POLE_QUERIES.getProjectStatistics, [projectId]);
    
    if (result.success && result.data.length > 0) {
      return result.data[0] as ProjectStatistics;
    }
    
    return {
      total_poles: 0,
      completed_poles: 0,
      in_progress_poles: 0,
      pending_poles: 0,
      issue_poles: 0,
      average_quality_score: 0
    };
  }

  /**
   * Get completion percentage for a project
   */
  async getCompletionPercentage(projectId: string): Promise<number> {
    const stats = await this.getProjectStatistics(projectId);
    
    if (stats.total_poles === 0) return 0;
    
    return (stats.completed_poles / stats.total_poles) * 100;
  }

  /**
   * Get poles requiring sync
   */
  async getPendingSync(projectId: string): Promise<unknown[]> {
    const result = await neonService.query(
      POLE_QUERIES.getPendingSync,
      [projectId, 'pending']
    );
    return result.success ? result.data : [];
  }
}