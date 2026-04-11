---
name: weekly-report
description: Generate a weekly dev report (HTML + PDF) of what was shipped — merged PRs grouped by type, commit count, contributors, and totals. USE WHEN user says '/weekly-report', 'weekly report', 'what shipped this week', 'weekly summary', 'ship report', or asks for a recap of a given week's work.
---

# /weekly-report — Weekly Dev Report

Generates a polished HTML + PDF report of everything shipped (merged PRs + commits) for an ISO week. Output lives in `docs/weekly-dev-reports/`.

## Usage

```bash
# Current ISO week (Mon → Sun, UTC)
tsx scripts/weekly-report/generate.ts

# Explicit ISO week
tsx scripts/weekly-report/generate.ts --week 2026-15

# Custom date range
tsx scripts/weekly-report/generate.ts --since 2026-04-07 --until 2026-04-13

# HTML only (skip puppeteer PDF render)
tsx scripts/weekly-report/generate.ts --no-pdf
```

Outputs:
- `docs/weekly-dev-reports/<week>.html`
- `docs/weekly-dev-reports/<week>.pdf`

## What it includes

- **Stats strip** — PRs merged, commits, total +/- lines
- **Grouped PR sections** — Features, Bug Fixes, Performance, Refactors, Docs, Tests, Chores & Infra, Other (matched on conventional-commit prefix in PR title)
- **Contributors table** — PR count per author
- **Header** — ISO week label + date range + generation timestamp

## Data sources

| Source | What it provides | How |
|---|---|---|
| GitHub (`gh pr list`) | Merged PRs, authors, +/- lines, labels | `is:pr is:merged merged:<since>..<until>` |
| Local git (`git log`) | Commit count for the week | `--since/--until --no-merges` |

The script must be run from a checkout that has `gh` authenticated against the FibreFlow repo.

## When to invoke

- User says "weekly report", "what shipped this week", "ship report", or `/weekly-report`
- User asks for a recap of a specific week ("recap last week", "report for week 14")
- Friday wrap-up / handover summaries

## Workflow

1. Confirm the week with the user if ambiguous (default = current ISO week, SAST).
2. Run the generator from a worktree (per project worktree rule).
3. Open the PDF and report the path back to the user.
4. Optional: commit the PDF + HTML to `docs/weekly-dev-reports/` and open a PR if the user wants it tracked.

## Notes

- Categorisation reads the PR title prefix — encourage conventional commits (`feat:`, `fix:`, `perf:` …) for clean grouping; anything unmatched falls into **Other**.
- PDF rendering uses the project's existing `puppeteer` dependency — no new packages needed.
- Times use UTC for the week boundary (Mon 00:00 UTC → Sun 23:59 UTC). Close enough to SAST for a weekly cadence; if you need a SAST-exact cut, pass explicit `--since/--until`.
- Reports are point-in-time snapshots. Re-running for the same week overwrites the existing files.
