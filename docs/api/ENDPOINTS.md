# FibreFlow API Endpoints Reference

**Last Updated:** 2026-03-21  
**Status:** Scaffold (endpoints cataloged; see `openapi.yaml` for full spec)  
**Owner:** Scribe

---

## Quick Navigation
- [Analytics](#analytics)
- [Assets](#assets)
- [Contractors](#contractors)
- [Dev Queue](#dev-queue)
- [NOC](#noc)
- [Procurement](#procurement)
- [Projects](#projects)
- [Reports](#reports)
- [Teams](#teams)
- [Tickets](#tickets)
- [Users](#users)
- [WhatsApp](#whatsapp)

---

## Analytics

| Method | Endpoint | Description | Source |
|--------|----------|-------------|--------|
| GET | `/analytics/reports/expense-pivot` | Expense analysis by project/category | `app/api/analytics/reports/expense-pivot/route.ts` |
| GET | `/analytics/reports/project-detail` | Detailed project financials | `app/api/analytics/reports/project-detail/route.ts` |
| GET | `/analytics/reports/project-fin` | Project financial overview | `app/api/analytics/reports/project-fin/route.ts` |
| GET | `/analytics/reports/project-revenue` | Project revenue breakdown | `app/api/analytics/reports/project-revenue/route.ts` |
| GET | `/analytics/reports/revenue-overview` | Organization revenue summary | `app/api/analytics/reports/revenue-overview/route.ts` |

---

## Assets

| Method | Endpoint | Description | Source |
|--------|----------|-------------|--------|
| GET | `/assets` | List all assets | `app/api/assets/route.ts` |
| GET | `/assets/[id]` | Get asset by ID | `app/api/assets/[id]/route.ts` |
| POST | `/assets` | Create new asset | `app/api/assets/route.ts` |
| PATCH | `/assets/[id]` | Update asset | `app/api/assets/[id]/route.ts` |
| GET | `/assets/dashboard` | Asset overview dashboard | `app/api/assets/dashboard/route.ts` |
| GET | `/assets/search` | Search assets by name/category/tags | `app/api/assets/search/route.ts` |
| GET | `/assets/categories` | List asset categories | `app/api/assets/categories/route.ts` |
| POST | `/assets/categories` | Create asset category | `app/api/assets/categories/route.ts` |
| GET | `/assets/categories/[id]` | Get category details | `app/api/assets/categories/[id]/route.ts` |
| PATCH | `/assets/categories/[id]` | Update category | `app/api/assets/categories/[id]/route.ts` |
| GET | `/assets/calibration-due` | Assets needing calibration | `app/api/assets/calibration-due/route.ts` |
| GET | `/assets/maintenance-due` | Assets with overdue maintenance | `app/api/assets/maintenance-due/route.ts` |
| GET | `/assets/maintenance` | List maintenance records | `app/api/assets/maintenance/route.ts` |
| POST | `/assets/maintenance` | Create maintenance record | `app/api/assets/maintenance/route.ts` |
| GET | `/assets/maintenance/[id]` | Get maintenance record | `app/api/assets/maintenance/[id]/route.ts` |
| GET | `/assets/maintenance/upcoming` | Upcoming maintenance schedule | `app/api/assets/maintenance/upcoming/route.ts` |
| GET | `/assets/maintenance/overdue` | Overdue maintenance items | `app/api/assets/maintenance/overdue/route.ts` |
| POST | `/assets/[id]/checkin` | Check in asset (field ops) | `app/api/assets/[id]/checkin/route.ts` |
| POST | `/assets/[id]/checkout` | Check out asset (field ops) | `app/api/assets/[id]/checkout/route.ts` |
| GET | `/assets/[id]/documents` | Get asset documents | `app/api/assets/[id]/documents/route.ts` |
| POST | `/assets/[id]/documents` | Upload asset document | `app/api/assets/[id]/documents/route.ts` |
| DELETE | `/assets/[id]/documents/[documentId]` | Delete asset document | `app/api/assets/[id]/documents/[documentId]/route.ts` |
| GET | `/assets/[id]/history` | Asset audit trail | `app/api/assets/[id]/history/route.ts` |
| GET | `/assets/[id]/verify-label` | Verify asset RFID/QR label | `app/api/assets/[id]/verify-label/route.ts` |
| POST | `/assets/export` | Export assets (CSV/Excel) | `app/api/assets/export/route.ts` |
| POST | `/assets/extract-from-image` | Extract asset data from photo (AI) | `app/api/assets/extract-from-image/route.ts` |

---

## Contractors

| Method | Endpoint | Description | Source |
|--------|----------|-------------|--------|
| GET | `/contractors` | List all contractors | `app/api/contractors/route.ts` |

---

## Dev Queue

| Method | Endpoint | Description | Source |
|--------|----------|-------------|--------|
| GET | `/dev-queue` | List all dev tasks | `app/api/dev-queue/route.ts` |
| POST | `/dev-queue` | Create dev task | `app/api/dev-queue/route.ts` |
| GET | `/dev-queue/[id]` | Get dev task by ID | `app/api/dev-queue/[id]/route.ts` |
| PATCH | `/dev-queue/[id]` | Update dev task | `app/api/dev-queue/[id]/route.ts` |
| GET | `/dev-queue/columns` | Get Kanban column structure | `app/api/dev-queue/columns/route.ts` |
| POST | `/dev-queue/move` | Move task to column | `app/api/dev-queue/move/route.ts` |
| POST | `/dev-queue/vote` | Vote on task priority | `app/api/dev-queue/vote/route.ts` |
| GET | `/dev-queue/[id]/attachments` | List task attachments | `app/api/dev-queue/[id]/attachments/route.ts` |
| POST | `/dev-queue/[id]/attachments` | Upload task attachment | `app/api/dev-queue/[id]/attachments/route.ts` |
| GET | `/dev-queue/[id]/progress` | Get task progress/timeline | `app/api/dev-queue/[id]/progress/route.ts` |

---

## NOC (Network Operations Center)

| Method | Endpoint | Description | Source |
|--------|----------|-------------|--------|
| GET | `/noc/dashboard/summary` | NOC dashboard overview | `app/api/noc/dashboard/summary/route.ts` |
| GET | `/noc/dashboard/sla` | SLA compliance view | `app/api/noc/dashboard/sla/route.ts` |
| GET | `/noc/analytics/fault-trends` | Fault analysis + trends | `app/api/noc/analytics/fault-trends/route.ts` |
| GET | `/noc/attachments` | List NOC attachments | `app/api/noc/attachments/route.ts` |
| GET | `/noc/attachments/[id]` | Get attachment details | `app/api/noc/attachments/[id]/route.ts` |
| POST | `/noc/cron/sync-qcontact` | Sync Q-Contact data (cron) | `app/api/noc/cron/sync-qcontact/route.ts` |

---

## Procurement

| Method | Endpoint | Description | Source |
|--------|----------|-------------|--------|
| GET | `/procurement` | List POs | `app/api/procurement/route.ts` |
| POST | `/procurement` | Create PO | `app/api/procurement/route.ts` |
| GET | `/procurement/[id]` | Get PO by ID | `app/api/procurement/[id]/route.ts` |
| PATCH | `/procurement/[id]` | Update PO | `app/api/procurement/[id]/route.ts` |
| POST | `/procurement/[id]/approve` | Approve PO | `app/api/procurement/[id]/approve/route.ts` |
| POST | `/procurement/[id]/reject` | Reject PO | `app/api/procurement/[id]/reject/route.ts` |
| GET | `/procurement/budgets` | Budget overview | `app/api/procurement/budgets/route.ts` |
| GET | `/procurement/vendors` | List vendors | `app/api/procurement/vendors/route.ts` |

---

## Projects

| Method | Endpoint | Description | Source |
|--------|----------|-------------|--------|
| GET | `/projects` | List projects | `app/api/projects/route.ts` |
| POST | `/projects` | Create project | `app/api/projects/route.ts` |
| GET | `/projects/[id]` | Get project by ID | `app/api/projects/[id]/route.ts` |
| PATCH | `/projects/[id]` | Update project | `app/api/projects/[id]/route.ts` |
| GET | `/projects/[id]/tasks` | List project tasks | `app/api/projects/[id]/tasks/route.ts` |
| GET | `/projects/[id]/budget` | Project budget status | `app/api/projects/[id]/budget/route.ts` |

---

## Reports

| Method | Endpoint | Description | Source |
|--------|----------|-------------|--------|
| GET | `/reports` | List available reports | `app/api/reports/route.ts` |
| POST | `/reports/[name]/generate` | Generate report | `app/api/reports/[name]/generate/route.ts` |
| GET | `/reports/[id]/download` | Download report file | `app/api/reports/[id]/download/route.ts` |

---

## Teams

| Method | Endpoint | Description | Source |
|--------|----------|-------------|--------|
| GET | `/teams` | List teams | `app/api/teams/route.ts` |
| POST | `/teams` | Create team | `app/api/teams/route.ts` |
| GET | `/teams/[id]` | Get team details | `app/api/teams/[id]/route.ts` |
| PATCH | `/teams/[id]` | Update team | `app/api/teams/[id]/route.ts` |
| GET | `/teams/[id]/members` | List team members | `app/api/teams/[id]/members/route.ts` |

---

## Tickets

| Method | Endpoint | Description | Source |
|--------|----------|-------------|--------|
| GET | `/tickets` | List tickets | `app/api/tickets/route.ts` |
| POST | `/tickets` | Create ticket | `app/api/tickets/route.ts` |
| GET | `/tickets/[id]` | Get ticket by ID | `app/api/tickets/[id]/route.ts` |
| PATCH | `/tickets/[id]` | Update ticket | `app/api/tickets/[id]/route.ts` |
| GET | `/tickets/[id]/comments` | List ticket comments | `app/api/tickets/[id]/comments/route.ts` |
| POST | `/tickets/[id]/comments` | Add comment | `app/api/tickets/[id]/comments/route.ts` |

---

## Users

| Method | Endpoint | Description | Source |
|--------|----------|-------------|--------|
| GET | `/users` | List users | `app/api/users/route.ts` |
| POST | `/users` | Create user | `app/api/users/route.ts` |
| GET | `/users/[id]` | Get user profile | `app/api/users/[id]/route.ts` |
| PATCH | `/users/[id]` | Update user | `app/api/users/[id]/route.ts` |
| GET | `/users/[id]/permissions` | User permissions/roles | `app/api/users/[id]/permissions/route.ts` |
| POST | `/users/[id]/invite` | Send invite email | `app/api/users/[id]/invite/route.ts` |

---

## WhatsApp

| Method | Endpoint | Description | Source |
|--------|----------|-------------|--------|
| POST | `/whatsapp/send` | Send WA message | `app/api/whatsapp/send/route.ts` |
| GET | `/whatsapp/status` | Check WA connection status | `app/api/whatsapp/status/route.ts` |
| POST | `/whatsapp/webhook` | Webhook receiver for WA events | `app/api/whatsapp/webhook/route.ts` |
| GET | `/whatsapp/templates` | List message templates | `app/api/whatsapp/templates/route.ts` |

---

## Authentication

**All endpoints require:**
- **Header:** `Authorization: Bearer <JWT-TOKEN>`
- **Methods:** 
  - User login → JWT token (see `/auth/login`)
  - Service-to-service → API key (see `.env` docs)

---

## Error Handling

All endpoints return standard error format:
```json
{
  "error": true,
  "message": "Human-readable error",
  "code": "ERROR_CODE",
  "statusCode": 400
}
```

Common status codes:
- `200` — Success
- `201` — Created
- `400` — Bad request (validation)
- `401` — Unauthorized
- `403` — Forbidden
- `404` — Not found
- `500` — Server error

---

## Full OpenAPI Specification

For detailed request/response schemas, see `openapi.yaml` in this directory.

---

**Generated:** 2026-03-21  
**Endpoint count:** 100+  
**Last verified against codebase:** 2026-03-21
