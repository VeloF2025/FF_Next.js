/**
 * Browser-side calls to the H&S attachment API.
 *
 * Kept out of the components so a create form — which can only upload after the
 * record it attaches to exists — can drive the same upload the detail widget
 * uses, without duplicating the multipart assembly or the error handling.
 */

import type { AttachmentSurface } from '../../services/hsAttachmentPolicy';

export interface AttachmentSummary {
  id: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  uploaded_by: string;
  created_at: string;
}

const ENDPOINT = '/api/health-safety/attachments';

/** The authenticated route is the only way to read the bytes. */
export function attachmentDownloadUrl(attachmentId: string, inline = false): string {
  return `${ENDPOINT}/download?id=${encodeURIComponent(attachmentId)}${inline ? '&inline=true' : ''}`;
}

/**
 * Pull the server's message out of an apiResponse envelope.
 *
 * The envelope nests the message differently depending on which helper built
 * it, so all three shapes are read rather than the caller being shown "Upload
 * failed" when the server explained precisely what was wrong.
 */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const json = await res.json();
    return json?.error?.message || json?.message || json?.error || fallback;
  } catch {
    return fallback;
  }
}

export async function uploadAttachment(
  surface: AttachmentSurface,
  parentId: string,
  file: File
): Promise<AttachmentSummary> {
  const body = new FormData();
  body.append('surface', surface);
  body.append('parentId', parentId);
  body.append('file', file);

  const res = await fetch(ENDPOINT, { method: 'POST', credentials: 'include', body });
  if (!res.ok) {
    throw new Error(await errorMessage(res, 'Failed to upload the file'));
  }

  const json = await res.json();
  return (json?.data ?? json) as AttachmentSummary;
}

export async function listAttachments(
  surface: AttachmentSurface,
  parentId: string
): Promise<AttachmentSummary[]> {
  const url = `${ENDPOINT}?surface=${encodeURIComponent(surface)}&parentId=${encodeURIComponent(parentId)}`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    throw new Error(await errorMessage(res, 'Failed to load attachments'));
  }
  const json = await res.json();
  const data = json?.data ?? json;
  return Array.isArray(data) ? (data as AttachmentSummary[]) : [];
}

export async function deleteAttachment(attachmentId: string): Promise<void> {
  const res = await fetch(`${ENDPOINT}/${encodeURIComponent(attachmentId)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await errorMessage(res, 'Failed to remove the attachment'));
  }
}

/** Accepted upload formats, kept in step with the server's allow-list. */
export const ACCEPTED_ATTACHMENT_TYPES = '.pdf,.jpg,.jpeg,.png,.doc,.docx';
export const MAX_ATTACHMENT_MB = 10;

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
