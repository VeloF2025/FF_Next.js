/**
 * Document Prompt Enhancer
 * PRD-033: OCR-First Document Upload Flow
 *
 * Enriches static VLM prompts with:
 * 1. South African document context and validation rules
 * 2. Common OCR confusion patterns (O vs 0, I vs 1, etc.)
 * 3. HITL few-shot examples from ocrLearningService
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import { log } from '@/lib/logger';
import {
  getOcrFewShotExamples,
  type OcrFewShotExample,
} from '@/modules/qa-learning/services/ocrLearningService';
import { VLM_PROMPTS } from './documentClassificationService';

const MODULE_NAME = 'staff_documents';

// ============================================================================
// SA DOCUMENT CONTEXT — appended to base prompts
// ============================================================================

const SA_CONTEXT: Record<string, string> = {
  drivers_license: `
SOUTH AFRICAN DRIVER'S LICENSE CONTEXT:
- License number format: typically alphanumeric, e.g., "6025000170N4"
- ID number on license is a 13-digit SA ID: YYMMDD SSSS C A Z
- License codes: A (motorcycle), B (light vehicle), C1 (heavy vehicle), EB (articulated)
- Card issued by Department of Transport; holographic smart card since 2000s
- Valid from/to dates printed on front; first issue date on back
- Common OCR confusions: 0 vs O, 1 vs I, 5 vs S, 8 vs B in license number`,

  id_document: `
SOUTH AFRICAN ID DOCUMENT CONTEXT:
- Smart ID card (credit-card size, issued since 2013) or green ID book (older format)
- ID number is EXACTLY 13 digits: YYMMDD SSSS C A Z
  - YYMMDD = date of birth (e.g., 780203 = 3 Feb 1978)
  - SSSS = sequence number (0000-4999 = female, 5000-9999 = male)
  - C = citizenship (0 = SA citizen, 1 = permanent resident)
  - A = usually 8 (was used for race, now deprecated)
  - Z = Luhn checksum digit
- VALIDATION: First 6 digits MUST be a valid date. Digit 11 must be 0 or 1.
- Common OCR confusions: 0↔O, 1↔I, 5↔S, 8↔B — these are ALL digits, never letters
- Green ID book: handwritten fields, often faded — read very carefully`,

  passport: `
SOUTH AFRICAN PASSPORT CONTEXT:
- SA passport numbers: typically A followed by 8 digits (e.g., A12345678)
- MRZ (Machine Readable Zone) at bottom: two lines of 44 characters each
- MRZ contains name, nationality (ZAF), DOB, sex, expiry, passport number
- If OCR of printed text is unclear, cross-reference with MRZ data
- Common OCR confusions in MRZ: 0↔O, 1↔I, B↔8, D↔0, S↔5
- Nationality field: "South African" or "ZAF" (ISO code)
- Issued by Department of Home Affairs`,

  bank_statement: `
SOUTH AFRICAN BANK CONTEXT:
- Major banks: ABSA (632005), FNB (250655), Standard Bank (051001), Nedbank (198765), Capitec (470010)
- Branch codes: 6 digits (universal branch codes are common now)
- Account numbers: typically 10-13 digits depending on bank
- Capitec uses universal branch code 470010 for all branches
- FNB uses universal branch code 250655
- Common OCR confusions in account numbers: 0↔O, 1↔I, 6↔G, 8↔B
- Look for "Account Number", "Acc No", or "Account No" labels`,

  employment_contract: `
SOUTH AFRICAN EMPLOYMENT CONTRACT CONTEXT:
- Must comply with Basic Conditions of Employment Act (BCEA)
- Common formats: CCMA template, company-specific templates
- Key sections: parties, commencement date, remuneration, leave, termination
- ID numbers on contracts are 13-digit SA IDs (validate as above)
- Company registration: format like "2020/123456/07" (year/number/type)
- Salary often stated as monthly CTC (Cost to Company) in ZAR
- Common OCR confusions in registration numbers: 0↔O, I↔1, /↔1`,

  proof_of_residence: `
SOUTH AFRICAN PROOF OF RESIDENCE CONTEXT:
- Accepted documents: utility bill (Eskom, municipality), bank statement, lease agreement
- Must be less than 3 months old (check documentDate)
- SA postal codes: 4 digits (e.g., 0001 = Pretoria, 2001 = Johannesburg)
- Province names: Gauteng, Western Cape, KwaZulu-Natal, Eastern Cape, Free State,
  Limpopo, Mpumalanga, North West, Northern Cape
- Common OCR confusions in postal codes: 0↔O, 1↔I — these are ALL digits
- Municipality names may appear in multiple languages (English, Afrikaans, Zulu)`,
};

// ============================================================================
// FEW-SHOT PROMPT BUILDING (markdown format matching activate module)
// ============================================================================

/**
 * Build a few-shot section using the same format as activate module prompts.
 * Uses the WRONG/CORRECT markdown pattern for consistency across VLM prompts.
 */
function buildFewShotSection(examples: OcrFewShotExample[]): string {
  if (examples.length === 0) return '';

  const lines = [
    '',
    '### CORRECTION EXAMPLES (Learn from past mistakes):',
    '',
  ];

  for (const ex of examples) {
    lines.push(`- Field: ${ex.fieldName}`);
    if (ex.vlmExtractedValue) {
      lines.push(`  ❌ WRONG: "${ex.vlmExtractedValue}"`);
    }
    lines.push(`  ✅ CORRECT: "${ex.correctedValue}"`);
    if (ex.correctionReason) {
      lines.push(`   Note: ${ex.correctionReason}`);
    }
    lines.push('');
  }

  lines.push('Apply these corrections to avoid similar mistakes.');
  return lines.join('\n');
}

// ============================================================================
// DOCUMENT TYPE MAPPING
// ============================================================================

/** Map document type keys to the ocrLearningService document_type values */
const DOC_TYPE_MAP: Record<string, string> = {
  drivers_license: 'drivers_license',
  id_document: 'sa_id',
  sa_id: 'sa_id',
  passport: 'passport',
  bank_statement: 'bank_confirmation',
  bank_details: 'bank_confirmation',
  employment_contract: 'employment_contract',
  proof_of_residence: 'proof_of_residence',
};

// ============================================================================
// MAIN EXPORT: getEnhancedPrompt
// ============================================================================

/**
 * Get an enhanced VLM prompt for a document type.
 *
 * Combines:
 * 1. Base static prompt from VLM_PROMPTS
 * 2. SA document context and OCR confusion patterns
 * 3. HITL few-shot examples (if any exist in the database)
 *
 * Falls back to the base prompt if few-shot retrieval fails.
 * This is the async replacement for direct VLM_PROMPTS[type] lookups.
 */
export async function getEnhancedPrompt(
  documentType: string | undefined
): Promise<string> {
  const docType = documentType ?? '';
  const basePrompt = VLM_PROMPTS[docType] ?? VLM_PROMPTS['default'] ?? 'Extract all visible text and data from this document. Return ONLY valid JSON.';

  // Resolve the canonical type for SA context and few-shot lookup
  const canonicalType =
    docType === 'sa_id' ? 'id_document' :
    docType === 'bank_details' ? 'bank_statement' :
    docType;

  // Layer 1: Add SA document context
  const saContext = SA_CONTEXT[canonicalType] ?? '';

  // Layer 2: Fetch few-shot examples (non-blocking — empty array on failure)
  let fewShotSection = '';
  const learningDocType = DOC_TYPE_MAP[docType];

  if (learningDocType) {
    try {
      const examples = await getOcrFewShotExamples(
        MODULE_NAME,
        learningDocType,
        { maxExamples: 3, canonicalOnly: false }
      );

      if (examples.length > 0) {
        fewShotSection = buildFewShotSection(examples);
        log.info(`Injected ${examples.length} few-shot examples for ${docType}`, {
          documentType: docType,
          learningDocType,
        });
      }
    } catch (error) {
      log.warn('Few-shot retrieval failed, using base prompt', {
        documentType: docType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Combine: base prompt + SA context + few-shot examples
  let enhanced = basePrompt;
  if (saContext) {
    enhanced += `\n${saContext}`;
  }
  if (fewShotSection) {
    enhanced += `\n${fewShotSection}`;
  }

  return enhanced;
}

/**
 * Synchronous prompt lookup — for cases where async is not possible.
 * Returns the base prompt without few-shot examples.
 */
export function getBasePrompt(documentType: string | undefined): string {
  const docType = documentType ?? '';
  return VLM_PROMPTS[docType] ?? VLM_PROMPTS['default'] ?? 'Extract all visible text and data from this document. Return ONLY valid JSON.';
}
