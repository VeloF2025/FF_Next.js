# Weekly Dev Report

Generate this week's "what shipped" report (HTML + PDF) under `docs/weekly-dev-reports/`.

## Run

```bash
# Current ISO week (default)
tsx scripts/weekly-report/generate.ts

# Specific week
tsx scripts/weekly-report/generate.ts --week 2026-15

# Custom range
tsx scripts/weekly-report/generate.ts --since 2026-04-07 --until 2026-04-13
```

## What you get

- Stats: PRs merged, commits, +/- lines
- Grouped PR list: Features, Fixes, Perf, Refactors, Docs, Tests, Chores, Other
- Contributors table
- Output: `docs/weekly-dev-reports/<iso-week>.html` + `.pdf`

See `.claude/skills/weekly-report/SKILL.md` for full details.
