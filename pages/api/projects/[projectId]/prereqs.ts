/**
 * API Route: /api/projects/[projectId]/prereqs
 *
 * GET: Returns all project pre-requisites grouped by phase
 * PATCH: Updates a single pre-req item (completion status, notes)
 *
 * Response: PrereqsResponse
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type { PoolClient } from 'pg';
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

/**
 * Run auto-detection queries in parallel.
 * Returns a map of requirement_type → boolean (met or not).
 */
async function getAutoDetectionResults(
  client: PoolClient,
  projectId: string
): Promise<Record<string, boolean>> {
  const [po, boq, contractor, agreements, team, hs, budgetRow, dropsRow, sowUploaded] =
    await Promise.all([
      client.query<{ met: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM client_purchase_orders
         WHERE project_id = $1 AND status IN ('active','completed')) as met`,
        [projectId]
      ),
      client.query<{ met: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM boqs WHERE project_id = $1) as met`,
        [projectId]
      ),
      client.query<{ met: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM contractor_projects
         WHERE project_id = $1 AND is_active = true) as met`,
        [projectId]
      ),
      client.query<{ agreement_type: string }>(
        `SELECT DISTINCT agreement_type FROM contractor_agreements
         WHERE project_id = $1 AND status IN ('signed','active')`,
        [projectId]
      ),
      client.query<{ met: boolean }>(
        `SELECT EXISTS(
           SELECT 1 FROM staff_projects WHERE project_id = $1 AND is_active = true
           UNION ALL
           SELECT 1 FROM contractor_projects WHERE project_id = $1 AND is_active = true
         ) as met`,
        [projectId]
      ),
      client.query<{ met: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM hs_project_config
         WHERE project_id = $1 AND template_id IS NOT NULL) as met`,
        [projectId]
      ),
      client.query<{ budget: string | null }>(
        `SELECT budget FROM projects WHERE id = $1`,
        [projectId]
      ),
      client.query<{ target: string; actual: string }>(
        `SELECT COALESCE(cpo.contracted_drops, 0)::text as target,
                (SELECT COUNT(*)::text FROM drops WHERE project_id = $1) as actual
         FROM client_purchase_orders cpo
         WHERE cpo.project_id = $1 AND cpo.status = 'active' LIMIT 1`,
        [projectId]
      ),
      client.query<{ met: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM drops WHERE project_id = $1) as met`,
        [projectId]
      ),
    ]);

  const agreementTypes = new Set(agreements.rows.map(r => r.agreement_type));
  const target = Number(dropsRow.rows[0]?.target || 0);
  const actual = Number(dropsRow.rows[0]?.actual || 0);
  const hasPo = po.rows[0]?.met === true;
  const hasContractor = contractor.rows[0]?.met === true;
  const hasSow = agreementTypes.has('sow');
  const hasMba = agreementTypes.has('mba');
  const hasSowUploaded = sowUploaded.rows[0]?.met === true;

  return {
    // Activation-check seed types
    client_po: hasPo,
    boq_approved: boq.rows[0]?.met === true,
    contractor_appointed: hasContractor,
    sow_signed: hasSow,
    mba_signed: hasMba,
    client_agreement: agreements.rows.length > 0,
    team_assigned: team.rows[0]?.met === true,
    hs_verified: hs.rows[0]?.met === true,
    budget_approved: Number(budgetRow.rows[0]?.budget || 0) > 0,
    drops_complete: target > 0 && actual >= target,
    sow_uploaded: hasSowUploaded,
    // VF Standard template equivalents (same checks, different type names)
    po_received: hasPo,
    contractor_sow_signed: hasSow,
    contractor_mba_signed: hasMba,
  };
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

      // Fetch requirements + auto-detection in parallel
      const [reqResult, autoResults] = await Promise.all([
        client.query<{
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
        ),
        getAutoDetectionResults(client, projectId),
      ]);

      // Group by phase
      const phaseMap = new Map<PrereqPhase, PrereqItem[]>();

      for (const row of reqResult.rows) {
        const phase = resolvePhase(row.stage, row.template_phase);

        // Determine auto_status overlay
        let autoStatus: PrereqItem['auto_status'] = null;
        let isCompleted = row.is_completed;

        if (row.requirement_type in autoResults) {
          const autoMet = autoResults[row.requirement_type];
          if (autoMet) {
            isCompleted = true;
            autoStatus = 'auto';
          } else if (row.is_completed) {
            autoStatus = 'manual';
          }
        }

        const item: PrereqItem = {
          id: row.id,
          requirement_type: row.requirement_type,
          requirement_name: row.requirement_name,
          description: row.description,
          stage: row.stage,
          sort_order: row.sort_order,
          is_completed: isCompleted,
          completed_at: row.completed_at,
          completed_by: row.completed_by,
          responsible_party: row.responsible_party,
          document_url: row.document_url,
          notes: row.notes,
          template_id: row.template_id,
          auto_status: autoStatus,
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
