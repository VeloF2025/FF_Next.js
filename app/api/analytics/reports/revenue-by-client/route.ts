/**
 * GET /api/analytics/reports/revenue-by-client
 *
 * Reads the "Data" worksheet and groups contract revenue by client
 * (Cost Centre: T1, col 14). Filters to Type == "Income" AND
 * Category == "Contract Revenue" (col 9).
 *
 * Access restricted via RBAC (analytics.reports / view) or user allowlist.
 */

// 🟢 WORKING: Revenue by Client GET handler — reads live SharePoint data
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createLogger } from '@/lib/logger';
import { verifyToken } from '@/lib/auth/jwt';
import { userHasPermission } from '@/lib/permissions';
import { getWorksheetRange } from '@/lib/graph/sharepoint-excel';
import type { RevenueByClientItem } from '@/modules/analytics/reports/revenue-by-client/useRevenueByClientData';

const logger = createLogger('analytics:api:revenue-by-client');

const ALLOWED_USERS = new Set([
  '28ab98c1-df21-48f8-a30a-489cd09a0d39', // Hein
  '7d84184b-2a2b-4fbb-a52e-9815d0e92237', // Lew
]);

function toNumber(cell: unknown): number {
  if (typeof cell === 'number') return cell;
  if (typeof cell === 'string') return parseFloat(cell.replace(/,/g, '')) || 0;
  return 0;
}

function toStr(cell: unknown): string {
  if (typeof cell === 'string') return cell.trim();
  if (cell == null) return '';
  return String(cell).trim();
}

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

  const hasAccess = await userHasPermission(userId, 'analytics.reports', 'view');
  if (!hasAccess && !ALLOWED_USERS.has(userId)) {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Access restricted to authorised users' } },
      { status: 403 }
    );
  }

  logger.info('Revenue by client requested', { userId });

  try {
    const { values } = await getWorksheetRange('Data');

    if (!values || values.length < 2) {
      throw new Error('Data sheet returned insufficient data');
    }

    // Skip header row (index 0). Data rows from index 1.
    // Col 2=Type, Col 10=Category, Col 6=Amount Excl. VAT, Col 19=Name (client)
    const clientMap = new Map<string, number>();

    for (let i = 1; i < values.length; i++) {
      const row = values[i] as unknown[];
      const type = toStr(row[2]);
      const category = toStr(row[10]);

      if (type !== 'Income') continue;
      if (category !== 'Contract Revenue') continue;

      const client = toStr(row[19]) || 'Unknown';
      const amount = toNumber(row[6]);

      clientMap.set(client, (clientMap.get(client) ?? 0) + amount);
    }

    // Sort by revenue descending
    const data: RevenueByClientItem[] = Array.from(clientMap.entries())
      .map(([client, revenue]) => ({ client, revenue }))
      .sort((a, b) => b.revenue - a.revenue);

    logger.info('Revenue by client fetched', { userId, clientCount: data.length });

    return NextResponse.json({
      success: true,
      data,
      meta: {
        generatedAt: new Date().toISOString(),
        sources: ['Data'],
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Revenue by client fetch failed', { error: message });
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 }
    );
  }
}
