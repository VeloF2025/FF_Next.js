/**
 * Generic field-user create/list endpoint.
 *
 * POST /api/field/users — create a staff member with a given role.
 * GET  /api/field/users — list staff with optional filters.
 *
 * Role gate: only storeman, manager, admin, super_admin, system may access.
 * Technician and viewer are explicitly excluded (they share level-2 with storeman
 * so withRole('storeman') alone would admit technicians — we use a name allowlist).
 *
 * Role-aware pending status:
 *   - storeman/manager callers → account_status='pending'  (admin must approve)
 *   - admin/super_admin/system → account_status='active'
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth/middleware';
import type { AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import { logCreate } from '@/lib/db-logger';
import type { AuthRole } from '@/lib/auth/types';

// ── Constants ────────────────────────────────────────────────────────────────

/** Roles accepted as the `role` body field (staff.role column, NOT AuthRole). */
const ALLOWED_ROLES = ['technician', 'stores', 'supervisor', 'admin', 'driver', 'office'] as const;
type FieldUserRole = (typeof ALLOWED_ROLES)[number];

/**
 * AuthRoles permitted to call this endpoint.
 * Technician is intentionally excluded: it shares ROLE_HIERARCHY level 2 with
 * storeman, so a level-based gate cannot distinguish them.
 */
const PERMITTED_AUTH_ROLES = new Set<AuthRole>(['storeman', 'manager', 'admin', 'super_admin', 'system']);

/** AuthRoles that create accounts directly active (no approval required). */
const ADMIN_AUTH_ROLES = new Set<AuthRole>(['admin', 'super_admin', 'system']);

/** Prefix map for employee_id generation. */
const ROLE_UPPER_PREFIX: Record<FieldUserRole, string> = {
  technician: 'TECH',
  stores: 'STOR',
  supervisor: 'SUPV',
  admin: 'ADMN',
  driver: 'DRVR',
  office: 'OFFC',
};

// ── Department/position defaults ─────────────────────────────────────────────

function defaultDepartment(role: FieldUserRole): string {
  switch (role) {
    case 'technician':  return 'Field Operations';
    case 'stores':      return 'Stores & Warehouse';
    case 'supervisor':  return 'Field Operations';
    case 'driver':      return 'Fleet';
    case 'admin':       return 'Operations';
    default:            return 'Office';
  }
}

function defaultPosition(role: FieldUserRole): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

// ── POST handler ─────────────────────────────────────────────────────────────

async function handlePost(req: AuthenticatedNextApiRequest, res: NextApiResponse): Promise<void> {
  // contractorId is intentionally NOT destructured/persisted on staff —
  // contractor linkage lives on the picking row per the design plan.
  const { firstName, lastName, phone, email, role, department, position } = req.body as {
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
    role?: string;
    department?: string;
    position?: string;
  };

  // 400: required fields
  if (!firstName || !lastName || !phone || !role) {
    apiResponse.badRequest(res, 'firstName, lastName, phone and role are required');
    return;
  }

  // 400: validate role
  if (!(ALLOWED_ROLES as readonly string[]).includes(role)) {
    apiResponse.badRequest(res, `role must be one of: ${ALLOWED_ROLES.join(', ')}`);
    return;
  }

  const fieldRole = role as FieldUserRole;
  const callerRole = req.user.role;

  // 403: non-admin callers may only create technician accounts.
  // Admin / super_admin / system can create any allowed role.
  if (!ADMIN_AUTH_ROLES.has(callerRole) && fieldRole !== 'technician') {
    apiResponse.forbidden(res, 'Only admin users may create non-technician accounts');
    return;
  }

  // Determine account_status based on caller role.
  // Admin-tier callers create accounts immediately active; everyone else (storeman, manager)
  // creates pending accounts that require admin approval.
  const accountStatus = ADMIN_AUTH_ROLES.has(callerRole) ? 'active' : 'pending';

  const employeeId = `${ROLE_UPPER_PREFIX[fieldRole]}-${String(Date.now()).slice(-8)}`;

  // Mass-assignment guard: non-admin callers cannot override department/position.
  // Only admin-tier callers may set these fields; others get the role defaults.
  const isAdminCaller = ADMIN_AUTH_ROLES.has(callerRole);
  const resolvedDepartment = isAdminCaller ? (department ?? defaultDepartment(fieldRole)) : defaultDepartment(fieldRole);
  const resolvedPosition = isAdminCaller ? (position ?? defaultPosition(fieldRole)) : defaultPosition(fieldRole);
  const contractType = fieldRole === 'technician' ? 'contractor' : 'full-time';

  // Resolve the caller's staff.id via staff.user_id → users.id linkage.
  // req.user.id is users.id (auth_users), NOT staff.id. The column
  // created_by_staff_id is UUID REFERENCES staff(id) (migration 346), so we
  // must look up the staff row whose user_id matches the caller's users.id.
  // If no staff row exists (e.g. a super_admin account with no staff record),
  // we insert NULL — the column is nullable per migration 346.
  const callerUserId = req.user.id;
  let createdByStaffId: string | null = null;
  try {
    const staffLookup = await sql<{ id: string }>`
      SELECT id FROM staff WHERE user_id = ${callerUserId} LIMIT 1
    `;
    if (staffLookup.length > 0 && staffLookup[0]?.id) {
      createdByStaffId = staffLookup[0].id;
    } else {
      log.warn('Field user created by user with no staff record', { userId: callerUserId }, 'FieldUsersAPI');
    }
  } catch (lookupError) {
    // Non-fatal: log and proceed with NULL so the INSERT is not blocked.
    log.warn(
      'Failed to resolve staff record for created_by_staff_id; inserting NULL',
      { userId: callerUserId, error: lookupError instanceof Error ? lookupError.message : String(lookupError) },
      'FieldUsersAPI'
    );
  }

  try {
    const rows = await sql`
      INSERT INTO staff (
        employee_id, first_name, last_name, email, phone, status,
        department, position, contract_type,
        role, account_status, created_by_staff_id
      )
      VALUES (
        ${employeeId},
        ${firstName},
        ${lastName},
        ${email ?? null},
        ${phone},
        ${'active'},
        ${resolvedDepartment},
        ${resolvedPosition},
        ${contractType},
        ${fieldRole},
        ${accountStatus},
        ${createdByStaffId}
      )
      RETURNING id, role, account_status, created_by_staff_id
    `;

    const created = rows[0] as {
      id: string;
      role: string;
      account_status: string;
      created_by_staff_id: string | null;
    };

    logCreate('field_user', created.id, {
      role: fieldRole,
      account_status: accountStatus,
      created_by: req.user.id,
    });

    log.info('Field user created', { id: created.id, role: fieldRole, account_status: accountStatus }, 'FieldUsersAPI');

    apiResponse.created(res, { user: created }, 'Field user created successfully');
  } catch (error) {
    log.error('Error creating field user', error instanceof Error ? { message: error.message } : { error }, 'FieldUsersAPI');
    apiResponse.internalError(res, error, 'Failed to create field user');
  }
}

// ── GET handler ──────────────────────────────────────────────────────────────

async function handleGet(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  // contractorId is intentionally not supported here — contractor linkage lives
  // on the picking row, not on staff. The filter branches were dead code.
  const { role, accountStatus } = req.query as {
    role?: string;
    accountStatus?: string;
  };

  try {
    // Build dynamic filter conditions with explicit branches (Neon shim limitation workaround)
    let rows: Record<string, unknown>[];

    if (role && accountStatus) {
      rows = await sql`
        SELECT id, first_name, last_name, phone, email, role, account_status,
               created_by_staff_id, created_at
        FROM staff
        WHERE role = ${role} AND account_status = ${accountStatus}
        ORDER BY created_at DESC
        LIMIT 200
      `;
    } else if (role) {
      rows = await sql`
        SELECT id, first_name, last_name, phone, email, role, account_status,
               created_by_staff_id, created_at
        FROM staff
        WHERE role = ${role}
        ORDER BY created_at DESC
        LIMIT 200
      `;
    } else if (accountStatus) {
      rows = await sql`
        SELECT id, first_name, last_name, phone, email, role, account_status,
               created_by_staff_id, created_at
        FROM staff
        WHERE account_status = ${accountStatus}
        ORDER BY created_at DESC
        LIMIT 200
      `;
    } else {
      rows = await sql`
        SELECT id, first_name, last_name, phone, email, role, account_status,
               created_by_staff_id, created_at
        FROM staff
        ORDER BY created_at DESC
        LIMIT 200
      `;
    }

    apiResponse.success(res, rows);
  } catch (error) {
    log.error('Error listing field users', error instanceof Error ? { message: error.message } : { error }, 'FieldUsersAPI');
    apiResponse.internalError(res, error, 'Failed to list field users');
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

async function fieldUsersHandler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const authReq = req as AuthenticatedNextApiRequest;

  // Role gate: technician and viewer are excluded by name (level-based check
  // would admit technician since it shares ROLE_HIERARCHY level 2 with storeman).
  if (!PERMITTED_AUTH_ROLES.has(authReq.user.role)) {
    apiResponse.forbidden(res, 'Insufficient role to access field users');
    return;
  }

  if (req.method === 'POST') {
    return handlePost(authReq, res);
  }

  if (req.method === 'GET') {
    return handleGet(req, res);
  }

  apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
}

export default withAuth(fieldUsersHandler);
