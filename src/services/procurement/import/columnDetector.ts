/**
 * Smart Column Detection for BOQ Excel Imports
 * Analyzes headers + sample data to auto-detect column mappings.
 */
import * as XLSX from 'xlsx';
import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import type {
  BOQTargetField,
  ColumnMapping,
  ColumnDetectionResult,
} from '@/types/procurement/boq.types';

const FIELD_KEYWORDS: Record<BOQTargetField, string[]> = {
  itemNo: ['item no', 'item number', 'no', '#', 'line', 'line no', 'row'],
  uom: ['uom', 'unit', 'unit of measure', 'measure'],
  itemCategory: ['category', 'item category', 'type', 'group', 'class', 'material type'],
  description: ['description', 'desc', 'item description', 'material', 'name', 'item name', 'material description'],
  quantity: ['quantity', 'qty', 'amount', 'count', 'vol', 'volume', 'no of', 'number of'],
  itemCode: ['item code', 'code', 'sku', 'part', 'part number', 'part no', 'material code', 'product code'],
  itemRate: ['rate', 'unit rate', 'price', 'unit price', 'cost', 'unit cost', 'each'],
  photonicsRef: ['photonics', 'external ref', 'photonics ref', 'ext ref'],
  supplier: ['supplier', 'vendor', 'manufacturer', 'supplied by'],
  leadTime: ['lead time', 'delivery', 'lead', 'eta', 'delivery time'],
  totalCost: ['total', 'total cost', 'total price', 'line total', 'total item cost', 'extended', 'ext cost'],
};

/** Find the sheet with the most data, prefer known names */
function findDataSheet(workbook: XLSX.WorkBook): { sheet: XLSX.WorkSheet; name: string } | null {
  const preferredNames = ['material', 'boq', 'items', 'master'];
  let bestName = '';
  let bestScore = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet!, { header: 1 }) as unknown[][];
    if (data.length < 5) continue;

    const rowCount = data.filter(r => r && r.length > 0).length;
    const nameBonus = preferredNames.some(n => sheetName.toLowerCase().includes(n)) ? 1000 : 0;
    const score = rowCount + nameBonus;

    if (score > bestScore) {
      bestScore = score;
      bestName = sheetName;
    }
  }

  if (!bestName) return null;
  return { sheet: workbook.Sheets[bestName]!, name: bestName };
}

/** Scan first 10 rows to find the header row */
function findHeaderRow(data: unknown[][]): number {
  let bestIndex = -1;
  let bestScore = 0;

  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;

    const textCells = row.filter(
      cell => cell && typeof cell === 'string' && isNaN(Number(cell))
    );
    if (textCells.length < 3) continue;

    let score = textCells.length;
    const rowText = textCells.join(' ').toLowerCase();
    const keywordHits = Object.values(FIELD_KEYWORDS)
      .flat()
      .filter(kw => rowText.includes(kw)).length;
    score += keywordHits * 2;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
}

/** Score how well a header matches a set of keywords */
function scoreKeyword(header: string, keywords: string[]): number {
  for (const kw of keywords) {
    if (header === kw) return 1.0;
    if (header.includes(kw)) return 0.8;
    if (kw.includes(header) && header.length > 2) return 0.6;
  }
  return 0;
}

/** Score how well sample data matches expected patterns for a field */
function scoreDataPattern(field: BOQTargetField, samples: unknown[]): number {
  if (samples.length === 0) return 0;
  const nums = samples.map(v => Number(v)).filter(n => !isNaN(n));
  const strs = samples.filter((v): v is string => typeof v === 'string');

  switch (field) {
    case 'itemNo': {
      if (nums.length < 2) return 0;
      let seq = true;
      for (let i = 1; i < nums.length; i++) { if (nums[i] !== nums[i - 1]! + 1) seq = false; }
      return seq ? 1.0 : 0;
    }
    case 'uom':
      return strs.length > 0 && strs.every(s => s.length <= 15) ? 0.8 : 0;
    case 'description':
      return strs.length > 0 && strs.every(s => s.length > 15) ? 1.0 : 0;
    case 'itemCode':
      return strs.length > 0 && strs.every(s => /^[A-Z0-9].*[-/].*[A-Z0-9]/i.test(s)) ? 1.0 : 0;
    case 'quantity':
      return nums.length > 0 && nums.every(n => n >= 1 && n % 1 === 0) ? 0.6 : 0;
    case 'itemRate':
    case 'totalCost':
      return nums.length > 0 && nums.some(n => n % 1 !== 0) ? 0.8 : 0;
    case 'leadTime':
      return strs.some(s => /weeks?|days?|months?|tbc|n\/a/i.test(s)) ? 1.0 : 0;
    default:
      return 0;
  }
}

/** Match headers to target fields */
function matchHeaders(headers: string[], sampleRows: unknown[][]): ColumnMapping[] {
  const usedTargets = new Set<BOQTargetField>();
  const mappings: ColumnMapping[] = [];

  for (let col = 0; col < headers.length; col++) {
    const header = headers[col];
    if (!header) {
      mappings.push({ sourceIndex: col, sourceHeader: '', targetField: null, confidence: 0, detectionMethod: 'keyword' });
      continue;
    }

    const normalized = header.toLowerCase().trim();
    const sampleValues = sampleRows.map(r => r[col]).filter(v => v !== null && v !== undefined && v !== '');

    let best: { field: BOQTargetField; confidence: number } | null = null;

    for (const [field, keywords] of Object.entries(FIELD_KEYWORDS)) {
      const f = field as BOQTargetField;
      if (usedTargets.has(f)) continue;

      const kwScore = scoreKeyword(normalized, keywords);
      const patScore = scoreDataPattern(f, sampleValues);
      const conf = kwScore * 0.7 + patScore * 0.3;

      if (conf >= 0.5 && (!best || conf > best.confidence)) {
        best = { field: f, confidence: conf };
      }
    }

    if (best) {
      usedTargets.add(best.field);
      mappings.push({
        sourceIndex: col,
        sourceHeader: header,
        targetField: best.field,
        confidence: Math.round(best.confidence * 100) / 100,
        detectionMethod: 'keyword',
      });
    } else {
      mappings.push({
        sourceIndex: col,
        sourceHeader: header,
        targetField: null,
        confidence: 0,
        detectionMethod: 'keyword',
      });
    }
  }

  return mappings;
}

/** Check saved templates for a header match */
export async function checkSavedTemplates(
  headers: string[],
  databaseUrl: string
): Promise<{ id: string; name: string; supplierName?: string; mapping: Record<string, BOQTargetField>; sheetName?: string; headerRow: number } | null> {
  try {
    const sql: any = neon(databaseUrl);
    const templates = await sql`
      SELECT id, name, supplier_name, headers, column_mapping, sheet_name, header_row
      FROM boq_column_templates ORDER BY usage_count DESC
    `;

    for (const t of templates) {
      const tHeaders = t.headers as string[];
      const normalized = headers.map(h => h.toLowerCase().trim());
      const tNormalized = tHeaders.map((h: string) => h.toLowerCase().trim());

      // Exact match
      if (normalized.length === tNormalized.length && normalized.every((h, i) => h === tNormalized[i])) {
        await sql`UPDATE boq_column_templates SET usage_count = usage_count + 1, last_used_at = NOW() WHERE id = ${t.id}`;
        return {
          id: t.id as string,
          name: t.name as string,
          supplierName: t.supplier_name as string | undefined,
          mapping: t.column_mapping as Record<string, BOQTargetField>,
          sheetName: t.sheet_name as string | undefined,
          headerRow: t.header_row as number,
        };
      }

      // Fuzzy: 80%+ headers overlap
      const matchCount = normalized.filter(h => tNormalized.includes(h)).length;
      if (matchCount / Math.max(normalized.length, tNormalized.length) >= 0.8) {
        await sql`UPDATE boq_column_templates SET usage_count = usage_count + 1, last_used_at = NOW() WHERE id = ${t.id}`;
        return {
          id: t.id as string,
          name: t.name as string,
          supplierName: t.supplier_name as string | undefined,
          mapping: t.column_mapping as Record<string, BOQTargetField>,
          sheetName: t.sheet_name as string | undefined,
          headerRow: t.header_row as number,
        };
      }
    }

    return null;
  } catch (error) {
    log.error('Failed to check saved templates', { data: { error: String(error) } }, 'boq-import');
    return null;
  }
}

/** Apply saved template mapping to produce ColumnMapping array */
function applyTemplate(
  headers: string[],
  templateMapping: Record<string, BOQTargetField>
): ColumnMapping[] {
  return headers.map((header, index) => {
    const target = templateMapping[header] || null;
    return {
      sourceIndex: index,
      sourceHeader: header,
      targetField: target,
      confidence: target ? 1.0 : 0,
      detectionMethod: 'template' as const,
    };
  });
}

/**
 * Main entry point: detect columns from an Excel buffer.
 * Checks saved templates first, falls back to heuristic detection.
 */
export async function detectColumns(
  buffer: ArrayBuffer,
  databaseUrl?: string
): Promise<ColumnDetectionResult> {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const found = findDataSheet(workbook);
  if (!found) throw new Error('No valid data sheet found in workbook');

  const data = XLSX.utils.sheet_to_json<unknown[]>(found.sheet, { header: 1, defval: '' });
  const headerRow = findHeaderRow(data);
  if (headerRow === -1) throw new Error('Could not identify header row');

  const headers = (data[headerRow] as unknown[]).map(h => String(h || '').trim()).filter(Boolean);
  const sampleRows = data
    .slice(headerRow + 1)
    .filter(row => {
      const nonEmpty = (row as unknown[]).filter(c => c !== '' && c !== null && c !== undefined);
      return nonEmpty.length > 1;
    })
    .slice(0, 5);

  // Check saved templates first
  if (databaseUrl) {
    const template = await checkSavedTemplates(headers, databaseUrl);
    if (template) {
      const mapping = applyTemplate(headers, template.mapping);
      const validMappings = mapping.filter(m => m.targetField !== null);
      return {
        mapping,
        overallConfidence: validMappings.length > 0
          ? validMappings.reduce((s, m) => s + m.confidence, 0) / validMappings.length
          : 0,
        sheetName: found.name,
        headerRow,
        headers,
        sampleRows: sampleRows as unknown[][],
        templateMatch: { id: template.id, name: template.name, supplierName: template.supplierName },
      };
    }
  }

  // Heuristic detection
  const mapping = matchHeaders(headers, sampleRows as unknown[][]);
  const validMappings = mapping.filter(m => m.targetField !== null);
  const overallConfidence = validMappings.length > 0
    ? validMappings.reduce((s, m) => s + m.confidence, 0) / validMappings.length
    : 0;

  return {
    mapping,
    overallConfidence,
    sheetName: found.name,
    headerRow,
    headers,
    sampleRows: sampleRows as unknown[][],
  };
}
