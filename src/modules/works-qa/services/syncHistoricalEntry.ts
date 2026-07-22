/**
 * Build the `vlm_results[slot]` JSON entry for a historical (construction_qa)
 * photo, following the Works-QA pending contract: a source photo whose
 * construction-qa VLM verdict (`vlm_valid`) is NULL was never actually scored →
 * write a pending marker `{scored:false}` (no `valid`), NOT a coerced red
 * `valid:false`. A real boolean verdict is stamped `scored:true`. Mirrors
 * syncQfieldCore.ts. Pure so the NULL-vs-boolean boundary is unit-tested.
 */
export function buildHistoricalVlmEntry(input: {
  slotKey: string;
  vlmValid: boolean | null | undefined;
  vlmConfidence: number | string | null;
  vlmFeedback: string | null;
  source: string;
}): string {
  const { slotKey, vlmValid, vlmConfidence, vlmFeedback, source } = input;
  if (vlmValid === null || vlmValid === undefined) {
    return JSON.stringify({ [slotKey]: { scored: false } });
  }
  return JSON.stringify({
    [slotKey]: {
      valid: vlmValid,
      confidence: vlmConfidence !== null ? Number(vlmConfidence) : 0,
      feedback: vlmFeedback ?? `Historical photo (${source})`,
      scored: true,
    },
  });
}
