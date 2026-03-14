# RAG Module Changelog

All notable changes to the RAG (Red/Amber/Green) contractor health scoring module are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- [ ] Separate RAG into independent, reusable module
- [ ] Implement safety incident tracking (currently hardcoded to 0)
- [ ] Add automated score recalculation via cron jobs
- [ ] Score history & trending dashboard
- [ ] Performance dimension real-time calculation
- [ ] Email alerts on RAG status changes
- [ ] External API for contractor risk scoring
- [ ] Drill-down breakdowns (which specific items caused red/amber)
- [ ] Contractor leaderboard (top performers)

## [1.0.0] – 2026-03-11

### Added (2026-03-11)
- **README.md** — Complete RAG module documentation with quick start, architecture, API reference, and examples
- **This CHANGELOG** — Version history tracking

### Current State (as of 2026-03-11)
- ✅ Financial dimension scoring (based on payment history, financial stability)
- ✅ Compliance dimension scoring (based on document expiration, certifications)
- ✅ Performance dimension scoring (based on project aggregates)
- ✅ Safety dimension placeholder (hardcoded to green, no incidents tracked)
- ✅ Overall RAG status (worst-of-all-dimensions fail-safe model)
- ✅ RagDashboard component with filtering
- ✅ RagStatusBadge component (colored badges)
- ✅ `/api/contractors-rag` endpoint (GET single or all)

### Known Limitations (v1.0.0)
- Safety scoring hardcoded to green (no incident tracking table exists)
- Payment data aggregation incomplete
- Performance scoring uses contractor aggregates, not real-time calculations
- No score history tracking (trending not available)
- No automated recalculation (manual or on-demand only)
- RAG embedded in contractors module (not separately reusable)

### Architecture (v1.0.0)
- **Service:** `ragCalculationService` (core scoring engine)
- **Service:** `ragApiService` (API wrapper)
- **Components:** `RagDashboard`, `RagStatusBadge`
- **API:** `GET /api/contractors-rag` (single or bulk)
- **Data:** Reads from `contractors`, `contractor_documents` tables

---

## Legend

- **Added** — New features or capabilities
- **Changed** — Modifications to existing functionality
- **Deprecated** — Features marked for future removal
- **Removed** — Deleted features or code
- **Fixed** — Bug fixes
- **Security** — Security-related changes
- **Planned** — Upcoming work in the roadmap

---

## Versioning Notes

### v1.0.0 Baseline
Represents the current state of RAG scoring as an embedded, functioning system. Scoring works for contractors but has known data gaps (safety, performance) that prevent full accuracy.

### Future Versions (v1.1+)
Will focus on:
1. **Resolving Known Gaps** (safety tracking, performance real-time calc)
2. **Architecture Separation** (making RAG independently reusable)
3. **Analytics & Trending** (score history, dashboards)
4. **Automation** (cron recalculation, alerts)

---

## Document History

| Date | Author | Change |
|------|--------|--------|
| 2026-03-11 | Scribe | Initial CHANGELOG created; v1.0.0 baseline documented |

---

**Last Updated:** 2026-03-11  
**Maintainer:** Elon (CTO)
