# Sage Business Cloud Accounting - South Africa Integration

## Critical: SA Sage is DIFFERENT from Global Sage

South African Sage Business Cloud Accounting (formerly SageOne) uses a **completely different API** than the global Sage product.

| Aspect | Global Sage (UK, US, EU) | South Africa Sage |
|--------|--------------------------|-------------------|
| **Auth Method** | OAuth 2.0 | Basic Auth + API Key |
| **API Version** | v3.1 | v2.0.0 |
| **Base URL** | `https://api.sage.com` | `https://accounting.sageone.co.za` |
| **Developer Portal** | developer.sage.com | www.sage.com/en-za/.../developer-api/ |
| **API Key Source** | OAuth app credentials | Request from Sage SA |

## Authentication Method

South African Sage uses **Basic Authentication**:

```
Authorization: Basic base64(username:password)
```

Plus **API Key as query parameter**:
```
?apikey=YOUR_API_KEY
```

### Example Request
```bash
curl "https://accounting.sageone.co.za/api/2.0.0/Company/Get?apikey=YOUR_API_KEY" \
  -H "Authorization: Basic $(echo -n 'email:password' | base64)" \
  -H "Content-Type: application/json"
```

## How to Get SA Sage API Key

**IMPORTANT:** The API Key is NOT found in Sage Accounting settings!

1. Go to: https://www.sage.com/en-za/sage-business-cloud/accounting/developer-api/
2. Scroll to **"Get your API key"** section
3. Fill out the enrollment form and license agreement
4. Sage will email you the API Key

**Troubleshooting:**
- Page may load slowly (10+ seconds)
- If Chrome/Edge fail, try Safari
- The form requires company details and intended use case

## Credentials Required

| Field | Description | Source |
|-------|-------------|--------|
| **API Key** | Unique key from Sage SA | Request from Sage portal |
| **Username** | Sage login email | Your Sage account |
| **Password** | Sage login password | Your Sage account |

## API Documentation

- **Full API Spec:** https://accounting.sageone.co.za/api/2.0.0/Help
- **Legacy v1.1.1:** https://accounting.sageone.co.za/api/1.1.1

## Common API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/Company/Get` | GET | Get company details (use for connection test) |
| `/Supplier/Get` | GET | List all suppliers |
| `/SupplierInvoice/Get` | GET | List supplier invoices |
| `/SupplierPayment/Get` | GET | List supplier payments |
| `/Account/Get` | GET | Chart of accounts |

## Error Codes

| Error | Meaning | Solution |
|-------|---------|----------|
| `403 Forbidden` | Invalid API key or not authorized | Request proper API key from Sage SA portal |
| `401 Unauthorized` | Invalid username/password | Check Sage login credentials |
| `404 Not Found` | Wrong endpoint or API version | Use v2.0.0 endpoints |

## FibreFlow Implementation

### Database Table
```sql
sage_api_config (
  api_key TEXT,           -- From Sage SA portal
  username TEXT,          -- Sage login email
  password TEXT,          -- Sage login password
  base_url TEXT,          -- https://accounting.sageone.co.za
  api_version VARCHAR(10) -- 2.0.0
)
```

### Service Location
- Client: `src/services/sage/sageClient.ts`
- API: `pages/api/sage/config.ts`, `pages/api/sage/config/test.ts`
- UI: `src/components/settings/SageIntegrationTab.tsx`

## DO NOT Use

❌ OAuth 2.0 flow (global Sage only)
❌ developer.sage.com credentials
❌ Client ID / Client Secret from global portal
❌ `https://api.sage.com` base URL

## References

- [Sage SA Developer API Portal](https://www.sage.com/en-za/sage-business-cloud/accounting/developer-api/)
- [API Key Help - Community Hub](https://communityhub.sage.com/za/sage-accounting/f/general-discussion/173284/sage-api-key-south-africa)
- [SA API Spec v2.0.0](https://accounting.sageone.co.za/api/2.0.0/Help)
- [Regional API Guide](https://developer.sage.com/accounting/guides/regional-considerations/)
