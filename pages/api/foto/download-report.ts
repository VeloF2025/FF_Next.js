/**
 * GET /api/foto/download-report?dr_number=DR1234567
 * Download comprehensive markdown evaluation report
 * Returns markdown file as attachment
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getEvaluationByDR } from '@/modules/photo-review/services/fotoDbService';
import { generateMarkdownReport, generateReportFilename } from '@/modules/photo-review/services/markdownReportService';
import { validateDrNumber } from '@/modules/photo-review/utils/drValidator';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { dr_number } = req.query;

    if (!dr_number || typeof dr_number !== 'string') {
      return res.status(400).json({
        error: 'Missing parameter',
        message: 'DR number is required',
      });
    }

    // Validate DR number format and check for SQL injection
    const validation = validateDrNumber(dr_number);

    if (!validation.valid) {
      return res.status(400).json({
        error: 'Invalid DR number',
        message: validation.error,
      });
    }

    const sanitizedDr = validation.sanitized!;

    // Fetch evaluation from database
    const evaluation = await getEvaluationByDR(sanitizedDr);

    if (!evaluation) {
      return res.status(404).json({
        error: 'Evaluation not found',
        message: `No evaluation found for DR ${sanitizedDr}. Please run evaluation first.`,
      });
    }

    // Generate comprehensive markdown report
    const markdownContent = generateMarkdownReport(evaluation);
    const filename = generateReportFilename(sanitizedDr, evaluation.evaluation_date);

    // Set headers for file download
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    // Send markdown content
    return res.status(200).send(markdownContent);
  } catch (error) {
    console.error('Error generating report:', error);
    return res.status(500).json({
      error: 'Failed to generate report',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
