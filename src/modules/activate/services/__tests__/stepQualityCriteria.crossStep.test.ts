/**
 * Tests: opt-in cross-step "wrong subject" + anti-hallucination instruction.
 *
 * SiteCam live-capture passes crossStepClassification:true so a misfiled photo
 * (e.g. a wall mount sent to "Cable Entry Inside") fails with a reason naming
 * what it actually shows. Auto-QA omits the flag and must be unaffected.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  buildMessageContent,
  buildCrossStepInstruction,
  STEP_CRITERIA,
  QUALITY_CHECK_STEPS,
} from '../stepQualityCriteria';

function allText(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('\n');
}

describe('buildCrossStepInstruction', () => {
  it('names the expected subject and lists every other step subject', () => {
    const text = buildCrossStepInstruction(4);
    expect(text).toContain(`This step expects "${STEP_CRITERIA[4].label}"`);
    // Every quality-check step label appears in the taxonomy so the model can
    // recognise — and name — a misfiled photo.
    for (const s of QUALITY_CHECK_STEPS) {
      expect(text).toContain(STEP_CRITERIA[s].label);
    }
  });

  it('includes the anti-hallucination guard', () => {
    expect(buildCrossStepInstruction(4)).toMatch(/do not invent a cable, hole/i);
  });
});

describe('buildMessageContent crossStepClassification flag', () => {
  it('few-shot branch (step 1) injects the wrong-subject check when enabled', () => {
    const text = allText(
      buildMessageContent(1, 'base64photo', undefined, { crossStepClassification: true }).content,
    );
    expect(text).toContain('WRONG-SUBJECT CHECK');
    expect(text).toContain(STEP_CRITERIA[5].label); // taxonomy present
  });

  it('text-only branch (step 3) injects the wrong-subject check when enabled', () => {
    const text = allText(
      buildMessageContent(3, 'base64photo', undefined, { crossStepClassification: true }).content,
    );
    expect(text).toContain('WRONG-SUBJECT CHECK');
  });

  it('omits the wrong-subject check by default (auto-QA path unchanged)', () => {
    expect(allText(buildMessageContent(1, 'base64photo').content)).not.toContain('WRONG-SUBJECT CHECK');
    expect(allText(buildMessageContent(3, 'base64photo').content)).not.toContain('WRONG-SUBJECT CHECK');
  });

  it('still demands the strict JSON contract with the flag on', () => {
    const text = allText(
      buildMessageContent(4, 'base64photo', undefined, { crossStepClassification: true }).content,
    );
    expect(text).toContain('{"passes": true, "fail_reason": null}');
    expect(text).toContain('"passes": false');
  });
});
