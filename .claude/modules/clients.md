# Module: clients

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Client management including CRUD operations, project tracking, financial details, and communications |
| **Status** | Active |
| **Complexity** | High |
| **Category** | core |

## Dependencies

### Internal FF Modules
None

### External Packages
- react
- next
- @tanstack/react-query
- lucide-react
- zod (validation implied)

## Database

### Tables
- `clients` - Main client table
- `projects` (via LEFT JOIN) - Related projects

### Key Queries
- List all clients with search/status filtering
- Get single client with related projects aggregated
- Count active projects per client
- Sum budget per client (total_revenue)
- Create new client with auto-generated code
- Update client details
- Delete client

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/clients` | List with search/status filters |
| GET | `/api/clients?id={id}` | Get single client with projects |
| POST | `/api/clients` | Create new client |
| PUT | `/api/clients?id={id}` | Update client |
| DELETE | `/api/clients?id={id}` | Delete client |

## Services

### clientService
Methods inferred from component usage

## Components
- `ClientsPage` - Main entry
- `ClientList` - List view
- `ClientListHeader` - Header actions
- `ClientTable` - Table display
- `ClientTableRow` - Row component
- `ClientSummaryCards` - Summary stats
- `ClientForm` - Create/edit form
- `ClientFormSections` - Form sections
- `ClientDetail` - Detail view
- `ClientDetailPage` - Detail page
- `ClientDetailSections` - Detail sections
- `ClientCreatePage` - Create page
- `ClientEditPage` - Edit page
- `ClientAnalytics` - Analytics view

## Hooks
- `useClient(id: string)` - Single client
- `useCreateClient()` - Create mutation
- `useUpdateClient()` - Update mutation
- `useClients()` - List clients

## Patterns
- Parameterized SQL queries for safety
- Safe query wrapper (safeArrayQuery) with retry logic
- JSON aggregation for related projects
- Name field fallback (client_name → name → company_name)
- Status-based filtering
- Search across multiple fields (company_name, contact_person, email)
- Page layout distinction (AppLayout vs fullscreen)

## Gotchas
- **Name Fields**: Multiple client name field variants (company_name, client_name, name)
- **UUID Cast**: Project JOIN uses ::text::uuid cast - potential type issues
- **ID Required**: Client ID must exist for single client fetches
- **Search Pattern**: Search term wrapped with % for ILIKE pattern
- **Case Sensitive**: Status filter case-sensitive (should validate against allowed values)
- **No Validation**: No validation on create/update payloads
- **Hardcoded Default**: Default country hardcoded to 'South Africa'
- **NULL Filtering**: Project aggregation via JSON_AGG includes NULL filtering
- **Empty Response**: Empty clients list returns 200 with empty array (not 404)
