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
    reader.onload = () => resolve((reader.result as string).split(',')[1]!);
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
    data: { duplicate: boolean; existingSheetId?: string; existingSheetDate?: string } & Partial<EodVlmExtraction>;
    message?: string;
  };

  if (!json.success) throw new Error(json.message ?? 'Extraction failed');

  if (json.data.duplicate) {
    return {
      duplicate: true,
      existingSheetId: json.data.existingSheetId!,
      existingSheetDate: json.data.existingSheetDate!,
      photoHash,
    };
  }

  const { duplicate: _d, existingSheetId: _e, existingSheetDate: _ed, ...extraction } = json.data;
  return { duplicate: false, extraction: extraction as EodVlmExtraction, photoHash };
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
  const json = await res.json() as { success: boolean; data: { matched_count: number }; message?: string; code?: string };
  if (!json.success) throw new Error(json.message ?? 'Save failed');
  return json.data;
}
