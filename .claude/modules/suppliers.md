# Module: suppliers

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Supplier management and procurement portal with company profiles, performance tracking, document compliance, RFQ management, and communication tools |
| **Status** | Active |
| **Complexity** | High |
| **Category** | procurement |

## Dependencies

### Internal FF Modules
None

### External Packages
- @tanstack/react-query
- lucide-react
- react-hot-toast
- react (Context API)
- next/router

## Database

### Tables
- `suppliers` - Main supplier table
- `supplier_documents` - Compliance documents
- `supplier_ratings` - Performance ratings
- `supplier_compliance` - Compliance tracking

### Key Queries
- Fetch suppliers with filters (status, category, preferred)
- Search suppliers by name/registration/email
- Get supplier statistics and performance
- Count documents by status

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/suppliers` | List suppliers |
| POST | `/api/suppliers` | Create supplier |
| GET | `/api/suppliers/[supplierId]` | Single supplier |
| PUT | `/api/suppliers/[supplierId]` | Update supplier |
| DELETE | `/api/suppliers/[supplierId]` | Delete supplier |
| GET | `/api/suppliers/[supplierId]/ratings` | Performance ratings |
| PUT | `/api/suppliers/[supplierId]/ratings` | Update ratings |
| GET | `/api/suppliers/[supplierId]/compliance` | Compliance status |
| PUT | `/api/suppliers/[supplierId]/compliance` | Update compliance |
| GET | `/api/suppliers/statistics` | Aggregated statistics |

## Services

### supplierService
```typescript
getAll(filter)
getById(id)
create(data)
update(id, data)
delete(id)
getPreferredSuppliers()
searchByName(term)
getByCategory(category)
getStatistics()
updateStatus(id, status, reason)
setPreferred(id, isPreferred)
updateRating(id, rating)
calculatePerformance(supplierId, period)
updateCompliance(id, compliance)
addDocument(id, document)
subscribeToSupplier(id, callback)
```

### NeonSupplierService
```typescript
getAll(filter)
create(data, userId)
```

## Components

### Main Pages
- `SuppliersPage` - Main list view
- `SuppliersPortalPage` - Supplier portal

### Common Components
- `SupplierCard` - Single supplier display
- `SupplierForm` - Create/edit form
- `SupplierFilter` - Filter UI
- `SuppliersTabsNav` - Tab navigation

### Tab Components
- `DashboardTab` - Overview
- `CompanyProfileTab` - Company details
- `PerformanceTab` - Performance metrics
- `DocumentsTab` - Compliance documents
- `MessagesTab` - Communication
- `RFQInvitesTab` - RFQ management

## Hooks
```typescript
useSuppliers(filter)
useSupplier(id)
usePreferredSuppliers()
useSearchSuppliers(term)
useSuppliersByCategory(category)
useSupplierStatistics()
useCreateSupplier()
useUpdateSupplier()
useDeleteSupplier()
useUpdateSupplierStatus()
useSetPreferredSupplier()
useUpdateSupplierRating()
useCalculateSupplierPerformance()
useUpdateSupplierCompliance()
useAddSupplierDocument()
useSupplierSubscription(id, callback)
useSupplierFilters()
useDocumentFilters()
useMessageFilters()
```

## Patterns
- Comprehensive React Query hook suite
- Portal context for state management
- Tab-based navigation with own data/state
- Toast notifications for all mutations
- Mock data for development
- Nested components with local state per tab
- Status and rating configurations as data
- Real-time subscription pattern

## Gotchas
- **Mock Data**: Mock data in tabs may mask missing API integration
- **Multiple Sub-hooks**: useDocumentFilters, useMessageFilters, etc. per tab
- **Rating Type**: Supplier.rating can be number OR object with 'overall' property
- **No Union Types**: Need to handle both rating formats
- **Complex Context**: Portal context has complex state structure
- **Expiry Tracking**: Document expiry tracking needed for compliance alerts
- **Period Parameter**: Performance calculation requires period selection
