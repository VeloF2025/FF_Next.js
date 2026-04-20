/**
 * ONT Back Cable Validator
 *
 * Targeted VLM post-check for photos categorized as Step 6 (ONT Back After Install).
 *
 * A valid "ONT Back After Install" photo must show a green fiber optic cable
 * physically plugged into the fiber port on the back of the ONT. Without that
 * cable visible, the photo is not actually post-install — it's either a
 * pre-install shot or the ONT being held/inspected with the fiber port empty.
 *
 * Those photos are reclassified to Step 0 (Discard) with the comment
 * "No green cable in the back".
 */

import { log } from '@/lib/logger';
import { fetchPhotoAsBase64 } from './photoFetchService';
import {
  VLM_CHAT_ENDPOINT,
  VLM_CATEGORIZATION_MODEL,
  VLM_TIMEOUT_REALTIME,
  VLM_MAX_TOKENS_QUICK,
  VLM_TEMPERATURE,
  stripThinkTags,
} from '@/lib/vlm';

const MODULE = 'OntBackCableValidator';

export interface OntBackCableCheckResult {
  filename: string;
  hasGreenCable: boolean;
  reasoning: string;
  checkFailed: boolean;
}

const PROMPT = `You are inspecting a photo that has been categorized as "ONT Back After Install" for a fiber optic installation.

Your ONLY task: determine whether a GREEN fiber optic cable is physically plugged into the fiber port on the back panel of the ONT (Optical Network Terminal) shown in the photo.

The fiber port is typically a yellow or orange socket on the back of the ONT. A correctly installed ONT will have a thin green fiber cable inserted into that port.

Return STRICT JSON in this exact format:
{
  "has_green_cable": true | false,
  "reasoning": "Short description of what you see at the fiber port"
}

Rules:
- has_green_cable = true ONLY if you can clearly see a green fiber cable physically inserted into the fiber port.
- has_green_cable = false if the fiber port is empty, covered, obscured, not visible, or only non-green cables are present.
- Be STRICT: if you are unsure, return false. Only power cables (black/white) do not count — we only care about the GREEN fiber cable at the fiber port.`;

/**
 * Call VLM to check if a single photo shows a green fiber cable plugged into the ONT back.
 */
async function checkOneCable(
  drNumber: string,
  photo: { filename: string; url: string }
): Promise<OntBackCableCheckResult> {
  let base64: string;
  try {
    base64 = await fetchPhotoAsBase64(photo.url);
  } catch (err) {
    log.warn(`Failed to fetch photo for cable check: ${photo.filename}`, {
      dropNumber: drNumber,
      error: (err as Error).message,
    }, MODULE);
    return {
      filename: photo.filename,
      hasGreenCable: false,
      reasoning: 'Failed to fetch photo',
      checkFailed: true,
    };
  }

  const requestBody = {
    model: VLM_CATEGORIZATION_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
        ],
      },
    ],
    max_tokens: VLM_MAX_TOKENS_QUICK,
    temperature: VLM_TEMPERATURE,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VLM_TIMEOUT_REALTIME);

  try {
    const response = await fetch(VLM_CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      log.warn(`VLM cable check HTTP ${response.status} for ${photo.filename}`, {
        dropNumber: drNumber,
        error: errorText.slice(0, 200),
      }, MODULE);
      return {
        filename: photo.filename,
        hasGreenCable: false,
        reasoning: `VLM HTTP ${response.status}`,
        checkFailed: true,
      };
    }

    const data = await response.json();
    const rawContent: string | undefined = data.choices?.[0]?.message?.content;
    if (!rawContent) {
      return {
        filename: photo.filename,
        hasGreenCable: false,
        reasoning: 'Empty VLM response',
        checkFailed: true,
      };
    }

    const content = stripThinkTags(rawContent);
    const jsonMatch =
      content.match(/```json\n([\s\S]*?)\n```/) ||
      content.match(/```\n([\s\S]*?)\n```/) ||
      [null, content];
    const parsed = JSON.parse(jsonMatch[1] || content);

    const hasGreenCable = parsed.has_green_cable === true;
    const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : '';

    return {
      filename: photo.filename,
      hasGreenCable,
      reasoning,
      checkFailed: false,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    log.warn(`VLM cable check failed for ${photo.filename}`, {
      dropNumber: drNumber,
      error: isTimeout ? 'timeout' : (err as Error).message,
    }, MODULE);
    return {
      filename: photo.filename,
      hasGreenCable: false,
      reasoning: isTimeout ? 'VLM timeout' : 'VLM error',
      checkFailed: true,
    };
  }
}

/**
 * Validate a batch of Step 6 (ONT Back After Install) photos.
 *
 * Returns a map of filename → check result. When checkFailed is true we do NOT
 * reclassify the photo — we leave the original Step 6 classification alone so a
 * transient VLM/network failure doesn't cause false discards.
 *
 * Concurrency is limited to avoid flooding the VLM.
 */
export async function validateOntBackCables(
  drNumber: string,
  photos: Array<{ filename: string; url: string }>
): Promise<Map<string, OntBackCableCheckResult>> {
  const results = new Map<string, OntBackCableCheckResult>();
  if (photos.length === 0) return results;

  log.info(`Running ONT-back cable check on ${photos.length} Step 6 photo(s) for ${drNumber}`, undefined, MODULE);

  const CONCURRENCY = 2;
  for (let i = 0; i < photos.length; i += CONCURRENCY) {
    const batch = photos.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map((p) => checkOneCable(drNumber, p)));
    for (const r of batchResults) {
      results.set(r.filename, r);
    }
  }

  const missing = Array.from(results.values()).filter((r) => !r.checkFailed && !r.hasGreenCable).length;
  const failed = Array.from(results.values()).filter((r) => r.checkFailed).length;
  log.info(`ONT-back cable check complete for ${drNumber}: ${missing} missing cable, ${failed} check failed`, undefined, MODULE);

  return results;
}
