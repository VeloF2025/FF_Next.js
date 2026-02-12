---
name: user-manual
description: Update the complete FibreFlow user manual with recent feature changes
version: 1.0.0
triggers:
  - /user-manual
  - update user manual
  - update manual
  - update help center
---

# /user-manual - Update Complete User Manual

Update `docs/user-manuals/source/fibreflow-complete.md` with recent feature changes, then regenerate the embedded help center content.

## Usage
```
/user-manual              # Scan recent changes and update
/user-manual <section>    # Update specific section only
```

## Workflow

### Step 1: Identify Recent Changes

```bash
# Recent feature commits (last 30 days)
git log --oneline --since="30 days ago" | grep -i "feat\|add\|new\|update\|improve"

# Recently modified modules
git log --name-only --since="30 days ago" -- "src/modules/" | grep "src/modules" | sort -u

# New API endpoints
git log --name-only --since="30 days ago" -- "pages/api/" | grep "pages/api" | sort -u
```

### Step 2: Read Current Manual

```bash
# Read the complete manual
cat docs/user-manuals/source/fibreflow-complete.md
```

The manual has 14 sections:
1. Getting Started
2. Dashboard, Meetings & Action Items
3. Project Management
4. Activate - QA & Photo Review
5. Field Operations (QField QA)
6. Maintenance
7. Procurement
8. Assets
9. Fleet Management
10. Human Resources
11. Analytics
12. Communications
13. System Administration
14. Appendices

### Step 3: Update Sections

For each changed feature, find and update the relevant section:

**Update guidelines:**
- Add new features under the correct section heading
- Use existing writing style (clear, non-technical)
- Include role-based access notes where relevant
- Add to Table of Contents if new subsections created
- Reference UI elements by exact button/label names
- Keep step-by-step numbered instructions
- Add tips in blockquotes: `> **Tip:** ...`
- Update the "Last Updated" date in frontmatter
- Update version number if significant changes

**Section mapping:**
| Module | Section |
|--------|---------|
| activate | 4. Activate - QA & Photo Review |
| fleet | 9. Fleet Management |
| procurement | 7. Procurement |
| staff | 10. Human Resources |
| meetings | 2.2 Meetings |
| maintenance | 6. Maintenance |
| projects | 3. Project Management |
| communications | 12. Communications |
| system/data-sync | 13. System Administration |

### Step 4: Regenerate Help Center Content

```bash
# Embed updated manual into help center TypeScript module
npm run embed-manual
```

This converts `fibreflow-complete.md` → `src/modules/help-center/data/manual-content.ts`

**Verify generation:**
```bash
# Check the generated file was updated
head -5 src/modules/help-center/data/manual-content.ts
# Should show recent timestamp
```

### Step 5: Commit

```bash
git add docs/user-manuals/source/fibreflow-complete.md
git add src/modules/help-center/data/manual-content.ts
git commit -m "docs(manual): update user manual with recent feature changes

- Updated sections: [list changed sections]
- New features documented: [list]

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

### Step 6: Report

```
╔══════════════════════════════════════════════════════════════╗
║                 USER MANUAL UPDATED                          ║
╠══════════════════════════════════════════════════════════════╣
║ Sections updated:       N                                    ║
║ New subsections added:  N                                    ║
║ Features documented:    [list]                               ║
║ Help center embedded:   ✅                                   ║
║ Manual version:         X.Y                                  ║
╚══════════════════════════════════════════════════════════════╝
```

## Key Files

| File | Purpose |
|------|---------|
| `docs/user-manuals/source/fibreflow-complete.md` | Complete manual source (edit this) |
| `src/modules/help-center/data/manual-content.ts` | Auto-generated (never edit) |
| `scripts/embed-manual-content.js` | Generator script |
| `docs/user-manuals/pdf/fibreflow-complete.pdf` | PDF output |
| `docs/user-manuals/screenshots/` | Screenshot library |

## Relationship to Other Skills

| Skill | Purpose |
|-------|---------|
| `/manual <module>` | Generate standalone per-module manual with screenshots |
| `/user-manual` | Update the complete integrated manual (this skill) |
| `/access-control` | Audit RBAC (often run together with manual updates) |

## Notes
- The complete manual is ~2000 lines covering all 14 sections
- `npm run embed-manual` must be run after any edit to update the help center
- Screenshots are in `docs/user-manuals/screenshots/` organized by module
- PDF generation: `cd docs/user-manuals && npx md-to-pdf source/fibreflow-complete.md --basedir .`
