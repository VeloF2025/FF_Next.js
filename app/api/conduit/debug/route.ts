export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { getWorksheetRange } from '@/lib/graph/sharepoint-excel';

export async function GET(req: NextRequest) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { values } = await getWorksheetRange('Data');
    const sample: unknown[] = [];
    for (let i = 1; i < Math.min(values.length, 5000); i++) {
      const row = values[i] as unknown[];
      const type = String(row[3] ?? '').trim();
      const costCentre = String(row[15] ?? '').trim();
      const categoryT2 = String(row[10] ?? '').trim();
      if (costCentre === 'Lawley' && type === 'Expense') {
        sample.push({ row: i, type, costCentre, categoryT2, amount: row[5] });
        if (sample.length >= 20) break;
      }
    }
    return NextResponse.json({ count: sample.length, sample });
  } catch (e) {
    return NextResponse.json({ error: String(e) });
  }
}
