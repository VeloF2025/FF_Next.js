/**
 * Low-level VLM client for photo categorization.
 *
 * Extracted from categorizationVlmService.ts to keep that file under the
 * 300-line CLAUDE.md limit. This file owns the single batched HTTP call to
 * the Qwen3 categorization endpoint plus response parsing.
 *
 * Errors raised here use the `CategorizationError` re-exported from
 * categorizationVlmService so existing consumers keep a stable import path.
 */

import { log } from '@/lib/logger';
import { VlmBatchCategorizationResponse } from '../types/unified.types';
import {
  FewShotExample,
  PositiveExample,
} from '@/modules/qa-learning';
import {
  VLM_CHAT_ENDPOINT,
  VLM_CATEGORIZATION_MODEL,
  VLM_TIMEOUT_BATCH,
  VLM_MAX_TOKENS_CATEGORIZATION,
  VLM_TEMPERATURE,
} from '@/lib/vlm';
import { buildCategorizationPrompt } from './categorizationPrompt';
import { CategorizationError } from './categorizationError';

/**
 * Call the VLM API to categorize a batch of photos.
 */
export async function callVlmForCategorization(
  drNumber: string,
  photos: Array<{ filename: string; url: string; original_type: string | null }>,
  base64Images: string[],
  fewShotExamples?: FewShotExample[],
  positiveExamples?: PositiveExample[],
): Promise<VlmBatchCategorizationResponse> {
  const prompt = buildCategorizationPrompt(
    photos.length,
    drNumber,
    fewShotExamples,
    positiveExamples,
  );

  const requestBody = {
    model: VLM_CATEGORIZATION_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...base64Images.map((base64) => ({
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${base64}` },
          })),
        ],
      },
    ],
    max_tokens: VLM_MAX_TOKENS_CATEGORIZATION,
    temperature: VLM_TEMPERATURE,
  };

  log.info(
    `Calling ${VLM_CATEGORIZATION_MODEL} for ${drNumber} (${photos.length} photos)...`,
    undefined,
    'CategorizationVlm',
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VLM_TIMEOUT_BATCH);

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
      throw new CategorizationError(
        `VLM API returned ${response.status}: ${errorText}`,
        `VLM_HTTP_${response.status}`,
        errorText,
      );
    }

    const data = await response.json();
    log.info(`VLM response received for ${drNumber}`, undefined, 'CategorizationVlm');

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new CategorizationError('No content in VLM response', 'VLM_EMPTY_RESPONSE');
    }

    // VLM response may be wrapped in ```json fences or plain.
    const jsonMatch =
      content.match(/```json\n([\s\S]*?)\n```/) ||
      content.match(/```\n([\s\S]*?)\n```/) ||
      [null, content];

    const parsed = JSON.parse(jsonMatch[1] || content);

    if (!parsed.categorizations || !Array.isArray(parsed.categorizations)) {
      throw new CategorizationError(
        'Invalid VLM response format: missing categorizations array',
        'VLM_INVALID_FORMAT',
        parsed,
      );
    }

    return parsed as VlmBatchCategorizationResponse;
  } catch (error: unknown) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      throw new CategorizationError('VLM API request timed out', 'VLM_TIMEOUT');
    }

    if (error instanceof CategorizationError) {
      throw error;
    }

    throw new CategorizationError(
      `VLM API error: ${error instanceof Error ? error.message : String(error)}`,
      'VLM_API_ERROR',
      error,
    );
  }
}
