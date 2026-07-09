/**
 * The step quality check must NOT let a transient VLM failure silently pass a
 * photo. Before this fix, any HTTP error / timeout / malformed reply returned
 * `checkFailed` on the FIRST attempt and the caller preserved the photo's
 * categorization PASS — so a VLM hiccup auto-approved bad work and (via the
 * auto-feedback cron) told the technician it passed.
 *
 * Now the call is retried, and only when every attempt fails is `checkFailed`
 * reported — which the caller turns into "hold for human review", not a pass.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../qaReferencePhotos', () => ({ loadStepReferences: () => null }));
vi.mock('../photoFetchService', () => ({ fetchPhotoAsBase64: vi.fn(async () => 'PHOTOB64') }));
vi.mock('@/lib/vlmGallery', () => ({ loadGalleryExamples: vi.fn(async () => undefined) }));

import { validateStepQuality, QUALITY_CHECK_MAX_ATTEMPTS } from '../stepQualityValidationService';

const noSleep = async () => {};
const photo = { filename: 'wall.jpg', url: 'http://x/wall.jpg', step: 5 };

function okJson(obj: unknown) {
  return { ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) };
}
function httpErr(status: number) {
  return { ok: false, status, json: async () => ({}), text: async () => 'boom' };
}
function vlmVerdict(passes: boolean, reason?: string) {
  const content = JSON.stringify(passes ? { passes: true, fail_reason: null } : { passes: false, fail_reason: reason });
  return okJson({ choices: [{ message: { content } }] });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('validateStepQuality — retry then hold', () => {
  it('retries the VLM call up to the max, then reports checkFailed (hold, never a pass)', async () => {
    fetchMock.mockResolvedValue(httpErr(500));

    const results = await validateStepQuality('DR1', [photo], { sleep: noSleep });
    const r = results.get('wall.jpg');

    expect(fetchMock).toHaveBeenCalledTimes(QUALITY_CHECK_MAX_ATTEMPTS);
    expect(r?.checkFailed).toBe(true);
  });

  it('recovers on a later attempt and does not hold', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(httpErr(503))
      .mockResolvedValueOnce(vlmVerdict(false, 'no wooden board or bracket visible'));

    const results = await validateStepQuality('DR1', [photo], { sleep: noSleep });
    const r = results.get('wall.jpg');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(r?.checkFailed).toBe(false);
    expect(r?.passes).toBe(false);
    expect(r?.failReason).toContain('board');
  });

  it('does not retry when the first attempt succeeds', async () => {
    fetchMock.mockResolvedValueOnce(vlmVerdict(true));

    const results = await validateStepQuality('DR1', [photo], { sleep: noSleep });
    const r = results.get('wall.jpg');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r?.checkFailed).toBe(false);
    expect(r?.passes).toBe(true);
  });
});
