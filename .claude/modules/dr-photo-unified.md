# Module: activate

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Unified DR photo review with VLM-powered AI categorization |
| **Status** | Active |
| **Complexity** | High |
| **Category** | monitoring |

## Dependencies

### Internal FF Modules
- wa-monitor (source of DR data from WhatsApp groups)

### External Packages
- lucide-react
- react
- @neondatabase/serverless
- Qwen3 VLM via VLLM on 100.96.203.105:8000

## Database

### Tables
- `foto_ai_reviews` - Main review table with VLM categorization

### Schema
```sql
CREATE TABLE foto_ai_reviews (
  id UUID PRIMARY KEY,
  dr_number TEXT NOT NULL,
  project TEXT,
  photos JSONB,
  vlm_categorization JSONB,
  vlm_status TEXT DEFAULT 'pending',
  vlm_error TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### Key Queries
```sql
-- Get pending categorizations
SELECT * FROM foto_ai_reviews WHERE vlm_status = 'pending' ORDER BY created_at;

-- Get failed for retry
SELECT * FROM foto_ai_reviews WHERE vlm_status = 'failed' AND retry_count < 3;

-- Stats by project
SELECT project, vlm_status, COUNT(*) FROM foto_ai_reviews GROUP BY project, vlm_status;
```

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/activate/health-check` | Service health status |
| GET | `/api/activate/admin/retry-failed` | List failed DRs |
| POST | `/api/activate/admin/retry-failed` | Retry failed categorizations |
| POST | `/api/activate/categorize-photos` | Trigger VLM categorization |
| POST | `/api/activate/approve-categorization` | Approve AI results |
| POST | `/api/activate/process-new-dr` | Process new DR from WA |
| GET | `/api/activate/fetch-photos` | Fetch photos for DR |
| POST | `/api/activate/send-feedback` | Send WhatsApp feedback |

## Pages
| Route | Description |
|-------|-------------|
| `/activate` | Main dashboard with DR list and Manual Entry tabs |
| `/activate/monitoring` | Full system health dashboard |
| `/activate/[dropNumber]` | Individual DR review page |

## Services

### categorizationVlmService
```typescript
categorizePhotos(drNumber: string, photos: Photo[])
getCategorization(drNumber: string)
approveResults(drNumber: string, corrections?: object)
retryFailed(drNumbers?: string[])
```

## Components
- `DrListPage` - Main page with tabs (List / Manual Entry)
- `UnifiedReviewCard` - Individual DR review interface
- `ManualDREntry` - Manual DR addition form
- `SystemHealthDashboard` - Health monitoring (compact/full modes)
- `AICategorizationTab` - AI results display

## Hooks
- `useHealthCheck()` - Service health polling
- `useDRList()` - DR listing with filters

## Types
- `DrUnified` - Main DR data structure
- `VlmCategorization` - AI categorization result
- `HealthCheckResponse` - Service status response
- `VlmStatus` - pending | processing | completed | failed | approved

## VLM Integration

### 10-Step Photo Checklist
| Step | Field | Description |
|------|-------|-------------|
| 1 | cable_placement | Cable correctly placed |
| 2 | splicing_complete | Splicing work completed |
| 3 | enclosure_sealed | Enclosure properly sealed |
| 4 | labels_visible | Labels clearly visible |
| 5 | fiber_protection | Fiber protection in place |
| 6 | nbn_compliance | NBN compliance met |
| 7 | documentation | Documentation complete |
| 8 | site_cleanup | Site cleaned up |
| 9 | safety_measures | Safety measures followed |
| 10 | quality_check | Final quality check passed |

### VLM Configuration
- Model: Qwen3 via VLLM
- Endpoint: http://100.96.203.105:8000
- Prompts: 10-step structure analysis

## WhatsApp Integration

### Sender Service
- URL: http://100.96.203.105:8081
- Health check: `curl http://100.96.203.105:8081/health`

### Group Mapping
| Project | Group ID |
|---------|----------|
| Lawley | 120363418298130331@g.us |
| Mohadin | 120363421532174586@g.us |
| Velo Test | 120363421664266245@g.us |
| Mamelodi | 120363408849234743@g.us |

## Patterns
- Tab-based UI (List tab + Manual Entry tab)
- Health dashboard with compact (header) and full (page) modes
- Auto-refresh for health status (30s interval)
- Retry queue for failed VLM categorizations
- WhatsApp feedback integration

## Gotchas
- **Routing Conflict**: Dynamic route `[dropNumber].tsx` catches static routes
  - Solution: Create explicit Pages Router files (e.g., `monitoring.tsx`)
- **VLM Timeout**: Large batches may timeout - process in chunks
- **Retry Limit**: Max 3 retries per DR before manual intervention
- **WhatsApp Service**: May need re-pairing with phone periodically
- **Migration Required**: Run `055_vlm_categorization.sql` before first use

## Troubleshooting

### VLM Not Responding
```bash
ssh louis@100.96.203.105
docker ps | grep vllm
docker logs vllm-qwen3
```

### Photos Not Categorizing
1. Check health dashboard: `/activate/monitoring`
2. Review retry queue via admin/retry-failed API
3. Check vlm_error in foto_ai_reviews table

### WhatsApp Feedback Not Sending
```bash
ssh louis@100.96.203.105
sudo systemctl restart whatsapp-sender
```

## Related Modules
- `wa-monitor` - Source of DR data from WhatsApp groups
- `foto-review` - Legacy AI photo review (predecessor)
- `dr-photo-review` - Legacy DR photo workflow

## File Structure
```
src/modules/activate/
├── components/
│   ├── DrListPage.tsx
│   ├── UnifiedReviewCard.tsx
│   ├── ManualDREntry.tsx
│   ├── SystemHealthDashboard.tsx
│   └── AICategorizationTab.tsx
├── services/
│   └── categorizationVlmService.ts
└── types/
    └── unified.types.ts

pages/activate/
├── index.tsx
├── monitoring.tsx
└── [dropNumber].tsx

pages/api/activate/
├── health-check.ts
├── fetch-photos.ts
├── categorize-photos.ts
├── approve-categorization.ts
├── process-new-dr.ts
├── send-feedback.ts
└── admin/
    └── retry-failed.ts
```
