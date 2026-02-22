# Field Stock Module

> **Last updated:** 2026-02-21  
> **PRD:** PRD-027  
> **Path:** `/procurement/field-stock`  
> **Status:** Active

## Overview

Mobile-first stock management for field teams. Tracks physical stock at field locations — from warehouse dispatch through contractor accountability to consumption on-site.

## Eight Sub-Tabs

| Tab | Path | Purpose |
|-----|------|---------|
| **Dashboard** | `/field-stock` | Overview: stock levels, pending transfers, alerts |
| **Locations** | `/field-stock?tab=locations` | Manage field storage locations |
| **Items** | `/field-stock?tab=items` | Stock item catalogue with quantities |
| **Transfers** | `/field-stock?tab=transfers` | Stock transfers between locations (was "Pickings" pre-Feb 2026) |
| **Returns** | `/field-stock?tab=returns` | Stock returns from field to warehouse |
| **Consumptions** | `/field-stock?tab=consumptions` | Record stock consumed on-site |
| **Accountability** | `/field-stock?tab=accountability` | Contractor stock accountability |
| **Adjustments** | `/field-stock?tab=adjustments` | Manual stock adjustments |

> **Note:** Tab was renamed from **Pickings → Transfers** in Feb 2026 (commit 2579f83c). API routes still use `/pickings` internally.

## Transfer Lifecycle

```
Transfer Created (pending)
        │
        ▼
Confirmed (items committed)
        │
        ▼
Processed (physically moved)
        │
        ▼
Signed (contractor signs off)
        │
   or: Cancelled (at any pre-sign stage)
```

## Serial Number State Machine

Field stock tracks individual serials (ONT, router, UPS, cable):

```
unassigned → assigned → deployed → returned → decommissioned
                │
                └──► faulty (at any active stage)
```

Serials tracked in `serials` table; state transitions via `/api/procurement/field-stock/serials/transition`.

## Contractor Accountability

Each contractor has a running balance of stock issued vs. consumed/returned.

**States:**
- **Active** — normal operation
- **Blocked** — cannot receive new stock (unresolved discrepancy)
- **Reconciled** — balance settled

**Reconciliation flow:**
1. Compare issued vs. consumed+returned
2. Flag discrepancies
3. Block contractor if unresolved
4. Reconcile once resolved: `/api/procurement/field-stock/accountability/[contractorId]/reconcile`

## API Routes (`/api/procurement/field-stock/`)

### Core
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/dashboard` | Aggregated dashboard stats |
| GET/POST | `/items` | Stock items list / create |
| GET/PUT/DELETE | `/locations/[id]` | Location CRUD |
| GET/POST | `/locations` | Locations list / create |
| GET/POST | `/serials` | Serial numbers list / create |
| GET | `/serials/[serialNumber]` | Serial lookup by number |
| POST | `/serials/transition` | State machine transition |

### Transfers (Pickings)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/pickings` | List / create transfer |
| GET/PUT | `/pickings/[id]` | Get / update transfer |
| POST | `/pickings/[id]/confirm` | Commit items |
| POST | `/pickings/[id]/process` | Mark physically moved |
| POST | `/pickings/[id]/sign` | Contractor sign-off |
| POST | `/pickings/[id]/cancel` | Cancel transfer |

### Returns
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/returns` | List / create return |
| POST | `/returns/[id]/inspect` | Inspect returned items |
| POST | `/returns/[id]/accept` | Accept return into stock |

### Consumptions
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/consumptions` | List / record consumption |
| POST | `/consumptions/[id]/verify` | Verify consumption record |

### Accountability
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/accountability` | All contractor balances |
| GET | `/accountability/[contractorId]` | Single contractor balance |
| POST | `/accountability/[contractorId]/block` | Block contractor |
| POST | `/accountability/[contractorId]/unblock` | Unblock contractor |
| POST | `/accountability/[contractorId]/reconcile` | Reconcile balance |

### Movements
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/movements/[id]/reverse` | Reverse a stock movement |

## Module Source

```
src/modules/field-stock/
├── components/     # Transfer wizard, accountability table, consumption form
├── offline/        # Offline-first capabilities (mobile portal)
├── services/
│   └── reconciliationService.ts
```

## Key Features

- **Mobile portal** — designed for field use on phones
- **Offline support** — offline/ module for connectivity-poor field conditions
- **RBAC** — all 65 procurement API routes have auth middleware
- **Serial tracking** — individual item accountability via state machine
- **Contractor blocking** — automatic block on unresolved stock discrepancies

## Related

- `/procurement` — Parent module
- `/skills/modules/procurement.md` — Procurement overview including field-stock
- `PRD-027` — Full feature spec
