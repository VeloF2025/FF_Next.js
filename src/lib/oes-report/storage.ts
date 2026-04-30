const VF_STORAGE_BASE = process.env.VF_STORAGE_URL ?? 'http://100.96.203.105:8091';
// VF Storage files are served via app.fibreflow.app/storage/<path>
const PUBLIC_STORAGE_BASE = 'https://app.fibreflow.app/storage';

export async function uploadOesReport(buffer: Buffer, date: string): Promise<string> {
  const filename = `oes-report-${date}.xlsx`;

  const formData = new FormData();
  formData.append(
    'file',
    new Blob([buffer as unknown as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename
  );

  // VF Storage upload route pattern: POST /upload/:type/:category
  const response = await fetch(`${VF_STORAGE_BASE}/upload/oes/reports`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'unknown');
    throw new Error(`VF Storage upload failed (${response.status}): ${text}`);
  }

  // Storage API returns { path: "oes/reports/<timestamp>-<hash>.xlsx", ... }
  const result = (await response.json()) as { path?: string };
  const storedPath = result.path ?? `oes/reports/${filename}`;
  return `${PUBLIC_STORAGE_BASE}/${storedPath}`;
}
