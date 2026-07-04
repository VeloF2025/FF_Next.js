// src/lib/vfStorageUpload.ts
// Server-side upload of a base64 photo to VF Storage. Shared by the SiteCam
// upload and escalate endpoints so escalation photos land in the same store
// (and pass the isAllowedPhotoUrl guard) as regular submissions.

const VF_STORAGE_URL = process.env.VF_STORAGE_URL ?? 'http://100.96.203.105:8091';

/** Strip any path components / unsafe chars from a client-supplied filename. */
export function safeFilename(name: unknown): string {
  const base = typeof name === 'string' ? name.split(/[/\\]/).pop() ?? '' : '';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
  return cleaned || `photo_${Date.now()}.jpg`;
}

export async function uploadToVfStorage(filename: string, base64: string): Promise<string> {
  const buffer = Buffer.from(base64, 'base64');
  const formData = new FormData();
  formData.append('file', new Blob([buffer], { type: 'image/jpeg' }), filename);

  // VF Storage only exposes typed upload routes: /upload/:type/:category.
  // Bare /upload returns 404, causing SiteCam to fail the final submission after
  // every step has already passed. Keep SiteCam photos grouped and return the
  // app-safe same-origin /storage proxy path used by the rest of FibreFlow.
  const resp = await fetch(`${VF_STORAGE_URL}/upload/sitecam/photos`, { method: 'POST', body: formData });
  if (!resp.ok) throw new Error(`VF Storage upload failed: HTTP ${resp.status}`);
  const json = await resp.json() as { path?: string; url?: string };
  if (json.path) return `/storage/${json.path}`;
  if (json.url) return json.url;
  throw new Error('VF Storage returned no path or url');
}
