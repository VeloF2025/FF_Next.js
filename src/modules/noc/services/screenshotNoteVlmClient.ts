/**
 * Sends 1map screenshots to Qwen3-VL and returns the parsed analysis.
 * Throws on network error / non-200 / unparseable response. The 90s
 * document timeout accommodates multiple images in one call.
 */
import {
  VLM_CHAT_ENDPOINT,
  VLM_EXTRACTION_MODEL,
  VLM_MAX_TOKENS_ANALYSIS,
  VLM_TIMEOUT_DOCUMENT,
  VLM_TEMPERATURE,
} from '@/lib/vlm';
import { createLogger } from '@/lib/logger';
import {
  buildInstallScreenshotPrompt,
  parseInstallScreenshotResponse,
  type TicketCrossRef,
  type InstallScreenshotAnalysis,
} from '@/modules/noc/services/screenshotNoteAnalysis';

const logger = createLogger('noc:screenshot-vlm');

export async function analyzeInstallScreenshots(
  images: string[],
  ctx: TicketCrossRef,
): Promise<InstallScreenshotAnalysis> {
  const prompt = buildInstallScreenshotPrompt(ctx);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VLM_TIMEOUT_DOCUMENT);

  try {
    const resp = await fetch(VLM_CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: VLM_EXTRACTION_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              ...images.map((url) => ({ type: 'image_url', image_url: { url, detail: 'high' } })),
            ],
          },
        ],
        max_tokens: VLM_MAX_TOKENS_ANALYSIS,
        temperature: VLM_TEMPERATURE,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => 'unknown');
      throw new Error(`VLM request failed (${resp.status}): ${errText.slice(0, 200)}`);
    }

    const json = await resp.json();
    const rawContent: string = json.choices?.[0]?.message?.content ?? '';
    logger.debug('VLM raw response', { length: rawContent.length, images: images.length });
    return parseInstallScreenshotResponse(rawContent);
  } finally {
    clearTimeout(timeoutId);
  }
}
