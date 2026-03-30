/**
 * Agreement PDF Generation API (PRD-058)
 * POST /api/projects/[projectId]/agreements/generate-pdf
 * Generates SOW or MBA PDF documents
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { safeObjectQuery } from '@/lib/safe-query';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { generateSOWHtml, SOWTemplateData } from '@/templates/agreements/sow-template';
import { generateMBAHtml, MBATemplateData } from '@/templates/agreements/mba-template';

const getSql = () => neon(process.env.DATABASE_URL!);

interface GeneratePDFRequest {
  agreementType: 'sow' | 'mba';
  contractorId: string;
  referenceNumber?: string;
  effectiveDate: string;
  expiryDate: string;
  totalValue?: number;
  paymentTerms?: string;

  // SOW-specific
  scopeItems?: Array<{
    item: string;
    description: string;
    quantity?: number;
    unit?: string;
    unitRate?: number;
    total?: number;
  }>;
  milestones?: Array<{
    name: string;
    dueDate: string;
    deliverable: string;
  }>;
  warrantyPeriod?: string;
  retentionPercentage?: number;
  specialConditions?: string[];

  // MBA-specific
  geographicScope?: string;
  defectsLiabilityPeriod?: string;
  publicLiabilityAmount?: number;
  professionalIndemnityAmount?: number;
  workersCompRequired?: boolean;
  bbbeeLevel?: string;
  taxClearanceRequired?: boolean;
  cidbGrading?: string;
  noticePeriod?: string;
  disputeResolution?: string;
}

interface Project {
  id: string;
  project_name: string;
  location?: string;
  description?: string;
  client_id?: string;
  client_name?: string;
  client_address?: string;
}

interface Contractor {
  id: string;
  name: string;
  company_name?: string;
  address?: string;
  contact_person?: string;
  registration_number?: string;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const { projectId } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.badRequest(res, 'Project ID is required');
  }

  const sql = getSql();
  const body = req.body as GeneratePDFRequest;

  if (!body.agreementType || !['sow', 'mba'].includes(body.agreementType)) {
    return apiResponse.badRequest(res, 'Valid agreement type (sow or mba) is required');
  }

  if (!body.contractorId) {
    return apiResponse.badRequest(res, 'Contractor ID is required');
  }

  if (!body.effectiveDate || !body.expiryDate) {
    return apiResponse.badRequest(res, 'Effective date and expiry date are required');
  }

  try {
    // Fetch project details
    const project = await safeObjectQuery<Project>(
      async () => {
        const rows = await sql`
          SELECT
            p.id,
            p.project_name,
            p.location,
            p.description,
            p.client_id,
            c.company_name as client_name,
            c.address as client_address
          FROM projects p
          LEFT JOIN clients c ON p.client_id = c.id
          WHERE p.id = ${projectId}
        `;
        return (rows[0] as Project) || null;
      }
    );

    if (!project) {
      return apiResponse.notFound(res, 'Project', projectId);
    }

    // Fetch contractor details
    const contractor = await safeObjectQuery<Contractor>(
      async () => {
        const rows = await sql`
          SELECT
            id,
            company_name AS name,
            company_name,
            physical_address AS address,
            contact_person,
            registration_number
          FROM contractors
          WHERE id = ${body.contractorId}
        `;
        return (rows[0] as Contractor) || null;
      }
    );

    if (!contractor) {
      return apiResponse.notFound(res, 'Contractor', body.contractorId);
    }

    // Generate reference number if not provided
    const referenceNumber = body.referenceNumber || generateReferenceNumber(body.agreementType, projectId);

    let html: string;

    if (body.agreementType === 'sow') {
      const templateData: SOWTemplateData = {
        referenceNumber,
        effectiveDate: body.effectiveDate,
        expiryDate: body.expiryDate,
        clientName: project.client_name || 'VelocityFibre',
        clientAddress: project.client_address,
        contractorName: contractor.company_name || contractor.name,
        contractorAddress: contractor.address,
        contractorContact: contractor.contact_person,
        projectName: project.project_name,
        projectLocation: project.location,
        projectDescription: project.description,
        scopeItems: body.scopeItems || [
          { item: 'Fiber Installation', description: 'As per project specifications', quantity: 1, unit: 'lot', total: body.totalValue || 0 }
        ],
        totalValue: body.totalValue || 0,
        currency: 'ZAR',
        paymentTerms: body.paymentTerms,
        milestones: body.milestones,
        warrantyPeriod: body.warrantyPeriod,
        retentionPercentage: body.retentionPercentage,
        specialConditions: body.specialConditions,
      };

      html = generateSOWHtml(templateData);
    } else {
      const templateData: MBATemplateData = {
        referenceNumber,
        effectiveDate: body.effectiveDate,
        expiryDate: body.expiryDate,
        clientName: project.client_name || 'VelocityFibre',
        clientAddress: project.client_address,
        contractorName: contractor.company_name || contractor.name,
        contractorRegistration: contractor.registration_number,
        contractorAddress: contractor.address,
        contractorRepresentative: contractor.contact_person,
        geographicScope: body.geographicScope,
        currency: 'ZAR',
        paymentTerms: body.paymentTerms || 'Net 30 days from invoice date',
        retentionPercentage: body.retentionPercentage,
        defectsLiabilityPeriod: body.defectsLiabilityPeriod,
        publicLiabilityAmount: body.publicLiabilityAmount,
        professionalIndemnityAmount: body.professionalIndemnityAmount,
        workersCompRequired: body.workersCompRequired,
        bbbeeLevel: body.bbbeeLevel,
        taxClearanceRequired: body.taxClearanceRequired,
        cidbGrading: body.cidbGrading,
        noticePeriod: body.noticePeriod,
        disputeResolution: body.disputeResolution,
      };

      html = generateMBAHtml(templateData);
    }

    // Generate PDF using Puppeteer
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '10mm',
        left: '10mm',
      },
    });

    await browser.close();

    log.info('AgreementPDFGenerated', {
      projectId,
      agreementType: body.agreementType,
      referenceNumber,
      contractorId: body.contractorId,
    });

    // Convert Uint8Array to Buffer so Next.js sends binary, not JSON
    const buffer = Buffer.from(pdfBuffer);

    // Set response headers for PDF download
    const filename = `${body.agreementType.toUpperCase()}_${referenceNumber.replace(/\//g, '-')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);

    return res.send(buffer);
  } catch (error) {
    log.error('AgreementPDFGeneration', {
      projectId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return apiResponse.internalError(res, error as Error);
  }
}

function generateReferenceNumber(type: 'sow' | 'mba', projectId: string): string {
  const prefix = type === 'sow' ? 'SOW' : 'MBA';
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const shortId = projectId.substring(0, 8).toUpperCase();
  const seq = String(Math.floor(Math.random() * 1000)).padStart(3, '0');

  return `${prefix}/${year}${month}/${shortId}/${seq}`;
}

export default withAuth(handler);

export const config = {
  api: {
    responseLimit: '10mb',
  },
};
