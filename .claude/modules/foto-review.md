# Module: foto-review

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | AI-powered photo evaluation system for fiber installation quality assessment using GPT-4 Vision and VLM models |
| **Status** | Active |
| **Complexity** | High |
| **Category** | monitoring |

## Dependencies

### Internal FF Modules
None

### External Packages
- @neondatabase/serverless
- livekit-server-sdk (optional for recording)
- lucide-react
- next
- openai (via Python backend)

## Database

### Tables
- `foto_ai_reviews` - AI evaluation results with step-by-step breakdown
- `qa_photo_reviews` - WA Monitor data (linked by drop_number)

### Key Queries
- SELECT by dr_number from foto_ai_reviews with JOIN to qa_photo_reviews for submitter phone
- INSERT/UPDATE ON CONFLICT on dr_number for evaluation upserts
- Query step_results (JSONB column) with array of step evaluation results

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/foto/photos` | Fetch DRs with photos |
| POST | `/api/foto/evaluate` | Trigger AI evaluation |
| GET | `/api/foto/evaluation/[dr_number]` | Fetch cached evaluation |
| POST | `/api/foto/feedback` | Send WhatsApp feedback |
| POST | `/api/foto/auto-process` | Batch auto-evaluate drops |
| GET | `/api/foto/download-report` | Download evaluation report |
| GET | `/api/foto/photo-proxy` | Proxy photos from BOSS VPS |

## Services

### fotoEvaluationService
```typescript
fetchPhotos(filters)
fetchPhotosByDR(dr_number)
evaluateDR(dr_number)
getEvaluation(dr_number)
sendFeedback(dr_number, message, project)
reEvaluateDR(dr_number)
isEvaluated(dr_number)
```

### fotoDbService
```typescript
getEvaluationByDR(dr_number)
getAllEvaluations(filters)
saveEvaluation(evaluation)
markFeedbackSent(dr_number)
getDropSubmitterPhone(dr_number)
```

### fotoVlmService
```typescript
fetchDrPhotos(dr_number)
executeVlmEvaluation(dr_number, photos, steps)
loadQASteps()
```

### autoEvaluator
```typescript
autoEvaluateDrop(drNumber, project)
autoEvaluateDropWithRetry(drNumber, project, retryCount)
autoProcessDropsBatch(drops)
```

## Components
- `PhotoGallery` - Grid view of DR photos
- `AIEvaluationCard` - PASS/FAIL summary
- `EvaluationResults` - Step-by-step breakdown
- `EvaluationPanel` - Combined photo + results
- `FeedbackButton` - WhatsApp feedback sender
- `FilterControls` - Filtering interface

## Hooks
- `usePhotos(initialFilters)` - Fetch and filter DRs
- `useFotoEvaluation()` - Evaluation state management

## Patterns
- Client-side API service layer wraps /api endpoints
- Lazy-initialized database connections
- Batch processing with rate limiting (MAX_CONCURRENT_EVALUATIONS=3)
- Dry-run mode for testing (AUTO_EVALUATOR_DRY_RUN env var)
- Human approval required for feedback (AUTO_EVALUATOR_SEND_FEEDBACK defaults to false)
- Neon serverless queries with template literals
- JSONB storage for step_results array
- Retry logic with exponential backoff
- VLM inference at port 8100 with 3-minute timeout

## Gotchas
- **Two Tables**: foto_ai_reviews (AI evaluations) vs qa_photo_reviews (WA Monitor data) - JOIN by dr_number/drop_number
- **External Photos**: Photos hosted on BOSS VPS at 100.96.203.105. Photo-proxy adds compression
- **VLM Timeout**: 180 seconds (3 min) - long images take time. Max concurrent limited
- **WA Integration**: Feedback requires integration with wa-monitor service AND valid project name
- **Opt-In Auto**: Auto-evaluation opt-in via AUTO_EVALUATOR_SEND_FEEDBACK env var
- **Python Backend**: Located at /home/louisdup/VF/agents/foto/foto-evaluator-ach/ on VPS
- **Step Config**: Can load from config/qa-evaluation-steps.json with hardcoded fallback
- **SQL Safety**: Must use sql.unsafe() for dynamic WHERE clauses
