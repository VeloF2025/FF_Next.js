/**
 * API Route: Export Contractor Documents Report
 *
 * GET /api/contractors-documents-export?contractorId={id}&format={csv|pdf}
 *
 * Exports contractor document report as CSV or PDF
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { generateContractorDocumentReport } from '@/modules/contractor-documents-report/services/documentReportService';
import { generateContractorReportCSV } from '@/modules/contractor-documents-report/services/documentExportService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { contractorId, format } = req.query;

    // Validation
    if (!contractorId || typeof contractorId !== 'string') {
      return res.status(400).json({ error: 'Contractor ID is required' });
    }

    if (!format || (format !== 'csv' && format !== 'pdf')) {
      return res.status(400).json({ error: 'Invalid format. Use "csv" or "pdf"' });
    }

    // Generate report
    const report = await generateContractorDocumentReport(contractorId);

    if (!report) {
      return res.status(404).json({ error: 'Contractor not found' });
    }

    // Export as CSV
    if (format === 'csv') {
      const csv = generateContractorReportCSV(report);
      const filename = `${report.contractor.name.replace(/\s+/g, '_')}_Documents_Report_${
        new Date().toISOString().split('T')[0]
      }.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).send(csv);
    }

    // Export as PDF (placeholder - to be implemented)
    if (format === 'pdf') {
      return res.status(501).json({ error: 'PDF export not yet implemented' });
    }

    return res.status(400).json({ error: 'Invalid format' });
  } catch (error) {
    log.error('[contractors-documents-export] Error', { error });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export default withAuth(handler);
