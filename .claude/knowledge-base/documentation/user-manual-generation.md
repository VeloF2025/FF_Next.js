# User Manual Generation

## Overview

FibreFlow user manuals are generated from markdown source files with screenshots, compiled to branded PDFs using md-to-pdf.

## File Structure

```
docs/user-manuals/
├── source/              # Markdown source files
│   ├── maintenance.md   # Maintenance module manual
│   └── fibreflow-complete.md  # Comprehensive system manual
├── pdf/                 # Generated PDFs
│   ├── maintenance.pdf
│   └── fibreflow-complete.pdf
└── screenshots/         # Screenshot images by module
    ├── maintenance/
    └── complete/
```

## Screenshot Capture Pipeline

Chrome blocks programmatic downloads via `link.click()`. Use the local HTTP server approach:

### 1. Start Screenshot Server

```bash
cat > /tmp/screenshot-server.js << 'SCRIPT'
const http = require('http');
const fs = require('fs');
const path = require('path');
const SAVE_DIR = '/home/hein/Workspace/FF_Next.js/docs/user-manuals/screenshots/<module>';

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { filename, data } = JSON.parse(body);
      const buffer = Buffer.from(data, 'base64');
      fs.writeFileSync(path.join(SAVE_DIR, filename), buffer);
      console.log(`Saved: ${filename} (${buffer.length} bytes)`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, size: buffer.length }));
    });
  }
});
server.listen(9876, '127.0.0.1', () => console.log('Screenshot server on :9876'));
SCRIPT
node /tmp/screenshot-server.js &
```

### 2. Capture via Claude in Chrome

For each page, run via `mcp__claude-in-chrome__javascript_tool`:

```javascript
(async () => {
  if (!window.html2canvas) {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    document.head.appendChild(s);
    await new Promise(r => s.onload = r);
  }
  const canvas = await html2canvas(document.body, { scale: 1, useCORS: true, logging: false });
  const base64 = canvas.toDataURL('image/png').split(',')[1];
  const resp = await fetch('http://127.0.0.1:9876', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'XX-page-name.png', data: base64 })
  });
  return resp.json();
})();
```

### 3. Kill Server

```bash
pkill -f screenshot-server.js
```

## PDF Generation

**CRITICAL**: Must run from `docs/user-manuals/` with `--basedir .` for relative image paths to resolve.

```bash
cd /home/hein/Workspace/FF_Next.js/docs/user-manuals
timeout 120 npx md-to-pdf source/<file>.md --basedir . \
  --pdf-options '{"format":"A4","margin":{"top":"25mm","bottom":"25mm","left":"20mm","right":"20mm"}}'
mv source/<file>.pdf pdf/
```

## Branding Template

Use YAML frontmatter for Velocity Fibre branding:

```yaml
---
pdf_options:
  format: A4
  margin:
    top: 25mm
    bottom: 30mm
    left: 20mm
    right: 20mm
  displayHeaderFooter: true
  headerTemplate: '<div style="...">Velocity Fibre | FibreFlow</div>'
  footerTemplate: '<div style="..."><span class="pageNumber"></span>/<span class="totalPages"></span></div>'
body_class: manual
stylesheet: |
  body { font-family: 'Segoe UI', Arial, sans-serif; }
  h1 { color: #e65100; }
  /* ... full CSS in source files ... */
---
```

## Existing Manuals

| Manual | Source | Pages | Sections |
|--------|--------|-------|----------|
| Maintenance | `source/maintenance.md` | ~50 | Kanban, Work Orders, Teams |
| Complete | `source/fibreflow-complete.md` | ~150 | All 11 nav sections |

## References

- Skill: `.claude/skills/manual.md`
- Learning: See `learnings.md` entry "2026-02-01: Chrome Screenshot Capture Pipeline"
