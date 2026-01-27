# /manual - User Manual Generation

## Description
Generate comprehensive user manuals for FibreFlow modules with screenshots and PDF output.

## Usage
```
/manual <module-name>
```

Example: `/manual maintenance`, `/manual procurement`, `/manual activate`

## Workflow

### Phase 1: Explore Module
1. Use Task agent (subagent_type=Explore) to discover all features:
   - Pages (`pages/<module>/` and `app/(main)/<module>/`)
   - Components (`src/modules/<module>/components/`)
   - API routes (`pages/api/<module>/`)
   - Types and services
   - Navigation config (`src/components/layout/sidebar/config/`)
2. Read `.claude/modules/<module>.md` if it exists for module context
3. Build a feature inventory: pages, workflows, integrations, settings

### Phase 2: Capture Screenshots
1. Ensure dev server is running on port 3004: `PORT=3004 npm run dev`
2. Get browser tab context: `mcp__claude-in-chrome__tabs_context_mcp`
3. Create a new tab: `mcp__claude-in-chrome__tabs_create_mcp`
4. For each module page:
   a. Navigate to `http://localhost:3004/<module-path>`
   b. Wait for page to load (use `wait` action, 3 seconds)
   c. Take screenshot using html2canvas injection:
   ```javascript
   (async () => {
     const script = document.createElement('script');
     script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
     document.head.appendChild(script);
     await new Promise(r => script.onload = r);
     const canvas = await html2canvas(document.body, { scale: 1, useCORS: true, logging: false });
     const link = document.createElement('a');
     link.download = 'FILENAME.png';
     link.href = canvas.toDataURL('image/png');
     link.click();
   })();
   ```
   d. Name screenshots: `01-<page-name>.png`, `02-<page-name>.png`, etc.
5. Copy screenshots from `~/Downloads/` to `docs/user-manuals/screenshots/<module>/`

### Phase 3: Write Manual
Create `docs/user-manuals/source/<module>.md` with this structure:

```markdown
# FibreFlow <Module Name> - User Manual

**Version:** 1.0
**Last Updated:** YYYY-MM-DD
**Module Path:** `/module-path`

---

## Table of Contents
<!-- numbered sections -->

## 1. Overview
- What the module does
- Key features summary
- Who uses it (roles)

## 2. Getting Started
- How to access (navigation path)
- Required permissions/roles
- Prerequisites

## 3-N. Feature Sections
For each major feature/page:
- Screenshot: `![Description](../screenshots/<module>/XX-name.png)`
- Step-by-step instructions
- UI element explanations
- Tips and notes

## N+1. Integration & Sync (if applicable)
- External system connections
- What data syncs and how
- Status/field mapping tables

## N+2. Common Workflows
Step-by-step workflows for typical tasks:
1. Workflow name
   - Step 1
   - Step 2
   - Expected result

## N+3. Troubleshooting
| Problem | Cause | Solution |
|---------|-------|----------|

## N+4. Appendix
- Keyboard shortcuts
- Role permissions
- Glossary
```

### Phase 4: Generate PDF

**CRITICAL:** Must run from `docs/user-manuals/` with `--basedir .` so that `../screenshots/` relative paths resolve correctly. Without `--basedir`, images will show as broken icons in the PDF. See [md-to-pdf #70](https://github.com/simonhaenisch/md-to-pdf/issues/70).

```bash
cd docs/user-manuals
npx md-to-pdf source/<module>.md --basedir . --pdf-options '{"format":"A4","margin":{"top":"25mm","bottom":"25mm","left":"20mm","right":"20mm"}}'
mv source/<module>.pdf pdf/
```

### Phase 5: Commit
```bash
git add docs/user-manuals/
git commit -m "docs(manual): add <module> user manual with screenshots

- Comprehensive user manual for <module> module
- Screenshots of all key pages
- PDF generated for distribution

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

## Folder Structure
```
docs/user-manuals/
├── source/              # Markdown source files
│   ├── maintenance.md
│   └── <module>.md
├── pdf/                 # Generated PDFs
│   ├── maintenance.pdf
│   └── <module>.pdf
└── screenshots/         # Screenshot images
    ├── maintenance/
    │   ├── 01-dashboard.png
    │   └── ...
    └── <module>/
```

## Writing Guidelines
- Use clear, non-technical language where possible
- Every feature should have a screenshot
- Include step-by-step numbered instructions
- Add tips/notes in blockquotes: `> **Tip:** ...`
- Reference exact button names and menu paths
- Include role-based access notes where relevant
- Add troubleshooting for common issues
- Keep sections focused - one feature per section

## Existing Manuals
| Module | Status | Last Updated |
|--------|--------|-------------|
| Maintenance | Complete | 2026-01-27 |

## Notes
- Screenshots use html2canvas via Claude in Chrome extension
- PDF generation uses `npx md-to-pdf` (v5.2.5)
- Always run on localhost:3004 for consistent screenshots
- Screenshots should be 1280px wide (default browser width)
