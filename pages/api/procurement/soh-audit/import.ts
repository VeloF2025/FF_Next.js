/**
 * POST /api/procurement/soh-audit/import
 * Multipart Excel upload — creates a new version-stamped SOH audit.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import * as XLSX from 'xlsx';
import formidable from 'formidable';
import fs from 'fs';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import type { AuthenticatedNextApiRequest } from '@/lib/auth';

export const config = { api: { bodyParser: false } };

const sql = neon(process.env.DATABASE_URL!);

const FIXED_COLS = ['Item Code', 'Description', 'Category', 'UOM', 'BOQ Rate'];

export default withAuth(async (req: NextApiRequest, res: NextApiResponse) => {
  const authReq = req as AuthenticatedNextApiRequest;
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method!, ['POST']);

  try {
    // Parse multipart form
    const form = formidable({ maxFileSize: 10 * 1024 * 1024 });
    const [fields, files] = await form.parse(req);

    const versionLabel = Array.isArray(fields.version_label) ? fields.version_label[0] : fields.version_label;
    const notes = Array.isArray(fields.notes) ? fields.notes[0] : fields.notes;
    const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;

    if (!versionLabel) return apiResponse.badRequest(res, 'version_label field is required');
    if (!uploadedFile) return apiResponse.badRequest(res, 'file field is required');

    // Parse Excel
    const fileBuffer = fs.readFileSync(uploadedFile.filepath);
    const wb = XLSX.read(fileBuffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]!]!;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: 0 });

    if (rows.length === 0) return apiResponse.badRequest(res, 'Excel file contains no data rows');

    // Detect warehouse columns (everything after fixed cols except Notes)
    const firstRow = rows[0]!;
    const allCols = Object.keys(firstRow);
    const warehouseCols = allCols.filter(
      c => !FIXED_COLS.includes(c) && c !== 'Notes'
    );

    // Validate warehouses exist
    const knownWarehouses = await sql`
      SELECT name FROM soh_audit_warehouses WHERE is_active = true
    `;
    const knownNames = new Set((knownWarehouses as { name: string }[]).map(w => w.name));
    const unknownWarehouses = warehouseCols.filter(c => !knownNames.has(c));
    if (unknownWarehouses.length > 0) {
      return apiResponse.badRequest(res, `Unknown warehouse columns: ${unknownWarehouses.join(', ')}. Add them first via the warehouse manager.`);
    }

    // Create version
    const userEmail = (req as AuthenticatedNextApiRequest & { user?: { email?: string } }).user?.email ?? 'system';
    const versionRows = await sql`
      INSERT INTO soh_audit_versions (version_label, notes, created_by)
      VALUES (${versionLabel.trim()}, ${notes ?? null}, ${userEmail})
      RETURNING id::text
    `;
    const versionId = (versionRows[0] as { id: string }).id;

    // Insert entries
    let imported = 0;
    for (const row of rows) {
      const itemName = String(row['Description'] ?? row['item_name'] ?? '').trim();
      if (!itemName) continue;

      const quantities: Record<string, number> = {};
      for (const wh of warehouseCols) {
        const qty = Number(row[wh]);
        if (!isNaN(qty) && qty > 0) quantities[wh] = qty;
      }

      await sql`
        INSERT INTO soh_audit_entries
          (version_id, item_code, item_name, category, uom, boq_rate, quantities, notes)
        VALUES (
          ${versionId}::uuid,
          ${String(row['Item Code'] ?? '').trim() || null},
          ${itemName},
          ${String(row['Category'] ?? 'Uncategorized').trim()},
          ${String(row['UOM'] ?? 'units').trim()},
          ${Number(row['BOQ Rate']) || 0},
          ${JSON.stringify(quantities)},
          ${String(row['Notes'] ?? '').trim() || null}
        )
      `;
      imported++;
    }

    // Cleanup temp file
    fs.unlinkSync(uploadedFile.filepath);

    return apiResponse.created(res, { version_id: versionId, rows_imported: imported });
  } catch (err) {
    log.error('SOH import failed', { error: (err as Error).message }, 'SOHImport');
    return apiResponse.internalError(res, 'Import failed');
  }
});
