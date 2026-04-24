/**
 * Unit tests for assetService helpers.
 *
 * Covers the regression guard for VF-20260420-058: when a user tries to
 * register a second asset that duplicates an existing barcode, the API must
 * surface a field-specific message instead of the generic "Failed to create
 * asset" error.
 */

import { describe, it, expect } from 'vitest';
import { mapAssetUniqueViolation } from '../services/assetService';

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
