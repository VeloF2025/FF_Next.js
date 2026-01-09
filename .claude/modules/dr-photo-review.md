# Module: dr-photo-review

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | AI-powered photo evaluation system for fiber installation quality assurance |
| **Status** | Active |
| **Complexity** | High |
| **Category** | monitoring |

## Dependencies

### Internal FF Modules
None

### External Packages
- lucide-react
- react
- Backend API at localhost:8082 (remote VLM service)

## Database

### Tables
None - uses external API

### Key Queries
N/A

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/dr-dashboard/sessions` | List sessions |
| GET | `/api/dr-dashboard/sessions/{drNumber}/photos?project={project}` | Get DR photos |
| POST | `/api/dr-dashboard/sessions/{drNumber}/evaluate` | Evaluate DR |
| POST | `/api/dr-dashboard/evaluate` | Single photo evaluation |
| GET | `/api/dr-dashboard/vlm-status` | VLM status check |
| GET | `/api/dr-dashboard/photos/{drNumber}/{filename}` | Get photo |

## Services

### drPhotoReviewService
```typescript
fetchSessions()
fetchDRPhotos(drNumber, project)
evaluatePhoto(drNumber, filename, stepNumber, housingType)
evaluateAllPhotos(drNumber)
getVLMStatus()
getPhotoUrl(drNumber, filename)
getStepInfo(stepNumber)
blobToBase64(blob)
```

## Components
- `DRSessionList` - Session listing
- `DRPhotoGallery` - Photo display
- `DREvaluationPanel` - Evaluation interface
- `VLMStatusIndicator` - VLM connection status

## Hooks
- `useDRSessions()` - Session data
- `useDREvaluation()` - Evaluation state

## Types
- `DR_PHOTO_STEPS` - Constant array (11 steps)
- `DRSession` - Session data (dr_number, project, status, current_step)
- `DRStepPhoto` - Photo metadata
- `PhotoEvaluation` - AI results + FiberTime compliance
- `DREvaluationResult` - Overall pass/fail per DR
- `VLMStatus` - Online state + available models
- `FibertimeCompliance` - Detailed compliance checks

## Critical Steps
| Step | Description |
|------|-------------|
| 3 | Cable Entry Outside |
| 7 | Power Meter Reading |
| 8 | ONT Barcode/Serial |
| 9 | UPS Serial Number |
| 10 | Final Installation |
| 11 | Green Lights |

## Patterns
- External VLM backend integration (localhost:8082)
- 11-step verification workflow for fiber installations
- Critical vs non-critical step distinction
- Image evaluation with base64 encoding
- FiberTime compliance checking
- VLM status monitoring (online/offline)
- Session list with search and filtering
- Photo gallery with step-by-step progression
- Evaluation result aggregation

## Gotchas
- **External Backend**: Requires running backend service on localhost:8082 (not in this repo)
- **CORS Proxy**: Photo URLs proxied through /api/dr-dashboard/* to avoid CORS
- **Base64 Required**: Images must be converted to base64 for evaluation
- **Legacy Fields**: VLM response format has legacy fields for backward compatibility
- **Nested Data**: FiberTime compliance details deeply nested in evaluation response
- **Default Project**: Default project is 'VPS' if not specified
- **Array Indexing**: Step numbers are 1-11 but mapped to 0-indexed arrays
