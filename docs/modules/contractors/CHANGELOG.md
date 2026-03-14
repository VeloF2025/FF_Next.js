# Contractors Module Changelog

All notable changes to the Contractors module are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- [ ] Separate RAG scoring into independent module
- [ ] Safety incident tracking (currently hardcoded in RAG)
- [ ] Contractor document automation (auto-expiration warnings)
- [ ] Integration with project cost tracking
- [ ] Contractor performance metrics dashboard

## [1.0.0] – 2026-03-11

### Current State (as of 2026-03-11)
- ✅ Contractor CRUD operations (create, read, update, delete)
- ✅ RAG (Red/Amber/Green) scoring embedded
  - Financial dimension (payment history, stability)
  - Compliance dimension (document status, certifications)
  - Performance dimension (project aggregates)
  - Safety dimension (placeholder, hardcoded to green)
- ✅ Contractor document tracking (expiration, certification status)
- ✅ Contractor list with RAG dashboard filtering
- ✅ Contractor detail view with RAG breakdown
- ✅ `/api/contractors-rag` endpoint (GET single or bulk)

### Known Limitations (v1.0.0)
- RAG module tightly coupled (not independently reusable)
- Safety scoring non-functional (no incident tracking)
- Payment aggregation incomplete
- No contractor performance metrics history
- No automated document expiration warnings

### Database (v1.0.0)
- `contractors` table — Contractor identity, status, RAG scores
- `contractor_documents` table — Document tracking, expiration
- Related: `projects` (contractor assignments), `accounting` (payments)

### UI Components (v1.0.0)
- **ContractorsPage** — Main list view with RAG dashboard
- **ContractorDetail** — Individual contractor view with RAG breakdown
- **RagDashboard** — Filtering and visualization (shared with RAG module)
- **RagStatusBadge** — Color-coded status display

### API Endpoints (v1.0.0)
- `GET /api/contractors-rag` — Fetch contractor RAG status (single or bulk)
- CRUD operations via main contractors module (separate from RAG)

---

## Historical Notes

### Before v1.0.0 (Pre-Documentation)
- Contractors module existed in production with embedded RAG scoring
- No version tracking or changelog maintained
- Documentation gaps: no README, no API docs, no architecture docs
- v1.0.0 marks the baseline for future changelog tracking

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

## Document History

| Date | Author | Change |
|------|--------|--------|
| 2026-03-11 | Scribe | Initial CHANGELOG created; v1.0.0 baseline documented |

---

**Last Updated:** 2026-03-11  
**Maintainer:** Elon (CTO)  
**Related:** [RAG Module Docs](../rag/README.md) | [Contractors README](README.md)
