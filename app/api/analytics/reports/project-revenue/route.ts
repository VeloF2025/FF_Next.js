/**
 * GET /api/analytics/reports/project-revenue
 *
 * Returns projected activation revenue per project from the
 * Shareholder Model Excel "Project_Detail" worksheet via SharePoint Graph API.
 *
 * Access restricted to authorised users via RBAC (analytics.reports / view)
 * or direct user-ID allowlist.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createLogger } from '@/lib/logger';
import { verifyToken } from '@/lib/auth/jwt';
import { userHasPermission } from '@/lib/permissions';
import { getWorksheetRange } from '@/lib/graph/sharepoint-excel';

const logger = createLogger('analytics:api:project-revenue');

/** Allowlist — fallback guard independent of RBAC table */
const ALLOWED_USERS = new Set([
  '28ab98c1-df21-48f8-a30a-489cd09a0d39', // Hein
  '7d84184b-2a2b-4fbb-a52e-9815d0e92237', // Lew
]);

export interface ProjectRevenuePoint {
  project: string;
  fcActivation: number;
}

function toNumber(cell: unknown): number {
  if (typeof cell === 'number') return cell;
  if (typeof cell === 'string') return parseFloat(cell) || 0;
  return 0;
}

// 🟢 WORKING: Project revenue GET handler — reads live SharePoint data
export async function GET(_req: NextRequest): Promise<NextResponse> {
  // --- Authentication ---
  const cookieStore = await cookies();
  const token = cookieStore.get('ff_auth_token')?.value;

  if (!token) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      { status: 401 }
    );
  }

  const payload = await verifyToken(token);
  if (!payload?.sub) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
      { status: 401 }
    );
  }

  const userId = payload.sub;

  // --- Authorisation ---
  const hasAccess = await userHasPermission(userId, 'analytics.reports', 'view');
  if (!hasAccess && !ALLOWED_USERS.has(userId)) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access restricted to authorised users' },
      },
      { status: 403 }
    );
  }

  logger.info('Project revenue requested', { userId });

  try {
    const { values } = await getWorksheetRange('Project_Detail');

    if (!values || values.length < 4) {
      throw new Error('Project_Detail sheet returned insufficient data');
    }

    // Header row is index 2 (row 3):
    // ["","","","Project Scope - Original","PO Count","Rate","Uptake","FC Activation",...]
    // col 3 = project name, col 7 = FC Activation
    const PROJECT_COL = 3;
    const FC_ACTIVATION_COL = 7;

    // Data starts at index 3 (row 4)
    const dataRows = values.slice(3);

    const data: ProjectRevenuePoint[] = [];

    for (const row of dataRows) {
      const typedRow = row as unknown[];
      const project = String(typedRow[PROJECT_COL] ?? '').trim();
      if (!project || project === 'Project Scope - Original') continue;

      const fcActivation = toNumber(typedRow[FC_ACTIVATION_COL]);
      if (fcActivation <= 0) continue;

      data.push({ project, fcActivation });
    }

    return NextResponse.json({
      success: true,
      data,
      meta: {
        generatedAt: new Date().toISOString(),
        projectCount: data.length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Project revenue fetch failed', { error: message });

    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 }
    );
  }
}
