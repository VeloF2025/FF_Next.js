import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import formidable from 'formidable';
import fs from 'fs';
import * as XLSX from 'xlsx';
import { neon } from '@neondatabase/serverless';
import { BOQImportEnhanced, type BOQRow } from '@/services/procurement/import/boqImportEnhanced';
import type { ColumnMapping, BOQTargetField } from '@/types/procurement/boq.types';

export const config = { api: { bodyParser: false } };

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

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
      createBudgetItems,
      createMaterials,
    });

    // Match stock items by item_code
    const sql = neon(process.env.DATABASE_URL!);
    let stockItemsMatched = 0;

    if (result.boqId) {
      const stockMatches = await sql`
        SELECT si.id as stock_item_id, si.item_code, bi.id as boq_item_id
        FROM boq_items bi
        JOIN stock_items si ON LOWER(si.item_code) = LOWER(bi.item_code)
        WHERE bi.boq_id = ${result.boqId} AND bi.item_code IS NOT NULL AND bi.item_code != ''
      `;

      for (const match of stockMatches) {
        await sql`UPDATE boq_items SET stock_item_id = ${match.stock_item_id} WHERE id = ${match.boq_item_id}`;
      }
      stockItemsMatched = stockMatches.length;
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
    try { fs.unlinkSync(file.filepath); } catch { /* ignore */ }

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
