# Tracker Module

## Overview
The Tracker module provides PON (Passive Optical Network) progress tracking and master tracker views for fiber deployment operations.

## Key Features
- **Master Tracker:** Comprehensive view of all PON deployment progress
- **PON Tracker:** Detailed PON-level tracking with progress stages
- **Column Filtering:** Dynamic filter UI for tracker data

## Data Model
Primary entity: `PonRow`

**Key fields:**
- Zone and PON identifiers (`zone_no`, `hld_pon`, `z_pon`)
- Scope metrics (`scope_poles`, `scope_drops`)
- Construction milestones (`poles_planted`, `cwc_poles_date`, `cwc_stringing_date`)
- Optical activation tracking (`optical_splicing_date`, `optical_submitted_date`, `optical_activated_date`)
- QA checkpoints (`cwc_qa`, `atp_qa`)
- Service metrics (`sign_ups`, `homes_po`, `homes_recon`, `activated`, `available`)
- Blockage tracking

## Components
- `MasterTrackerPage.tsx` — Main master tracker UI
- `MasterTrackerTable.tsx` — Table view with full dataset
- `PonTrackerPage.tsx` — Individual PON tracking view
- `ColumnFilter.tsx` — Dynamic column filtering

## Use Cases
1. Track construction progress across all PONs
2. Monitor QA checkpoints (CWC, ATP)
3. Report on service activation metrics
4. Identify blockages and delays
5. Filter tracker data by zone, date, or status

## Access Control
- Requires field ops or project management role
- Data scoped to user's authorized zones

## Related Modules
- Field Ops (for construction tracking)
- Activate (for service activation data)
- Projects (for zone/PON metadata)

---

**Last updated:** 2026-03-30  
**Status:** Production (active PON tracking)
