/**
 * Client-side helpers for the EOD batch upload queue.
 * These run in the browser — fetch() only, no SQL.
 */

import type { EodVlmExtraction, EodSavePayload } from '../types';

export async function extractSheetFile(file: File): Promise<EodVlmExtraction> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.split(',')[1]!);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const res = await fetch('/api/eod/extract', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64 }),
  });
  const json = await res.json() as { success: boolean; data: EodVlmExtraction; message?: string };
  if (!json.success) throw new Error(json.message ?? 'Extraction failed');
  return json.data;
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
  const json = await res.json() as { success: boolean; data: { matched_count: number }; message?: string };
  if (!json.success) throw new Error(json.message ?? 'Save failed');
  return json.data;
}
