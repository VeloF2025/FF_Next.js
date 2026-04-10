/**
 * DevOps VLM Screenshot Analysis API
 *
 * POST /api/noc/devops-vlm-analyse
 * Accepts a base64 screenshot, sends to VLM (Qwen3), returns structured DevOps fields.
 *
 * // WORKING: VLM-powered screenshot analysis for DevOps ticket auto-fill
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';

const logger = createLogger('noc:devops-vlm');

const VLM_API_BASE = process.env.VLM_API_URL || 'http://100.96.203.105:8100';
const VLM_API_ENDPOINT = `${VLM_API_BASE}/v1/chat/completions`;
const VLM_MODEL = process.env.VLM_EXTRACTION_MODEL || process.env.VLM_MODEL || 'QuantTrio/Qwen3-VL-30B-A3B-Instruct-AWQ';
const VLM_TIMEOUT_MS = 60000;

const FIBREFLOW_MODULES = [
  'Dashboard', 'NOC', 'Activate', 'Procurement', 'Accounting',
  'Assets', 'Projects', 'Data Sync', 'Fleet', 'QField',
  'Field Ops', 'Stock Portal', 'Reports', 'Other',
];

interface VlmAnalysisResult {
  title: string;
  description: string;
  affected_module: string;
  environment: string;
  error_url: string;
  stack_trace: string;
  steps_to_reproduce: string;
  browser_info: string;
  priority_suggestion: string;
  confidence: number;
}

const ANALYSIS_PROMPT = `You are analyzing a screenshot of a FibreFlow web application error or issue.

Extract the following information from the screenshot and return it as a JSON object:

{
  "title": "Short bug title (max 80 chars) describing the issue visible in the screenshot",
  "description": "Detailed description of what appears to be wrong based on the screenshot",
  "affected_module": "Which FibreFlow module is shown. Must be one of: ${FIBREFLOW_MODULES.join(', ')}",
  "environment": "Detect from URL: app.fibreflow.app = production, dev.fibreflow.app = dev, localhost = local. Default: production",
  "error_url": "The URL visible in the browser address bar, if readable",
  "stack_trace": "Any error messages, stack traces, or console errors visible in the screenshot. Include the full text.",
  "steps_to_reproduce": "Infer steps based on what page/state is shown, e.g. '1. Navigate to [page]\\n2. [action that likely triggered the error]'",
  "browser_info": "Browser name/version if visible in the screenshot",
  "priority_suggestion": "Based on severity: critical (app crash/data loss), high (feature broken), normal (UI issue), low (cosmetic)",
  "confidence": 0.0 to 1.0
}

Important:
- If you can see DevTools/Console panel open, extract ALL visible error messages and stack traces
- Look for red error text, error modals, broken UI elements, network errors, 500/404 status codes
- If the URL bar is visible, extract the full URL
- Detect the module from the sidebar navigation highlight or page content
- Return ONLY valid JSON, no markdown fences or extra text`;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    const { imageBase64 } = req.body;

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return apiResponse.badRequest(res, 'imageBase64 is required');
    }

    // Ensure proper data URL format
    const imageUrl = imageBase64.startsWith('data:')
      ? imageBase64
      : `data:image/png;base64,${imageBase64}`;

    logger.info('Analysing DevOps screenshot via VLM');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VLM_TIMEOUT_MS);

    const vlmResponse = await fetch(VLM_API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: VLM_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: ANALYSIS_PROMPT },
              { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
            ],
          },
        ],
        max_tokens: 2048,
        temperature: 0.1,
      }),
    });

    clearTimeout(timeoutId);

    if (!vlmResponse.ok) {
      const errText = await vlmResponse.text().catch(() => 'Unknown VLM error');
      logger.error('VLM API error', { status: vlmResponse.status, error: errText });
      return apiResponse.error(res, ErrorCode.SERVICE_UNAVAILABLE, `VLM analysis failed: ${vlmResponse.status}`);
    }

    const vlmResult = await vlmResponse.json();
    const rawContent = vlmResult.choices?.[0]?.message?.content || '';

    logger.debug('VLM raw response', { length: rawContent.length });

    // Parse JSON from response (strip markdown fences if present)
    let analysis: VlmAnalysisResult;
    try {
      const jsonStr = rawContent
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();
      analysis = JSON.parse(jsonStr);
    } catch {
      logger.error('Failed to parse VLM JSON response', { rawContent: rawContent.substring(0, 500) });
      return apiResponse.error(res, ErrorCode.SERVICE_UNAVAILABLE, 'VLM returned unparseable response');
    }

    // Validate affected_module against allowed list
    if (analysis.affected_module && !FIBREFLOW_MODULES.includes(analysis.affected_module)) {
      const lower = analysis.affected_module.toLowerCase();
      const match = FIBREFLOW_MODULES.find(m => m.toLowerCase().includes(lower) || lower.includes(m.toLowerCase()));
      analysis.affected_module = match || 'Other';
    }

    // Validate environment
    if (!['production', 'dev', 'local'].includes(analysis.environment)) {
      analysis.environment = 'production';
    }

    // Validate priority
    if (!['low', 'normal', 'high', 'urgent', 'critical'].includes(analysis.priority_suggestion)) {
      analysis.priority_suggestion = 'normal';
    }

    logger.info('DevOps screenshot analysis complete', {
      module: analysis.affected_module,
      environment: analysis.environment,
      confidence: analysis.confidence,
    });

    return apiResponse.success(res, analysis);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      logger.error('VLM analysis timed out');
      return apiResponse.error(res, ErrorCode.GATEWAY_TIMEOUT, 'VLM analysis timed out (60s)');
    }
    logger.error('DevOps VLM analysis error', { error: err });
    return apiResponse.internalError(res, err instanceof Error ? err : new Error('Unknown error'));
  }
}

export default withAuth(handler);
