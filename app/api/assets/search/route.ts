/**
 * Asset Search API Route
 * GET /api/assets/search - Search assets by term, barcode, or asset number
 */

import { NextRequest, NextResponse } from 'next/server';
import { assetService } from '@/modules/assets/services';
import { log } from '@/lib/logger';

export const dynamic = 'force-dynamic';

// ==================== GET /api/assets/search ====================

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const term = searchParams.get('q') || searchParams.get('term');
    const barcode = searchParams.get('barcode');
    const assetNumber = searchParams.get('assetNumber');

    // Search by barcode (exact match)
    if (barcode) {
      const result = await assetService.getByBarcode(barcode);

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }

      if (!result.data) {
        return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
      }

      return NextResponse.json({ data: result.data });
    }

    // Search by asset number (exact match)
    if (assetNumber) {
      const result = await assetService.getByAssetNumber(assetNumber);

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }

      if (!result.data) {
        return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
      }

      return NextResponse.json({ data: result.data });
    }

    // General search by term
    if (term) {
      const result = await assetService.search(term);

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }

      return NextResponse.json({ data: result.data });
    }

    return NextResponse.json(
      { error: 'Missing search parameter (q, barcode, or assetNumber)' },
      { status: 400 }
    );
  } catch (error) {
    log.error('Error searching assets:', { data: error }, 'assets:search');
    return NextResponse.json(
      { error: 'Failed to search assets' },
      { status: 500 }
    );
  }
}
