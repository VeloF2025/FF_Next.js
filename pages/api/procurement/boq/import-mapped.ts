import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import formidable from 'formidable';
import fs from 'fs';
import * as XLSX from 'xlsx';
import { neon } from '@neondatabase/serverless';
import { BOQImportEnhanced, type BOQRow } from '@/services/procurement/import/boqImportEnhanced';
import { createStockMatcher } from '@/services/procurement/import/stockMatcher';
import type { ColumnMapping, BOQTargetField } from '@/types/procurement/boq.types';

export const config = {
  api: { bodyParser: false },
  // Allow up to 120s for large BOQ imports (250+ rows with material matching)
  maxDuration: 120,
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  // Force connection close to prevent Cloudflare tunnel response buffering
  res.setHeader('Connection', 'close');

  try {
    const form = formidable({ maxFileSize: 50 * 1024 * 1024 }); // 50MB

    const [fields, files] = await new Promise<[formidable.Fields, formidable.Files]>(
      (resolve, reject) => {
        form.parse(req, (err, fields, files) => {
          if (err) reject(err);
          else resolve([fields, files]);
        });
      }
    );

    // Extract and validate fields
    const projectId = Array.isArray(fields.projectId) ? fields.projectId[0] : fields.projectId;
    const columnMappingJson = Array.isArray(fields.columnMapping) ? fields.columnMapping[0] : fields.columnMapping;
    const sheetName = Array.isArray(fields.sheetName) ? fields.sheetName[0] : fields.sheetName;
    const headerRowStr = Array.isArray(fields.headerRow) ? fields.headerRow[0] : fields.headerRow;
    const headerRow = Number(headerRowStr);
    const createBudgetItems = (Array.isArray(fields.createBudgetItems) ? fields.createBudgetItems[0] : fields.createBudgetItems) === 'true';
    const createMaterials = (Array.isArray(fields.createMaterials) ? fields.createMaterials[0] : fields.createMaterials) === 'true';
    const saveAsTemplateJson = Array.isArray(fields.saveAsTemplate) ? fields.saveAsTemplate[0] : fields.saveAsTemplate;
    const boqTitle = Array.isArray(fields.title) ? fields.title[0] : fields.title;

    if (!projectId || !columnMappingJson || !sheetName || isNaN(headerRow)) {
      return apiResponse.badRequest(res, 'Missing required fields: projectId, columnMapping, sheetName, headerRow');
    }

    const fileArray = files.file;
    const file = Array.isArray(fileArray) ? fileArray[0] : fileArray;
    if (!file || !file.filepath) {
      return apiResponse.badRequest(res, 'No file uploaded');
    }

    // Parse column mapping
    let columnMapping: ColumnMapping[];
    try {
      columnMapping = JSON.parse(columnMappingJson as string);
    } catch {
      log.error('ImportMappedApi', 'Operation failed', { error });
      return apiResponse.badRequest(res, 'Invalid columnMapping JSON');
    }

    // Read Excel file
    const buffer = fs.readFileSync(file.filepath);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const worksheet = workbook.Sheets[sheetName as string];

    if (!worksheet) {
      return apiResponse.badRequest(res, `Sheet "${sheetName}" not found in workbook`);
    }

    // Parse sheet data
    const data = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: '' });

    // Build field map: targetField -> sourceIndex
    const fieldMap = new Map<BOQTargetField, number>();
    for (const m of columnMapping) {
      if (m.targetField) {
        fieldMap.set(m.targetField, m.sourceIndex);
      }
    }

    // Parse rows using dynamic mapping
    const boqRows: BOQRow[] = [];
    for (let i = headerRow + 1; i < data.length; i++) {
      const row = data[i] as unknown[];
      if (!row || row.length === 0) continue;

      const nonEmptyCells = row.filter(cell => cell !== '' && cell !== null && cell !== undefined);
      if (nonEmptyCells.length <= 1) continue;

      const getValue = (field: BOQTargetField): unknown => {
        const idx = fieldMap.get(field);
        return idx !== undefined ? row[idx] : undefined;
      };

      const boqRow: BOQRow = {
        itemNo: fieldMap.has('itemNo') ? Number(getValue('itemNo')) || undefined : undefined,
        uom: fieldMap.has('uom') ? String(getValue('uom') || '') : '',
        itemCategory: fieldMap.has('itemCategory') ? String(getValue('itemCategory') || '') : '',
        description: fieldMap.has('description') ? String(getValue('description') || '') : '',
        quantity: fieldMap.has('quantity') ? Number(getValue('quantity')) || undefined : undefined,
        itemCode: fieldMap.has('itemCode') ? String(getValue('itemCode') || '') : '',
        itemRate: fieldMap.has('itemRate') ? Number(getValue('itemRate')) || undefined : undefined,
        photonicsRef: fieldMap.has('photonicsRef') ? String(getValue('photonicsRef') || '') : '',
        supplier: fieldMap.has('supplier') ? String(getValue('supplier') || '') : '',
        leadTime: fieldMap.has('leadTime') ? String(getValue('leadTime') || '') : '',
        totalCost: fieldMap.has('totalCost') ? Number(getValue('totalCost')) || undefined : undefined,
      };

      if (boqRow.description && boqRow.description.trim()) {
        boqRows.push(boqRow);
      }
    }

    log.info('Parsed BOQ rows for mapped import', {
      data: {
        totalRows: data.length,
        validRows: boqRows.length,
        mappedFields: fieldMap.size,
      }
    }, 'boq-import');

    // Process import using enhanced service
    const importService = new BOQImportEnhanced(process.env.DATABASE_URL!);
    const result = await importService.processRows(boqRows, {
      projectId: projectId as string,
      title: boqTitle as string | undefined,
      createBudgetItems,
      createMaterials,
    });

    // Match stock items using fuzzy matching pipeline
    const sql = neon(process.env.DATABASE_URL!);
    let stockItemsMatched = 0;

    if (result.boqId) {
      const boqItemRows = await sql`
        SELECT id, item_code, description, category
        FROM boq_items
        WHERE boq_id = ${result.boqId}
          AND description IS NOT NULL AND description != ''
      `;

      if (boqItemRows.length > 0) {
        const stockMatcher = createStockMatcher(process.env.DATABASE_URL!);
        const matchResults = await stockMatcher.matchBatch(
          boqItemRows.map(r => ({
            id: r.id as string,
            itemCode: (r.item_code as string) || null,
            description: r.description as string,
            category: (r.category as string) || null,
          }))
        );

        stockItemsMatched = await stockMatcher.saveMatches(matchResults);
      }
    }

    // Save as template if requested
    if (saveAsTemplateJson) {
      try {
        const saveAsTemplate = JSON.parse(saveAsTemplateJson as string);
        const headers = (data[headerRow] as unknown[]).map(h => String(h || ''));
        const columnMappingRecord: Record<string, BOQTargetField> = {};
        for (const m of columnMapping) {
          if (m.targetField && headers[m.sourceIndex]) {
            columnMappingRecord[headers[m.sourceIndex]] = m.targetField;
          }
        }

        await sql`
          INSERT INTO boq_column_templates (
            name, supplier_name, headers, column_mapping,
            sheet_name, header_row, usage_count
          ) VALUES (
            ${saveAsTemplate.name},
            ${saveAsTemplate.supplierName || null},
            ${headers},
            ${JSON.stringify(columnMappingRecord)},
            ${sheetName},
            ${headerRow},
            0
          )
        `;
        log.info('Saved BOQ column template', { data: { name: saveAsTemplate.name } }, 'boq-import');
      } catch (error) {
        log.warn('Failed to save template', { data: { error: String(error) } }, 'boq-import');
      }
    }

    // Clean up temp file
    try { fs.unlinkSync(file.filepath); } catch (e) { log.error('ImportMappedApi', 'Failed to cleanup temp file', { error: e }); }

    return apiResponse.success(res, {
      ...result,
      stockItemsMatched,
    });
  } catch (error) {
    log.error('BOQ mapped import failed', { data: { error: String(error) } }, 'boq-import');
    return apiResponse.internalError(res, error, 'Failed to import BOQ');
  }
}

export default withAuth(handler);
