/**
 * autoQaProcessor.holdWiring.test.ts
 *
 * Integration guard for the auto-feedback hold WIRING in processOneDR.
 *
 * The pure policy (shouldHoldForIncompleteQualityCheck) is unit-tested in
 * autoQaHoldPolicy.test.ts. This test exercises the REAL call site: that an
 * incomplete visual quality check threads the correct holdForHumanReason into
 * persistAutoQaResults — 'quality_check_incomplete' for a PASS (an unverified
 * approval that must be held) and null for a FAIL/REWORK (corrective feedback
 * that must still flow). Regression guard for the 2026-07-10 incident, when an
 * incomplete check held EVERY verdict and stranded ~200 FAIL DRs for days.
 */

// ============================================================================
// MOCKS — must be defined before any imports that use them
// ============================================================================

vi.mock('@/lib/db', () => ({ default: { query: vi.fn() } }));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: vi.fn(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() })),
}));

vi.mock('../photoDateValidator', () => ({ extractExifDatesForPhotos: vi.fn(async () => new Map()) }));

vi.mock('../qaAutoFailService', () => ({
  checkPrerequisites: vi.fn(() => ({ passed: true, reasons: [] })),
  checkStepCoverage: vi.fn(() => ({ missing: [], covered: [] })),
  validatePowerMeter: vi.fn(() => ({ passed: true })),
  validateSerialCrossReference: vi.fn(() => ({ passed: true })),
  evaluateAutoFail: vi.fn(() => ({ recommendation: 'PASS', reasons: [], autoFail: false })),
  getFailReasonDescription: vi.fn(() => 'desc'),
}));

vi.mock('../autoApprovalService', () => ({
  getStepAccuracy: vi.fn(async () => ({})),
  assignTiers: vi.fn(() => []),
  buildSummary: vi.fn(() => ({ autoApproved: 0, reviewRecommended: 0, humanRequired: 0 })),
}));

vi.mock('../autoQaCommentGenerator', () => ({
  generatePhotoComment: vi.fn(() => 'comment'),
  generateMissingStepComment: vi.fn(() => 'missing:'),
  generateFeedbackMessage: vi.fn(() => 'feedback'),
}));

vi.mock('../activityLogService', () => ({ logActivity: vi.fn(async () => undefined) }));

vi.mock('../autoQaDuplicateDetector', () => ({
  flagWithinDrStepDuplicates: vi.fn(() => 0),
  flagDateMismatchDuplicates: vi.fn(async () => undefined),
}));

vi.mock('../autoQaPhotoQualityChecks', () => ({
  applyOntBackCableCheck: vi.fn(async () => 0),
  applyStepQualityCheck: vi.fn(async () => ({ demoted: 0, checkIncomplete: true })),
}));

vi.mock('../autoQaHelpers', () => ({
  persistAutoQaResults: vi.fn(async () => undefined),
  makeResult: vi.fn((dropNumber: string, _startTime: number, overrides: Record<string, unknown>) => ({
    dropNumber,
    ...overrides,
  })),
  recordAutoQaAttempt: vi.fn(async () => undefined),
  recordAutoQaError: vi.fn(async () => undefined),
  buildValidationData: vi.fn(() => ({ photos: [], powerMeterDbm: null })),
  MAX_AUTO_QA_ATTEMPTS: 5,
}));

// ============================================================================
// IMPORTS — after mocks
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import pool from '@/lib/db';
import { processOneDR } from '../autoQaProcessor';
import { persistAutoQaResults } from '../autoQaHelpers';
import { evaluateAutoFail } from '../qaAutoFailService';
import { applyStepQualityCheck } from '../autoQaPhotoQualityChecks';

const query = vi.mocked((pool as unknown as { query: ReturnType<typeof vi.fn> }).query);
const mockEvaluate = vi.mocked(evaluateAutoFail);
const mockQualityCheck = vi.mocked(applyStepQualityCheck);
const mockPersist = vi.mocked(persistAutoQaResults);

function drRow() {
  return {
    drop_number: 'DR100',
    photo_count: 1,
    photos_json: '[{"filename":"p1.jpg","url":"http://x/p1.jpg"}]',
    vlm_json: JSON.stringify([
      { photo_filename: 'p1.jpg', vlm_predicted_step: 5, vlm_confidence: 0.9, vlm_predicted_category: 'Wall' },
    ]),
    ont_serial_scanned: null,
    ups_serial_scanned: null,
    vlm_power_meter_dbm: null,
    vlm_ont_serial_step6: null,
    vlm_ont_serial_step9: null,
    vlm_dr_number_step9: null,
    project: 'X',
    submitted_date: null,
    vlm_categorized_at: null,
  };
}

// persistAutoQaResults(dropNumber, decision, autoFailResult, autoQaResults,
//   stepCoverage, discardedPhotos, holdForHumanReason) — 7th arg (index 6).
function holdArgOfLastPersist(): unknown {
  const call = mockPersist.mock.calls.at(-1);
  return call?.[6];
}

beforeEach(() => {
  vi.clearAllMocks();
  query.mockResolvedValue({ rows: [drRow()] });
  mockQualityCheck.mockResolvedValue({ demoted: 0, checkIncomplete: true });
});

describe('processOneDR — incomplete-quality-check hold wiring', () => {
  it('holds a PASS (unverified approval) when the visual check is incomplete', async () => {
    mockEvaluate.mockReturnValue({ recommendation: 'PASS', reasons: [], autoFail: false } as never);

    await processOneDR('DR100');

    expect(mockPersist).toHaveBeenCalledTimes(1);
    expect(holdArgOfLastPersist()).toBe('quality_check_incomplete');
  });

  it('does NOT hold a FAIL when the visual check is incomplete — corrective feedback must flow', async () => {
    mockEvaluate.mockReturnValue({ recommendation: 'FAIL', reasons: ['x'], autoFail: true } as never);

    await processOneDR('DR100');

    expect(mockPersist).toHaveBeenCalledTimes(1);
    expect(holdArgOfLastPersist()).toBeNull();
  });

  it('does NOT hold a REWORK_NEEDED when the visual check is incomplete', async () => {
    mockEvaluate.mockReturnValue({ recommendation: 'REWORK_NEEDED', reasons: ['x'], autoFail: false } as never);

    await processOneDR('DR100');

    expect(holdArgOfLastPersist()).toBeNull();
  });

  it('does NOT hold when the visual check completed, even for a PASS', async () => {
    mockQualityCheck.mockResolvedValue({ demoted: 0, checkIncomplete: false });
    mockEvaluate.mockReturnValue({ recommendation: 'PASS', reasons: [], autoFail: false } as never);

    await processOneDR('DR100');

    expect(holdArgOfLastPersist()).toBeNull();
  });
});
