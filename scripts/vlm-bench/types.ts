// scripts/vlm-bench/types.ts
// Shared contracts for the VLM benchmark engine.

/** One labelled benchmark case (image + expected answer). */
export interface BenchCase {
  id: string;                 // stable id, unique within a pack
  imageRef: string;           // file path (golden) or URL (VF Storage)
  sha256?: string;            // golden integrity check (optional for live)
  expected: unknown;          // pack-specific ground truth
}

/** Result of scoring one case. */
export interface CaseScore {
  caseId: string;
  pass: boolean;
  score: number;              // 0..1 (partial credit allowed)
  detail?: Record<string, unknown>; // e.g. { cer: 0.1, drop: true }
  error?: string;             // set when the VLM call itself failed
}

/** What a pack's score() returns (before the engine attaches caseId). */
export interface ScoreOutcome {
  pass: boolean;
  score: number;
  detail?: Record<string, unknown>;
}

/** Aggregated result for one pack run. */
export interface PackResult {
  packId: string;
  total: number;
  scored: number;             // excludes error cases
  errors: number;
  passed: number;
  scorePct: number;           // 100 * sum(score)/scored
  cases: CaseScore[];
}

/** Top-level result for a benchmark invocation. */
export interface RunResult {
  mode: 'golden' | 'live';
  model: string;
  gitSha: string;
  startedAt: string;          // ISO
  status: 'ok' | 'infra_error';
  packs: PackResult[];
}

export interface LoadOpts {
  /** velo-side root for resolving golden image refs */
  goldenRoot: string;
}

/** OpenAI-compatible chat request body sent to vLLM. */
export interface VlmRequest {
  model: string;
  messages: Array<{
    role: 'user' | 'system';
    content:
      | Array<
          | { type: 'text'; text: string }
          | { type: 'image_url'; image_url: { url: string } }
        >
      | string;
  }>;
  max_tokens: number;
  temperature?: number;
}

/** A pluggable use-case pack. */
export interface VlmTestPack {
  id: string;
  loadCases(mode: 'golden' | 'live', opts: LoadOpts): Promise<BenchCase[]>;
  buildPrompt(c: BenchCase, variant?: string): VlmRequest;
  score(expected: unknown, actual: string): ScoreOutcome;
}
