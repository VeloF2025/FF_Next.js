# Module: OneMap (1Map GIS Integration)

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | 1Map GIS API integration for serial lookups, updates, and property data |
| **Status** | Production |
| **Complexity** | Medium |
| **Category** | operations |
| **1Map URL** | https://www.1map.co.za |
| **Layer ID** | 5121 (Home Installation - Aerial) |

## Core Service

### `src/modules/system/services/oneMapApiService.ts`
Singleton `oneMapApi` with 4-step auth flow:
1. GET `/login` → extract CSRF token
2. POST `/login` → authenticate, get `connect.sid` cookie
3. GET `/app?layer=5121` → initialize layer access (CRITICAL)
4. Make API calls with session cookie

Session timeout: 25 minutes (auto-refreshes).

### Key Methods
| Method | Purpose |
|--------|---------|
| `searchDR(drNumber)` | Search 1Map for a DR, returns all `prop_id` records |
| `updateOntSerial(propId, serial)` | Update `ph_ont` field on a property |
| `updateDualSerials(propId, ont, ups)` | Update both `ph_ont` and `br_ser` |
| `fixAllPropsForDR(drNumber, correctOnt, correctUps?)` | Fix all properties for a DR |

### 1Map Field Mapping
| 1Map Field | FF Column | Description |
|------------|-----------|-------------|
| `drp` | `drop_number` | DR number |
| `prop_id` | `property_id` | Unique per 1Map property |
| `ph_ont` | `ont_barcode` | ONT serial (ALCL/ALCB) |
| `br_ser` | `ups_serial` | UPS serial (GU18W) |
| `pole` | `pole_number` | Pole identifier |
| `status` | `status` | Installation status |
| `contact_person_name` | `contact_name` | Subscriber first name |
| `contact_number` | `contact_number` | Subscriber phone |

## Database Tables

### `onemap_properties` (LOCAL CACHE - STALE)
Local sync of 1Map data. **WARNING: This table is often stale** (last bulk sync ~Jan 2026). Do NOT rely on it for live UPS/ONT data. Always query the 1Map API directly for accurate values.

Key columns: `drop_number`, `property_id`, `ont_barcode`, `ups_serial`

## Multi-Property DRs (IMPORTANT)
Some DRs have multiple `prop_id` entries in 1Map (e.g., unit in a complex). When querying:
- **Search returns ALL** properties for a DR
- One prop may have serials while others are empty
- Use `records.find(r => r.br_ser)` to find the one with data
- When updating, `fixAllPropsForDR()` updates ALL properties

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET/POST | `/api/onemap/sync-serials` | Sync ONT + UPS serials from 1Map for a DR or project |
| POST | `/api/onemap/process-sync-queue` | Background batch sync |
| POST | `/api/drops/sync-serials` | Sync 1Map serials into `drops` table |

## Sync Flow
```
1Map API (br_ser, ph_ont)
    ↓ sync-serials.ts / process-sync-queue.ts
onemap_properties (ups_serial, ont_barcode)
    ↓ backfill-onemap-data.ts
dr_photo_unified_reviews (ups_serial_scanned, ont_serial_scanned)
    ↓ drops/sync-serials.ts
drops (mini_ups_serial, ont_serial)
```

## Auth
- Email: `hein@velocityfibre.co.za` (env: `ONEMAP_EMAIL`)
- Password: `VeloF@2025` (env: `ONEMAP_PASSWORD`)

## Gotchas
- **`onemap_properties` is stale**: Always use live API for current data
- **Session init required**: Step 3 (visit `/app?layer=5121`) is CRITICAL — API calls fail silently without it
- **Rate limiting**: 1Map can be slow (10-15s under load). Use 300-500ms delays between batch requests
- **Multi-prop DRs**: Always check ALL prop_ids, not just the first one
- **br_ser clearing**: Send empty string `""` to clear UPS on 1Map, not null
