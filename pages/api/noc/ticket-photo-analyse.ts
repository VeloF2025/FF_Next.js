/**
 * NOC Ticket Photo Analysis API
 *
 * POST /api/noc/ticket-photo-analyse
 * Accepts a base64 field/site photo, sends to VLM (Qwen3), returns structured ticket fields.
 *
 * // WORKING: VLM-powered site photo analysis for NOC ticket auto-fill
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import {
  VLM_CHAT_ENDPOINT,
  VLM_EXTRACTION_MODEL,
  VLM_TIMEOUT_DEFAULT,
  VLM_MAX_TOKENS_ANALYSIS,
} from '@/lib/vlm';

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

const logger = createLogger('noc:ticket-photo-vlm');

/** Structured result extracted from a field/site photo by VLM. */
interface PhotoAnalysisResult {
  suggested_title: string;
  suggested_description: string;
  visible_dr_number: string | null;
  visible_pole_number: string | null;
  visible_serial: string | null;
  issue_type: string;
  severity: string;
  confidence: number;
}

const VALID_ISSUE_TYPES = [
  'cable_damage',
  'pole_damage',
  'ont_issue',
  'splice_issue',
  'access_issue',
  'vegetation',
  'vandalism',
  'weather_damage',
  'other',
] as const;

const VALID_SEVERITIES = ['low', 'normal', 'high', 'critical'] as const;

const ANALYSIS_PROMPT = `You are analyzing a site photo from a fiber network field team.
Look for any visible information that can help create a maintenance ticket.

Extract information and return ONLY valid JSON:
{
  "suggested_title": "Short issue description (max 80 chars) based on what you see",
  "suggested_description": "Detailed description of the visible issue or scene",
  "visible_dr_number": "DR number if visible on a label, sign, or marking (e.g. DR-1234), or null",
  "visible_pole_number": "Pole number or ID if visible, or null",
  "visible_serial": "Any equipment serial number visible (ONT, OLT, splitter), or null",
  "issue_type": "cable_damage|pole_damage|ont_issue|splice_issue|access_issue|vegetation|vandalism|weather_damage|other",
  "severity": "low|normal|high|critical",
  "confidence": 0.0 to 1.0
}

Important:
- Look for text on labels, signs, stickers, equipment plates
- Identify the type of infrastructure visible (poles, cabinets, ONTs, splice closures, cables)
- Assess damage severity from visual cues
- If the image is unclear or not related to fiber infrastructure, set confidence below 0.3
- Return ONLY valid JSON, no markdown fences or extra text`;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    const { image } = req.body as { image?: unknown };

    if (!image || typeof image !== 'string') {
      return apiResponse.badRequest(res, 'image is required and must be a base64-encoded string');
    }

    // Ensure proper data URL format
    const imageUrl = image.startsWith('data:')
      ? image
      : `data:image/jpeg;base64,${image}`;

    logger.info('Analysing site photo via VLM');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VLM_TIMEOUT_DEFAULT);

    const vlmResponse = await fetch(VLM_CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: VLM_EXTRACTION_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: ANALYSIS_PROMPT },
              { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
            ],
          },
        ],
        max_tokens: VLM_MAX_TOKENS_ANALYSIS,
        temperature: 0.1,
      }),
    });

    clearTimeout(timeoutId);

    if (!vlmResponse.ok) {
      const errText = await vlmResponse.text().catch(() => 'Unknown VLM error');
      logger.error('VLM API error', { status: vlmResponse.status, error: errText });
      return apiResponse.error(
        res,
        ErrorCode.SERVICE_UNAVAILABLE,
        `VLM analysis failed: ${vlmResponse.status}`,
      );
    }

    const vlmResult = await vlmResponse.json();
    const rawContent: string = vlmResult.choices?.[0]?.message?.content || '';

    logger.debug('VLM raw response', { length: rawContent.length });

    // Parse JSON from response (strip markdown fences if present)
    let analysis: PhotoAnalysisResult;
    try {
      const jsonStr = rawContent
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();
      analysis = JSON.parse(jsonStr) as PhotoAnalysisResult;
    } catch {
      logger.error('Failed to parse VLM JSON response', { rawContent: rawContent.substring(0, 500) });
      return apiResponse.error(
        res,
        ErrorCode.SERVICE_UNAVAILABLE,
        'VLM returned unparseable response',
      );
    }

    // Validate issue_type against allowed values
    if (!VALID_ISSUE_TYPES.includes(analysis.issue_type as typeof VALID_ISSUE_TYPES[number])) {
      analysis.issue_type = 'other';
    }

    // Validate severity against allowed values
    if (!VALID_SEVERITIES.includes(analysis.severity as typeof VALID_SEVERITIES[number])) {
      analysis.severity = 'normal';
    }

    // Clamp confidence to [0, 1]
    if (typeof analysis.confidence !== 'number' || isNaN(analysis.confidence)) {
      analysis.confidence = 0;
    } else {
      analysis.confidence = Math.min(1, Math.max(0, analysis.confidence));
    }

    logger.info('Site photo analysis complete', {
      issue_type: analysis.issue_type,
      severity: analysis.severity,
      confidence: analysis.confidence,
      has_dr: !!analysis.visible_dr_number,
      has_pole: !!analysis.visible_pole_number,
      has_serial: !!analysis.visible_serial,
    });

    return apiResponse.success(res, analysis);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      logger.error('VLM analysis timed out');
      return apiResponse.error(res, ErrorCode.GATEWAY_TIMEOUT, 'VLM analysis timed out (60s)');
    }
    logger.error('Ticket photo VLM analysis error', { error: err });
    return apiResponse.internalError(res, err instanceof Error ? err : new Error('Unknown error'));
  }
}

export default withAuth(handler);
