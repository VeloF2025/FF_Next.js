/**
 * Tests: free-text actionable fail_reason instruction in the step-quality
 * VLM prompt (replaces the per-step canned "must be exactly" instruction).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  buildMessageContent,
  FAIL_REASON_INSTRUCTION,
  STEP_CRITERIA,
} from '../stepQualityCriteria';

function allText(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('\n');
}

describe('buildMessageContent fail_reason instruction', () => {
  it('few-shot branch (step 1 has static refs) uses the free-text instruction', () => {
    const { content, usedFewShot } = buildMessageContent(1, 'base64photo');
    const text = allText(content);
    expect(usedFewShot).toBe(true);
    expect(text).toContain(FAIL_REASON_INSTRUCTION);
    expect(text).not.toContain('the reason must be exactly');
    // The canned reason must no longer be dictated as the JSON example value
    expect(text).not.toContain(`"fail_reason": "${STEP_CRITERIA[1].failReason}"`);
  });

  it('text-only branch (step 3 has no refs) uses the free-text instruction', () => {
    const { content, usedFewShot } = buildMessageContent(3, 'base64photo');
    const text = allText(content);
    expect(usedFewShot).toBe(false);
    expect(text).toContain(FAIL_REASON_INSTRUCTION);
    expect(text).not.toContain('the reason must be exactly');
  });

  it('instruction demands an actionable sentence and covers photo-of-screen', () => {
    expect(FAIL_REASON_INSTRUCTION).toContain('what is wrong AND what to do');
    expect(FAIL_REASON_INSTRUCTION).toMatch(/photograph of a screen/i);
    expect(FAIL_REASON_INSTRUCTION).toContain('140');
  });

  it('guides on overexposure and does not let glare be mistaken for a screen', () => {
    // The technician must be told the real problem (too much exposure) + the fix.
    expect(FAIL_REASON_INSTRUCTION).toMatch(/overexposed/i);
    expect(FAIL_REASON_INSTRUCTION).toMatch(/lighting problem, never a screen/i);
    // Screen detection must require an actual screen artefact, not just glare.
    expect(FAIL_REASON_INSTRUCTION).toMatch(/ACTUAL screen artefact/);
  });

  it('still demands the strict JSON contract', () => {
    const text = allText(buildMessageContent(1, 'base64photo').content);
    expect(text).toContain('{"passes": true, "fail_reason": null}');
    expect(text).toContain('"passes": false');
  });
});
