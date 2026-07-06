import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatWatermarkLabel, prepareCapturePhotos } from '../watermarkPhoto';
import { stepPhotoFilename } from '../savePhotoToDevice';

describe('formatWatermarkLabel', () => {
  it('renders site id with a zero-padded local timestamp', () => {
    const when = new Date(2026, 5, 12, 9, 5); // 12 Jun 2026 09:05 local
    expect(formatWatermarkLabel('DR1866766', when)).toBe('DR1866766 • 2026-06-12 09:05');
  });
});

describe('stepPhotoFilename', () => {
  it('builds a safe filename with site, step and date', () => {
    const when = new Date(2026, 5, 12);
    expect(stepPhotoFilename('DR1866766', 4, when)).toBe('DR1866766_step4_20260612.jpg');
  });

  it('sanitises unsafe characters in the site id', () => {
    const when = new Date(2026, 5, 12);
    expect(stepPhotoFilename('TEST/CIVIL 001', 2, when)).toBe('TEST_CIVIL_001_step2_20260612.jpg');
  });
});

/** jsdom can't decode a real photo, so `loadImage`'s `new Image()` is stubbed
 *  to resolve on the next microtask with a fixed decoded size. */
class MockImage {
  naturalWidth = 2000;
  naturalHeight = 1000;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

function fakeFile(): File {
  return new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' });
}

/** jsdom's Blob shim doesn't implement `arrayBuffer()` — read bytes via
 *  FileReader instead (mirrors readFileAsBase64/blobToBase64 in prod code). */
function blobBytes(blob: Blob): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1] ?? '';
      resolve(Array.from(atob(base64), (c) => c.charCodeAt(0)));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Stub the canvas primitives jsdom doesn't implement, recording the call
 * order into `callLog` so a test can assert the banner (fillRect/fillText) is
 * drawn strictly AFTER the clean copy's `toDataURL` call, and the Blob is
 * encoded (via `toBlob`) strictly AFTER the banner — i.e. from the SAME
 * canvas, post-banner, while the clean copy stays banner-free.
 */
function installCanvasStubs(
  callLog: string[],
  /** The Blob `canvas.toBlob` hands back — pass `null` to exercise the
   *  encoder-failure fallback (`base64ToBlob(watermarked)`). */
  toBlobResult: Blob | null = new Blob([new Uint8Array([9, 9, 9])], { type: 'image/jpeg' }),
): void {
  vi.stubGlobal('Image', MockImage as unknown as typeof Image);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    fillRect: vi.fn(() => callLog.push('fillRect')),
    fillText: vi.fn(() => callLog.push('fillText')),
    fillStyle: '',
    font: '',
    textBaseline: 'alphabetic',
  } as unknown as CanvasRenderingContext2D);

  let toDataURLCalls = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => {
    toDataURLCalls += 1;
    callLog.push('toDataURL');
    return `data:image/jpeg;base64,${toDataURLCalls === 1 ? 'Q0xFQU4=' : 'V0FURVJNQVJLRUQ='}`;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback) {
    callLog.push('toBlob');
    cb(toBlobResult);
  });
}

describe('prepareCapturePhotos', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('produces a JPEG watermarkedBlob encoded post-banner while the clean copy stays banner-free', async () => {
    const callLog: string[] = [];
    installCanvasStubs(callLog);

    const result = await prepareCapturePhotos(fakeFile(), 'DR1866766', new Date(2026, 5, 12));

    expect(result.clean).toBe('Q0xFQU4=');
    expect(result.watermarked).toBe('V0FURVJNQVJLRUQ=');
    expect(result.watermarkedBlob).toBeInstanceOf(Blob);
    expect(result.watermarkedBlob.type).toBe('image/jpeg');

    expect(await blobBytes(result.watermarkedBlob)).toEqual([9, 9, 9]);

    // The clean copy's toDataURL happens BEFORE the banner (fillRect/fillText)
    // is ever drawn; the Blob is encoded from the canvas strictly AFTER.
    expect(callLog).toEqual(['toDataURL', 'fillRect', 'fillText', 'toDataURL', 'toBlob']);
  });

  it('falls back to base64ToBlob(watermarked) when canvas.toBlob yields null — never throws', async () => {
    const callLog: string[] = [];
    installCanvasStubs(callLog, null);

    const result = await prepareCapturePhotos(fakeFile(), 'DR1866766', new Date(2026, 5, 12));

    // The base64 paths are unaffected — only the Blob encode failed.
    expect(result.clean).toBe('Q0xFQU4=');
    expect(result.watermarked).toBe('V0FURVJNQVJLRUQ=');
    expect(result.watermarkedBlob).toBeInstanceOf(Blob);
    expect(result.watermarkedBlob.type).toBe('image/jpeg');
    // Decoded from the fallback base64 ('V0FURVJNQVJLRUQ=') via base64ToBlob,
    // not the (absent) native toBlob output.
    expect(await blobBytes(result.watermarkedBlob)).toEqual(
      Array.from(atob('V0FURVJNQVJLRUQ='), (c) => c.charCodeAt(0)),
    );
  });

  it('falls back to the original photo (base64 + Blob) when canvas 2D context is unavailable — never throws', async () => {
    vi.stubGlobal('Image', MockImage as unknown as typeof Image);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    const result = await prepareCapturePhotos(fakeFile(), 'DR1866766');

    expect(result.clean).toBe(result.watermarked);
    expect(result.watermarkedBlob).toBeInstanceOf(Blob);
    expect(result.watermarkedBlob.type).toBe('image/jpeg');
    expect(await blobBytes(result.watermarkedBlob)).toEqual([1, 2, 3]);
  });

  it('falls back without throwing when the photo cannot be decoded', async () => {
    class FailingImage extends MockImage {
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('Image', FailingImage as unknown as typeof Image);

    const result = await prepareCapturePhotos(fakeFile(), 'DR1866766');

    expect(result.clean).toBe(result.watermarked);
    expect(result.watermarkedBlob).toBeInstanceOf(Blob);
    expect(result.watermarkedBlob.type).toBe('image/jpeg');
  });
});
