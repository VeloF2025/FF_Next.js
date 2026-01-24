# ONT Serial Corrections Log

**Started:** 2026-01-24
**Method:** 1Map Attributes API (programmatic updates)
**Operator:** hein@velocityfibre.co.za

---

## API Details

```
Endpoint: POST https://www.1map.co.za/api/apps/app/attributes
Layer ID: 5121 (Home Installation - Aerial)
Field: ph_ont (ONT Barcode)
```

---

## Corrections Made

| # | Timestamp | DR Number | Property ID | Old Value | New Value | Status |
|---|-----------|-----------|-------------|-----------|-----------|--------|
| 1 | 2026-01-24 20:05 | DR1731053 | 355659 | ALCLB480E6E8 | ALCLB480E6E9 | ✅ SUCCESS |
| 2 | 2026-01-24 20:32 | DR1736834 | 362644 | ALCLB48A9E42 | ALCLB48A9E55 | ✅ SUCCESS |
| 3 | 2026-01-24 20:40 | DR1733472 | 496299 | ALCLB484D160 | ALCLB480F4B7 | ✅ SUCCESS |

---

## Already Correct (No Change Needed)

| DR Number | ONT Value | prop_id | Verified |
|-----------|-----------|---------|----------|
| DR1738319 | ALCLB48AC56E | - | 2026-01-24 20:28 |
| DR1736727 | ALCLB48A9E42 | - | 2026-01-24 20:35 |
| DR1735406 | ALCLB48AC88A | 734826 | 2026-01-24 20:42 |
| DR1735353 | ALCLB48A9B95 | 735018 | 2026-01-24 20:42 |
| DR1738321 | ALCLB48AC56A | 360189 | 2026-01-24 20:42 |
| DR1735407 | ALCLB48AC673 | 361297 | 2026-01-24 20:42 |
| DR1753008 | ALCLB463F4EB | 322822 | 2026-01-24 20:42 |

---

## Notes

- Corrections identified from OLT Reports comparison (2026-01-24)
- API requires authenticated session with proper CSRF handling:
  1. GET /login → extract `_csrf` token from form
  2. POST /login with `_csrf`, email, password → get `connect.sid` cookie
  3. GET /app?layer=5121 → initialize session for layer access
  4. POST /api/apps/app/attributes → perform update
- Each update logs `last_modified_by` and `last_modified_date` in 1Map
- Working script: `/tmp/1map_fix_dr3.mjs`

---

*Log maintained by FibreFlow PAI*
