/**
 * API Route: /api/projects/[projectId]/prereqs
 *
 * GET: Returns all project pre-requisites grouped by phase
 * PATCH: Updates a single pre-req item (completion status, notes)
 *
 * Response: PrereqsResponse
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import type {
  PrereqsResponse,
  PrereqPhaseGroup,
  PrereqItem,
  PrereqPhase,
} from '@/types/pon-stages.types';
import { PREREQ_PHASE_LABELS } from '@/types/pon-stages.types';

/** Map DB stage values to prereq phases */
const STAGE_TO_PHASE: Record<string, PrereqPhase> = {
  pipeline: 'site_assignments',
  planning: 'site_establishment',
  execution: 'key_milestones',
  closure: 'key_milestones',
};

/** Map template phases to prereq phases (when template_id exists) */
function resolvePhase(stage: string, templatePhase: string | null): PrereqPhase {
  if (templatePhase && templatePhase in PREREQ_PHASE_LABELS) {
    return templatePhase as PrereqPhase;
  }
  return STAGE_TO_PHASE[stage] || 'prerequisites';
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PrereqsResponse | { success: boolean; data?: unknown; error?: string }>
) {
  const { projectId } = req.query;
  const projectIdStr = Array.isArray(projectId) ? projectId[0] : projectId;

  if (!projectIdStr) {
    return res.status(400).json({ success: false, error: 'Missing projectId' });
  }

  if (req.method === 'GET') {
    return handleGet(req, res, projectIdStr);
  }

  if (req.method === 'PATCH') {
    return handlePatch(req, res, projectIdStr);
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

async function handleGet(
  _req: NextApiRequest,
  res: NextApiResponse<PrereqsResponse | { success: boolean; error: string }>,
  projectId: string
) {
  try {
    const client = await pool.connect();
    try {
      // Get project name
      const projectResult = await client.query<{ project_name: string }>(
        'SELECT project_name FROM projects WHERE id = $1',
        [projectId]
      );

      if (projectResult.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Project not found' });
      }

      const projectName = projectResult.rows[0]!.project_name;

      // Fetch all requirements for this project
      const reqResult = await client.query<{
        id: string;
        requirement_type: string;
        requirement_name: string;
        description: string | null;
        stage: string;
        sort_order: number;
        is_completed: boolean;
        completed_at: string | null;
        completed_by: string | null;
        responsible_party: string | null;
        document_url: string | null;
        notes: string | null;
        template_id: string | null;
        template_phase: string | null;
      }>(
        `SELECT
           r.id, r.requirement_type, r.requirement_name, r.description,
           r.stage, r.sort_order, r.is_completed,
           r.completed_at::text, r.completed_by,
           r.responsible_party, r.document_url, r.notes,
           r.template_id::text,
           t.phase as template_phase
         FROM project_requirements r
         LEFT JOIN project_prereq_templates t ON t.id = r.template_id
         WHERE r.project_id = $1
         ORDER BY r.sort_order, r.created_at`,
        [projectId]
      );

      // Group by phase
      const phaseMap = new Map<PrereqPhase, PrereqItem[]>();

      for (const row of reqResult.rows) {
        const phase = resolvePhase(row.stage, row.template_phase);

        const item: PrereqItem = {
          id: row.id,
          requirement_type: row.requirement_type,
          requirement_name: row.requirement_name,
          description: row.description,
          stage: row.stage,
          sort_order: row.sort_order,
          is_completed: row.is_completed,
          completed_at: row.completed_at,
          completed_by: row.completed_by,
          responsible_party: row.responsible_party,
          document_url: row.document_url,
          notes: row.notes,
          template_id: row.template_id,
        };

        const existing = phaseMap.get(phase);
        if (existing) {
          existing.push(item);
        } else {
          phaseMap.set(phase, [item]);
        }
      }

      // Build phase groups in order
      const phaseOrder: PrereqPhase[] = [
        'site_assignments', 'prerequisites', 'site_establishment',
        'contractor_engagements', 'key_milestones',
      ];

      const phases: PrereqPhaseGroup[] = [];
      let overallTotal = 0;
      let overallCompleted = 0;

      for (const phase of phaseOrder) {
        const items = phaseMap.get(phase) || [];
        const total = items.length;
        const completed = items.filter(i => i.is_completed).length;
        overallTotal += total;
        overallCompleted += completed;

        if (total > 0) {
          phases.push({
            phase,
            phase_label: PREREQ_PHASE_LABELS[phase],
            items,
            total,
            completed,
            pct: total > 0 ? Math.round((completed / total) * 10000) / 100 : 0,
          });
        }
      }

      const response: PrereqsResponse = {
        project_id: projectId,
        project_name: projectName,
        phases,
        overall: {
          total: overallTotal,
          completed: overallCompleted,
          pct: overallTotal > 0 ? Math.round((overallCompleted / overallTotal) * 10000) / 100 : 0,
        },
      };

      return res.status(200).json(response);
    } finally {
      client.release();
    }
  } catch (error) {
    log.error('Failed to fetch prereqs', { error, projectId }, 'Prereqs');
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

async function handlePatch(
  req: NextApiRequest,
  res: NextApiResponse<{ success: boolean; data?: unknown; error?: string }>,
  projectId: string
) {
  const { reqId, is_completed, notes, completed_by } = req.body as {
    reqId?: string;
    is_completed?: boolean;
    notes?: string;
    completed_by?: string;
  };

  if (!reqId) {
    return res.status(400).json({ success: false, error: 'Missing reqId in body' });
  }

  try {
    const client = await pool.connect();
    try {
      // Build update fields
      const updates: string[] = [];
      const params: unknown[] = [reqId, projectId];
      let paramIdx = 3;

      if (is_completed !== undefined) {
        updates.push(`is_completed = $${paramIdx}`);
        params.push(is_completed);
        paramIdx++;

        if (is_completed) {
          updates.push(`completed_at = NOW()`);
          if (completed_by) {
            updates.push(`completed_by = $${paramIdx}`);
            params.push(completed_by);
            paramIdx++;
          }
        } else {
          updates.push(`completed_at = NULL`);
          updates.push(`completed_by = NULL`);
        }
      }

      if (notes !== undefined) {
        updates.push(`notes = $${paramIdx}`);
        params.push(notes);
        paramIdx++;
      }

      if (updates.length === 0) {
        return res.status(400).json({ success: false, error: 'No fields to update' });
      }

      const result = await client.query(
        `UPDATE project_requirements
         SET ${updates.join(', ')}, updated_at = NOW()
         WHERE id = $1 AND project_id = $2
         RETURNING id, is_completed, completed_at::text, notes`,
        params
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Requirement not found' });
      }

      log.info('Requirement updated', { reqId, projectId, is_completed }, 'Prereqs');

      return res.status(200).json({ success: true, data: result.rows[0] });
    } finally {
      client.release();
    }
  } catch (error) {
    log.error('Failed to update prereq', { error, reqId, projectId }, 'Prereqs');
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

export default withAuth(handler);
