import { query, transaction, type TxnClient } from '@/lib/db-pool';
import type { OperationalSite } from './types';

export interface ProjectSiteActor {
  userId: string;
}

export interface CreateProjectSiteInput {
  projectId: string;
  displayName?: string;
  projectAoiId: string | null;
  authorizedLocationId: string | null;
  isDefault: boolean;
}

export interface UpdateProjectSiteInput {
  projectId?: string;
  displayName?: string;
  isDefault?: boolean;
  isActive?: boolean;
}

interface ProjectSiteRow extends Record<string, unknown> {
  id: string;
  project_id: string;
  display_name: string;
  project_aoi_id: string | null;
  authorized_location_id: string | null;
  is_default: boolean;
  is_active: boolean;
}

interface AoiSourceRow extends Record<string, unknown> {
  id: string;
  site_code: string;
  area_name: string;
}

interface LocationSourceRow extends Record<string, unknown> {
  id: string;
  name: string;
}

export class ProjectSiteValidationError extends Error {
  constructor(
    public readonly code: 'invalid_source' | 'inactive_source' | 'invalid_update',
    message: string,
  ) {
    super(message);
    this.name = 'ProjectSiteValidationError';
  }
}

function mapSite(row: ProjectSiteRow): OperationalSite {
  return {
    id: row.id,
    projectId: row.project_id,
    displayName: row.display_name,
    projectAoiId: row.project_aoi_id,
    authorizedLocationId: row.authorized_location_id,
    isDefault: row.is_default,
    isActive: row.is_active,
  };
}

function snapshot(site: OperationalSite): Record<string, unknown> {
  return {
    id: site.id,
    projectId: site.projectId,
    displayName: site.displayName,
    projectAoiId: site.projectAoiId,
    authorizedLocationId: site.authorizedLocationId,
    isDefault: site.isDefault,
    isActive: site.isActive,
  };
}

function validateExactlyOneSource(input: CreateProjectSiteInput): void {
  const sourceCount = Number(Boolean(input.projectAoiId)) + Number(Boolean(input.authorizedLocationId));
  if (sourceCount !== 1) {
    throw new ProjectSiteValidationError(
      'invalid_source',
      'Exactly one of projectAoiId and authorizedLocationId is required',
    );
  }
}

async function resolveSourceDisplayName(txn: TxnClient, input: CreateProjectSiteInput): Promise<string> {
  if (input.projectAoiId) {
    const source = await txn.queryOne<AoiSourceRow>(`
      SELECT id, site_code, area_name
      FROM fno_atlas_project_aois
      WHERE id = $1::uuid AND retired_at IS NULL
      LIMIT 1`, [input.projectAoiId]);
    if (!source) {
      throw new ProjectSiteValidationError('inactive_source', 'The selected project AOI is missing or inactive');
    }
    return `${source.site_code} — ${source.area_name}`;
  }

  const source = await txn.queryOne<LocationSourceRow>(`
    SELECT id, name
    FROM fleet_authorized_locations
    WHERE id = $1::uuid AND is_active = true
    LIMIT 1`, [input.authorizedLocationId]);
  if (!source) {
    throw new ProjectSiteValidationError(
      'inactive_source',
      'The selected Authorized Location is missing or inactive',
    );
  }
  return source.name;
}

async function lockAndClearDefault(txn: TxnClient, projectId: string): Promise<void> {
  await txn.query(`
    SELECT id
    FROM fleet_project_operational_sites
    WHERE project_id = $1::uuid AND is_active = true
    FOR UPDATE`, [projectId]);
  await txn.query(`
    UPDATE fleet_project_operational_sites
    SET is_default = false, updated_at = NOW()
    WHERE project_id = $1::uuid AND is_active = true AND is_default = true`, [projectId]);
}

async function insertAudit(
  txn: TxnClient,
  siteId: string,
  action: 'created' | 'default_changed' | 'deactivated',
  actor: ProjectSiteActor,
  before: OperationalSite | null,
  after: OperationalSite,
): Promise<void> {
  await txn.query(`
    INSERT INTO fleet_project_operational_site_audit (
      operational_site_id, action, actor_user_id, before_snapshot, after_snapshot
    ) VALUES ($1::uuid, $2, $3::uuid, $4::jsonb, $5::jsonb)`, [
    siteId,
    action,
    actor.userId,
    before ? JSON.stringify(snapshot(before)) : null,
    JSON.stringify(snapshot(after)),
  ]);
}

export async function listProjectSites(
  projectId: string,
  includeInactive: boolean,
): Promise<OperationalSite[]> {
  const baseSql = `
    SELECT ops.id, ops.project_id, ops.display_name, ops.project_aoi_id,
      ops.authorized_location_id, ops.is_default, ops.is_active
    FROM fleet_project_operational_sites ops
    WHERE ops.project_id = $1::uuid`;
  const rows = includeInactive
    ? await query<ProjectSiteRow>(`${baseSql}
        ORDER BY ops.is_active DESC, ops.is_default DESC, ops.display_name`, [projectId])
    : await query<ProjectSiteRow>(`${baseSql}
        AND ops.is_active = true
        ORDER BY ops.is_default DESC, ops.display_name`, [projectId]);
  return rows.map(mapSite);
}

export async function createProjectSite(
  input: CreateProjectSiteInput,
  actor: ProjectSiteActor,
): Promise<OperationalSite> {
  validateExactlyOneSource(input);
  const requestedName = input.displayName?.trim();
  if (input.displayName !== undefined && !requestedName) {
    throw new ProjectSiteValidationError('invalid_update', 'displayName cannot be blank');
  }

  return transaction(async (txn) => {
    const sourceDisplayName = await resolveSourceDisplayName(txn, input);
    if (input.isDefault) await lockAndClearDefault(txn, input.projectId);

    const row = await txn.queryOne<ProjectSiteRow>(`
      INSERT INTO fleet_project_operational_sites (
        project_id, display_name, project_aoi_id, authorized_location_id,
        is_default, is_active, created_by
      ) VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5, true, $6::uuid)
      RETURNING id, project_id, display_name, project_aoi_id,
        authorized_location_id, is_default, is_active`, [
      input.projectId,
      requestedName ?? sourceDisplayName,
      input.projectAoiId,
      input.authorizedLocationId,
      input.isDefault,
      actor.userId,
    ]);
    if (!row) throw new Error('Project operational site insert returned no row');

    const created = mapSite(row);
    await insertAudit(txn, created.id, 'created', actor, null, created);
    return created;
  });
}

export async function updateProjectSite(
  siteId: string,
  input: UpdateProjectSiteInput,
  actor: ProjectSiteActor,
): Promise<OperationalSite | null> {
  const displayName = input.displayName?.trim();
  if (input.displayName !== undefined && !displayName) {
    throw new ProjectSiteValidationError('invalid_update', 'displayName cannot be blank');
  }

  return transaction(async (txn) => {
    const currentRow = await txn.queryOne<ProjectSiteRow>(`
      SELECT id, project_id, display_name, project_aoi_id, authorized_location_id,
        is_default, is_active
      FROM fleet_project_operational_sites
      WHERE id = $1::uuid
        AND ($2::uuid IS NULL OR project_id = $2::uuid)
      FOR UPDATE`, [siteId, input.projectId ?? null]);
    if (!currentRow) return null;

    const before = mapSite(currentRow);
    const nextActive = input.isActive ?? before.isActive;
    const nextDefault = nextActive ? (input.isDefault ?? before.isDefault) : false;
    if (nextDefault && !nextActive) {
      throw new ProjectSiteValidationError('invalid_update', 'An inactive site cannot be default');
    }
    if (nextDefault && (!before.isDefault || !before.isActive)) {
      await lockAndClearDefault(txn, before.projectId);
    }

    const updatedRow = await txn.queryOne<ProjectSiteRow>(`
      UPDATE fleet_project_operational_sites
      SET display_name = COALESCE($2, display_name),
        is_active = $3,
        is_default = CASE WHEN $3 THEN $4 ELSE false END,
        updated_at = NOW()
      WHERE id = $1::uuid
      RETURNING id, project_id, display_name, project_aoi_id,
        authorized_location_id, is_default, is_active`, [siteId, displayName ?? null, nextActive, nextDefault]);
    if (!updatedRow) return null;

    const updated = mapSite(updatedRow);
    if (before.isActive && !updated.isActive) {
      await insertAudit(txn, siteId, 'deactivated', actor, before, updated);
    } else if (before.isDefault !== updated.isDefault) {
      await insertAudit(txn, siteId, 'default_changed', actor, before, updated);
    }
    return updated;
  });
}
