# FibreFlow UI/UX Improvement Plan

**Audit Date:** January 22, 2026
**Auditor:** Claude Code
**Reference:** `docs/THEME_SPECIFICATION.md`
**Gold Standard:** `/maintenance` page

---

## Executive Summary

Comprehensive UI/UX audit of FibreFlow staging (vf.fibreflow.app) revealed:
- **23 pages audited** across all modules
- **2 critical bugs fixed** during audit (procurement tabs)
- **1 major non-conformance** (Analytics page)
- **Several minor improvements** identified
- **No console errors** on any page after fixes
- **All API calls use correct URLs** (no localhost leakage)

---

## Fixes Applied During Audit

### 1. Procurement Route Abort Error ✅ FIXED
**Commit:** `cf16aa26`
**Issue:** Console errors "Abort fetching component for route: /procurement/field-stock" (5x)
**Root Cause:** `ProcurementTabs.tsx` triggered navigation while also rendering inline content
**Fix:** Added check to prevent navigation when on main `/procurement` page

### 2. Procurement Tabs Visibility ✅ FIXED
**Commit:** `c963aa48`
**Issue:** Only Dashboard and Field Stock tabs visible in "All Projects" view
**Root Cause:** `useProcurementPermissions.ts` returned `false` for all view permissions when no project selected
**Fix:** Changed to return `true` for view permissions in All Projects view (edit permissions still require project)

---

## Pages Conforming to UI Spec ✅

| Page | Status | Notes |
|------|--------|-------|
| `/maintenance` | Gold Standard | Reference for all pages |
| `/maintenance/tickets` | Excellent | Kanban + list views |
| `/staff` | Good | Minor: 5th stat card orphaned |
| `/fleet` | Good | Clean dashboard layout |
| `/clients` | Good | Proper table layout |
| `/contractors` | Good | Missing stat cards (intentional?) |
| `/assets` | Excellent | Dashboard with quick actions |
| `/procurement` | Good | After fixes applied |
| `/projects` | Good | Minor: empty columns show "-" |
| `/dashboard` | Good | Main landing page |

---

## Major Non-Conformance: Analytics Page ❌

**Location:** `/analytics`
**Severity:** HIGH - Needs significant refactoring

### Current Issues

| Element | Current State | Expected (per spec) |
|---------|---------------|---------------------|
| Header | Redundant "Analytics & Reports" + "Analytics Dashboard" | Single title with subtitle |
| Action Buttons | Text links with icons ("Export Report / Refresh Data") | Proper styled buttons |
| Stat Card Icons | Positioned absolutely in top-right corner | Same row with `justify-between` |
| Stat Card Layout | 2 rows of 5 cards (10 total) | Single row of 4-5 cards |
| Secondary Metrics | Second row of stat cards | Separate "Status by X" section |

### Recommended Fix

```tsx
// BEFORE (current)
<div className="stat-card">
  <span className="label">{label}</span>
  <span className="value">{value}</span>
  <Icon className="absolute top-4 right-4" /> {/* Wrong */}
</div>

// AFTER (per spec)
<div className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)]">
  <div className="flex items-center justify-between">
    <div>
      <p className="text-sm text-[var(--ff-text-secondary)]">{label}</p>
      <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{value}</p>
    </div>
    <div className="h-12 w-12 bg-blue-500/20 rounded-full flex items-center justify-center">
      <Icon className="h-6 w-6 text-blue-400" />
    </div>
  </div>
</div>
```

### Action Items for Analytics

1. [ ] Simplify header to single title + subtitle + action buttons
2. [ ] Convert action links to proper button components
3. [ ] Refactor stat cards to use standard layout
4. [ ] Reduce to 4-5 primary stat cards
5. [ ] Move secondary metrics to dedicated section
6. [ ] Test responsive behavior at all breakpoints

---

## Minor Improvements Recommended

### Navigation & Sidebar

| Item | Current | Recommendation |
|------|---------|----------------|
| Sidebar sections | Inconsistent grouping | Standardize order: Main → Project Mgmt → Operations → People → Finance → Settings |
| Collapsed state | Works | Add keyboard shortcut (Cmd+B) |
| Active state | Blue highlight | Consistent across all items |

### Data Tables

| Item | Current | Recommendation |
|------|---------|----------------|
| Empty states | "No data" text | Add illustration + CTA button |
| Loading states | Spinner | Add skeleton loaders |
| Pagination | Basic | Add page size selector |
| Sorting | Works | Add visual indicator for sort direction |

### Forms & Inputs

| Item | Current | Recommendation |
|------|---------|----------------|
| Validation | Inline errors | Add field-level validation on blur |
| Required fields | Asterisk | Consistent asterisk color |
| Date pickers | Native | Consider unified date picker component |

### Performance

| Item | Current | Recommendation |
|------|---------|----------------|
| Image loading | Immediate | Add lazy loading for images |
| API caching | Limited | Implement SWR/React Query caching |
| Bundle size | ~500KB first load | Analyze and optimize chunks |

---

## Security Observations

### Positive Findings ✅
- All API calls use correct server URLs (no localhost in browser)
- Tailscale IPs used server-side only (correct)
- No sensitive data exposed in network requests
- HTTPS enforced on all endpoints

### Recommendations
- [ ] Add CSP headers
- [ ] Implement rate limiting on client
- [ ] Add CORS validation
- [ ] Review authentication token handling

---

## Infrastructure Notes

### API URL Configuration ✅ CORRECT
- Browser requests: `https://vf.fibreflow.app/api/*`
- Server-side (VLM, WA): Uses Tailscale `100.96.203.105`
- No localhost leakage detected

### Environment Variables
- `NEXT_PUBLIC_APP_URL` correctly configured
- `VLM_API_URL` uses internal network (correct)
- Database credentials properly secured

---

## Priority Matrix

| Priority | Task | Effort | Impact |
|----------|------|--------|--------|
| P1 | Refactor Analytics page | High | High |
| P2 | Add skeleton loaders | Medium | Medium |
| P3 | Standardize empty states | Low | Medium |
| P3 | Add keyboard shortcuts | Low | Low |
| P4 | Optimize bundle size | High | Medium |

---

## Verification Checklist

For each page, verify:
- [ ] Uses AppLayout wrapper
- [ ] Uses CSS variables (not hardcoded colors)
- [ ] Has consistent header with title and actions
- [ ] Has summary/stat cards section
- [ ] Has search and filter bar (where applicable)
- [ ] Table uses theme-aware styling
- [ ] Status badges use opacity variants
- [ ] Loading and empty states styled
- [ ] No double headers
- [ ] Responsive at all breakpoints
- [ ] All text is visible (contrast check)
- [ ] No console errors

---

## Next Steps

1. **Immediate:** Review and approve this improvement plan
2. **Week 1:** Refactor Analytics page to match spec
3. **Week 2:** Implement skeleton loaders across data tables
4. **Week 3:** Standardize empty states and add CTAs
5. **Ongoing:** Apply checklist to new pages

---

*Generated by Claude Code audit on January 22, 2026*
