/**
 * Field Ops VLM Validation Service
 *
 * Two-stage AI validation for field_ops_wa_photos (upload_status='uploaded', vlm_processed=false):
 * 1. VLM Visual Analysis — Qwen3-VL-8B inspects photos for discipline-specific QA criteria
 *    and extracts the pole number from visible labels.
 * 2. Project Cross-Reference — Validates the extracted pole number against the project SOW
 *    (poles table) and checks PON stage progression.
 *
 * @module field-ops/services/fieldOpsVlmService
 */

import { neon } from '@/lib/db-neon';
import { createLogger } from '@/lib/logger';

const logger = createLogger('fieldOpsVlmService');
const VLM_URL = process.env.VLM_SERVICE_URL || 'http://100.96.203.105:8100';
const VLM_MODEL = 'Qwen3-VL-8B-Instruct';

function getDb() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set');
  return neon(process.env.DATABASE_URL);
}

// ============================================================================
// Types
// ============================================================================

interface UploadedPhoto {
  id: string;
  group_type: string;
  project: string;
  storage_key: string;
  local_path: string;
  wa_group_jid: string;
  message_timestamp: string;
}

interface VlmResult {
  extracted_pole_number: string | null;
  vlm_valid: boolean;
  confidence: number;
  issues: string[];
  feedback: string;
}

interface CrossRefResult {
  valid: boolean;
  issues: string[];
  pole_number: string | null;
  zone_no: number | null;
  pon_no: number | null;
}

// ============================================================================
// VLM Prompts
// ============================================================================

const CIVIL_PROMPT = `You are a civil construction QA inspector for fiber network pole installations.
Analyze this photo and respond with ONLY a valid JSON object.
Check: 1) Pole verticality, 2) Depth marker visible, 3) Ground compaction, 4) Stay wires installed, 5) Pole label/number.
JSON format:
{"extracted_pole_number":"POL-001 or null","valid":true,"confidence":0.0,"issues":[],"feedback":"one sentence"}`;

const OPTICAL_PROMPT = `You are a fiber optic construction QA inspector for aerial fiber installations.
Analyze this photo and respond with ONLY a valid JSON object.
Check: 1) Cable tension appropriate, 2) Sag within spec, 3) Splice dome sealed, 4) Cable markings.
JSON format:
{"extracted_pole_number":null,"valid":true,"confidence":0.0,"issues":[],"feedback":"one sentence"}`;

// ============================================================================
// Stage 1: VLM Visual Analysis
// ============================================================================

function parseVlmResponse(text: string): VlmResult {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const p = JSON.parse(jsonMatch[0]);
      return {
        extracted_pole_number: p.extracted_pole_number ? String(p.extracted_pole_number) : null,
        vlm_valid: Boolean(p.valid ?? p.pass ?? false),
        confidence: Math.min(1, Math.max(0, Number(p.confidence ?? 0))),
        issues: Array.isArray(p.issues) ? p.issues : [],
        feedback: String(p.feedback || ''),
      };
    }
  } catch { /* fall through */ }

  const lower = text.toLowerCase();
  const valid = lower.includes('pass') || lower.includes('acceptable');
  return {
    extracted_pole_number: null,
    vlm_valid: valid,
    confidence: valid ? 0.5 : 0.2,
    issues: valid ? [] : ['Manual review required — AI could not parse response'],
    feedback: text.slice(0, 300),
  };
}

/**
 * Call Qwen3-VL to analyse a construction photo and extract QA results.
 */
async function runVlmAnalysis(photoPath: string, discipline: string): Promise<VlmResult> {
  const prompt = discipline === 'civil' ? CIVIL_PROMPT : OPTICAL_PROMPT;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3004';
  const imageUrl = photoPath.startsWith('http')
    ? photoPath
    : `${baseUrl}/api/field-ops/photo-proxy?path=${encodeURIComponent(photoPath)}`;

  try {
    const response = await fetch(`${VLM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VLM_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
              { type: 'text', text: prompt },
            ],
          },
        ],
        max_tokens: 512,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      throw new Error(`VLM HTTP ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const text: string = data.choices?.[0]?.message?.content || '';
    return parseVlmResponse(text);
  } catch (error) {
    logger.error('VLM analysis failed', {
      error: error instanceof Error ? error.message : 'Unknown',
      photoPath,
    });
    return {
      extracted_pole_number: null,
      vlm_valid: false,
      confidence: 0,
      issues: [`VLM error: ${error instanceof Error ? error.message : 'Unknown'}`],
      feedback: 'AI validation unavailable — manual review required',
    };
  }
}

// ============================================================================
// Stage 2: Project Cross-Reference
// ============================================================================

/**
 * Validate extracted pole number against the project SOW and PON stage tracking.
 */
async function crossReferenceProject(
  poleNumber: string | null,
  projectName: string
): Promise<CrossRefResult> {
  if (!poleNumber) {
    return { valid: false, issues: ['Could not extract pole number from photo'], pole_number: null, zone_no: null, pon_no: null };
  }

  const sql = getDb();
  const projects = await sql`SELECT id FROM projects WHERE project_name = ${projectName} LIMIT 1`;

  if (projects.length === 0) {
    return { valid: false, issues: [`Project '${projectName}' not found`], pole_number: poleNumber, zone_no: null, pon_no: null };
  }

  const projectRow = projects[0] as Record<string, unknown> | undefined;
  const projectId = projectRow?.id as string | undefined;
  if (!projectId) {
    return { valid: false, issues: [`Project '${projectName}' has no ID`], pole_number: poleNumber, zone_no: null, pon_no: null };
  }

  const poles = await sql`
    SELECT zone_no, pon_no FROM poles
    WHERE project_id = ${projectId}::uuid AND pole_number = ${poleNumber}
    LIMIT 1
  `;

  if (poles.length === 0) {
    return { valid: false, issues: [`Pole ${poleNumber} not in SOW for '${projectName}'`], pole_number: poleNumber, zone_no: null, pon_no: null };
  }

  const poleRow = poles[0] as Record<string, unknown> | undefined;
  const ponNo = poleRow?.pon_no ? Number(poleRow.pon_no) : null;
  const zoneNo = poleRow?.zone_no ? Number(poleRow.zone_no) : null;
  const issues: string[] = [];

  if (ponNo !== null) {
    const stages = await sql`
      SELECT overall_stage FROM pon_stage_tracking
      WHERE project_id = ${projectId}::uuid AND pon_no = ${ponNo}
      LIMIT 1
    `;
    if (stages.length > 0) {
      const stageRow = stages[0] as Record<string, unknown> | undefined;
      const stage = stageRow?.overall_stage as string | undefined;
      if (stage === 'design' || stage === 'planning') {
        issues.push(`PON ${ponNo} is in '${stage}' stage — pole work may be premature`);
      }
    }
  }

  return { valid: issues.length === 0, issues, pole_number: poleNumber, zone_no: zoneNo, pon_no: ponNo };
}

// ============================================================================
// Exports
// ============================================================================

/**
 * Run VLM + cross-reference validation for a single uploaded photo.
 * Updates field_ops_wa_photos with all results.
 */
export async function validatePhoto(photo: UploadedPhoto): Promise<{ success: boolean; error?: string }> {
  const sql = getDb();
  const discipline = photo.group_type;

  try {
    const vlmResult = await runVlmAnalysis(photo.local_path || photo.storage_key, discipline);

    let crossRef: CrossRefResult = { valid: true, issues: [], pole_number: null, zone_no: null, pon_no: null };
    if (discipline === 'civil' && photo.project) {
      crossRef = await crossReferenceProject(vlmResult.extracted_pole_number, photo.project);
    }

    await sql`
      UPDATE field_ops_wa_photos SET
        vlm_processed = true,
        vlm_valid = ${vlmResult.vlm_valid},
        vlm_confidence = ${vlmResult.confidence},
        vlm_issues = ${JSON.stringify(vlmResult.issues)}::jsonb,
        vlm_feedback = ${vlmResult.feedback},
        vlm_processed_at = NOW(),
        cross_ref_valid = ${crossRef.valid},
        cross_ref_issues = ${JSON.stringify(crossRef.issues)}::jsonb,
        matched_pole_number = ${crossRef.pole_number},
        matched_zone_no = ${crossRef.zone_no},
        matched_pon_no = ${crossRef.pon_no},
        updated_at = NOW()
      WHERE id = ${photo.id}
    `;

    logger.info('Photo validation complete', {
      photoId: photo.id,
      discipline,
      vlmValid: vlmResult.vlm_valid,
      crossRefValid: crossRef.valid,
      poleNumber: crossRef.pole_number,
    });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Photo validation failed', { photoId: photo.id, error: errorMessage });
    return { success: false, error: errorMessage };
  }
}

/**
 * Batch validate uploaded photos pending VLM processing
 */
export async function validatePendingPhotos(limit = 5): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  const sql = getDb();
  const photos = await sql`
    SELECT id, group_type, project, storage_key, local_path, wa_group_jid, message_timestamp
    FROM field_ops_wa_photos
    WHERE upload_status = 'uploaded' AND vlm_processed = false
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;

  const results = { processed: 0, succeeded: 0, failed: 0 };

  for (const photo of photos) {
    results.processed++;
    try {
      const result = await validatePhoto(photo as unknown as UploadedPhoto);
      if (result.success) results.succeeded++;
      else results.failed++;
    } catch {
      results.failed++;
    }
  }

  logger.info('Batch VLM validation complete', results);
  return results;
}
