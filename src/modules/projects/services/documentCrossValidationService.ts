/**
 * Document Cross-Validation Service
 *
 * Extracts data from BSS/MSS PDFs via VLM and cross-validates against Client PO.
 * Only runs when all 3 documents (PO + BSS + MSS) are uploaded.
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import { log } from '@/lib/logger';
import { createLoggedSql } from '@/lib/db-logger';
import { normalizeStorageUrl } from '@/services/vfStorageAdapter';
import { VLM_CHAT_ENDPOINT, VLM_EXTRACTION_MODEL, VLM_TIMEOUT_DOCUMENT, VLM_MAX_TOKENS_QA } from '@/lib/vlm';

const sql = createLoggedSql(process.env.DATABASE_URL!);

// ============================================================================
// TYPES
// ============================================================================

export interface DocumentExtractionResult {
  drops: number | null;
  pricePerDrop: number | null;
  totalValue: number | null;
  poReference: string | null;
  description: string | null;
  confidence: number;
}

export interface CrossValidationResult {
  status: 'passed' | 'failed' | 'warning';
  isValid: boolean;
  discrepancies: Discrepancy[];
  confidenceScore: number;
  po: { drops: number | null; pricePerDrop: number | null; totalValue: number | null };
  bss: DocumentExtractionResult;
  mss: DocumentExtractionResult;
}

interface Discrepancy {
  field: string;
  po: number | string | null;
  bss: number | string | null;
  mss: number | string | null;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

// ============================================================================
// VLM PROMPTS
// ============================================================================

const BSS_EXTRACTION_PROMPT = `You are analyzing a Build Service Schedule (BSS) document for a fiber network project. Extract the key commercial terms.

CRITICAL RULES:
1. Extract EXACTLY what you see - do not calculate or infer values
2. For prices/amounts, use numeric values without currency symbols
3. If a field is not visible or unclear, use null
4. The "drops" is the total number of FTTH drops/connections contracted
5. Look for total quantities, unit rates, and contract values

Return ONLY valid JSON (no markdown, no explanation):
{
  "drops": <total drops/connections as integer or null>,
  "pricePerDrop": <unit rate per drop as number or null>,
  "totalValue": <total contract value as number or null>,
  "poReference": <PO number reference if mentioned, or null>,
  "description": <brief description of scope, or null>,
  "confidence": <0.0 to 1.0>
}`;

const MSS_EXTRACTION_PROMPT = `You are analyzing a Maintenance Service Schedule (MSS) document for a fiber network project. Extract the key commercial terms.

CRITICAL RULES:
1. Extract EXACTLY what you see - do not calculate or infer values
2. For prices/amounts, use numeric values without currency symbols
3. If a field is not visible or unclear, use null
4. The "drops" is the total number of FTTH drops/connections covered
5. Look for total quantities, maintenance rates, and contract values

Return ONLY valid JSON (no markdown, no explanation):
{
  "drops": <total drops/connections as integer or null>,
  "pricePerDrop": <unit rate per drop as number or null>,
  "totalValue": <total contract value as number or null>,
  "poReference": <PO number reference if mentioned, or null>,
  "description": <brief description of scope, or null>,
  "confidence": <0.0 to 1.0>
}`;

// ============================================================================
// VLM API
// ============================================================================

async function callVlm(imageDataUrl: string, prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VLM_TIMEOUT_DOCUMENT);

  try {
    const response = await fetch(VLM_CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: VLM_EXTRACTION_MODEL,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageDataUrl } },
            { type: 'text', text: prompt },
          ],
        }],
        max_tokens: VLM_MAX_TOKENS_QA,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      throw new Error(`VLM API returned ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timeout);
  }
}

function parseVlmResponse(text: string): DocumentExtractionResult {
  // Strip markdown code fences if present
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  try {
    const parsed = JSON.parse(cleaned);
    return {
      drops: parsed.drops != null ? Math.round(Number(parsed.drops)) : null,
      pricePerDrop: parsed.pricePerDrop != null ? Number(parsed.pricePerDrop) : null,
      totalValue: parsed.totalValue != null ? Number(parsed.totalValue) : null,
      poReference: parsed.poReference || null,
      description: parsed.description || null,
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5)),
    };
  } catch {
    log.error('Failed to parse VLM response', { text: text.slice(0, 200) }, 'DocCrossVal');
    return { drops: null, pricePerDrop: null, totalValue: null, poReference: null, description: null, confidence: 0 };
  }
}

// ============================================================================
// PDF → IMAGE CONVERSION
// ============================================================================

async function pdfToImages(pdfUrl: string): Promise<string[]> {
  const { execSync } = await import('child_process');
  const { mkdtempSync, readdirSync, readFileSync, unlinkSync, writeFileSync } = await import('fs');
  const { join } = await import('path');
  const os = await import('os');

  const tmpDir = mkdtempSync(join(os.tmpdir(), 'docval-'));

  try {
    // Download PDF
    const pdfPath = join(tmpDir, 'doc.pdf');
    const response = await fetch(pdfUrl);
    if (!response.ok) throw new Error(`Failed to download PDF: ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(pdfPath, buffer);

    // Convert first 3 pages to JPEG
    const outPrefix = join(tmpDir, 'page');
    execSync(`pdftoppm -jpeg -r 150 -scale-to 1024 -l 3 "${pdfPath}" "${outPrefix}"`, {
      timeout: 30000,
    });

    // Read generated images
    const files = readdirSync(tmpDir)
      .filter(f => f.startsWith('page') && f.endsWith('.jpg'))
      .sort();

    const images: string[] = [];
    for (const file of files) {
      const imgBuffer = readFileSync(join(tmpDir, file));
      images.push(`data:image/jpeg;base64,${imgBuffer.toString('base64')}`);
    }

    // Cleanup
    for (const file of readdirSync(tmpDir)) {
      unlinkSync(join(tmpDir, file));
    }

    return images;
  } catch (error) {
    log.error('PDF to image conversion failed', { pdfUrl, error }, 'DocCrossVal');
    return [];
  }
}

// ============================================================================
// EXTRACTION
// ============================================================================

async function extractFromDocument(
  fileUrl: string,
  prompt: string,
  docType: string
): Promise<DocumentExtractionResult> {
  const images = await pdfToImages(fileUrl);
  if (images.length === 0) {
    log.warn(`No images extracted from ${docType}`, { fileUrl }, 'DocCrossVal');
    return { drops: null, pricePerDrop: null, totalValue: null, poReference: null, description: null, confidence: 0 };
  }

  // Try first page, then subsequent pages if confidence is low
  let bestResult: DocumentExtractionResult | null = null;

  for (const image of images.slice(0, 3)) {
    try {
      const responseText = await callVlm(image, prompt);
      const result = parseVlmResponse(responseText);

      if (!bestResult || result.confidence > bestResult.confidence) {
        bestResult = result;
      }

      if (result.confidence >= 0.85) break;
    } catch (error) {
      log.warn(`VLM extraction failed for ${docType} page`, { error }, 'DocCrossVal');
    }
  }

  return bestResult || { drops: null, pricePerDrop: null, totalValue: null, poReference: null, description: null, confidence: 0 };
}

// ============================================================================
// CROSS-VALIDATION LOGIC
// ============================================================================

function crossValidate(
  po: { drops: number | null; pricePerDrop: number | null; totalValue: number | null },
  bss: DocumentExtractionResult,
  mss: DocumentExtractionResult
): CrossValidationResult {
  const discrepancies: Discrepancy[] = [];
  const TOLERANCE = 0.05; // 5% tolerance

  // Check drops consistency
  if (po.drops != null && bss.drops != null) {
    const diff = Math.abs(po.drops - bss.drops) / po.drops;
    if (diff > TOLERANCE) {
      discrepancies.push({
        field: 'drops (PO vs BSS)',
        po: po.drops,
        bss: bss.drops,
        mss: mss.drops,
        severity: diff > 0.1 ? 'error' : 'warning',
        message: `PO has ${po.drops} drops, BSS has ${bss.drops} (${(diff * 100).toFixed(1)}% difference)`,
      });
    }
  }

  if (po.drops != null && mss.drops != null) {
    const diff = Math.abs(po.drops - mss.drops) / po.drops;
    if (diff > TOLERANCE) {
      discrepancies.push({
        field: 'drops (PO vs MSS)',
        po: po.drops,
        bss: bss.drops,
        mss: mss.drops,
        severity: diff > 0.1 ? 'error' : 'warning',
        message: `PO has ${po.drops} drops, MSS has ${mss.drops} (${(diff * 100).toFixed(1)}% difference)`,
      });
    }
  }

  if (bss.drops != null && mss.drops != null) {
    const diff = Math.abs(bss.drops - mss.drops) / bss.drops;
    if (diff > TOLERANCE) {
      discrepancies.push({
        field: 'drops (BSS vs MSS)',
        po: po.drops,
        bss: bss.drops,
        mss: mss.drops,
        severity: 'warning',
        message: `BSS has ${bss.drops} drops, MSS has ${mss.drops} (${(diff * 100).toFixed(1)}% difference)`,
      });
    }
  }

  // Check price per drop (PO vs BSS only — MSS may have different maintenance rate)
  if (po.pricePerDrop != null && bss.pricePerDrop != null) {
    const diff = Math.abs(po.pricePerDrop - bss.pricePerDrop) / po.pricePerDrop;
    if (diff > TOLERANCE) {
      discrepancies.push({
        field: 'pricePerDrop (PO vs BSS)',
        po: po.pricePerDrop,
        bss: bss.pricePerDrop,
        mss: mss.pricePerDrop,
        severity: diff > 0.2 ? 'error' : 'warning',
        message: `PO rate R${po.pricePerDrop}, BSS rate R${bss.pricePerDrop}`,
      });
    }
  }

  const hasErrors = discrepancies.some(d => d.severity === 'error');
  const hasWarnings = discrepancies.some(d => d.severity === 'warning');

  // Calculate overall confidence from extraction scores
  const avgConfidence = (bss.confidence + mss.confidence) / 2;

  const status = hasErrors ? 'failed' : hasWarnings ? 'warning' : 'passed';
  // Pass if no errors (warnings are acceptable)
  const isValid = !hasErrors;

  return {
    status,
    isValid,
    discrepancies,
    confidenceScore: avgConfidence,
    po,
    bss,
    mss,
  };
}

// ============================================================================
// MAIN: CHECK AND RUN CROSS-VALIDATION
// ============================================================================

/**
 * Check if all 3 documents exist for a project and run cross-validation.
 * Called after any document upload (PO, BSS, or MSS).
 * Returns null if not all 3 documents are present yet.
 */
export async function runCrossValidationIfReady(projectId: string): Promise<CrossValidationResult | null> {
  const startTime = Date.now();

  try {
    // 1. Check for active Client PO
    const poRows = await sql`
      SELECT id, po_number, contracted_drops, price_per_drop, total_value,
             source_document_url, vlm_extraction_data
      FROM client_purchase_orders
      WHERE project_id = ${projectId} AND status = 'active'
      ORDER BY created_at DESC LIMIT 1
    `;

    if (poRows.length === 0) {
      log.info('Cross-validation skipped: no active Client PO', { projectId }, 'DocCrossVal');
      return null;
    }

    const po = poRows[0]!; // Guaranteed by length check above

    // 2. Check for active BSS
    const bssRows = await sql`
      SELECT id, file_url, vlm_extraction_data, vlm_confidence_score
      FROM project_documents
      WHERE project_id = ${projectId} AND document_type = 'bss' AND is_active = true
      ORDER BY created_at DESC LIMIT 1
    `;

    if (bssRows.length === 0) {
      log.info('Cross-validation skipped: no BSS uploaded', { projectId }, 'DocCrossVal');
      return null;
    }

    // 3. Check for active MSS
    const mssRows = await sql`
      SELECT id, file_url, vlm_extraction_data, vlm_confidence_score
      FROM project_documents
      WHERE project_id = ${projectId} AND document_type = 'mss' AND is_active = true
      ORDER BY created_at DESC LIMIT 1
    `;

    if (mssRows.length === 0) {
      log.info('Cross-validation skipped: no MSS uploaded', { projectId }, 'DocCrossVal');
      return null;
    }

    const bssDoc = bssRows[0]!;
    const mssDoc = mssRows[0]!;

    log.info('All 3 documents present — running cross-validation', {
      projectId,
      poNumber: po.po_number,
      bssId: bssDoc.id,
      mssId: mssDoc.id,
    }, 'DocCrossVal');

    // 4. Extract BSS data (use cached if available)
    let bssExtraction: DocumentExtractionResult;
    if (bssDoc.vlm_extraction_data) {
      bssExtraction = bssDoc.vlm_extraction_data as DocumentExtractionResult;
      bssExtraction.confidence = Number(bssDoc.vlm_confidence_score) || bssExtraction.confidence;
    } else {
      const bssUrl = normalizeStorageUrl(bssDoc.file_url) || bssDoc.file_url;
      bssExtraction = await extractFromDocument(bssUrl, BSS_EXTRACTION_PROMPT, 'BSS');
      // Cache extraction result
      await sql`
        UPDATE project_documents
        SET vlm_extraction_data = ${JSON.stringify(bssExtraction)},
            vlm_confidence_score = ${bssExtraction.confidence},
            extraction_status = ${bssExtraction.confidence > 0 ? 'success' : 'failed'}
        WHERE id = ${bssDoc.id}
      `;
    }

    // 5. Extract MSS data (use cached if available)
    let mssExtraction: DocumentExtractionResult;
    if (mssDoc.vlm_extraction_data) {
      mssExtraction = mssDoc.vlm_extraction_data as DocumentExtractionResult;
      mssExtraction.confidence = Number(mssDoc.vlm_confidence_score) || mssExtraction.confidence;
    } else {
      const mssUrl = normalizeStorageUrl(mssDoc.file_url) || mssDoc.file_url;
      mssExtraction = await extractFromDocument(mssUrl, MSS_EXTRACTION_PROMPT, 'MSS');
      // Cache extraction result
      await sql`
        UPDATE project_documents
        SET vlm_extraction_data = ${JSON.stringify(mssExtraction)},
            vlm_confidence_score = ${mssExtraction.confidence},
            extraction_status = ${mssExtraction.confidence > 0 ? 'success' : 'failed'}
        WHERE id = ${mssDoc.id}
      `;
    }

    // 6. PO data from DB (already structured, no VLM needed)
    const poData = {
      drops: Number(po.contracted_drops) || null,
      pricePerDrop: Number(po.price_per_drop) || null,
      totalValue: Number(po.total_value) || null,
    };

    // 7. Cross-validate
    const result = crossValidate(poData, bssExtraction, mssExtraction);

    // 8. Store result
    await sql`
      INSERT INTO document_cross_validations (
        project_id, client_po_id,
        po_document_url, bss_document_id, mss_document_id,
        po_drops, po_price_per_drop, po_total_value,
        bss_drops, bss_price_per_drop, bss_total_value,
        mss_drops, mss_price_per_drop, mss_total_value,
        status, is_valid, discrepancies, confidence_score,
        validated_at
      ) VALUES (
        ${projectId}, ${po.id},
        ${po.source_document_url || null}, ${bssDoc.id}, ${mssDoc.id},
        ${poData.drops}, ${poData.pricePerDrop}, ${poData.totalValue},
        ${bssExtraction.drops}, ${bssExtraction.pricePerDrop}, ${bssExtraction.totalValue},
        ${mssExtraction.drops}, ${mssExtraction.pricePerDrop}, ${mssExtraction.totalValue},
        ${result.status}, ${result.isValid}, ${JSON.stringify(result.discrepancies)}, ${result.confidenceScore},
        NOW()
      )
    `;

    const elapsed = Date.now() - startTime;
    log.info('Cross-validation complete', {
      projectId,
      status: result.status,
      isValid: result.isValid,
      discrepancies: result.discrepancies.length,
      elapsedMs: elapsed,
    }, 'DocCrossVal');

    return result;
  } catch (error) {
    log.error('Cross-validation failed', { projectId, error }, 'DocCrossVal');
    return null;
  }
}

/**
 * Get the latest cross-validation result for a project.
 */
export async function getLatestValidation(projectId: string) {
  const rows = await sql`
    SELECT * FROM document_cross_validations
    WHERE project_id = ${projectId}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows[0] || null;
}
