# Tracker Module

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Project tracking at master and PON level with configurable columns |
| **Status** | Production |
| **Complexity** | Medium |
| **Category** | project-management |

## Key Features
- **Master Tracker**: All-projects overview with filterable columns
- **PON Tracker**: Drill-down to PON-level progress per project
- **Column Filtering**: Dynamic filter per column
- **Select List Admin**: Configure tracker dropdown options
- **4 Tracking Categories**: Civil, Optical, Splicing, Activation (from 2026-03-11 meeting)
- **Sticky Columns**: Frozen left columns with horizontal scroll

## Directory Structure
```
src/modules/tracker/
├── components/
│   ├── MasterTrackerPage.tsx         # Master tracker container
│   ├── MasterTrackerTable.tsx        # Master tracker data grid
│   ├── PonTrackerPage.tsx            # PON-level tracker container
│   ├── PonTrackerTable.tsx           # PON-level data grid
│   ├── ColumnFilter.tsx              # Dynamic column filter component
│   └── TrackerSelectListAdmin.tsx    # Admin for dropdown options
└── types/
    ├── master-tracker.types.ts       # Master tracker types
    └── types.ts                      # General tracker types
```

## API Routes
```
pages/api/tracker/
├── master.ts               # Master tracker data
├── pon.ts                  # PON-level tracker data
└── select-lists.ts         # Select list admin CRUD
```

## Database Tables
- `tracker_master` — Master-level tracking data
- `tracker_pon` — PON-level tracking data
- `tracker_select_lists` — Configurable dropdown options

## Notes
- Desktop-only layout (dense data grid with sticky columns)
- Uses hardcoded `slate-*` palette (should migrate to CSS vars)
- Color-only status dots lack text alternatives (a11y gap)
