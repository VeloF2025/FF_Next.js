/**
 * API: Generate Master Build Agreement
 *
 * POST /api/documents/generate-master-build
 * Body: { contractorId: string }
 *
 * Returns: DOCX file download
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth } from '@/lib/auth';
import { withErrorHandler } from '@/lib/api-error-handler';
import { log } from '@/lib/logger';
import {
  generateMasterBuildAgreement,
  type ContractorDocData,
} from '@/services/documents/documentGenerationService';

const sql = neon(process.env.DATABASE_URL || '');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { contractorId } = req.body;

  if (!contractorId) {
    return res.status(400).json({ error: 'contractorId is required' });
  }

  try {
    // Fetch contractor data from database
    const contractorResult = await sql`
      SELECT
        id,
        company_name,
        registration_number,
        contact_person,
        email,
        phone,
        physical_address,
        city,
        province,
        postal_code
      FROM contractors
      WHERE id = ${contractorId}
    `;

    const contractor = contractorResult[0];

    if (!contractor) {
      return res.status(404).json({ error: 'Contractor not found' });
    }

    // Build the full address
    const addressParts = [
      contractor.physical_address as string | null,
      contractor.city as string | null,
      contractor.province as string | null,
      contractor.postal_code as string | null,
    ].filter(Boolean);

    const fullAddress = addressParts.join(', ');

    // Prepare data for document generation
    const docData: ContractorDocData = {
      contractor_name: (contractor.company_name as string) || '',
      contractor_reg_number: (contractor.registration_number as string) || '',
      contractor_contact_person: (contractor.contact_person as string) || '',
      contractor_physical_address: fullAddress,
      contractor_email: (contractor.email as string) || '',
      contractor_phone: (contractor.phone as string) || '',
    };

    log.info('Generating Master Build Agreement', {
      contractorId,
      contractorName: docData.contractor_name,
    });

    // Generate the document
    const result = await generateMasterBuildAgreement(docData);

    if (!result.success || !result.buffer) {
      log.error('Document generation failed', { contractorId, error: result.error });
      return res.status(500).json({ error: result.error || 'Document generation failed' });
    }

    // Set headers for file download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('Content-Length', result.buffer.length);

    log.info('Master Build Agreement generated successfully', {
      contractorId,
      filename: result.filename,
    });

    return res.send(result.buffer);
  } catch (error) {
    log.error('Error generating Master Build Agreement', { error, contractorId });
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

export default withAuth(withErrorHandler(handler));
