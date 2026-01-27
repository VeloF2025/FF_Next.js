# Activate Export Filter Alignment

## Critical Rule

**`export.ts` and `drops.ts` MUST use identical filter logic.**

When any filter condition changes in `pages/api/activate/drops.ts`, the same change MUST be applied to `pages/api/activate/export.ts`.

## Filter Reference

### Status Filters
```sql
-- installed: NOT in OES
NOT EXISTS (SELECT 1 FROM oes_activations oes2 WHERE oes2.drop_number = upr.drop_number)

-- activated: IN OES
EXISTS (SELECT 1 FROM oes_activations oes2 WHERE oes2.drop_number = upr.drop_number)

-- reviewed: feedback_sent = true (NOT qa_decision)
upr.feedback_sent = true

-- not_reviewed: feedback_sent IS NULL OR false
(upr.feedback_sent IS NULL OR upr.feedback_sent = false)
```

### QA Status (DB stores uppercase)
| UI Value | DB Value |
|----------|----------|
| `pending` | `NULL` (qa_decision IS NULL) |
| `passed` | `PASS` |
| `failed` | `FAIL` |
| `rework` | `REWORK_NEEDED` |

### Serial Status (pattern-based, no status column)
| Filter | SQL Pattern |
|--------|-------------|
| `valid` | ONT LIKE `ALCL%`/`ALCB%` AND UPS LIKE `GU18W%` |
| `swapped` | ONT LIKE `GU18W%` OR UPS LIKE `ALCL%`/`ALCB%` |
| `missing` | ONT IS NULL OR UPS IS NULL |
| `invalid` | Neither ONT nor UPS match known patterns |

### Other Filters
- `resubmissionsOnly`: `submission_count > 1`
- `dateFrom/dateTo`: Applied to `COALESCE(submitted_date, created_at::DATE)`
- `project`: Direct match on `upr.project`

## Dynamic Export Button

Both Dashboard (`DrListPage.tsx`) and QA Centre (`QaCentrePage.tsx`) use dynamic button text:
```tsx
`Export ${filters.statusFilter !== 'all'
  ? filters.statusFilter.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  : 'All'} Excel`
```

## Export Features
- X-Export-Count response header (record count)
- Dynamic filename includes: active filters + record count
- format=json query param for JSON output (default: xlsx)
- No LIMIT clause (exports all matching records)
