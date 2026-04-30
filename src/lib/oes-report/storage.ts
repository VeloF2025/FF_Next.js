const VF_STORAGE_BASE = process.env.VF_STORAGE_URL ?? 'http://100.96.203.105:8091';
const PUBLIC_STORAGE_BASE = 'https://vf.fibreflow.app/storage';

export async function uploadOesReport(buffer: Buffer, date: string): Promise<string> {
  const filename = `oes-report-${date}.xlsx`;
  const storagePath = `oes/reports/${filename}`;

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

  return `${PUBLIC_STORAGE_BASE}/${storagePath}`;
}
