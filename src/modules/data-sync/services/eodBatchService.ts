/**
 * Client-side helpers for the EOD batch upload queue.
 * These run in the browser — fetch() only, no SQL.
 */

import type { EodVlmExtraction, EodSavePayload } from '../types';

export type ExtractResult =
  | { duplicate: true; existingSheetId: string; existingSheetDate: string; photoHash: string }
  | { duplicate: false; extraction: EodVlmExtraction; photoHash: string };

async function computeFileHash(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const parts = (reader.result as string).split(',');
      if (parts.length < 2 || !parts[1]) {
        reject(new Error('FileReader produced an unexpected data URL format'));
        return;
      }
      resolve(parts[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function extractSheetFile(file: File): Promise<ExtractResult> {
  const [base64, photoHash] = await Promise.all([readAsBase64(file), computeFileHash(file)]);

  const res = await fetch('/api/eod/extract', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64, photoHash }),
  });

  const json = await res.json() as {
    success: boolean;
    data?: {
      duplicate: boolean;
      existingSheetId?: string;
      existingSheetDate?: string;
    } & Partial<EodVlmExtraction>;
    error?: { message: string };
    message?: string;
  };

  if (!json.success) throw new Error(json.error?.message ?? json.message ?? 'Extraction failed');
  if (!json.data) throw new Error('Empty response from extract endpoint');

  if (json.data.duplicate) {
    const { existingSheetId, existingSheetDate } = json.data;
    if (!existingSheetId || !existingSheetDate) {
      throw new Error('Duplicate response missing sheet details');
    }
    return { duplicate: true, existingSheetId, existingSheetDate, photoHash };
  }

  const { duplicate: _d, existingSheetId: _e, existingSheetDate: _ed, ...rest } = json.data;
  if (!Array.isArray(rest.entries)) throw new Error('Invalid extraction response: missing entries array');
  return { duplicate: false, extraction: rest as EodVlmExtraction, photoHash };
}

/** Convert a PDF File into one synthetic JPEG File per page. */
export async function expandPdfToFiles(file: File): Promise<File[]> {
  const base64 = await readAsBase64(file);
  const res = await fetch('/api/eod/pdf-pages', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdf: base64 }),
  });
  const json = await res.json() as {
    success: boolean;
    data?: { pages: Array<{ pageNumber: number; base64: string }> };
    error?: { message: string };
    message?: string;
  };
  if (!json.success) throw new Error(json.error?.message ?? json.message ?? 'PDF conversion failed');
  if (!json.data?.pages?.length) throw new Error('PDF produced no pages');

  const stem = file.name.replace(/\.pdf$/i, '');
  return json.data.pages.map(({ pageNumber, base64: imgB64 }) => {
    const byteChars = atob(imgB64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    const name = json.data!.pages.length === 1 ? `${stem}.jpg` : `${stem}_p${pageNumber}.jpg`;
    return new File([bytes], name, { type: 'image/jpeg' });
  });
}

export async function saveEodSheet(payload: EodSavePayload): Promise<{ matched_count: number }> {
  const res = await fetch('/api/eod/sheets', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sheetDate: payload.sheetDate,
      technicianName: payload.technicianName,
      technicianId: payload.technicianId,
      photoHash: payload.photoHash ?? null,
      entries: payload.entries.map((e) => ({
        row_number: e.row_number,
        ont_serial: e.ont_serial,
        gizzu_serial: e.gizzu_serial,
        dr_number: e.dr_number,
        pon_number: e.pon_number,
        address: e.address,
      })),
    }),
  });
  const json = await res.json() as {
    success: boolean;
    data?: { matched_count: number };
    error?: { message: string };
    message?: string;
  };
  if (!json.success) throw new Error(json.error?.message ?? json.message ?? 'Save failed');
  return json.data ?? { matched_count: 0 };
}
