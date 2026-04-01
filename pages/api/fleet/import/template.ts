/**
 * Fleet Import Template Download API
 * GET /api/fleet/import/template?type=odometer|fuel
 * Returns a pre-formatted .xlsx template with headers and example row
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as XLSX from 'xlsx';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';

const TEMPLATES: Record<string, { headers: string[]; example: (string | number)[] }> = {
  odometer: {
    headers: ['Registration', 'Date', 'Odometer'],
    example: ['MW94RBGP', '2026-04-01', 5869],
  },
  fuel: {
    headers: ['Registration', 'Date', 'Amount', 'Litres', 'Station', 'Odometer'],
    example: ['MW94RBGP', '2026-04-01', 650.00, 31.5, 'Shell Midrand', 5869],
  },
};

export default withAuth(withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const type = req.query.type as string;
  const template = TEMPLATES[type];

  if (!template) {
    return apiResponse.validationError(res, { type: 'Must be "odometer" or "fuel"' });
  }

  const ws = XLSX.utils.aoa_to_sheet([template.headers, template.example] as (string | number)[][]);
  ws['!cols'] = template.headers.map(() => ({ wch: 16 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Fleet ${type.charAt(0).toUpperCase() + type.slice(1)} Import`);

  const buffer = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="fleet-${type}-import-template.xlsx"`);

  return res.status(200).send(buffer);
}));
