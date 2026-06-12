/**
 * Saves a step photo (base64 JPEG) to the technician's device so it can be
 * re-uploaded in 1Map. Uses the native share sheet when available (lands in
 * the camera roll on iOS/Android); falls back to a plain file download.
 */

export function stepPhotoFilename(siteId: string, stepNumber: number, when: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}`;
  const safeSite = siteId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${safeSite}_step${stepNumber}_${date}.jpg`;
}

function base64ToBlob(base64: string): Blob {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: 'image/jpeg' });
}

type ShareCapableNavigator = Navigator & {
  canShare?: (data: { files: File[] }) => boolean;
  share?: (data: { files: File[] }) => Promise<void>;
};

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Share-sheet a set of files; returns false when sharing is unavailable (caller should download). */
async function tryShareFiles(files: File[]): Promise<boolean> {
  const nav = navigator as ShareCapableNavigator;
  if (!nav.canShare?.({ files }) || !nav.share) return false;
  try {
    await nav.share({ files });
    return true;
  } catch (err) {
    // User dismissed the sheet — done, don't force a download on top of it.
    if (err instanceof Error && err.name === 'AbortError') return true;
    return false;
  }
}

export async function savePhotoToDevice(base64: string, filename: string): Promise<void> {
  const blob = base64ToBlob(base64);
  const file = new File([blob], filename, { type: 'image/jpeg' });
  // Share sheet first — it's the only route into the photo gallery on mobile.
  if (await tryShareFiles([file])) return;
  downloadBlob(blob, filename);
}

/** Save all step photos at once — one share sheet on mobile, sequential downloads otherwise. */
export async function saveAllPhotosToDevice(
  photos: Array<{ base64: string; filename: string }>,
): Promise<void> {
  if (photos.length === 0) return;
  const files = photos.map((p) => new File([base64ToBlob(p.base64)], p.filename, { type: 'image/jpeg' }));
  if (await tryShareFiles(files)) return;
  for (const p of photos) {
    downloadBlob(base64ToBlob(p.base64), p.filename);
  }
}
