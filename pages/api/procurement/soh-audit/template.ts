/**
 * GET /api/procurement/soh-audit/template
 * Returns an Excel (.xlsx) template pre-populated with BOQ items and warehouse columns.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import * as XLSX from 'xlsx';
import { neon } from '@neondatabase/serverless';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import type { AuthenticatedNextApiRequest } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

export default withAuth(async (req: NextApiRequest, res: NextApiResponse) => {
  const authReq = req as AuthenticatedNextApiRequest;
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Fetch active warehouses
    const warehouses = await sql`
      SELECT name FROM soh_audit_warehouses
      WHERE is_active = true ORDER BY sort_order ASC, name ASC
    `;
    const warehouseNames = (warehouses as { name: string }[]).map(w => w.name);

    // Fetch distinct BOQ items
    const items = await sql`
      SELECT DISTINCT
        COALESCE(si.item_code, bi.item_code)            AS item_code,
        COALESCE(si.name, bi.description)               AS item_name,
        COALESCE(si.category, bi.category, 'Uncategorized') AS category,
        COALESCE(si.uom, bi.uom, 'units')               AS uom,
        MIN(bi.unit_price)                               AS boq_rate
      FROM boq_items bi
      LEFT JOIN stock_items si ON si.id = bi.stock_item_id
      GROUP BY 1, 2, 3, 4
      ORDER BY 3, 2
    `;

    // Build header row
    const fixedHeaders = ['Item Code', 'Description', 'Category', 'UOM', 'BOQ Rate'];
    const headers = [...fixedHeaders, ...warehouseNames, 'Notes'];

    // Build data rows
    const dataRows = (items as Record<string, unknown>[]).map(item => {
      const row: Record<string, unknown> = {
        'Item Code': item.item_code ?? '',
        'Description': item.item_name ?? '',
        'Category': item.category ?? '',
        'UOM': item.uom ?? '',
        'BOQ Rate': Number(item.boq_rate) || 0,
      };
      for (const wh of warehouseNames) {
        row[wh] = 0;
      }
      row['Notes'] = '';
      return row;
    });

    // Create workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(dataRows, { header: headers });

    // Style header row width
    ws['!cols'] = [
      { wch: 15 }, // Item Code
      { wch: 40 }, // Description
      { wch: 20 }, // Category
      { wch: 8 },  // UOM
      { wch: 12 }, // BOQ Rate
      ...warehouseNames.map(() => ({ wch: 14 })),
      { wch: 30 }, // Notes
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'SOH Audit');

    // Instructions sheet
    const instructions = [
      ['SOH Audit Template — Instructions'],
      [''],
      ['1. Do not change or delete columns A–E (Item Code, Description, Category, UOM, BOQ Rate)'],
      ['2. Enter quantities in the warehouse columns (numbers only)'],
      ['3. Leave blank or enter 0 for items not counted at a location'],
      ['4. The Notes column is optional'],
      ['5. Save as .xlsx and import via the SOH Audit screen in FibreFlow'],
      ['6. Each import creates a new version — previous imports are preserved'],
    ];
    const wsInfo = XLSX.utils.aoa_to_sheet(instructions);
    XLSX.utils.book_append_sheet(wb, wsInfo, 'Instructions');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `soh-audit-template-${new Date().toISOString().slice(0, 10)}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    return res.status(200).send(buffer);
  } catch (err) {
    log.error('Failed to generate SOH template', { error: (err as Error).message }, 'SOHTemplate');
    return res.status(500).json({ error: 'Failed to generate template' });
  }
});
