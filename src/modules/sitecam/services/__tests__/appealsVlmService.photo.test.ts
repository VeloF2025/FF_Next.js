import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ optimizeForVlm: vi.fn(), loadGallery: vi.fn(), fetchFn: vi.fn() }));

vi.mock('@/lib/logger', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/vlmGallery', () => ({ loadGalleryExamples: h.loadGallery }));
vi.mock('@/modules/activate/services/imagePreprocessService', () => ({ optimizeForVlm: h.optimizeForVlm }));
vi.mock('@/modules/sitecam/lib/appealStepCriteria', () => ({
  buildAppealPhotoContent: () => [{ type: 'text', text: 'APPEAL-PROMPT' }],
  APPEAL_PHOTO_JSON_SHAPE: '{}',
}));

import { evaluateAppeal } from '../appealsVlmService';

function mockVlm(content: string) {
  h.fetchFn.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
}

const photoInput = { jobType: 'activations' as const, stepNumber: 4, photoBase64: 'RAW', appealText: 'ONT is visible' };

beforeEach(() => {
  vi.clearAllMocks();
  h.optimizeForVlm.mockResolvedValue('small-b64');
  h.loadGallery.mockResolvedValue({ positiveBase64: [], negativeBase64: [] });
  vi.stubGlobal('fetch', h.fetchFn);
});

describe('evaluateAppeal — photo mode', () => {
  it('returns the VLM recommendation with clamped confidence and checks', async () => {
    mockVlm('{"recommendation":"approve","confidence":0.86,"reasoning":"ONT clearly visible","checks":[{"name":"reason_photo_consistency","verdict":"pass","evidence":"ONT body visible"}]}');
    const r = await evaluateAppeal(photoInput);
    expect(r.recommendation).toBe('approve');
    expect(r.confidence).toBe(0.86);
    expect(r.checks).toHaveLength(1);
    expect(r.skipReason).toBeNull();
    expect(r.model).toContain('appeal-v1');
  });

  it('clamps out-of-range confidence into 0..1', async () => {
    mockVlm('{"recommendation":"deny","confidence":9,"reasoning":"no ONT","checks":[]}');
    const r = await evaluateAppeal(photoInput);
    expect(r.confidence).toBe(1);
  });

  it('fails OPEN to uncertain (never approve) when the VLM is unreachable', async () => {
    h.fetchFn.mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await evaluateAppeal(photoInput);
    expect(r.recommendation).toBe('uncertain');
    expect(r.skipReason).toBe('vlm_unavailable');
  });

  it('returns uncertain when the VLM response has no parsable recommendation', async () => {
    mockVlm('the appeal looks fine to me');
    const r = await evaluateAppeal(photoInput);
    expect(r.recommendation).toBe('uncertain');
    expect(r.skipReason).toBe('vlm_unavailable');
  });

  it('skips with no_photo when the appeal has no image', async () => {
    const r = await evaluateAppeal({ ...photoInput, photoBase64: '' });
    expect(r.recommendation).toBe('uncertain');
    expect(r.skipReason).toBe('no_photo');
    expect(h.fetchFn).not.toHaveBeenCalled();
  });

  it('skips with unsupported_step for a step with no criteria', async () => {
    const r = await evaluateAppeal({ ...photoInput, stepNumber: 99 });
    expect(r.skipReason).toBe('unsupported_step');
    expect(h.fetchFn).not.toHaveBeenCalled();
  });
});
