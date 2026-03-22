# FibreFlow API Documentation

This directory contains the complete API specification and documentation for FibreFlow.

---

## Quick Start

1. **Browse endpoints:** See `ENDPOINTS.md` for a catalog of all 100+ API endpoints
2. **OpenAPI spec:** `openapi.yaml` contains full machine-readable specification
3. **Generate UI:** Run `npx swagger-cli serve openapi.yaml` to view interactive Swagger UI
4. **Generate SDK:** Use OpenAPI Generator to create client libraries (Python, TypeScript, etc.)

---

## Files

| File | Purpose |
|------|---------|
| **ENDPOINTS.md** | Human-readable endpoint catalog, organized by domain |
| **openapi.yaml** | OpenAPI 3.0.0 specification (machine-readable) |
| **README.md** | This file |

---

## Authentication

All endpoints require JWT bearer token in the `Authorization` header:

```bash
curl -H "Authorization: Bearer <your-jwt-token>" \
  https://fibreflow.app/api/assets
```

**Get a token:**
- **User login:** POST `/auth/login` with credentials → JWT token
- **Service account:** Use API key from `.env` → `Bearer <api-key>`

---

## Common Response Format

All endpoints return JSON with a standard error format:

```json
{
  "error": false,
  "data": { /* response body */ },
  "statusCode": 200
}
```

On error:
```json
{
  "error": true,
  "message": "Human-readable error message",
  "code": "ERROR_CODE",
  "statusCode": 400
}
```

---

## API Domains

- **Assets** — Inventory management, maintenance, tracking
- **Analytics** — Reports, dashboards, metrics
- **Projects** — Project management and budgeting
- **Procurement** — Purchase orders, vendor management
- **Tickets** — Issue tracking and SLA monitoring
- **Teams** — Team management, member roles
- **Users** — User management, permissions
- **NOC** — Network operations center monitoring
- **WhatsApp** — WA message integration

See `ENDPOINTS.md` for full catalog.

---

## Generate Swagger UI

### Option 1: Local development

```bash
npx swagger-ui-express openapi.yaml --port 8080
# Visit http://localhost:8080
```

### Option 2: Swagger Editor

1. Go to https://editor.swagger.io/
2. Paste contents of `openapi.yaml`
3. Explore interactively

### Option 3: ReDoc (read-only)

```bash
npm install -g redoc-cli
redoc-cli serve openapi.yaml --port 8080
# Visit http://localhost:8080
```

---

## Generate Client SDK

### TypeScript/JavaScript

```bash
npx @openapitools/openapi-generator-cli generate \
  -i openapi.yaml \
  -g typescript-fetch \
  -o ./generated/typescript-client

# Install + use
cd generated/typescript-client
npm install
```

Then in your code:
```typescript
import { AssetsApi } from './generated/typescript-client';

const api = new AssetsApi();
api.listAssets().then(assets => console.log(assets));
```

### Python

```bash
openapi-generator-cli generate \
  -i openapi.yaml \
  -g python \
  -o ./generated/python-client

cd generated/python-client
pip install -e .
```

### Go, Java, C#, etc.

Use the same approach with generator name:
- `go` → Go client
- `java` → Java client
- `csharp` → C# client
- `rust` → Rust client
- [Full list](https://openapi-generator.tech/docs/generators)

---

## Update the OpenAPI Spec

When adding or modifying API endpoints:

1. **Update `openapi.yaml`:**
   - Add new `path` entry
   - Include request/response schemas
   - Document required parameters and auth
   - Update `info.version` if breaking changes

2. **Update `ENDPOINTS.md`:**
   - Add row to appropriate domain table
   - Include method, path, description, source file

3. **Test the spec:**
   ```bash
   npx swagger-cli validate openapi.yaml
   ```

4. **Commit both files** in the same PR as the backend changes

---

## Common Patterns

### Pagination

Parameters: `skip` (offset) and `limit` (max records)

```bash
curl "https://fibreflow.app/api/assets?skip=20&limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

Response includes items array and metadata:
```json
{
  "error": false,
  "data": [{ /* asset 1 */ }, { /* asset 2 */ }],
  "meta": {
    "total": 450,
    "skip": 20,
    "limit": 10
  }
}
```

### Filtering

Most list endpoints support domain-specific filters:

```bash
# Filter by category
curl "https://fibreflow.app/api/assets?category=tools" \
  -H "Authorization: Bearer $TOKEN"

# Filter by status
curl "https://fibreflow.app/api/projects?status=active" \
  -H "Authorization: Bearer $TOKEN"
```

### Sorting

Optional `sort` parameter (format: `fieldName:asc|desc`):

```bash
# Sort by name, ascending
curl "https://fibreflow.app/api/assets?sort=name:asc" \
  -H "Authorization: Bearer $TOKEN"

# Sort by creation date, descending
curl "https://fibreflow.app/api/projects?sort=createdAt:desc" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| `VALIDATION_ERROR` | 400 | Request validation failed |
| `UNAUTHORIZED` | 401 | Missing or invalid token |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Resource already exists |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |

---

## Rate Limiting

Standard rate limits:
- **Authenticated requests:** 1000 req/hour per user
- **Service accounts:** 5000 req/hour per account
- **Burst limit:** 100 req/minute

Response headers:
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1679123400
```

When rate limited (429):
```json
{
  "error": true,
  "code": "RATE_LIMITED",
  "message": "Rate limit exceeded. Retry after 60 seconds.",
  "retryAfter": 60
}
```

---

## Webhooks (Future)

WhatsApp and ticket system support webhooks. See:
- Incoming webhook: `POST /webhooks/register`
- Webhook events: `docs/webhooks/EVENTS.md` (WIP)

---

## Support

- **Issues:** Report bugs in #dev-api channel
- **Questions:** Check `ENDPOINTS.md` first
- **Specs:** Review `openapi.yaml` for exact request/response formats
- **Integration help:** Contact @dev-team

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-03-21 | Initial OpenAPI scaffold + endpoint catalog |

---

**Last updated:** 2026-03-21  
**Status:** Scaffold-complete (spec ready for use; examples needed)  
**Next:** Add request/response examples to openapi.yaml
