<!-- GENERATED — do not edit. Canonical source: ./.claude.md -->
<!-- Regenerate: node scripts/mirror-agents-md.mjs -->
<!-- You are reading the AGENTS.md view of the Claude-facing docs. Prose
     below may refer to ".claude.md" when describing the canonical side;
     that is accurate — only PATH references are rewritten to AGENTS.md. -->
# Module: installations
<!-- Home fiber installation tracking — UI scaffold only, no live API integration yet -->

## Purpose
Dashboard UI for tracking home fiber installation jobs (scheduling, status, technician, speed tests). Currently a scaffold — no real data service wired up.

## Key Files
| File | Purpose |
|------|---------|
| `HomeInstallationsDashboard.tsx` | Entry point — renders stats, filter tabs, table |
| `HomeInstallationsDashboard/hooks/useHomeInstallations.ts` | State management — returns empty `[]`, TODO: wire to real service |
| `HomeInstallationsDashboard/types/installation.types.ts` | `Installation`, `InstallationStats`, `FilterStatus` |
| `HomeInstallationsDashboard/utils/installationUtils.ts` | `calculateInstallationStats()` |
| `HomeInstallationsDashboard/components/` | `InstallationStatsCards`, `InstallationFilterTabs`, `InstallationsTable` |
| `models/installation.model.ts` | Data model |

## Installation Type
```typescript
{
  id, homeNumber, clientName, address, installDate,
  status: 'scheduled' | 'in_progress' | 'completed' | 'issue' | 'cancelled',
  technician,
  equipment: { ont, router, cables, splitter },
  speedTest: { download, upload, ping },
  issues: string[],
  completionTime?, customerSatisfaction?
}
```

## Critical Rules
- `useHomeInstallations` intentionally returns `[]` with a TODO comment — **do not remove the comment**, it documents the gap
- No API endpoints exist for this module yet — real installations data lives in `activate` module (ONT activations)
- Do not confuse with the `activate` module which handles actual ONT activations and has a full API
- When implementing real data, wire to `activate` or a new `installations` API — check for existing data before creating tables

<!-- Auto-updated by /kb. Last: 2026-05-12 -->
