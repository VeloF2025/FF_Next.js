# Module: pipeline

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Sales pipeline and wayleave approval tracking for fiber projects |
| **Status** | Active |
| **Complexity** | Medium |
| **Category** | sales |

## Quick Reference
- **Dashboard:** `/pipeline`
- **Project Detail:** `/pipeline/[id]`
- **Authorities:** `/pipeline/authorities`
- **API:** `/api/pipeline/*`

## Database Tables
| Table | Purpose |
|-------|---------|
| `pipeline_projects` | Pipeline opportunities (leads, qualifying, planning) |
| `pipeline_project_approvals` | Wayleave/approval tracking per pipeline project |
| `approval_types` | Types of approvals (Eskom, Transnet, Municipal, etc.) |
| `authorities` | Authority contacts and details |
| `project_pipeline_links` | Junction table linking projects ↔ pipeline (one-to-many) |

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/pipeline/projects` | List pipeline projects |
| GET/PUT | `/api/pipeline/projects/[id]` | Single pipeline project |
| POST | `/api/pipeline/projects/[id]/transition` | Transition to active project |
| GET | `/api/pipeline/projects/search` | Search for linkable pipelines |
| GET | `/api/projects/[projectId]/pipeline-links` | Get linked pipeline areas |
| POST | `/api/projects/[projectId]/pipeline-links` | Create new link |
| PATCH/DELETE | `/api/projects/[projectId]/pipeline-links/[linkId]` | Update/remove link |
| GET | `/api/projects/[projectId]/wayleaves` | Get wayleaves from primary link |

## Pages
| Path | File | Description |
|------|------|-------------|
| `/pipeline` | `pages/pipeline/index.tsx` | Pipeline dashboard |
| `/pipeline/[id]` | `pages/pipeline/[id]/index.tsx` | Pipeline project detail |
| `/pipeline/new` | `pages/pipeline/new.tsx` | Create new pipeline project |
| `/pipeline/alerts` | `pages/pipeline/alerts.tsx` | Expiring approvals alerts |
| `/pipeline/authorities` | `pages/pipeline/authorities.tsx` | Manage authorities |
| `/projects/pipeline/[id]` | `pages/projects/pipeline/[id].tsx` | Alternate route (same content) |

## Pipeline Statuses
| Status | Description |
|--------|-------------|
| `lead` | Initial lead |
| `qualifying` | Evaluating opportunity |
| `planning` | Active planning |
| `ready_to_plan` | Ready for detailed planning |
| `planned` | Fully planned |
| `on_hold` | Temporarily paused |
| `lost` | Lost opportunity |

## Approval Statuses
| Status | Description |
|--------|-------------|
| `not_started` | Not yet begun |
| `preparing` | Documents being prepared |
| `submitted` | Application submitted |
| `in_review` | Under authority review |
| `conditionally_approved` | Approved with conditions |
| `approved` | Fully approved |
| `rejected` | Application rejected |
| `expired` | Approval expired |
| `renewed` | Approval renewed |

## Project-Pipeline Linking
Projects can link to multiple pipeline areas via `project_pipeline_links`:
- `is_primary` - Determines which pipeline's wayleaves show on project
- `link_type` - 'transition' (auto) or 'manual' (user-linked)
- One project → many pipelines (multi-area projects)
- One pipeline → many projects (project splits)

## Components
- `LinkPipelineModal` - Modal to link project to pipeline area
- `ProjectWayleavesTab` - Shows linked pipelines and wayleaves

## Gotchas
- **Route Duplication**: Both `/pipeline/[id]` and `/projects/pipeline/[id]` exist and work
- **Cross-Module Links**: Use `/pipeline/[id]` (not `/pipeline/projects/[id]/approvals`) for navigation
- **Primary Link**: Wayleaves display uses primary linked pipeline - change via star icon
- **Approval Types**: Some approvals are compulsory (`is_compulsory = true`)
- **Expiry Tracking**: Approvals with `expiry_date` trigger alerts when < 90 days remaining
