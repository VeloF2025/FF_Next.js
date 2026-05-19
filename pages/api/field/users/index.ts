/**
 * Generic field-user create/list endpoint.
 *
 * POST /api/field/users — create a staff member with a given role.
 * GET  /api/field/users — list staff with optional filters.
 *
 * Role-aware pending status:
 *   - storeman callers  → account_status='pending'  (admin must approve)
 *   - admin/super_admin → account_status='active'
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth/middleware';
import type { AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import { logCreate } from '@/lib/db-logger';

// ── Constants ────────────────────────────────────────────────────────────────

/** Roles accepted as the `role` body field (staff.role column, NOT AuthRole). */
const ALLOWED_ROLES = ['technician', 'stores', 'supervisor', 'admin', 'driver', 'office'] as const;
type FieldUserRole = (typeof ALLOWED_ROLES)[number];

/** AuthRoles that are considered "stores-level" callers (create pending accounts). */
const STORES_AUTH_ROLES = new Set(['storeman']);

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

  // 403: stores callers may only create technicians
  if (STORES_AUTH_ROLES.has(callerRole) && fieldRole !== 'technician') {
    apiResponse.forbidden(res, 'Stores users may only create technician accounts');
    return;
  }

  // Determine account_status based on caller role
  const accountStatus = STORES_AUTH_ROLES.has(callerRole) ? 'pending' : 'active';

  const employeeId = `${ROLE_UPPER_PREFIX[fieldRole]}-${String(Date.now()).slice(-8)}`;
  const resolvedDepartment = department ?? defaultDepartment(fieldRole);
  const resolvedPosition = position ?? defaultPosition(fieldRole);
  const contractType = fieldRole === 'technician' ? 'contractor' : 'full-time';

  try {
    const rows = await sql`
      INSERT INTO staff (
        employee_id, first_name, last_name, email, phone,
        department, position, contract_type,
        role, account_status, created_by_staff_id
      )
      VALUES (
        ${employeeId},
        ${firstName},
        ${lastName},
        ${email ?? null},
        ${phone},
        ${resolvedDepartment},
        ${resolvedPosition},
        ${contractType},
        ${fieldRole},
        ${accountStatus},
        ${req.user.id}
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
  const { role, accountStatus, contractorId } = req.query as {
    role?: string;
    accountStatus?: string;
    contractorId?: string;
  };

  try {
    // Build dynamic filter conditions with explicit branches (Neon shim limitation workaround)
    let rows: Record<string, unknown>[];

    if (role && accountStatus && contractorId) {
      rows = await sql`
        SELECT id, first_name, last_name, phone, email, role, account_status,
               created_by_staff_id, created_at
        FROM staff
        WHERE role = ${role}
          AND account_status = ${accountStatus}
          AND metadata->>'contractorId' = ${contractorId}
        ORDER BY created_at DESC
        LIMIT 200
      `;
    } else if (role && accountStatus) {
      rows = await sql`
        SELECT id, first_name, last_name, phone, email, role, account_status,
               created_by_staff_id, created_at
        FROM staff
        WHERE role = ${role} AND account_status = ${accountStatus}
        ORDER BY created_at DESC
        LIMIT 200
      `;
    } else if (role && contractorId) {
      rows = await sql`
        SELECT id, first_name, last_name, phone, email, role, account_status,
               created_by_staff_id, created_at
        FROM staff
        WHERE role = ${role}
          AND metadata->>'contractorId' = ${contractorId}
        ORDER BY created_at DESC
        LIMIT 200
      `;
    } else if (accountStatus && contractorId) {
      rows = await sql`
        SELECT id, first_name, last_name, phone, email, role, account_status,
               created_by_staff_id, created_at
        FROM staff
        WHERE account_status = ${accountStatus}
          AND metadata->>'contractorId' = ${contractorId}
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
    } else if (contractorId) {
      rows = await sql`
        SELECT id, first_name, last_name, phone, email, role, account_status,
               created_by_staff_id, created_at
        FROM staff
        WHERE metadata->>'contractorId' = ${contractorId}
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

  if (req.method === 'POST') {
    return handlePost(authReq, res);
  }

  if (req.method === 'GET') {
    return handleGet(req, res);
  }

  apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
}

export default withAuth(fieldUsersHandler);
