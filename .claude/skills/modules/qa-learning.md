# QA Learning Module Skill

HITL (Human-In-The-Loop) few-shot learning system for VLM photo categorization improvement.

## Overview

When humans correct VLM categorization mistakes, corrections are stored and injected as few-shot examples into future VLM prompts. This improves accuracy without model fine-tuning (VLLM is inference-only).

## Quick Reference

| Setting | Value |
|---------|-------|
| **Module Location** | `src/modules/qa-learning/` |
| **Database Tables** | `qa_correction_examples`, `qa_workflow_steps` |
| **Migration** | `scripts/migrations/084_qa_correction_examples.sql` |
| **Status** | Active (New Module) |

## How It Works

```
Human Override → qa_correction_examples → Next VLM Call → Enriched Prompt
```

### Flow
1. VLM categorizes photo incorrectly
2. Human reviews and corrects the categorization
3. Correction is recorded with context (VLM prediction, confidence, reasoning)
4. Future VLM calls retrieve relevant corrections as few-shot examples
5. Examples are injected into the prompt as "learn from past mistakes"

## Usage

### Check for Corrections
```typescript
import { hasCorrections } from '@/modules/qa-learning';

if (await hasCorrections('dr_photo')) {
  // Corrections exist, can enrich prompts
}
```

### Get Relevant Examples
```typescript
import { getRelevantExamples } from '@/modules/qa-learning';

const { examples, totalAvailable, selectionCriteria } = await getRelevantExamples({
  workflowType: 'dr_photo',
  maxExamples: 5,
  includeConfusionPairs: true,
  canonicalOnly: false,
  minConfidenceForMistake: 0.8,
});
```

### Build Prompt Section
```typescript
import { buildFewShotPromptSection } from '@/modules/qa-learning';

const promptSection = buildFewShotPromptSection(examples);
// Returns formatted text for VLM prompt injection
```

### Record New Correction
```typescript
import { recordCorrection } from '@/modules/qa-learning';

await recordCorrection({
  workflowType: 'dr_photo',
  photoFilename: 'IMG_1234.jpg',
  photoDescription: 'Shows cable entering house',

  // VLM's wrong prediction
  vlmPredictedStep: 6,
  vlmPredictedCategory: 'ONT Back',
  vlmConfidence: 0.85,
  vlmReasoning: 'Cables visible entering device',

  // Human correction
  correctStep: 4,
  correctCategory: 'Entry Inside',
  correctionReason: 'Photo shows entry point, not ONT',

  correctedBy: 'user@example.com',
});
```

## Selection Strategy (Priority Order)

1. **Canonical** - Manually curated high-quality examples (`is_canonical = true`)
2. **Confusion Pairs** - Known confusing step combinations
3. **High-Confidence Mistakes** - VLM was >80% confident but wrong
4. **Recent** - Corrections from last 30 days

### DR Photo Confusion Pairs
Steps that VLM commonly confuses:
- Steps 3 ↔ 4 (Entry Outside vs Entry Inside)
- Steps 6 ↔ 8 (ONT Back vs Final Installation)
- Steps 1 ↔ 8 (House Photo vs Final Installation)
- Steps 6 ↔ 9 (ONT Back cables vs Green Lights front)

## Workflow Types

Each workflow has isolated learning (separate correction pools):

| Workflow | Steps | Status |
|----------|-------|--------|
| `dr_photo` | 10 steps | Active |
| `civil_works` | TBD | Future |
| `optical_works` | TBD | Future |

## Database Schema

### qa_correction_examples
```sql
CREATE TABLE qa_correction_examples (
  id UUID PRIMARY KEY,

  -- Workflow identification
  workflow_type VARCHAR(50) NOT NULL,

  -- Photo context
  photo_filename TEXT NOT NULL,
  photo_description TEXT,

  -- VLM prediction (what was wrong)
  vlm_predicted_step INTEGER NOT NULL,
  vlm_predicted_category TEXT NOT NULL,
  vlm_confidence DECIMAL(3,2) NOT NULL,
  vlm_reasoning TEXT,

  -- Human correction (ground truth)
  correct_step INTEGER NOT NULL,
  correct_category TEXT NOT NULL,
  correction_reason TEXT,

  -- Quality signals
  corrected_by TEXT NOT NULL,
  reviewed_count INTEGER DEFAULT 1,
  is_canonical BOOLEAN DEFAULT false,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE
);
```

### qa_workflow_steps
```sql
CREATE TABLE qa_workflow_steps (
  id UUID PRIMARY KEY,
  workflow_type VARCHAR(50) NOT NULL,
  step_number INTEGER NOT NULL,
  step_label TEXT NOT NULL,
  step_description TEXT,
  created_at TIMESTAMP WITH TIME ZONE
);
```

## Files

```
src/modules/qa-learning/
├── index.ts                    # Public exports
├── README.md                   # Module documentation
├── types/
│   └── learning.types.ts       # TypeScript interfaces & converters
├── services/
│   ├── correctionService.ts    # Store/retrieve corrections
│   └── fewShotService.ts       # Select examples for prompts
└── utils/
    └── promptBuilder.ts        # Build prompt sections
```

## Key Types

### CorrectionRecord
Full correction record from database:
```typescript
interface CorrectionRecord {
  id: string;
  workflowType: WorkflowType;
  photoFilename: string;
  photoDescription: string | null;
  vlmPredictedStep: number;
  vlmPredictedCategory: string;
  vlmConfidence: number;
  vlmReasoning: string | null;
  correctStep: number;
  correctCategory: string;
  correctionReason: string | null;
  correctedBy: string;
  reviewedCount: number;
  isCanonical: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

### FewShotExample
Simplified format for prompt building:
```typescript
interface FewShotExample {
  photoDescription: string;
  wrongStep: number;
  wrongCategory: string;
  correctStep: number;
  correctCategory: string;
  correctionReason: string;
}
```

## Integration with Activate Module

The QA Learning module integrates with the Activate module's categorization flow:

1. **categorizationVlmService.ts** calls `getRelevantExamples()` before VLM requests
2. Examples are formatted via `buildFewShotPromptSection()`
3. Prompt section is injected after the main categorization instructions
4. When human overrides occur in the Review tab, `recordCorrection()` is called

### Sample Prompt Injection
```
## Learn From Past Corrections

Here are examples where the AI made mistakes. Use these to avoid similar errors:

Example 1:
- Photo showed: "Cable entering building through wall"
- AI predicted: Step 6 (ONT Back) with 85% confidence
- Correct answer: Step 4 (Entry Inside)
- Why AI was wrong: Photo shows entry point, not ONT installation

Example 2:
...
```

## Troubleshooting

### No Corrections Being Recorded
```sql
-- Check recent corrections
SELECT * FROM qa_correction_examples
ORDER BY created_at DESC
LIMIT 10;
```

### Examples Not Affecting VLM Output
1. Verify `hasCorrections()` returns true
2. Check `maxExamples` isn't 0
3. Confirm prompt section is being injected
4. Review VLM logs for prompt content

### Stats Query
```sql
-- Correction statistics
SELECT
  workflow_type,
  COUNT(*) as total,
  SUM(CASE WHEN is_canonical THEN 1 ELSE 0 END) as canonical,
  SUM(CASE WHEN created_at > NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END) as recent
FROM qa_correction_examples
GROUP BY workflow_type;
```

### Top Confused Steps
```sql
-- Most common confusion patterns
SELECT
  vlm_predicted_step,
  correct_step,
  COUNT(*) as count
FROM qa_correction_examples
WHERE workflow_type = 'dr_photo'
GROUP BY vlm_predicted_step, correct_step
ORDER BY count DESC
LIMIT 10;
```

## Related Skills

- `/activate` - Main photo review module
- `/vlm` - VLM infrastructure
- `/photo-categorization` - Step definitions
