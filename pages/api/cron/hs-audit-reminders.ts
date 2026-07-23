/**
 * H&S Overdue-Audit Reminders Cron
 *
 * POST /api/cron/hs-audit-reminders
 * Auth: x-cron-secret header (CRON_SECRET env) — fail closed.
 *
 * For every active hs_project_config whose next_audit_due is in the past,
 * creates (or refreshes) an Action Centre item so overdue weekly audits are
 * actually surfaced to someone. Deduped on (source_type='hs_audit_overdue',
 * source_id=config.id) with an open status — re-runs never spam. Items whose
 * config is no longer overdue (audit completed → next_audit_due advanced)
 * are auto-completed.
 *
 * Suggested crontab (velo, dev — install is gated, see goal §8.3):
 *   40 6 * * 1-6 curl -s -X POST -H "x-cron-secret: $CRON_SECRET" http://localhost:3005/api/cron/hs-audit-reminders
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

const SOURCE_TYPE = 'hs_audit_overdue';

/** timestamptz comes back from the pg driver as a JS Date — format explicitly */
function isoDate(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

interface OverdueConfig {
  id: string;
  project_id: string;
  project_name: string;
  next_audit_due: string;
  audit_frequency: string;
  days_overdue: number;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify cron secret (mandatory — fail closed if not configured)
  const cronSecret = req.headers['x-cron-secret'];
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    log.error('[hs-audit-reminders] CRON_SECRET not configured — rejecting');
    return apiResponse.error(res, ErrorCode.SERVICE_UNAVAILABLE, 'Cron endpoint misconfigured');
  }
  if (cronSecret !== expectedSecret) {
    return apiResponse.unauthorized(res, 'Invalid cron secret');
  }

  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  try {
    const overdue = (await sql`
      SELECT c.id, c.project_id, p.project_name, c.next_audit_due,
             c.audit_frequency,
             GREATEST(0, (NOW()::date - c.next_audit_due::date))::int AS days_overdue
      FROM hs_project_config c
      JOIN projects p ON p.id = c.project_id
      WHERE c.is_active = true
        AND c.next_audit_due < NOW()
      ORDER BY c.next_audit_due
    `) as unknown as OverdueConfig[];

    let created = 0;
    let refreshed = 0;

    for (const cfg of overdue) {
      const description = `H&S audit overdue for ${cfg.project_name}: was due ${isoDate(cfg.next_audit_due)} (${cfg.days_overdue} days overdue, ${cfg.audit_frequency} schedule)`;

      const [existing] = await sql`
        SELECT id FROM action_items
        WHERE source_type = ${SOURCE_TYPE}
          AND source_id = ${cfg.id}
          AND status IN ('pending', 'in_progress')
        LIMIT 1
      `;

      if (existing) {
        await sql`
          UPDATE action_items
          SET description = ${description},
              due_date = ${cfg.next_audit_due},
              updated_at = NOW()
          WHERE id = ${existing.id}
        `;
        refreshed++;
      } else {
        await sql`
          INSERT INTO action_items (
            description, source, source_type, source_id, project_id,
            priority, status, due_date, category
          ) VALUES (
            ${description},
            'system',
            ${SOURCE_TYPE},
            ${cfg.id},
            ${cfg.project_id},
            'high',
            'pending',
            ${cfg.next_audit_due},
            'Health & Safety'
          )
        `;
        created++;
      }
    }

    // Auto-complete items whose config is no longer overdue. Explicit branches
    // (no conditional SQL fragments through the shim).
    let resolvedRows;
    if (overdue.length > 0) {
      const overdueIds = overdue.map((c) => c.id);
      resolvedRows = await sql`
        UPDATE action_items
        SET status = 'completed', completed_date = NOW(), updated_at = NOW(),
            notes = COALESCE(notes || E'\n', '') || 'Auto-completed: audit no longer overdue'
        WHERE source_type = ${SOURCE_TYPE}
          AND status IN ('pending', 'in_progress')
          AND NOT (source_id = ANY(${overdueIds}))
        RETURNING id
      `;
    } else {
      resolvedRows = await sql`
        UPDATE action_items
        SET status = 'completed', completed_date = NOW(), updated_at = NOW(),
            notes = COALESCE(notes || E'\n', '') || 'Auto-completed: audit no longer overdue'
        WHERE source_type = ${SOURCE_TYPE}
          AND status IN ('pending', 'in_progress')
        RETURNING id
      `;
    }

    log.info('[hs-audit-reminders] run complete', {
      overdue: overdue.length,
      created,
      refreshed,
      resolved: resolvedRows.length,
    });

    return apiResponse.success(res, {
      overdue: overdue.length,
      created,
      refreshed,
      resolved: resolvedRows.length,
      projects: overdue.map((c) => ({
        project: c.project_name,
        due: isoDate(c.next_audit_due),
        days_overdue: c.days_overdue,
      })),
    });
  } catch (error) {
    log.error('[hs-audit-reminders] failed', { error });
    return apiResponse.internalError(res, error);
  }
}
