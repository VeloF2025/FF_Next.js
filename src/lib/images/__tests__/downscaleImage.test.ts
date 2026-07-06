import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeTargetDimensions, downscaleImage, ImageDecodeError } from '../downscaleImage';

/** Records the canvas state at toBlob time so tests can assert output geometry. */
let lastToBlob: { width: number; height: number; type: string; quality: number } | null = null;

/**
 * Stub the browser image primitives jsdom does not implement:
 * createImageBitmap (global), canvas getContext + toBlob. The fake toBlob
 * encodes a size proportional to pixels × quality so "lower q → smaller blob"
 * is observable, and captures the canvas dimensions the util set.
 */
function installStubs(source: { width: number; height: number }): ReturnType<typeof vi.fn> {
  const createBitmap = vi.fn(async (_blob: Blob, _opts?: ImageBitmapOptions) => ({
    width: source.width,
    height: source.height,
    close: vi.fn(),
  }));
  vi.stubGlobal('createImageBitmap', createBitmap);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    cb: BlobCallback,
    type?: string,
    quality?: number
  ) {
    const t = type ?? 'image/png';
    const q = quality ?? 1;
    lastToBlob = { width: this.width, height: this.height, type: t, quality: q };
    const size = Math.max(1, Math.round(this.width * this.height * q));
    cb(new Blob([new Uint8Array(size)], { type: t }));
  });
  return createBitmap;
}

function fakeFile(): File {
  return new File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  lastToBlob = null;
});

describe('computeTargetDimensions', () => {
  it('caps a landscape image at the max long edge, preserving aspect', () => {
    expect(computeTargetDimensions(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it('caps a portrait image at the max long edge, preserving aspect', () => {
    expect(computeTargetDimensions(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it('never upscales an image already within the cap', () => {
    expect(computeTargetDimensions(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it('leaves an image whose long edge equals the cap unchanged', () => {
    expect(computeTargetDimensions(1600, 900, 1600)).toEqual({ width: 1600, height: 900 });
  });
});

describe('downscaleImage', () => {
  it('bounds the output long edge to the default 1600px', async () => {
    installStubs({ width: 4000, height: 3000 });
    await downscaleImage(fakeFile());
    expect(lastToBlob).not.toBeNull();
    expect(Math.max(lastToBlob!.width, lastToBlob!.height)).toBe(1600);
    expect(lastToBlob!.width).toBe(1600);
    expect(lastToBlob!.height).toBe(1200);
  });

  it('produces a JPEG blob by default', async () => {
    installStubs({ width: 2000, height: 2000 });
    const blob = await downscaleImage(fakeFile());
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/jpeg');
    expect(lastToBlob!.quality).toBe(0.8);
  });

  it('honors EXIF orientation by decoding from-image', async () => {
    const createBitmap = installStubs({ width: 2000, height: 1000 });
    await downscaleImage(fakeFile());
    expect(createBitmap).toHaveBeenCalledWith(expect.anything(), { imageOrientation: 'from-image' });
  });

  it('respects the quality param (lower quality → smaller blob)', async () => {
    installStubs({ width: 1000, height: 1000 });
    const hi = await downscaleImage(fakeFile(), { quality: 0.8 });
    const lo = await downscaleImage(fakeFile(), { quality: 0.3 });
    expect(lo.size).toBeLessThan(hi.size);
  });

  it('honors a custom maxEdge override', async () => {
    installStubs({ width: 4000, height: 3000 });
    await downscaleImage(fakeFile(), { maxEdge: 800 });
    expect(Math.max(lastToBlob!.width, lastToBlob!.height)).toBe(800);
    expect(lastToBlob!.width).toBe(800);
    expect(lastToBlob!.height).toBe(600);
  });

  it('honors a custom mimeType override', async () => {
    installStubs({ width: 1000, height: 1000 });
    const blob = await downscaleImage(fakeFile(), { mimeType: 'image/webp' });
    expect(blob.type).toBe('image/webp');
    expect(lastToBlob!.type).toBe('image/webp');
  });

  it('rejects with ImageDecodeError when the canvas yields no blob', async () => {
    installStubs({ width: 1000, height: 1000 });
    // Re-stub toBlob to hand back null (the encoder failing / unsupported type).
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback) {
      cb(null);
    });
    await expect(downscaleImage(fakeFile())).rejects.toBeInstanceOf(ImageDecodeError);
  });

  it('rejects with ImageDecodeError when the browser cannot decode the file', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('bad image'); }));
    await expect(downscaleImage(fakeFile())).rejects.toBeInstanceOf(ImageDecodeError);
  });

  it('rejects with ImageDecodeError when canvas/createImageBitmap is unavailable', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    await expect(downscaleImage(fakeFile())).rejects.toBeInstanceOf(ImageDecodeError);
  });
});
