# QA Learning Module

HITL (Human-In-The-Loop) few-shot learning for VLM photo categorization.

## Overview

When humans correct VLM mistakes, corrections are captured and injected as few-shot examples into future prompts. Improves accuracy without fine-tuning (VLLM is inference-only).

## How It Works

```
Human Override → qa_correction_examples → Next VLM Call → Enriched Prompt
```

## Quick Start

```typescript
import {
  recordCorrection,
  getRelevantExamples,
  buildFewShotPromptSection,
  hasCorrections,
} from '@/modules/qa-learning';

// Check if corrections exist
if (await hasCorrections('dr_photo')) {
  const { examples } = await getRelevantExamples({
    workflowType: 'dr_photo',
    maxExamples: 5,
  });
  const promptSection = buildFewShotPromptSection(examples);
}
```

## Selection Strategy

Priority order:
1. **Canonical** - Curated high-quality examples
2. **Confusion pairs** - Steps 3↔4, 6↔8, 1↔8, 6↔9
3. **High-confidence mistakes** - VLM >80% confident but wrong
4. **Recent** - Last 30 days

## Workflows

Each workflow has isolated learning:
- `dr_photo` - 10 steps (active)
- `civil_works` - Future
- `optical_works` - Future

## Database

**Tables:** `qa_correction_examples`, `qa_workflow_steps`
**Migration:** `scripts/migrations/084_qa_correction_examples.sql`

## Files

- `types/learning.types.ts` - Types and converters
- `services/correctionService.ts` - Store/retrieve corrections
- `services/fewShotService.ts` - Select examples for prompts
- `index.ts` - Public exports
