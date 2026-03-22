/**
 * GET /api/analytics/reports/assets-register
 *
 * Returns two asset sections:
 *   - Current Assets: from "Current Assets" worksheet (pre-paid costs, wayleave deposits)
 *   - Fixed Assets: from "Data" worksheet, categories = Fixed Assets, Computer Equipment,
 *                   Optical Equipment, Vehicles, Tools & Equipment — total value only
 *                   (full register pending dedicated Fixed Assets tab in workbook)
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

/** Categories in the Data tab that represent Fixed Assets */
const FIXED_ASSET_CATEGORIES = new Set([
  'Fixed Assets',
  'Computer Equipment',
  'Optical Equipment',
  'Vehicles',
  'Tools & Equipment',
]);

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
    // Fetch both sheets in parallel — Data failure is non-fatal (fixed assets total becomes 0)
    const [currentAssetsResult, dataResult] = await Promise.allSettled([
      getWorksheetRange('Current Assets'),
      getWorksheetRange('Data'),
    ]);

    // --- Current Assets ---
    const items: AssetItem[] = [];
    const categorySummary: Record<string, number> = {};

    if (currentAssetsResult.status === 'fulfilled') {
      const { values } = currentAssetsResult.value;
      // Headers row 0: Date, Date-M, Type, Type-Loan, Description, Amount, Amount Acc, Category
      for (let i = 1; i < (values ?? []).length; i++) {
        const row = values[i] as unknown[];
        const dateCell = row[0];
        if (!dateCell && !row[4]) continue;

        const dateSerial = typeof dateCell === 'number' ? dateCell : 0;
        const date = dateSerial > 0 ? excelSerialToDate(dateSerial) : '';
        const description = toStr(row[4]);
        const amount = toNumber(row[5]);
        const runningTotal = toNumber(row[6]);
        const category = toStr(row[7]) || 'Uncategorised';

        if (!description && amount === 0) continue;
        items.push({ date, description, category, amount, runningTotal });
        if (amount !== 0) categorySummary[category] = (categorySummary[category] ?? 0) + amount;
      }
    }

    // --- Fixed Assets (from Data tab, specific categories) ---
    const fixedAssetsByCategory: Record<string, number> = {};
    let fixedAssetsTotal = 0;

    if (dataResult.status === 'fulfilled') {
      const { values: dataValues } = dataResult.value;
      // Data headers row 0: Date(0), Date-M(1), Type(2), ..., Ammount Excl. VAT(5), ..., Category(9)
      for (let i = 1; i < (dataValues ?? []).length; i++) {
        const row = dataValues[i] as unknown[];
        const category = toStr(row[9]);
        if (!FIXED_ASSET_CATEGORIES.has(category)) continue;
        const amount = Math.abs(toNumber(row[5])); // store as positive magnitude
        fixedAssetsByCategory[category] = (fixedAssetsByCategory[category] ?? 0) + amount;
        fixedAssetsTotal += amount;
      }
    } else {
      logger.warn('Data tab unavailable for fixed assets calc', { error: String(dataResult.reason) });
    }

    logger.info('Assets register fetched', {
      userId,
      currentItemCount: items.length,
      fixedAssetCategories: Object.keys(fixedAssetsByCategory).length,
      fixedAssetsTotal,
    });

    return NextResponse.json({
      success: true,
      data: {
        currentAssets: { items, categorySummary },
        fixedAssets: {
          total: fixedAssetsTotal,
          byCategory: fixedAssetsByCategory,
          note: 'Totals derived from Data tab. Full fixed assets register pending dedicated worksheet in Shareholder Model.',
        },
      },
      meta: {
        generatedAt: new Date().toISOString(),
        sources: ['Current Assets', 'Data'],
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
