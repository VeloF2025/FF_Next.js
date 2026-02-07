# AI QA Validation Skill

VLM-powered photo quality validation using Qwen3 against FiberTime Installation Standards Rev 1.1.

## Purpose

Define criteria for AI-based photo quality assessment in Phase 2 of the 3-Phase QA Workflow.

## When to Activate

**Trigger phrases**:
- "VLM validation"
- "AI QA"
- "photo quality check"
- "FiberTime standards"
- "validation criteria"
- "QA failing"
- "vlm_categorization"

## VLM Server Details

| Setting | Value |
|---------|-------|
| **Server** | `http://100.96.203.105:8100` |
| **Model** | Qwen3 |
| **Docker Container** | `vllm-qwen3` |
| **API Format** | OpenAI-compatible (`/v1/chat/completions`) |

## 3-Phase QA Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│ Phase 1: Attribute Categorization (Instant, Deterministic)      │
│ - Map ph_* types to 10-step checklist                           │
│ - See /photo-categorization skill                               │
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Phase 2: VLM Quality Validation (AI, Asynchronous)              │
│ - Qwen3 validates each photo against FiberTime spec             │
│ - Returns PASS/NEEDS_REVIEW with confidence score               │
│ - THIS SKILL defines the criteria                               │
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Phase 3: Human Review (Manual, Final Authority)                 │
│ - Card grid with approve/reject per photo                       │
│ - Activity log for audit trail                                  │
└─────────────────────────────────────────────────────────────────┘
```

## FiberTime Standards Rev 1.1 - Validation Criteria

### Step-by-Step Validation Rules

| Step | Photo Type | Pass Criteria | Fail Criteria |
|------|------------|---------------|---------------|
| 1 | House Photo | Property clearly visible, address identifiable | Blurry, wrong location, no property visible |
| 2 | Cable from Pole | Cable span visible, pole to pigtail screw shown | Cable not visible, wrong angle |
| 3 | Entry Outside | Entry point clearly visible from outside | Entry point obscured, wrong location |
| 4 | Entry Inside | Entry point visible from inside, grommet visible | Entry not shown, grommet missing |
| 5 | Wall | Wall installation area clearly shown | Wall not visible, cluttered |
| 6 | ONT Back | Fiber cable from entry to ONT visible, connections shown | ONT not visible, poor lighting |
| 7 | Power Meter | Reading visible and legible, within range | Reading not visible, out of range |
| 8 | Final Installation | Complete installation shown, work area clean | Incomplete, messy work area |
| 9 | Green Lights | Active broadband light visible and green | Lights not visible, wrong color |
| 10 | Signature | Customer signature visible and legible | No signature, illegible |

### Global Quality Standards

All photos must meet these baseline criteria:

1. **Clarity**: No motion blur, focus is sharp
2. **Lighting**: Subject is well-lit, no harsh shadows
3. **Framing**: Subject is centered, fully in frame
4. **Orientation**: Correct orientation (not rotated)
5. **Resolution**: Minimum 640x480, preferably 1080p

## VLM Prompt Template

```text
You are a fiber installation QA inspector reviewing a photo.

Photo Type: {step_label} (Step {step_number})
Expected Content: {step_description}

Validation Criteria:
{step_specific_criteria}

Global Quality Check:
- Is the image clear and in focus?
- Is the subject well-lit?
- Is the subject properly framed?
- Is the image correctly oriented?

Respond with JSON only:
{
  "result": "PASS" | "NEEDS_REVIEW",
  "confidence": 0.0-1.0,
  "issues": ["list of any issues found"],
  "notes": "brief explanation"
}
```

## VLM Response Handling

### Status Values

| Status | Meaning | Next Action |
|--------|---------|-------------|
| `pending` | Awaiting VLM processing | Queue for processing |
| `processing` | Currently being analyzed | Wait for completion |
| `completed` | VLM returned result | Review result, may need human |
| `failed` | VLM error occurred | Check `vlm_error`, retry |
| `approved` | Human approved result | Final, no action needed |
| `rejected` | Human rejected result | Requires re-submission |

### Database Fields

```sql
-- VLM result storage in dr_photo_unified_reviews
vlm_categorization JSONB,           -- VLM response per photo
vlm_categorization_status TEXT,     -- Overall status
vlm_error TEXT,                     -- Error message if failed
retry_count INTEGER DEFAULT 0       -- Retry attempts
```

### VLM Result Structure

```typescript
interface VlmCategorizationResult {
  photos: {
    filename: string;
    step: number;
    stepLabel: string;
    validation: {
      result: 'PASS' | 'NEEDS_REVIEW';
      confidence: number;
      issues: string[];
      notes: string;
    };
  }[];
  processedAt: string;
  modelVersion: string;
  overallResult: 'PASS' | 'NEEDS_REVIEW';
}
```

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/activate/validate-qa` | POST | Trigger VLM validation |
| `/api/activate/human-review` | POST | Submit human review decision |

## Retry Logic

```typescript
// Retry failed VLM calls with exponential backoff
const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 1000;

for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  try {
    const result = await callVlm(photo);
    return result;
  } catch (error) {
    if (attempt === MAX_RETRIES) throw error;
    await delay(INITIAL_DELAY_MS * Math.pow(2, attempt - 1));
  }
}
```

## Troubleshooting

### VLM Not Responding

```bash
# Check VLM health
curl http://100.96.203.105:8100/v1/models

# Check docker container
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "docker ps | grep vllm"
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "docker logs vllm-qwen3 --tail 50"

# Restart if needed
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "docker restart vllm-qwen3"
```

### Validation Always Failing

1. Check if photos are accessible via proxy URL
2. Verify image format is supported (jpg, png)
3. Check VLM prompt formatting
4. Review `vlm_error` for specific issues

### High NEEDS_REVIEW Rate

- May indicate installation quality issues
- Check if criteria are too strict
- Review sample of NEEDS_REVIEW photos manually

## Key Files

| File | Purpose |
|------|---------|
| `src/modules/activate/services/vlmQaValidationService.ts` | VLM API calls and prompt building |
| `pages/api/activate/validate-qa.ts` | Validation endpoint |
| `pages/api/activate/human-review.ts` | Human review submission |
| `src/modules/activate/components/ReviewTab.tsx` | Human review UI |
| `src/modules/activate/components/ActivityTab.tsx` | Activity log UI |

## Related Skills

- `/photo-categorization` - Phase 1: Photo type → step mapping
- `/activate` - Main Activate module operations
