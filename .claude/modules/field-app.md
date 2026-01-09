# Module: field-app

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Mobile-first field technician portal for task management and offline synchronization |
| **Status** | Active |
| **Complexity** | Medium |
| **Category** | operations |

## Dependencies

### Internal FF Modules
None

### External Packages
- lucide-react
- react

## Database

### Tables
None - mock data only

### Key Queries
None

## API Endpoints
None

## Services
None

## Components
- `FieldAppPortal` - Main portal
- `TaskCard` - Task display
- `TaskDialog` - Task details
- `TechnicianCard` - Technician info
- `OfflineStatus` - Sync indicator
- `DeviceStatus` - Device health

## Hooks
None

## Types
- `FieldTask` - Task data (id, type, title, customer, address, coordinates, priority, status, syncStatus, offline)
- `FieldTechnician` - Technician data (id, name, status, location, currentTask, expertise, rating)
- `OfflineData` - Offline state (tasks, photos, forms, lastSync, dataSize)
- `DeviceStatus` - Device health (battery, signal, gpsAccuracy, storage)

## Patterns
- Offline-first architecture with sync indicators
- Task status tracking (pending, in_progress, completed, failed)
- Task type categorization (installation, maintenance, inspection, repair)
- Priority levels (low, medium, high, urgent)
- Technician location and status tracking
- Device status monitoring (battery, signal, GPS, storage)
- Offline data accumulation with sync pending indicator
- Tab-based navigation (tasks, technicians, overview)
- Task distribution and priority breakdown charts

## Gotchas
- **Mock Only**: Completely mock-based - no backend API integration yet
- **Simulated Sync**: Offline sync is simulated with 2-second delay
- **No Persistence**: No actual data persistence or syncing logic
- **Stub Functions**: syncOfflineData() is a stub that just sets flags
- **Empty Handlers**: handleTechnicianSelect() and handleExport() are empty handlers
- **Mock Data**: Uses mock data (mockTasks, mockTechnicians, mockOfflineData, mockDeviceStatus) for all content
- **No Navigation**: No real navigation to task details
- **Unused Coordinates**: Location (lat/lng) coordinates present but not used
- **No Attachments**: Data includes attachments count but no attachment handling
