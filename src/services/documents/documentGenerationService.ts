/**
 * Document Generation Service
 * Uses docxtemplater to generate DOCX documents from templates
 */

import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import fs from 'fs';
import path from 'path';
import { log } from '@/lib/logger';
import { formatDisplayDateLong } from '@/utils/dateFormat';

export interface ContractorDocData {
  contractor_name: string;
  contractor_reg_number: string;
  contractor_contact_person: string;
  contractor_physical_address: string;
  contractor_email: string;
  contractor_phone: string;
  // Agreement details
  agreement_date?: string;
  effective_date?: string;
}

export interface DocumentGenerationResult {
  success: boolean;
  buffer?: Buffer;
  filename?: string;
  error?: string;
}

const TEMPLATES_DIR = path.join(process.cwd(), 'docs/templates');

/**
 * Generate a DOCX document from a template
 */
export async function generateDocument(
  templateName: string,
  data: Record<string, string | number | undefined>
): Promise<DocumentGenerationResult> {
  try {
    const templatePath = path.join(TEMPLATES_DIR, `${templateName}.docx`);

    if (!fs.existsSync(templatePath)) {
      log.error('Template not found', { templatePath });
      return { success: false, error: `Template not found: ${templateName}` };
    }

    const content = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(content);

    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      // Handle undefined values gracefully
      nullGetter: () => '',
    });

    // Replace placeholders with data
    doc.render(data);

    const buffer = doc.getZip().generate({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });

    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${templateName}-${data.contractor_name || 'generated'}-${timestamp}.docx`
      .replace(/[^a-zA-Z0-9.-]/g, '-')
      .replace(/-+/g, '-');

    log.info('Document generated', { templateName, filename });

    return {
      success: true,
      buffer,
      filename,
    };
  } catch (error) {
    log.error('Document generation failed', { error, templateName });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Document generation failed',
    };
  }
}

/**
 * Generate Master Build Agreement for a contractor
 */
export async function generateMasterBuildAgreement(
  contractorData: ContractorDocData
): Promise<DocumentGenerationResult> {
  const today = new Date();
  const formattedDate = formatDisplayDateLong(today);

  const data = {
    ...contractorData,
    agreement_date: contractorData.agreement_date || formattedDate,
    effective_date: contractorData.effective_date || formattedDate,
    // Customer (Velocity Fibre) details are pre-filled in template
  };

  return generateDocument('master-build-agreement', data);
}

/**
 * List available document templates
 */
export function listTemplates(): string[] {
  if (!fs.existsSync(TEMPLATES_DIR)) {
    return [];
  }

  return fs.readdirSync(TEMPLATES_DIR)
    .filter(f => f.endsWith('.docx'))
    .map(f => f.replace('.docx', ''));
}
