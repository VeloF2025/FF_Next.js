/**
 * Unit tests for assetService helpers.
 *
 * Covers the regression guard for VF-20260420-058: when a user tries to
 * register a second asset that duplicates an existing barcode, the API must
 * surface a field-specific message instead of the generic "Failed to create
 * asset" error.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql, queries } = vi.hoisted(() => {
  const queries: string[] = [];
  const mockSql = vi.fn(async (strings: TemplateStringsArray, ..._values: unknown[]) => {
    queries.push(strings.join('?'));
    return [{
      id: 'asset-1',
      asset_number: 'OTDR-2026-00015',
      category_id: 'category-1',
      name: 'TOOL-EXFO-OTDR-MAX730D-SM3',
      status: 'available',
      condition: 'good',
      currency: 'ZAR',
      salvage_value: 0,
      requires_calibration: false,
      specifications: {},
      tags: [],
      image_urls: [],
      verification_status: 'pending',
      created_at: '2026-05-28T00:00:00.000Z',
      updated_at: '2026-05-28T00:00:00.000Z',
      created_by: 'user-1',
    }];
  });
  return { mockSql, queries };
});

vi.mock('../utils/db', () => ({
  getDbConnection: () => mockSql,
}));

import { assetService, mapAssetUniqueViolation } from '../services/assetService';
import { UpdateAssetSchema } from '../utils/schemas';

describe('mapAssetUniqueViolation', () => {
  it('returns null for non-unique-violation errors', () => {
    expect(mapAssetUniqueViolation(null)).toBeNull();
    expect(mapAssetUniqueViolation(undefined)).toBeNull();
    expect(mapAssetUniqueViolation(new Error('boom'))).toBeNull();
    expect(mapAssetUniqueViolation({ code: '23503' })).toBeNull(); // FK violation
  });

  it('maps duplicate barcode by constraint name and extracts the value', () => {
    const pgError = {
      code: '23505',
      constraint: 'assets_barcode_key',
      detail: 'Key (barcode)=(CIDLI209685) already exists.',
    };
    const msg = mapAssetUniqueViolation(pgError);
    expect(msg).toContain('CIDLI209685');
    expect(msg).toMatch(/barcode/i);
    expect(msg).toMatch(/already exists/i);
  });

  it('maps duplicate barcode by field name when constraint is missing', () => {
    const pgError = {
      code: '23505',
      detail: 'Key (barcode)=(ABC-123) already exists.',
    };
    const msg = mapAssetUniqueViolation(pgError);
    expect(msg).toContain('ABC-123');
    expect(msg).toMatch(/barcode/i);
  });

  it('maps asset_number collision to a retryable hint', () => {
    const pgError = {
      code: '23505',
      constraint: 'assets_asset_number_key',
      detail: 'Key (asset_number)=(DRLL-2026-00023) already exists.',
    };
    expect(mapAssetUniqueViolation(pgError)).toMatch(/asset number collision/i);
  });

  it('falls back to a generic field-labeled message for unknown constraints', () => {
    const pgError = {
      code: '23505',
      constraint: 'assets_some_future_key',
      detail: 'Key (custom_field)=(x) already exists.',
    };
    expect(mapAssetUniqueViolation(pgError)).toMatch(/custom field/i);
  });

  it('falls back to a fully generic message when detail is missing', () => {
    expect(mapAssetUniqueViolation({ code: '23505' })).toBe(
      'This asset conflicts with an existing record. Please check for duplicates.'
    );
  });
});

describe('assetService.update', () => {
  beforeEach(() => {
    mockSql.mockClear();
    queries.length = 0;
  });

  it('accepts relative VF Storage image paths in update payloads', () => {
    const validation = UpdateAssetSchema.safeParse({
      primaryImageUrl: '/storage/assets/photos/front.jpeg',
      imageUrls: ['/storage/assets/photos/back.jpeg'],
      labelImageUrl: '/storage/assets/photos/label.jpeg',
      verificationImageUrl: '/api/uploads/assets/photos/label.jpeg',
    });

    expect(validation.success).toBe(true);
  });

  it('persists barcode and asset image fields during updates', async () => {
    const result = await assetService.update('asset-1', {
      barcode: '1981860',
      primaryImageUrl: '/api/uploads/assets/photos/front.jpeg',
      imageUrls: ['/api/uploads/assets/photos/back.jpeg'],
      labelImageUrl: '/api/uploads/assets/photos/label.jpeg',
      verificationImageUrl: '/api/uploads/assets/photos/label.jpeg',
      vlmExtractionData: { serialNumber: '1981860', confidence: 0.98 },
      verificationStatus: 'verified',
    }, 'user-1');

    expect(result.success).toBe(true);
    const updateSql = queries.join('\n');
    expect(updateSql).toContain('barcode = COALESCE');
    expect(updateSql).toContain('primary_image_url = COALESCE');
    expect(updateSql).toContain('image_urls = COALESCE');
    expect(updateSql).toContain('label_image_url = COALESCE');
    expect(updateSql).toContain('verification_image_url = COALESCE');
    expect(updateSql).toContain('vlm_extraction_data = COALESCE');
    expect(updateSql).toContain('verification_status = COALESCE');
  });
});
