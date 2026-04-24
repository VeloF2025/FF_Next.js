/**
 * Central VLM Configuration
 *
 * Single source of truth for all VLM (Vision Language Model) settings.
 * All VLM services MUST import from here instead of defining their own constants.
 *
 * To swap models, change VLM_MODEL in .env — no code changes needed.
 */

// ============================================================================
// Core Config — URL and Model
// ============================================================================

/** VLM API base URL (vLLM server) */
export const VLM_API_URL =
  process.env.VLM_API_URL ||
  process.env.VLM_SERVICE_URL ||
  process.env.VLLM_ENDPOINT ||
  'http://100.96.203.105:8100';

/** VLM API chat completions endpoint */
export const VLM_CHAT_ENDPOINT = `${VLM_API_URL}/v1/chat/completions`;

/** VLM models list endpoint (for health checks) */
export const VLM_MODELS_ENDPOINT = `${VLM_API_URL}/v1/models`;

/** Active VLM model name — must match what vLLM is serving */
export const VLM_MODEL =
  process.env.VLM_MODEL || 'QuantTrio/Qwen3-VL-30B-A3B-Instruct-AWQ';

// ============================================================================
// Per-Task Model Overrides (optional, fall back to VLM_MODEL)
// ============================================================================

/** Model for photo categorization (activate module) */
export const VLM_CATEGORIZATION_MODEL =
  process.env.VLM_CATEGORIZATION_MODEL || VLM_MODEL;

/** Model for QA validation (activate module) */
export const VLM_QA_MODEL =
  process.env.VLM_QA_MODEL || VLM_MODEL;

/** Model for data extraction (serials, power meter, OCR) */
export const VLM_EXTRACTION_MODEL =
  process.env.VLM_EXTRACTION_MODEL || VLM_MODEL;

/** Model for fleet check-in (odometer, fuel, plate) */
export const VLM_FLEET_MODEL =
  process.env.FLEET_VLM_MODEL || VLM_MODEL;

// ============================================================================
// Image Processing Defaults
// ============================================================================

/** Max image width before resizing for VLM */
export const VLM_MAX_IMAGE_WIDTH = 1280;

/** Max image height before resizing for VLM */
export const VLM_MAX_IMAGE_HEIGHT = 960;

/** JPEG quality for resized images */
export const VLM_JPEG_QUALITY = 85;

// ============================================================================
// Timeouts (per task type)
// ============================================================================

/** Default timeout for single-image VLM calls (ms) */
export const VLM_TIMEOUT_DEFAULT = 60_000;

/** Timeout for real-time/interactive use (plate scan, etc.) */
export const VLM_TIMEOUT_REALTIME = 30_000;

/** Timeout for batch categorization (multiple photos) */
export const VLM_TIMEOUT_BATCH = 180_000;

/** Timeout for QA validation per photo */
export const VLM_TIMEOUT_QA = 120_000;

/** Timeout for document extraction (quotes, POs) */
export const VLM_TIMEOUT_DOCUMENT = 90_000;

// ============================================================================
// Token Limits (per task type)
// ============================================================================

/** Default max tokens for VLM responses */
export const VLM_MAX_TOKENS_DEFAULT = 1000;

/** Max tokens for photo categorization (needs structured JSON for batches) */
export const VLM_MAX_TOKENS_CATEGORIZATION = 4000;

/** Max tokens for QA validation */
export const VLM_MAX_TOKENS_QA = 2000;

/** Max tokens for document extraction (quotes, POs — complex structured output) */
export const VLM_MAX_TOKENS_DOCUMENT = 4000;

/** Max tokens for quick extractions (plate, odometer, fuel) */
export const VLM_MAX_TOKENS_QUICK = 500;

/** Max tokens for orientation detection — response is a single number (0/90/180/270) */
export const VLM_MAX_TOKENS_ORIENTATION = 10;

/** Max tokens for OCR/ID extraction */
export const VLM_MAX_TOKENS_OCR = 1000;

/** Max tokens for screenshot/devops analysis */
export const VLM_MAX_TOKENS_ANALYSIS = 2048;

// ============================================================================
// Batch Processing
// ============================================================================

/** Max photos per VLM categorization call */
export const VLM_BATCH_SIZE = 6;

/** Default temperature for VLM calls (low = deterministic) */
export const VLM_TEMPERATURE = 0.1;

// ============================================================================
// Health Check
// ============================================================================

/** Timeout for VLM health check calls */
export const VLM_HEALTH_TIMEOUT = 10_000;

/**
 * Check if the VLM service is available and serving the expected model.
 * Centralized health check — replaces 5+ duplicate implementations.
 */
export async function checkVlmHealth(): Promise<{
  available: boolean;
  model: string | null;
  error?: string;
}> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VLM_HEALTH_TIMEOUT);

    const response = await fetch(VLM_MODELS_ENDPOINT, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { available: false, model: null, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    const models = data?.data || [];
    const activeModel = models[0]?.id || null;

    return {
      available: models.length > 0,
      model: activeModel,
    };
  } catch (err) {
    return {
      available: false,
      model: null,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Response Utilities
// ============================================================================

/**
 * Strip <think>...</think> tags from VLM responses.
 * Some models (Qwen3 with thinking mode) emit chain-of-thought
 * reasoning wrapped in <think> tags before the actual response.
 */
export function stripThinkTags(content: string): string {
  const thinkEnd = content.indexOf('</think>');
  if (thinkEnd !== -1) {
    return content.slice(thinkEnd + 8).trim();
  }
  return content;
}
