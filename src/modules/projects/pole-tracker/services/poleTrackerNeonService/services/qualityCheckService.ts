import { neonService } from '@/services/neonService';
import type { NeonPole } from '../types/pole.types';

export class QualityCheckService {
  /**
   * Update pole quality checks
   */
  async updateQualityChecks(id: number, checks: Partial<NeonPole>): Promise<void> {
    const updates: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;
    
    // Build dynamic update query
    if (checks.quality_pole_condition !== undefined) {
      updates.push(`quality_pole_condition = $${paramIndex++}`);
      params.push(checks.quality_pole_condition);
    }
    if (checks.quality_cable_routing !== undefined) {
      updates.push(`quality_cable_routing = $${paramIndex++}`);
      params.push(checks.quality_cable_routing);
    }
    if (checks.quality_connector !== undefined) {
      updates.push(`quality_connector = $${paramIndex++}`);
      params.push(checks.quality_connector);
    }
    if (checks.quality_labeling !== undefined) {
      updates.push(`quality_labeling = $${paramIndex++}`);
      params.push(checks.quality_labeling);
    }
    if (checks.quality_grounding !== undefined) {
      updates.push(`quality_grounding = $${paramIndex++}`);
      params.push(checks.quality_grounding);
    }
    if (checks.quality_height !== undefined) {
      updates.push(`quality_height = $${paramIndex++}`);
      params.push(checks.quality_height);
    }
    if (checks.quality_tension !== undefined) {
      updates.push(`quality_tension = $${paramIndex++}`);
      params.push(checks.quality_tension);
    }
    if (checks.quality_documentation !== undefined) {
      updates.push(`quality_documentation = $${paramIndex++}`);
      params.push(checks.quality_documentation);
    }
    
    if (updates.length === 0) return;
    
    updates.push(`updated_at = NOW()`);
    params.push(id);
    
    const query = `
      UPDATE sow_poles 
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
    `;
    
    const result = await neonService.execute(query, params);
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to update quality checks');
    }
  }
}