# 1Map Attributes Update API Documentation

## Overview
Documentation for programmatically updating ONT serial numbers and other attributes in 1Map.

**Captured:** 2026-01-24
**Source:** Network capture from 1Map web application

---

## API Endpoint

```
POST https://www.1map.co.za/api/apps/app/attributes
```

## Authentication

The API requires session authentication via cookies. Key cookies:
- `connect.sid` - Session ID
- `csrfToken` - CSRF token

## Request Format

**Content-Type:** `multipart/form-data`

### Required Parameters

| Parameter | Type | Value | Description |
|-----------|------|-------|-------------|
| `action` | string | `update` | Action type |
| `layerid` | string | `5121` | Fibertime Installations layer ID |
| `sort` | string | `prop_id` | Sort field |
| `templateExpression` | string | (empty) | Template expression |
| `start` | number | `0` | Pagination start |
| `limit` | number | `50` | Pagination limit |
| `bottom` | number | `0` | Bounding box bottom |
| `left` | number | `0` | Bounding box left |
| `right` | number | `0` | Bounding box right |
| `top` | number | `0` | Bounding box top |
| `selfilter` | string | `null` | Selection filter |
| `ungeocoded` | boolean | `false` | Include ungeocoded |
| `items` | JSON | See below | Data to update |

### Items JSON Format

```json
{
  "prop_id": "355659",      // Required: Property ID (unique identifier)
  "ph_ont": "ALCLB480E6E8"  // Optional: ONT Barcode value
}
```

### Multiple Fields Update

```json
{
  "prop_id": "355659",
  "ph_ont": "ALCLB480E6E8",
  "br_ser": "GU18W12V25176399"
}
```

---

## Field Mapping

| FibreFlow Field | 1Map Column | Description |
|-----------------|-------------|-------------|
| ONT Serial | `ph_ont` | ONT barcode/serial number |
| UPS Serial | `br_ser` | Mini-UPS battery serial |
| DR Number | `drp` | Drop number (read-only) |
| Property ID | `prop_id` | Unique record identifier |
| Status | `status` | Installation status |
| Nokia | `nokia` | Nokia port number |
| ONT RX | `ont_rx` | ONT receive power level |
| Pole | `pole` | Pole reference |
| Address | `address` | Full address |

---

## Response Format

**Success Response:**
```json
{
  "success": true,
  "start_item_index": 1,
  "total_pages": 1,
  "end_item_index": 1,
  "page_length": 50,
  "current_page": 1,
  "items": [
    {
      "prop_id": "355659",
      "drp": "DR1731053",
      "ph_ont": "ALCLB480E6E8",
      "br_ser": "GU18W12V25176399",
      // ... all other fields
    }
  ]
}
```

---

## Example: cURL Request

```bash
curl -X POST 'https://www.1map.co.za/api/apps/app/attributes' \
  -H 'Cookie: connect.sid=YOUR_SESSION_ID; csrfToken=YOUR_CSRF_TOKEN' \
  -H 'X-Requested-With: XMLHttpRequest' \
  -H 'Origin: https://www.1map.co.za' \
  -H 'Referer: https://www.1map.co.za/' \
  -F 'action=update' \
  -F 'layerid=5121' \
  -F 'sort=prop_id' \
  -F 'templateExpression=' \
  -F 'start=0' \
  -F 'limit=50' \
  -F 'bottom=0' \
  -F 'left=0' \
  -F 'right=0' \
  -F 'top=0' \
  -F 'selfilter=null' \
  -F 'ungeocoded=false' \
  -F 'items={"prop_id":"355659","ph_ont":"ALCLB480E6E8"}'
```

---

## Lookup API (Find Property ID by DR Number)

To get the `prop_id` for a DR number, use the get attributes API:

```
POST https://www.1map.co.za/api/apps/app/getattributes
```

With CQL filter:
```
CQL_FILTER=drp='DR1731053'
```

Or use the data API:
```
GET https://www.1map.co.za/api/v1/data/5121?CQL_FILTER=drp='DR1731053'&token=YOUR_TOKEN
```

---

## Rate Limiting

- No documented rate limits
- Recommend 1 request per second for bulk updates
- Use batch updates where possible

---

## Notes

1. **Session Required**: Must be logged into 1Map with valid session
2. **CSRF Protection**: Include csrfToken cookie
3. **Layer ID 5121**: Fibertime Installations layer
4. **Property ID**: Required for updates - use lookup API first if needed
5. **Audit Trail**: Updates are logged with `last_modified_by` and `last_modified_date`

---

## Use Case: Fixing ONT Serial Mismatches

For the 136 mismatched DRs identified in OLT reports:

1. Get property IDs using data API with DR numbers
2. Prepare update payloads with correct ONT serials
3. Execute POST to attributes API
4. Verify updates in response

Script: `scripts/fix-ont-mismatches.js`
