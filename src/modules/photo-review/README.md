# Foto Review Module

AI-powered photo evaluation module for FibreFlow. Provides automated quality assessment of fiber installation photos using GPT-4 Vision.

## Overview

This module enables quality control teams to:
- View installation photos for all DRs
- Run AI-powered evaluations on photo quality and compliance
- Send automated WhatsApp feedback to field agents
- Track evaluation history

## Module Structure

```
foto-review/
├── components/          # React UI components
│   ├── PhotoGallery.tsx       # Grid view of DR photos
│   ├── AIEvaluationCard.tsx   # Evaluation results summary
│   ├── EvaluationResults.tsx  # Detailed step breakdown
│   └── FeedbackButton.tsx     # WhatsApp feedback sender
├── services/            # API service layer
│   └── fotoEvaluationService.ts
├── hooks/               # Custom React hooks
│   ├── useFotoEvaluation.ts   # Evaluation state management
│   └── usePhotos.ts           # Photo fetching and filtering
├── types/               # TypeScript definitions
│   └── index.ts               # All module types
└── README.md            # This file
```

## Key Features

### 1. Photo Gallery
- Grid layout of installation photos
- Click-to-enlarge functionality
- Photo metadata display
- Responsive design

### 2. AI Evaluation
- 12-step quality assessment
- Overall PASS/FAIL status
- Numerical scoring (0-10 per step)
- Detailed AI comments

### 3. WhatsApp Feedback
- Automated message generation
- Integration with wa-monitor service
- Feedback preview before sending
- Tracking of sent status

## Usage

### Basic Usage

```tsx
import { PhotoGallery, AIEvaluationCard } from '@/modules/foto-review/components';
import { useFotoEvaluation, usePhotos } from '@/modules/foto-review/hooks';

function FotoReviewPage() {
  const { photos, loading } = usePhotos();
  const { evaluation, loading: evaluating, evaluate } = useFotoEvaluation();

  return (
    <div>
      <PhotoGallery photos={photos[0]?.photos || []} loading={loading} />
      {evaluation && <AIEvaluationCard evaluation={evaluation} />}
      <button onClick={() => evaluate('DR1234567')}>Evaluate</button>
    </div>
  );
}
```

### API Service

```tsx
import { fotoEvaluationService } from '@/modules/foto-review/services/fotoEvaluationService';

// Fetch photos
const photos = await fotoEvaluationService.getPhotos({ project: 'Lawley' });

// Trigger evaluation
const result = await fotoEvaluationService.evaluateDR('DR1234567');

// Get cached evaluation
const cached = await fotoEvaluationService.getEvaluation('DR1234567');

// Send feedback
await fotoEvaluationService.sendFeedback('DR1234567');
```

## Types

All TypeScript types are defined in `types/index.ts`. Key types:

- `DropRecord` - DR with photos
- `PhotoMetadata` - Individual photo info
- `EvaluationResult` - Complete evaluation results
- `StepEvaluationResult` - Single step result
- `FeedbackStatus` - Feedback sending status

See type definitions for full JSDoc documentation.

## Components

### PhotoGallery

Displays photos in a responsive grid.

```tsx
<PhotoGallery
  photos={photos}
  onPhotoClick={(photo) => console.log(photo)}
  loading={false}
/>
```

### AIEvaluationCard

Shows evaluation summary with PASS/FAIL badge, score, and step count.

```tsx
<AIEvaluationCard
  evaluation={result}
  onSendFeedback={() => handleFeedback()}
  sendingFeedback={false}
/>
```

### EvaluationResults

Displays detailed step-by-step breakdown.

```tsx
<EvaluationResults
  stepResults={result.step_results}
  compact={false}
/>
```

### FeedbackButton

Handles WhatsApp feedback sending with confirmation.

```tsx
<FeedbackButton
  drNumber="DR1234567"
  feedbackSent={false}
  onFeedbackSent={() => refresh()}
/>
```

## Hooks

### useFotoEvaluation

Manages evaluation state and operations.

```tsx
const {
  evaluation,    // Current evaluation result
  loading,       // Is evaluation in progress?
  error,         // Error message if failed
  evaluate,      // Function to trigger evaluation
  clear          // Clear current evaluation
} = useFotoEvaluation();

// Trigger evaluation
await evaluate('DR1234567');
```

### usePhotos

Fetches and filters photos.

```tsx
const {
  photos,        // Array of drop records
  loading,       // Is loading?
  error,         // Error message
  refresh,       // Reload photos
  applyFilters   // Apply filters
} = usePhotos();

// Apply filters
await applyFilters({
  project: 'Lawley',
  startDate: new Date('2024-01-01'),
  evaluationStatus: 'pending'
});
```

## Page Layout Configuration

### Fullscreen Mode (No Sidebar)

The foto-review page displays in fullscreen mode without the standard AppLayout sidebar. This provides maximum screen space for photo review operations.

**Implementation (December 8, 2024):**

The page bypasses the default AppLayout using a custom `getLayout` function:

```tsx
// pages/foto-review.tsx
import type { ReactElement } from 'react';

function FotoReviewPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* Page content without sidebar */}
    </div>
  );
}

// Disable AppLayout for this page (no sidebar/menu)
FotoReviewPage.getLayout = function getLayout(page: ReactElement) {
  return page;  // Returns just the page content without any layout wrapper
};

export default FotoReviewPage;
```

**Key Points:**
- No sidebar menu on the left
- Full width available for content
- Custom header and navigation within the page
- Better for photo-focused workflows

To restore the sidebar, simply remove the `getLayout` function and wrap content in `<AppLayout>`.

## API Integration

This module communicates with Next.js API routes:

- `GET /api/foto/photos` - Fetch DR photos
- `POST /api/foto/evaluate` - Trigger evaluation
- `GET /api/foto/evaluation/[dr_number]` - Get cached result
- `POST /api/foto/feedback` - Send WhatsApp feedback

API routes call Python backend via child_process to run AI evaluations.

## Python Backend

The Python evaluation engine is located at:
```
/home/louisdup/VF/agents/foto/foto-evaluator-ach/
```

It provides:
- GPT-4 Vision integration
- 12-step evaluation prompts
- Scoring and PASS/FAIL logic
- Markdown report generation

## Database

Results are stored in `foto_ai_reviews` table:

```sql
SELECT dr_number, overall_status, average_score, passed_steps
FROM foto_ai_reviews
WHERE evaluation_date >= NOW() - INTERVAL '7 days'
ORDER BY evaluation_date DESC;
```

## Development

### Adding a New Component

1. Create component in `components/`
2. Add TypeScript types to `types/index.ts`
3. Export from `components/index.ts`
4. Write tests
5. Update this README

### Modifying Evaluation Logic

Evaluation logic is in Python backend. To modify:
1. Edit `foto_prompts.py` for new criteria
2. Update `foto_verifier.py` for scoring logic
3. Update TypeScript types if schema changes
4. Redeploy Python backend to VPS

## Testing

```bash
# Run component tests
npm test src/modules/foto-review

# Run integration tests
npm run test:integration

# E2E tests
npm run test:e2e -- foto-review
```

## Deployment

1. Build application: `npm run build`
2. Deploy Python backend to VPS: `/opt/foto-evaluator`
3. Push to git and let Vercel auto-deploy
4. Verify at: `https://app.fibreflow.app/foto-review`

## Troubleshooting

### Evaluation Not Working

- Check Python backend is running on VPS
- Verify OPENAI_API_KEY is set in environment
- Check API route logs: `tail -f .next/server.log`
- Test Python script manually: `python evaluate_dr.py DR1234567`

### Photos Not Loading

- Verify BOSS VPS is accessible
- Check photo URLs in database
- Test API endpoint: `curl http://localhost:3005/api/foto/photos`

### Feedback Not Sending

- Verify wa-monitor service is running
- Check WhatsApp bridge connection
- Test feedback endpoint with Postman

## References

- **Main App**: See `CLAUDE.md` for FibreFlow architecture
- **wa-monitor**: Reference module for structure patterns
- **Python Backend**: `/home/louisdup/VF/agents/foto/foto-evaluator-ach/README.md`
- **Feature List**: `feature_list.json` for implementation checklist

---

**Status**: Initial Setup - Components to be implemented
**Version**: 1.0.0
**Last Updated**: December 2024
