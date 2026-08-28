vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/services/vlmLearningService', () => ({
  getVlmFewShotExamples: vi.fn(),
  buildVlmFewShotPrompt: vi.fn((examples: Array<{ incorrect?: string | null; correct: string }>) =>
    examples.length
      ? `LEARNED CORRECTIONS: ${examples.map(ex => `${ex.incorrect ?? 'unknown'} -> ${ex.correct}`).join('; ')}`
      : ''
  ),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FALLBACK_RESULT,
  classifyPhotoToSlot,
  validatePhotoWithVlm,
  worksQaAnalysisTypeForSlot,
} from '../worksQaVlmService';
import { getVlmFewShotExamples } from '@/services/vlmLearningService';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getVlmFewShotExamples).mockImplementation(async ({ analysisType }) => [
    {
      incorrect: analysisType === 'works_qa_civil' ? 'civil' : 'dome',
      correct: analysisType === 'works_qa_civil' ? 'civil_fail' : 'dome_fail',
      context: 'Human-corrected Works QA example',
    },
  ]);
});

function successfulFetch(content: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  });
}

function postedPrompt(fetchMock: ReturnType<typeof vi.fn>): string {
  const init = fetchMock.mock.calls[0]![1] as RequestInit;
  const body = JSON.parse(String(init.body));
  return body.messages[0].content[0].text as string;
}

describe('Works QA VLM learning lanes', () => {
  it('maps civil slots to the civil lane and dome/main-joint slots to optical', () => {
    expect(worksQaAnalysisTypeForSlot('civil_01')).toBe('works_qa_civil');
    expect(worksQaAnalysisTypeForSlot('dome_01')).toBe('works_qa_optical');
    expect(worksQaAnalysisTypeForSlot('main_joint_11')).toBe('works_qa_optical');
    expect(worksQaAnalysisTypeForSlot('unknown')).toBeNull();
  });

  it('injects only civil corrections into a civil validation prompt', async () => {
    const fetchMock = successfulFetch('{"valid":true,"confidence":0.8,"feedback":"ok"}');
    global.fetch = fetchMock as typeof fetch;

    await validatePhotoWithVlm({
      photoUrl: 'https://example.test/civil.jpg',
      slotKey: 'civil_01',
      stepLabel: 'Before Photo',
      vlmCheck: 'Undisturbed ground',
    });

    expect(getVlmFewShotExamples).toHaveBeenCalledTimes(1);
    expect(getVlmFewShotExamples).toHaveBeenCalledWith(expect.objectContaining({
      module: 'works_qa',
      analysisType: 'works_qa_civil',
    }));
    expect(postedPrompt(fetchMock)).toContain('LEARNED CORRECTIONS: civil -> civil_fail');
  });

  it('injects only optical corrections into an optical validation prompt', async () => {
    const fetchMock = successfulFetch('{"valid":true,"confidence":0.8,"feedback":"ok"}');
    global.fetch = fetchMock as typeof fetch;

    await validatePhotoWithVlm({
      photoUrl: 'https://example.test/dome.jpg',
      slotKey: 'dome_01',
      stepLabel: 'Dome on Pole',
      vlmCheck: 'Wide shot of dome',
    });

    expect(getVlmFewShotExamples).toHaveBeenCalledTimes(1);
    expect(getVlmFewShotExamples).toHaveBeenCalledWith(expect.objectContaining({
      module: 'works_qa',
      analysisType: 'works_qa_optical',
    }));
    expect(postedPrompt(fetchMock)).toContain('LEARNED CORRECTIONS: dome -> dome_fail');
  });

  it('loads both lanes for automatic slot classification', async () => {
    const fetchMock = successfulFetch('{"slot_key":"civil_01","confidence":0.91,"reasoning":"ground"}');
    global.fetch = fetchMock as typeof fetch;

    await classifyPhotoToSlot('https://example.test/photo.jpg');

    expect(getVlmFewShotExamples).toHaveBeenCalledTimes(2);
    expect(getVlmFewShotExamples).toHaveBeenCalledWith(expect.objectContaining({
      analysisType: 'works_qa_civil',
    }));
    expect(getVlmFewShotExamples).toHaveBeenCalledWith(expect.objectContaining({
      analysisType: 'works_qa_optical',
    }));
    const prompt = postedPrompt(fetchMock);
    expect(prompt).toContain('civil -> civil_fail');
    expect(prompt).toContain('dome -> dome_fail');
  });

  it('fails closed when the model returns valid as the string "false"', async () => {
    global.fetch = successfulFetch('{"valid":"false","confidence":0.95,"feedback":"bad frame"}') as typeof fetch;

    const result = await validatePhotoWithVlm({
      photoUrl: 'https://example.test/black.jpg',
      slotKey: 'civil_01',
      stepLabel: 'Before Photo',
      vlmCheck: 'Undisturbed ground',
    });

    expect(result).toEqual(FALLBACK_RESULT);
  });
});
