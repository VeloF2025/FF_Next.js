/**
 * GET /api/analytics/reports/assets-register
 *
 * Reads the "Current Assets" worksheet.
 * Returns pre-paid and capitalised costs with running total.
 *
 * Access restricted via RBAC (analytics.reports / view) or user allowlist.
 */

// 🟢 WORKING: Assets Register GET handler — reads live SharePoint data
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createLogger } from '@/lib/logger';
import { verifyToken } from '@/lib/auth/jwt';
import { userHasPermission } from '@/lib/permissions';
import { getWorksheetRange } from '@/lib/graph/sharepoint-excel';
import type { AssetItem } from '@/modules/analytics/reports/assets-register/useAssetsRegisterData';

const logger = createLogger('analytics:api:assets-register');

const ALLOWED_USERS = new Set([
  '28ab98c1-df21-48f8-a30a-489cd09a0d39', // Hein
  '7d84184b-2a2b-4fbb-a52e-9815d0e92237', // Lew
]);

/** Convert Excel date serial to ISO date string (YYYY-MM-DD) */
function excelSerialToDate(serial: number): string {
  const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  return date.toISOString().slice(0, 10);
}

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

  logger.info('Assets register requested', { userId });

  try {
    const { values } = await getWorksheetRange('Current Assets');

    if (!values || values.length < 2) {
      throw new Error('Current Assets sheet returned insufficient data');
    }

    // Headers at row 0: Date, Date-M, Type, Type-Loan, Description, Amount, Amount Acc, Category
    // Col 0 = Date (serial), Col 4 = Description, Col 5 = Amount, Col 6 = Amount Acc (running), Col 7 = Category

    const items: AssetItem[] = [];
    const categorySummary: Record<string, number> = {};

    for (let i = 1; i < values.length; i++) {
      const row = values[i] as unknown[];

      const dateCell = row[0];
      if (!dateCell && !row[4]) continue; // skip empty rows

      const dateSerial = typeof dateCell === 'number' ? dateCell : 0;
      const date = dateSerial > 0 ? excelSerialToDate(dateSerial) : '';
      const description = toStr(row[4]);
      const amount = toNumber(row[5]);
      const runningTotal = toNumber(row[6]);
      const category = toStr(row[7]) || 'Uncategorised';

      if (!description && amount === 0) continue;

      items.push({ date, description, category, amount, runningTotal });

      if (amount !== 0) {
        categorySummary[category] = (categorySummary[category] ?? 0) + amount;
      }
    }

    logger.info('Assets register fetched', { userId, itemCount: items.length });

    return NextResponse.json({
      success: true,
      data: { items, categorySummary },
      meta: {
        generatedAt: new Date().toISOString(),
        sources: ['Current Assets'],
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Assets register fetch failed', { error: message });
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 }
    );
  }
}
