/**
 * H&S Activity Log — shim-safe write helper
 *
 * Single writer for hs_activity_log using the LIVE schema:
 *   (activity_type, entity_type, entity_id, description, metadata)
 *
 * The legacy migration-113 columns (action, actor_id, details) do NOT exist in
 * the live DB — writing them 500s the request after the main row has already
 * committed (phantom writes). The Neon shim cannot run transactions, so this
 * helper must be called AFTER the main write and must NEVER fail the request:
 * every error is swallowed and surfaced via log.warn only.
 *
 * The live user_id column is INTEGER (legacy staff reference) while app users
 * have UUID ids — the authenticated user is therefore recorded in metadata
 * (user_id / user_email), never in the user_id column.
 */

import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

export interface HsActivityEntry {
  /** e.g. 'incident_reported', 'risk_created', 'capa_status_changed' */
  activityType: string;
  /** e.g. 'hs_incident', 'risk', 'capa', 'checklist_template' */
  entityType?: string;
  /** UUID of the affected row */
  entityId?: string | null;
  description?: string;
  metadata?: Record<string, unknown>;
  /** Authenticated user (recorded in metadata — see header note) */
  user?: { id?: string; email?: string } | null;
}

export async function logHsActivity(entry: HsActivityEntry): Promise<void> {
  try {
    const metadata: Record<string, unknown> = { ...(entry.metadata ?? {}) };
    if (entry.user?.id) {
      metadata.user_id = entry.user.id;
      if (entry.user.email) {
        metadata.user_email = entry.user.email;
      }
    }

    await sql`
      INSERT INTO hs_activity_log (activity_type, entity_type, entity_id, description, metadata)
      VALUES (
        ${entry.activityType},
        ${entry.entityType ?? null},
        ${entry.entityId ?? null}::uuid,
        ${entry.description ?? null},
        ${JSON.stringify(metadata)}::jsonb
      )
    `;
  } catch (error) {
    log.warn('[H&S] activity log write failed (non-fatal)', {
      error,
      activityType: entry.activityType,
      entityId: entry.entityId,
    });
  }
}
