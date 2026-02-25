# Help Center Module

**Status:** Active (end-user facing)  
**Last Updated:** 2026-02-25  
**Complexity:** Medium  
**Lines of Code:** ~6,400  
**Recent Activity:** 22 commits since 2026-02-01  

---

## Overview

Help Center is a user-facing documentation interface providing searchable, browsable access to the FibreFlow User Manual. It functions as an in-app help system with a sidebar table of contents, full-text search, markdown rendering, and breadcrumb navigation.

**Purpose:** Embed comprehensive user documentation directly in FibreFlow, reducing support load and improving self-service capability.

---

## Architecture

### Data Flow

```
Manual Source (docs/user-manuals/source/fibreflow-complete.md)
    ↓ [npm run embed-manual]
Auto-generated: data/manual-content.ts (4,300+ lines)
    ↓
useHelpCenter hook parses sections
    ↓
HelpCenterPage renders with:
  - Sidebar TOC (sections + subsections)
  - Search bar (full-text across manual)
  - Content area (markdown rendering)
  - Breadcrumbs + navigation (prev/next)
```

### Key Workflow

1. **Initial Load** — HelpCenterPage mounts, useHelpCenter parses manual sections
2. **Navigation** — User clicks section → setCurrentSection → content renders
3. **Search** — User types query → searchManual filters results → display matches
4. **Markdown Rendering** — SectionRenderer → MarkdownRenderer processes headings, tables, links, code blocks
5. **Mobile Responsive** — Sidebar collapses <1024px, toggleable menu

---

## Components

| Component | Purpose |
|-----------|---------|
| **HelpCenterPage** | Main page, layout router (sidebar/content/search) |
| **TableOfContents** | Sidebar tree of manual sections + subsections, active indicator |
| **SearchBar** | Full-text search input, result count display, clear button |
| **SectionRenderer** | Renders a single section with markdown processing, relative links |
| **MarkdownRenderer** | Converts markdown → HTML: headings, lists, tables, code blocks, links |

### HelpCenterPage Features
- Mobile-responsive sidebar (toggleable)
- Breadcrumb trail showing current location
- Prev/Next navigation buttons
- Download button (placeholder for PDF export)
- Content scrolls to top when section changes
- Sidebar closes on mobile after selection

### SectionRenderer
- Renders section title (h1) with breadcrumbs
- Displays subsection content (markdown)
- Converts relative links to navigation calls
- Preserves table formatting, code blocks, lists

### MarkdownRenderer
- Inline markdown → HTML:
  - `**bold**` → `<strong>`
  - `*italic*` → `<em>`
  - `` `code` `` → `<code>`
  - `[link](url)` → `<a href>`
- Block markdown:
  - `# Heading` → `<h1>` (h2/h3/etc)
  - `- List items` → `<ul>/<li>`
  - `| Table |` → `<table>/<tr>/<td>`
  - Code fences ` ```lang ``` ` → `<pre><code>`

---

## Data Structure

### Manual Content (auto-generated)

File: `src/modules/help-center/data/manual-content.ts` (DO NOT EDIT MANUALLY)

**Content is auto-generated from:** `docs/user-manuals/source/fibreflow-complete.md`

**To update manual content:**
```bash
npm run embed-manual
```

This command:
1. Reads the source markdown file
2. Parses sections and subsections (front matter: `## Section` → `### Subsection`)
3. Embeds all content as a giant string in `manual-content.ts`
4. Adds PDF options in front matter (A4, headers/footers, Velocity Fibre branding)

**Export functions from manual-content.ts:**
- `parseManualSections()` — Returns array of ManualSection objects
- `searchManual(query)` — Returns array of SearchResult (matching sections + snippet)

### ManualSection Type

```typescript
interface ManualSection {
  id: string;              // e.g., "getting-started", "maintenance-workflow"
  title: string;           // Display name
  content: string;         // Markdown body of main section
  subsections?: {
    id: string;            // e.g., "getting-started-quick-start"
    title: string;
    content: string;       // Markdown body of subsection
  }[];
}
```

### SearchResult Type

```typescript
interface SearchResult {
  sectionId: string;
  subsectionId?: string;
  title: string;
  snippet: string;         // ~100 chars of matching context
  matchCount: number;       // # of matches in this section
}
```

---

## Hooks

### `useHelpCenter()`

Main state management for help center navigation and search.

**State:**
- `sections` — Parsed manual sections
- `currentSectionId`, `currentSubsectionId` — Active location
- `searchQuery`, `searchResults`, `isSearching` — Search state
- `breadcrumbs` — Current navigation path
- `prevItem`, `nextItem` — Prev/next nav targets

**Methods:**
- `setCurrentSection(sectionId, subsectionId?)` — Navigate to section
- `setSearchQuery(query)` — Update search, trigger search
- `clearSearch()` — Exit search, return to browsing
- `goBack()`, `goNext()` — Prev/next navigation
- `parseManualSections()` — Load and parse manual on mount

---

## Common Tasks

### Add a New Section to the Manual

1. **Edit source:** `docs/user-manuals/source/fibreflow-complete.md`
2. **Add markdown:**
   ```markdown
   ## New Section Title
   Section intro text here.
   
   ### Subsection Title
   Subsection content here.
   ```
3. **Regenerate:** `npm run embed-manual`
4. **Test:** Browse Help Center, verify new section appears in TOC

### Update Manual Content

1. Edit `docs/user-manuals/source/fibreflow-complete.md`
2. Run `npm run embed-manual`
3. Manual sections auto-reload on next page load (no code changes needed)

### Add a Custom Link in Manual

Use markdown link syntax:
```markdown
See [Activate Module](activate-module) for details.
```

This converts to internal navigation (no HTTP request).

### Search Optimization

Search is full-text across all sections. Text is stripped of markdown before indexing:
- `**bold**` → `bold`
- `[link](url)` → `link`
- Code blocks are indexed as-is

---

## Mobile Behavior

| Breakpoint | Behavior |
|------------|----------|
| >1024px | Sidebar always visible, content beside it |
| <1024px | Sidebar hidden by default, hamburger menu toggles it, closes on section select |

Tested responsive: Safari iOS, Chrome Android.

---

## Performance Notes

- **Manual size:** ~4,300 lines (auto-generated from markdown source)
- **Search:** O(n) string scan on all sections (fast enough for ~4KB manual, consider indexing if grows >10KB)
- **Markdown rendering:** Regex-based, no external library (keeps bundle small)
- **Sidebar rendering:** Tree structure, no virtualization (acceptable for <50 sections)

---

## Known Limitations

1. **No PDF export** — Download button is placeholder; PDF generation would require server-side headless browser (Puppeteer/Chromium)
2. **No search highlighting** — Matches found but not highlighted in rendered content
3. **No breadcrumb links** — Breadcrumbs are text only, not clickable (could be added)
4. **No external link tracking** — Links to external docs don't log for analytics

---

## Related Modules & Systems

- **Manual source:** `docs/user-manuals/source/fibreflow-complete.md` (human-maintained markdown)
- **Manual build:** `scripts/embed-manual.js` (parses markdown → manual-content.ts)
- **CI step:** `npm run embed-manual` runs in build pipeline if manual changes detected

---

## Future Enhancements

- **PDF export** — Add "Download as PDF" button (requires Puppeteer server-side)
- **Full-text search indexing** — Pre-build search index during embed-manual step
- **Search result highlighting** — Highlight matched terms in rendered content
- **Breadcrumb navigation** — Make breadcrumbs clickable to jump to any level
- **Manual versioning** — Track manual versions (v1.6, v1.7, etc) in selector
- **Video embed support** — Allow `![alt](youtube-url)` → embedded player
- **Feedback widget** — "Was this helpful?" button on each section
- **Translation support** — Multi-language manual files (en, es, fr, etc)

---

## Testing Notes

- Unit: Markdown parsing, section tree navigation, search filtering
- Integration: Manual loading on mount, search results accuracy
- E2E: Sidebar navigation, search, mobile responsive, PDF download button (if implemented)

---

**Next Steps:** Monitor manual size as docs grow; consider search indexing if manual >10KB. Consider breadcrumb navigation enhancement (low effort, high UX gain).

---
*Written by: Scribe | 2026-02-25 | Self-improvement heartbeat task (00:59 AM)*
