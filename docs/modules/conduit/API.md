# Conduit API Specification

**Module:** Conduit  
**Base Path:** `/api/conduit`  
**Version:** 1.0.0  
**Authentication:** Required (all endpoints)  
**Authorization:** RBAC-based (module permission: `conduit`)

---

## Authentication & Authorization

### Authentication
All endpoints require a valid authenticated session. The `auth.userId` must be present in the request context (via cookies/headers).

**Unauthorized Request:**
```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{
  "error": "Unauthorized"
}
```

### Authorization (RBAC)
Access is controlled by the `conduit` module permission with the following actions:
- `view` — Read projects
- `create` — Create new projects
- `edit` — Update existing projects
- `delete` — Delete projects (not enforced in v1.0.0)

**Forbidden Request:**
```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{
  "error": "Insufficient permissions"
}
```

---

## Endpoints

### 1. List All Projects

**GET** `/api/conduit/projects`

Fetch all project scenarios (portfolio view).

#### Request

```http
GET /api/conduit/projects HTTP/1.1
Host: app.fibreflow.co.za
Cookie: auth_session=...
```

**Query Parameters:** None

#### Response (Success)

**Status:** `200 OK`

```json
{
  "data": [
    {
      "id": "a1b2c3d4-0000-4000-8000-000000000001",
      "name": "Lawley",
      "po_count": 15111,
      "start_date": "2025-01-01",
      "build_duration_months": 16,
      "inputs_json": {
        "rate": 2700,
        "uptake": 0.60,
        "scope": {
          "poles": 4471,
          "stringing_m": 110000,
          "pon": 159
        },
        "service_rates": {
          "permissions_per_pole": 10,
          "poles_each": 600,
          "stringing_per_m": 10,
          "optical_per_pon": 9000,
          "activation_each": 155
        },
        "stock_rates": {
          "pole": 993.19,
          "cable_per_m": 11.73,
          "optical": 4422.61,
          "activation": 191.68
        },
        "expenses_per_month": {
          "ad_hoc": 168021,
          "casuals": 488480,
          "fuel": 350993,
          "overheads": 2996992,
          "sales": 0
        }
      },
      "is_baseline_locked": false,
      "created_at": "2026-03-21T10:00:00.000Z",
      "updated_at": "2026-03-21T10:00:00.000Z"
    }
  ]
}
```

#### Response (Error)

**Status:** `500 Internal Server Error`

```json
{
  "error": "Failed to fetch projects"
}
```

**Console Output:** Error details logged to server console for debugging.

---

### 2. Create New Project

**POST** `/api/conduit/projects`

Create a new project scenario.

#### Request

```http
POST /api/conduit/projects HTTP/1.1
Host: app.fibreflow.co.za
Cookie: auth_session=...
Content-Type: application/json

{
  "name": "Durbanville Phase 2",
  "po_count": 8500,
  "start_date": "2026-06-01",
  "build_duration_months": 12,
  "inputs_json": {
    "rate": 2500,
    "uptake": 0.55,
    "scope": {
      "poles": 3200,
      "stringing_m": 85000,
      "pon": 120
    },
    "service_rates": {
      "permissions_per_pole": 10,
      "poles_each": 600,
      "stringing_per_m": 10,
      "optical_per_pon": 9000,
      "activation_each": 155
    },
    "stock_rates": {
      "pole": 993.19,
      "cable_per_m": 11.73,
      "optical": 4422.61,
      "activation": 191.68
    },
    "expenses_per_month": {
      "ad_hoc": 150000,
      "casuals": 400000,
      "fuel": 300000,
      "overheads": 2500000,
      "sales": 0
    }
  }
}
```

**Required Fields:**
- `name` (string) — Project name

**Optional Fields:**
- `po_count` (integer, default: 0) — Number of properties/homes passed
- `start_date` (string, YYYY-MM-DD format, nullable) — Build start date
- `build_duration_months` (integer, default: 12) — Build timeline
- `inputs_json` (object) — Financial inputs (see schema below)
- `is_baseline_locked` (boolean, default: false) — Lock project to prevent edits

#### Response (Success)

**Status:** `201 Created`

```json
{
  "data": {
    "id": "b2c3d4e5-0000-4000-8000-000000000002",
    "name": "Durbanville Phase 2",
    "po_count": 8500,
    "start_date": "2026-06-01",
    "build_duration_months": 12,
    "inputs_json": { ... },
    "is_baseline_locked": false,
    "created_at": "2026-03-22T01:30:00.000Z",
    "updated_at": "2026-03-22T01:30:00.000Z"
  }
}
```

#### Response (Validation Error)

**Status:** `400 Bad Request`

```json
{
  "error": "name is required"
}
```

#### Response (Server Error)

**Status:** `500 Internal Server Error`

```json
{
  "error": "Failed to create project"
}
```

---

### 3. Get Single Project

**GET** `/api/conduit/projects/[id]`

Fetch a single project by ID.

#### Request

```http
GET /api/conduit/projects/a1b2c3d4-0000-4000-8000-000000000001 HTTP/1.1
Host: app.fibreflow.co.za
Cookie: auth_session=...
```

#### Response (Success)

**Status:** `200 OK`

```json
{
  "data": {
    "id": "a1b2c3d4-0000-4000-8000-000000000001",
    "name": "Lawley",
    "po_count": 15111,
    "start_date": "2025-01-01",
    "build_duration_months": 16,
    "inputs_json": { ... },
    "is_baseline_locked": false,
    "created_at": "2026-03-21T10:00:00.000Z",
    "updated_at": "2026-03-21T10:00:00.000Z"
  }
}
```

#### Response (Not Found)

**Status:** `404 Not Found`

```json
{
  "error": "Project not found"
}
```

---

### 4. Update Project

**PATCH** `/api/conduit/projects/[id]`

Update an existing project's inputs.

#### Request

```http
PATCH /api/conduit/projects/a1b2c3d4-0000-4000-8000-000000000001 HTTP/1.1
Host: app.fibreflow.co.za
Cookie: auth_session=...
Content-Type: application/json

{
  "inputs_json": {
    "rate": 2800,
    "uptake": 0.65,
    "scope": {
      "poles": 4471,
      "stringing_m": 110000,
      "pon": 159
    },
    "service_rates": { ... },
    "stock_rates": { ... },
    "expenses_per_month": { ... }
  }
}
```

**Updatable Fields:**
- `name` (string)
- `po_count` (integer)
- `start_date` (string, YYYY-MM-DD)
- `build_duration_months` (integer)
- `inputs_json` (object) — Full replacement (not merged)
- `is_baseline_locked` (boolean)

**Validation:**
- If `is_baseline_locked = true`, PATCH should return `403 Forbidden` (enforcement varies by implementation)

#### Response (Success)

**Status:** `200 OK`

```json
{
  "data": {
    "id": "a1b2c3d4-0000-4000-8000-000000000001",
    "name": "Lawley",
    "po_count": 15111,
    "start_date": "2025-01-01",
    "build_duration_months": 16,
    "inputs_json": {
      "rate": 2800,
      "uptake": 0.65,
      ...
    },
    "is_baseline_locked": false,
    "created_at": "2026-03-21T10:00:00.000Z",
    "updated_at": "2026-03-22T02:00:00.000Z"
  }
}
```

#### Response (Forbidden - Locked Baseline)

**Status:** `403 Forbidden`

```json
{
  "error": "Cannot modify locked baseline project"
}
```

#### Response (Not Found)

**Status:** `404 Not Found`

```json
{
  "error": "Project not found"
}
```

---

### 5. Delete Project

**DELETE** `/api/conduit/projects/[id]`

Delete a project scenario (soft-delete).

**⚠️ Note:** Not implemented in v1.0.0. Endpoint may return `501 Not Implemented` or `403 Forbidden`.

#### Request

```http
DELETE /api/conduit/projects/a1b2c3d4-0000-4000-8000-000000000001 HTTP/1.1
Host: app.fibreflow.co.za
Cookie: auth_session=...
```

#### Response (Success - Future Implementation)

**Status:** `204 No Content`

(No response body)

#### Response (Not Implemented)

**Status:** `501 Not Implemented`

```json
{
  "error": "Delete operation not yet implemented"
}
```

---

## Data Schemas

### ConduitProject (Full Object)

```typescript
interface ConduitProject {
  id: string;                       // UUID
  name: string;                     // Project name
  po_count: number;                 // Properties/homes passed
  start_date: string | null;        // YYYY-MM-DD or null
  build_duration_months: number;    // Build timeline (months)
  inputs_json: ConduitProjectInputs; // Financial inputs
  is_baseline_locked: boolean;      // Prevents edits
  created_at: string;               // ISO 8601 timestamp
  updated_at: string;               // ISO 8601 timestamp
}
```

### ConduitProjectInputs

```typescript
interface ConduitProjectInputs {
  rate: number;                     // Subscription fee (ZAR/month)
  uptake: number;                   // Forecast uptake % (0.0 - 1.0)
  scope: ScopeInputs;
  service_rates: ServiceRates;
  stock_rates: StockRates;
  expenses_per_month: ExpensesPerMonth;
}
```

### ScopeInputs

```typescript
interface ScopeInputs {
  poles: number;                    // Number of poles to install
  stringing_m: number;              // Metres of cable stringing
  pon: number;                      // Points of Network
}
```

### ServiceRates (Labour Costs)

```typescript
interface ServiceRates {
  permissions_per_pole: number;     // ZAR per pole (permissions/wayleaves)
  poles_each: number;               // ZAR per pole installation
  stringing_per_m: number;          // ZAR per metre of cable stringing
  optical_per_pon: number;          // ZAR per PON installation
  activation_each: number;          // ZAR per customer activation
}
```

### StockRates (Hardware Costs)

```typescript
interface StockRates {
  pole: number;                     // ZAR per pole (material cost)
  cable_per_m: number;              // ZAR per metre of cable
  optical: number;                  // ZAR per optical equipment unit
  activation: number;               // ZAR per activation hardware kit
}
```

### ExpensesPerMonth

```typescript
interface ExpensesPerMonth {
  ad_hoc: number;                   // ZAR ad-hoc expenses per month
  casuals: number;                  // ZAR casual labour per month
  fuel: number;                     // ZAR fuel costs per month
  overheads: number;                // ZAR overheads per month
  sales: number;                    // ZAR sales expenses per month
}
```

### ConduitCalcResult (Calculated Outputs)

**⚠️ Not returned by API — calculated client-side via `useConduitCalc` hook.**

```typescript
interface ConduitCalcResult {
  fc_activation: number;            // Forecast activations (PON × uptake)
  revenue: number;                  // Total revenue (ZAR)
  cos_services: number;             // Cost of Services (ZAR)
  cos_stock: number;                // Cost of Stock (ZAR)
  cos_expenses: number;             // Cost of Expenses (ZAR)
  cos_total: number;                // Total Costs (ZAR)
  profit: number;                   // Profit (ZAR)
  gross_profit_pct: number;         // Gross Profit % (0-100)
  cost_per_home: number;            // Cost per home passed (ZAR)
}
```

**Calculation Logic:** See `/src/modules/conduit/hooks/useConduitCalc.ts` for full implementation.

---

## Error Handling

### Standard Error Response

```json
{
  "error": "Human-readable error message"
}
```

### HTTP Status Codes

| Code | Meaning | Common Cause |
|---|---|---|
| `200` | OK | Successful GET/PATCH request |
| `201` | Created | Successful POST request |
| `204` | No Content | Successful DELETE request (future) |
| `400` | Bad Request | Missing required fields, invalid JSON |
| `401` | Unauthorized | Missing or invalid auth session |
| `403` | Forbidden | Insufficient RBAC permissions or locked baseline |
| `404` | Not Found | Project ID does not exist |
| `500` | Internal Server Error | Database error or unhandled exception |
| `501` | Not Implemented | DELETE endpoint not yet implemented |

### Logging

All errors are logged to the server console with `[conduit/endpoint]` prefix for debugging.

**Example Console Log:**
```
[conduit/projects GET] Error fetching projects: <error details>
```

---

## Rate Limiting

**Current Implementation:** None  
**Future Consideration:** Apply standard FibreFlow API rate limits (TBD)

---

## Versioning

**Current Version:** 1.0.0 (no versioning in URL path)

Future versions may introduce `/api/v2/conduit/...` if breaking changes are required.

---

## Testing

### Sample cURL Requests

**List Projects:**
```bash
curl -X GET https://app.fibreflow.co.za/api/conduit/projects \
  -H "Cookie: auth_session=YOUR_SESSION_COOKIE"
```

**Create Project:**
```bash
curl -X POST https://app.fibreflow.co.za/api/conduit/projects \
  -H "Cookie: auth_session=YOUR_SESSION_COOKIE" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Project",
    "po_count": 5000,
    "start_date": "2026-07-01",
    "build_duration_months": 12,
    "inputs_json": {
      "rate": 2500,
      "uptake": 0.5,
      "scope": { "poles": 2000, "stringing_m": 50000, "pon": 80 },
      "service_rates": { ... },
      "stock_rates": { ... },
      "expenses_per_month": { ... }
    }
  }'
```

**Get Single Project:**
```bash
curl -X GET https://app.fibreflow.co.za/api/conduit/projects/PROJECT_ID \
  -H "Cookie: auth_session=YOUR_SESSION_COOKIE"
```

**Update Project:**
```bash
curl -X PATCH https://app.fibreflow.co.za/api/conduit/projects/PROJECT_ID \
  -H "Cookie: auth_session=YOUR_SESSION_COOKIE" \
  -H "Content-Type: application/json" \
  -d '{ "inputs_json": { "rate": 2800, ... } }'
```

---

## Security Considerations

1. **SQL Injection:** All queries use parameterized SQL via Neon SDK (safe)
2. **XSS:** JSON responses auto-escaped by Next.js (safe)
3. **CSRF:** No state-changing GET requests; POST/PATCH require valid session
4. **RBAC Bypass:** All endpoints check `auth.userId` and `conduit` permission before processing
5. **Data Validation:** Input validation is minimal in v1.0.0 — future enhancement

---

## Future Enhancements

- **Pagination:** Add `?limit=` and `?offset=` query params for large datasets
- **Filtering:** Add `?name=`, `?start_date_after=`, etc. for portfolio filtering
- **Sorting:** Add `?sort_by=profit&order=desc` for custom sorting
- **Batch Operations:** Bulk create/update/delete via single API call
- **Webhooks:** Notify external systems when projects are created/updated
- **GraphQL Support:** Alternative to REST for flexible querying

---

**Document Version:** 1.0  
**Last Updated:** 2026-03-22  
**Maintained By:** Scribe (Documentation)
