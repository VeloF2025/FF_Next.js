/**
 * VLM Extraction Service
 * PRD-033: OCR-First Document Upload Flow
 *
 * Calls the Qwen3-VL model via the VLLM endpoint to perform OCR extraction.
 * Also handles post-processing: field mapping, SA ID length validation,
 * and DOB cross-validation.
 */

import { log } from '@/lib/logger';
import { FIELD_MAPPINGS } from './documentClassificationService';
import { getEnhancedPrompt, getBasePrompt } from './documentPromptEnhancer';
import { crossValidateSaIdWithDob } from './saIdValidationService';

/** Standard shape for a single extracted field */
export interface ExtractedField {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
  confidence: number;
  validated: boolean;
}

export type ExtractedFields = Record<string, ExtractedField>;

/** VLLM endpoint for Qwen3-VL */
const VLLM_ENDPOINT = process.env.VLLM_ENDPOINT || 'http://100.96.203.105:8100';

/**
 * Check whether the VLLM service is reachable and serving the VLM model.
 *
 * @returns `true` if the health check passes within 5 seconds, `false` otherwise.
 */
export async function isVllmAvailable(): Promise<boolean> {
  try {
    const healthCheck = await fetch(`${VLLM_ENDPOINT}/v1/models`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return healthCheck.ok;
  } catch {
    log.warn('VLLM endpoint not available for OCR');
    return false;
  }
}

/**
 * Call Qwen3-VL to extract structured data from a document image.
 *
 * @param fileUrl      Internal URL of the uploaded image (accessible by the VLM).
 * @param documentType Document type key used to select the extraction prompt.
 * @returns Raw VLM response content string (JSON embedded in prose).
 * @throws If the VLM HTTP call itself fails.
 */
export async function callVlmForExtraction(
  fileUrl: string,
  documentType: string | undefined
): Promise<string> {
  // Fetch enhanced prompt with SA context + HITL few-shot examples
  let prompt: string;
  try {
    prompt = await getEnhancedPrompt(documentType);
  } catch {
    log.warn('Enhanced prompt failed, falling back to base prompt', { documentType });
    prompt = getBasePrompt(documentType);
  }

  log.info('Calling Qwen3-VL for OCR', { documentType, fileUrl });

  const vlmResponse = await fetch(`${VLLM_ENDPOINT}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'Qwen/Qwen3-VL-8B-Instruct',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: fileUrl } },
          ],
        },
      ],
      max_tokens: 1000,
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(55000),
  });

  if (!vlmResponse.ok) {
    const errorText = await vlmResponse.text();
    throw new Error(`VLM request failed: ${errorText}`);
  }

  const vlmData = await vlmResponse.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = vlmData.choices?.[0]?.message?.content ?? '';
  log.info('VLM response received', { contentLength: content.length });
  return content;
}

/**
 * Parse the raw VLM response into a plain key/value object.
 * Expects the VLM to have returned a JSON object embedded in the text.
 *
 * @returns Parsed key/value record.  Empty object if parsing fails.
 */
export function parseVlmResponse(rawContent: string): Record<string, unknown> {
  try {
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    }
  } catch {
    log.warn('Failed to parse VLM JSON response', { content: rawContent.substring(0, 500) });
  }
  return {};
}

/**
 * Map raw VLM-extracted key/value pairs to normalised `ExtractedFields`.
 *
 * @param extractedData  Plain object returned by `parseVlmResponse`.
 * @param documentType   Document type key used to look up field mappings.
 * @returns Normalised extracted fields with confidence and validation flags.
 */
export function mapExtractedFields(
  extractedData: Record<string, unknown>,
  documentType: string | undefined
): ExtractedFields {
  const fieldMapping = FIELD_MAPPINGS[documentType ?? ''] ?? {};
  const extractedFields: ExtractedFields = {};

  for (const [vlmField, value] of Object.entries(extractedData)) {
    if (value !== null && value !== undefined && value !== '') {
      const mappedField = fieldMapping[vlmField] ?? vlmField;
      extractedFields[mappedField] = {
        value,
        confidence: 0.95, // VLM typically has high confidence
        validated: true,
      };
    }
  }

  return extractedFields;
}

/**
 * Apply SA-ID-specific post-processing rules to an already-mapped field set.
 *
 * Checks that the extracted ID number has exactly 13 digits, and cross-validates
 * the DOB prefix embedded in the ID against the separately extracted `dateOfBirth`
 * field, attempting auto-correction when the Luhn checksum holds.
 *
 * Mutates `extractedFields` in-place and returns it for convenience.
 */
export function applyIdValidationPostProcessing(
  extractedFields: ExtractedFields,
  documentType: string | undefined
): ExtractedFields {
  const isIdDocument =
    documentType === 'sa_id' || documentType === 'id_document';

  if (!isIdDocument || !extractedFields.documentNumber) {
    return extractedFields;
  }

  // --- 1. Length check ---
  const idValue = String(extractedFields.documentNumber.value ?? '').replace(/[\s\-]/g, '');
  if (idValue.length !== 13) {
    log.warn('SA ID extraction returned wrong digit count', {
      extracted: idValue,
      digitCount: idValue.length,
      expected: 13,
      documentType,
    });

    extractedFields._idLengthWarning = {
      value: `Extracted ID "${idValue}" has ${idValue.length} digits instead of 13. Please verify manually.`,
      confidence: 1.0,
      validated: false,
    };

    extractedFields.documentNumber.confidence = 0.5;
    extractedFields.documentNumber.validated = false;
    return extractedFields;
  }

  log.info('SA ID extraction validated', { idValue, digitCount: 13 });

  // --- 2. DOB cross-validation ---
  if (!extractedFields.dateOfBirth) {
    return extractedFields;
  }

  const crossValidation = crossValidateSaIdWithDob(
    extractedFields.documentNumber.value,
    extractedFields.dateOfBirth.value
  );

  if (crossValidation.corrected) {
    log.info('SA ID cross-validation applied correction', {
      original: extractedFields.documentNumber.value,
      corrected: crossValidation.correctedId,
      dob: extractedFields.dateOfBirth.value,
      reason: crossValidation.reason,
    });

    extractedFields.documentNumber = {
      value: crossValidation.correctedId,
      confidence: 0.90, // Slightly lower for auto-corrected values
      validated: true,
    };

    extractedFields._idCorrectionNote = {
      value: crossValidation.reason,
      confidence: 1.0,
      validated: true,
    };
  } else if (crossValidation.mismatch) {
    log.warn('SA ID / DOB mismatch detected but could not auto-correct', {
      id: extractedFields.documentNumber.value,
      dob: extractedFields.dateOfBirth.value,
      reason: crossValidation.reason,
    });

    extractedFields._idValidationWarning = {
      value: crossValidation.reason,
      confidence: 1.0,
      validated: false,
    };
  }

  return extractedFields;
}
