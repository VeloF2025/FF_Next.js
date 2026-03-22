# Analytics Module Changelog

All notable changes to the FibreFlow Analytics & Reporting module are documented here. This changelog tracks new features, improvements, bug fixes, and breaking changes.

Format based on [Keep a Changelog](https://keepachangelog.com/).

---

## [Unreleased]

### Planned
- Power BI DirectQuery mode for real-time dashboard sourcing
- Advanced time-series forecasting with machine learning
- Custom KPI builder UI for non-technical users

---

## [1.0.0] – 2026-03-21

### Added – Reports Sandbox (Major Feature)

**Commit:** `ca95b24af9c418e02b45b9d43d92d106fdc23f81`  
**Author:** Claude Sonnet 4.5  
**Size:** 2,841 lines, 22 files changed  
**Status:** Shipped to Production

#### New Report Types (6 Core Reports)

1. **Cashflow Overview Report**
   - Endpoint: `GET /api/analytics/reports/cashflow`
   - Metrics: Opening balance, inflows, outflows, closing balance (period-based)
   - Time Granularity: Daily, Weekly, Monthly, Quarterly
   - Export Formats: Excel (XLSX), PDF
   - RBAC: Admin, Manager, Finance roles

2. **Revenue Overview Report**
   - Endpoint: `GET /api/analytics/reports/revenue-overview`
   - Metrics: Gross revenue, net revenue, by-project and by-client aggregation, trends
   - Scope: Organization-wide with drill-down capability
   - Export Formats: Excel, PDF
   - RBAC: Admin, Manager, Finance roles

3. **Project Revenue Projections Report**
   - Endpoint: `GET /api/analytics/reports/project-revenue-projection`
   - Metrics: Forecasted completion revenue, burn-down curves, variance analysis
   - Calculation: Based on historical burn rate and current project progress
   - Export Formats: Excel, PDF
   - RBAC: Admin, Manager, Finance, ProjectManager roles

4. **Expense Pivot Report**
   - Endpoint: `GET /api/analytics/reports/expense-pivot`
   - Multi-dimensional analysis: Category, Supplier, Cost Center, Project, Time Period
   - Metrics: Total expenses, expense ratio (%), trend analysis, cost drivers
   - Dynamic pivoting support
   - Export Formats: Excel (with pivot tables), PDF
   - RBAC: Admin, Manager, Finance roles

5. **Project Financial Detail Report**
   - Endpoint: `GET /api/analytics/reports/project-financial-detail`
   - Metrics: Budget vs. Actual (full variance), item-level cost breakdown, profitability, forecast-to-complete
   - Format: Tabular with drill-down to purchase orders and invoices
   - Scope: Single project deep-dive
   - RBAC: Admin, Manager, Finance, ProjectManager (own projects only)

6. **Project Detail Report**
   - Endpoint: `GET /api/analytics/reports/project-detail`
   - Content: Project metadata, status, timeline, resources, KPIs, financial snapshot
   - Format: Single-page summary with drill-down capability
   - Scope: All roles (filtered by RBAC — own projects for Technician/Viewer)
   - Export Formats: Excel, PDF

#### New API Endpoints

All endpoints available under `/api/analytics/reports/`

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/analytics/reports/cashflow` | GET | Fetch cashflow overview |
| `/api/analytics/reports/revenue-overview` | GET | Fetch revenue aggregation |
| `/api/analytics/reports/project-revenue-projection` | GET | Fetch revenue forecasts |
| `/api/analytics/reports/expense-pivot` | GET | Fetch multi-dimensional expenses |
| `/api/analytics/reports/project-financial-detail` | GET | Fetch project financials (deep-dive) |
| `/api/analytics/reports/project-detail` | GET | Fetch project summary |
| `/api/analytics/reports/export` | POST | Export report to Excel/PDF/SharePoint |

#### SharePoint Excel Integration

- **Feature:** Automated export to Microsoft SharePoint OneDrive
- **Location:** `/sites/FibreFlow/Shared Documents/Reports/`
- **Formats:** XLSX with metadata sheets, formatted headers, pivot tables
- **Power BI:** Excel files queryable via Power BI Graph Connector
- **Schedule:** Daily 8 PM UTC (configurable)
- **Documentation:** See `docs/integrations/sharepoint-excel.md`

#### RBAC Permission Migration (SQL 248)

**Migration:** 248-add-analytics-report-permissions.sql

New permission keys added to `permissions` table:
- `analytics:reports:cashflow:view` — Cashflow report access
- `analytics:reports:revenue:view` — Revenue report access
- `analytics:reports:projection:view` — Revenue projection access
- `analytics:reports:expense:view` — Expense pivot report access
- `analytics:reports:financial-detail:view` — Project financial detail access
- `analytics:reports:project-detail:view` — Project detail access
- `analytics:reports:export:excel` — Excel export capability
- `analytics:reports:export:pdf` — PDF export capability

**Role Mapping:**

| Permission Key | Admin | Manager | Finance | ProjectMgr | Technician | Viewer |
|---|---|---|---|---|---|---|
| `analytics:reports:cashflow:view` | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| `analytics:reports:revenue:view` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| `analytics:reports:projection:view` | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| `analytics:reports:expense:view` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| `analytics:reports:financial-detail:view` | ✓ | ✓ | ✓ | ✓* | ✗ | ✗ |
| `analytics:reports:project-detail:view` | ✓ | ✓ | ✓ | ✓* | ✓* | ✓* |
| `analytics:reports:export:excel` | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| `analytics:reports:export:pdf` | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |

*ProjectMgr, Technician, Viewer: own projects only (scoped by projectId)

#### Database Changes

**Tables Modified:**
- `permissions` — 8 new permission entries
- Indices optimized for `/api/analytics/reports/*` query performance

**Materialized Views:**
- `project_financial_summary` — Pre-aggregated financial metrics for Reports Sandbox
- `cashflow_period_analysis` — Period-based cashflow calculation cache

**No Breaking Changes:** Backward compatible with existing dashboard endpoints (`/api/analytics/dashboard/*`, `/api/analytics/kpis/*`)

#### Excel Export Configuration

- Library: SheetJS (xlsx) for workbook generation
- Formatting: Auto-fitted columns, frozen headers, number formats (currency, %)
- Metadata Sheet: Report type, generation timestamp, applied filters, RBAC scope
- Power BI Ready: Excel files compatible with Power BI Data Connector
- Retention: 90-day auto-deletion policy (configurable)

#### Features & Enhancements

- **Dynamic Filtering:** All reports support date range, project, and role-based filtering
- **Caching:** 15-minute cache on report data; invalidation on financial transaction updates
- **Audit Trail:** Each export logged with user ID, timestamp, filters applied, export format
- **Error Handling:** Graceful fallback to in-memory calculation if cache unavailable
- **Performance:** Optimized for datasets up to 500k rows; pagination recommended for larger exports

#### Files Changed (Summary)

- **API Routes:** 7 new endpoint definitions
- **Middleware:** RBAC check middleware applied to `/api/analytics/reports/*`
- **React Components:** 6 new report viewer components + ExportButton wrapper
- **Database:** 1 SQL migration file (248-add-analytics-report-permissions.sql)
- **Utils:** Report builder utility, Excel formatter, SharePoint sync service
- **Tests:** 22 test files covering API endpoints, RBAC, export formats

#### Documentation Added

- `docs/features/05-analytics.md` — Updated with Reports Sandbox section
- `docs/integrations/sharepoint-excel.md` — New SharePoint integration guide
- API specification: Report endpoints, filter parameters, response schemas

#### Breaking Changes

None. Reports Sandbox is additive and does not modify existing analytics endpoints.

#### Migration Path

**For Users:**
1. No action required — new reports available in Analytics menu
2. RBAC permissions auto-assigned per role (see table above)
3. SharePoint sync starts automatically on deployment

**For Developers:**
1. Review `docs/integrations/sharepoint-excel.md` for Graph API integration
2. Update Power BI datasets to include new Excel sources (if used)
3. Audit custom analytics queries to leverage new materialized views

---

## [0.1.0] – 2026-01-15

### Initial Release

**Content:**
- Executive dashboard with KPI cards
- Project performance tracking
- Financial analytics (budget vs. actual)
- Custom report builder (basic)
- Export to Excel/PDF
- Role-based dashboard access

---

## Notes for Maintainers

- **Performance:** Reports Sandbox uses materialized views and 15-min caching. Monitor query times if dataset grows >1M rows.
- **Power BI Integration:** Excel exports are queryable via Power BI Graph Connector. Test refresh schedules post-deployment.
- **RBAC Enforcement:** All `/api/analytics/reports/*` endpoints enforce role checks. Verify middleware is applied before production.
- **SharePoint Sync:** Runs at 8 PM UTC. Monitor logs at `logs/reports-sync.log` for failures.
- **Backward Compatibility:** Existing `/api/analytics/dashboard/*` and `/api/analytics/kpis/*` endpoints unchanged.

---

**Format Version:** 1.0  
**Last Updated:** 2026-03-21  
**Maintained By:** Scribe (Documentation)
