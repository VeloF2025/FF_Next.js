# PRD-022: Full Ticket Creation Form with DR Lookup

## Overview
Complete ticket creation form with all fields from `CreateTicketPayload` and integration with DR (Drop Reference) lookup to auto-populate location fields.

## Problem Statement
1. Current ticket creation is minimal, missing many important fields
2. No way to link tickets to specific DR numbers (drops)
3. Manual entry of location data is error-prone
4. Equipment details (ONT, RX levels) not captured

## Goals
1. Create comprehensive ticket form with all payload fields
2. Integrate DR lookup from SOW drops table
3. Auto-populate location fields when DR found
4. Organize form into logical sections

## Requirements

### 1. Form Sections

#### Source & Classification
- **Source**: WhatsApp, Phone, Email, Walk-in, System
- **Type**: Installation, Maintenance, Complaint, Query
- **Priority**: Low, Medium, High, Critical

#### Ticket Details
- **Title**: Short description (required)
- **Description**: Full details (required)
- **External ID**: Reference from external system

#### Location (DR Lookup)
- **DR Number**: Text input with lookup button
- **Project**: Auto-populated from DR
- **Zone**: Auto-populated from DR
- **Pole**: Auto-populated from DR
- **PON**: Auto-populated from DR
- **Address**: Auto-populated from DR
- **GPS Coordinates**: Auto-populated from DR (lat, lng)

#### Equipment
- **ONT Serial Number**: Equipment identifier
- **RX Level**: Signal strength (dBm)
- **ONT Model**: Device model

#### Client Information
- **Client Name**: Customer name
- **Client Contact**: Phone number
- **Client Email**: Email address

#### Assignment
- **Assigned User**: Dropdown of staff
- **Assigned Contractor**: Dropdown of contractors
- **Assigned Team**: Team assignment

#### Fault Attribution (for Maintenance)
- **Fault Type**: Installation fault, Client fault, Equipment fault, External
- **Root Cause**: Description
- **Contractor Responsible**: If installation fault

### 2. DR Lookup Service

Query `sow_drops` table by DR number:
```sql
SELECT
  dr_number,
  project_id,
  zone,
  pole_number,
  pon,
  address,
  gps_lat,
  gps_lng,
  status
FROM sow_drops
WHERE dr_number = $1
```

### 3. Auto-Population Flow
1. User enters DR number (e.g., "DR1234567")
2. Clicks "Lookup" button or tabs out
3. System queries sow_drops table
4. If found:
   - Green success indicator
   - Auto-fill: project, zone, pole, PON, address, GPS
   - Fields become read-only (can clear to edit manually)
5. If not found:
   - Yellow warning: "DR not found - enter manually"
   - Fields remain editable

### 4. Form Validation
```typescript
const ticketSchema = z.object({
  // Required
  title: z.string().min(5, 'Title must be at least 5 characters'),
  description: z.string().min(10, 'Description required'),
  type: z.enum(['installation', 'maintenance', 'complaint', 'query']),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  source: z.enum(['whatsapp', 'phone', 'email', 'walkin', 'system']),

  // Optional
  drNumber: z.string().optional(),
  projectId: z.string().uuid().optional(),
  zone: z.string().optional(),
  poleNumber: z.string().optional(),
  pon: z.string().optional(),
  address: z.string().optional(),
  gpsLat: z.number().optional(),
  gpsLng: z.number().optional(),

  // Client
  clientName: z.string().optional(),
  clientContact: z.string().optional(),
  clientEmail: z.string().email().optional(),

  // Equipment
  ontSerial: z.string().optional(),
  rxLevel: z.number().optional(),
  ontModel: z.string().optional(),

  // Assignment
  assignedUserId: z.string().uuid().optional(),
  assignedContractorId: z.string().uuid().optional(),
  assignedTeam: z.string().optional(),

  // Fault (maintenance only)
  faultType: z.string().optional(),
  rootCause: z.string().optional(),
  contractorResponsible: z.string().uuid().optional(),
});
```

## Files to Create

### Form Components
- [ ] `src/modules/ticketing/components/TicketForm/TicketForm.tsx` - Main form component
- [ ] `src/modules/ticketing/components/TicketForm/index.ts` - Exports
- [ ] `src/modules/ticketing/components/TicketForm/sections/SourceSection.tsx`
- [ ] `src/modules/ticketing/components/TicketForm/sections/DetailsSection.tsx`
- [ ] `src/modules/ticketing/components/TicketForm/sections/LocationSection.tsx`
- [ ] `src/modules/ticketing/components/TicketForm/sections/EquipmentSection.tsx`
- [ ] `src/modules/ticketing/components/TicketForm/sections/ClientSection.tsx`
- [ ] `src/modules/ticketing/components/TicketForm/sections/AssignmentSection.tsx`
- [ ] `src/modules/ticketing/components/TicketForm/sections/FaultSection.tsx`
- [ ] `src/modules/ticketing/components/TicketForm/sections/index.ts`

### Hooks
- [ ] `src/modules/ticketing/hooks/useTicketForm.ts` - Form state and validation
- [ ] `src/modules/ticketing/hooks/useDRLookup.ts` - DR lookup with debounce
- [ ] `src/modules/ticketing/hooks/index.ts` - Hook exports

### Services
- [ ] `src/modules/ticketing/services/drLookupService.ts` - DR query service

### Page Updates
- [ ] `app/(main)/ticketing/tickets/new/client.tsx` - Use new form

## Hook: useDRLookup

```typescript
interface UseDRLookupResult {
  lookup: (drNumber: string) => Promise<void>;
  data: DRLookupResult | null;
  isLoading: boolean;
  error: string | null;
  clear: () => void;
}

interface DRLookupResult {
  drNumber: string;
  projectId: string;
  projectName: string;
  zone: string;
  poleNumber: string;
  pon: string;
  address: string;
  gpsLat: number;
  gpsLng: number;
  status: string;
}
```

## UI Design

### Location Section Layout
```
┌─────────────────────────────────────────────────────────┐
│ Location                                                │
├─────────────────────────────────────────────────────────┤
│ DR Number: [DR1234567    ] [🔍 Lookup]                  │
│            ✅ Found - Location auto-populated           │
│                                                         │
│ Project: [Lawley          ▼]  Zone: [Zone A      ]     │
│ Pole:    [POL-001         ]   PON:  [PON-123     ]     │
│                                                         │
│ Address: [123 Main Street, Lawley                   ]   │
│ GPS:     [-26.1234        ] [28.5678              ]     │
└─────────────────────────────────────────────────────────┘
```

### Fault Section (Conditional)
Only shown when Type = "Maintenance":
```
┌─────────────────────────────────────────────────────────┐
│ Fault Attribution                                       │
├─────────────────────────────────────────────────────────┤
│ Fault Type: [Installation Fault ▼]                      │
│                                                         │
│ Root Cause:                                             │
│ [Poor splicing during initial installation          ]   │
│                                                         │
│ Contractor Responsible: [ABC Contractors ▼]             │
└─────────────────────────────────────────────────────────┘
```

## Acceptance Criteria
1. Form displays all sections with proper styling
2. DR lookup queries sow_drops and returns results
3. Location fields auto-populate when DR found
4. "Not found" message shown with manual entry option
5. Form validates required fields before submission
6. Fault section only shows for maintenance tickets
7. Form submits successfully and creates ticket
8. Dark mode styling works correctly
9. Loading states shown during lookup

## Dependencies
- Ticketing module exists
- sow_drops table has data
- Staff/contractor lists for assignment dropdowns

## Original PR
- PR #22: https://github.com/VelocityFibre/FF_Next.js/pull/22
- 17 files changed, +1,738 additions, -54 deletions
