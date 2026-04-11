#!/usr/bin/env tsx
/**
 * Weekly Dev Report Generator
 *
 * Usage:
 *   npx tsx scripts/weekly-report/generate.ts                           # current week
 *   npx tsx scripts/weekly-report/generate.ts --week 2026-15
 *   npx tsx scripts/weekly-report/generate.ts --since 2026-04-07 --until 2026-04-13
 *   npx tsx scripts/weekly-report/generate.ts --highlights /path/to/highlights.json
 *   npx tsx scripts/weekly-report/generate.ts --no-pdf
 *
 * highlights.json shape:
 *   [{ "title": "...", "blurb": "...", "screenshot": "/abs/path/to/image.png", "prs": [123, 456] }]
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── Types ───────────────────────────────────────────────────────────────────

type Pr = {
  number: number;
  title: string;
  author: { login: string };
  mergedAt: string;
  url: string;
  labels: { name: string }[];
  additions: number;
  deletions: number;
};

type Commit = { sha: string; subject: string; author: string; date: string };
type Bucket = { label: string; emoji: string; prs: Pr[] };

type Highlight = {
  title: string;
  blurb: string;
  screenshot?: string; // absolute path to image file
  prs?: number[];
};

// ─── Config ──────────────────────────────────────────────────────────────────

const CATEGORIES: Array<{ label: string; emoji: string; match: RegExp }> = [
  { label: 'Features', emoji: '✨', match: /^feat(\(|:|!)/i },
  { label: 'Bug Fixes', emoji: '🐛', match: /^fix(\(|:|!)/i },
  { label: 'Performance', emoji: '⚡', match: /^perf(\(|:|!)/i },
  { label: 'Refactors', emoji: '♻️', match: /^refactor(\(|:|!)/i },
  { label: 'Documentation', emoji: '📝', match: /^docs(\(|:|!)/i },
  { label: 'Tests', emoji: '✅', match: /^test(\(|:|!)/i },
  { label: 'Chores & Infra', emoji: '🔧', match: /^(chore|build|ci|infra)(\(|:|!)/i },
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function assertDate(label: string, value: string): string {
  if (!ISO_DATE.test(value)) throw new Error(`${label} must be YYYY-MM-DD, got: ${value}`);
  return value;
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i++; }
  }
  return args;
}

function isoWeekRange(date = new Date()): { since: string; until: string; isoWeek: string } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - (day - 1));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const target = new Date(monday);
  target.setUTCDate(target.getUTCDate() + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(
    ((target.getTime() - firstThursday.getTime()) / 86400000 - 3 +
      ((firstThursday.getUTCDay() + 6) % 7)) / 7,
  );
  const fmt = (x: Date) => x.toISOString().slice(0, 10);
  return { since: fmt(monday), until: fmt(sunday), isoWeek: `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}` };
}

function parseIsoWeek(isoWeek: string): { since: string; until: string; isoWeek: string } {
  const m = /^(\d{4})-W?(\d{1,2})$/.exec(isoWeek);
  if (!m) throw new Error(`Invalid --week ${isoWeek}, expected YYYY-Www`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const monday = new Date(week1Mon);
  monday.setUTCDate(week1Mon.getUTCDate() + (week - 1) * 7);
  return isoWeekRange(monday);
}

function fetchPrs(since: string, until: string): Pr[] {
  assertDate('since', since);
  assertDate('until', until);
  const search = `is:pr is:merged merged:${since}T00:00:00Z..${until}T23:59:59Z`;
  const json = execFileSync('gh', [
    'pr', 'list', '--state', 'merged', '--search', search,
    '--limit', '200', '--json', 'number,title,author,mergedAt,url,labels,additions,deletions',
  ], { encoding: 'utf8' });
  return JSON.parse(json) as Pr[];
}

function fetchCommits(since: string, until: string): Commit[] {
  assertDate('since', since);
  assertDate('until', until);
  const out = execFileSync('git', [
    'log', '--no-merges', `--since=${since}`, `--until=${until}T23:59:59`,
    '--pretty=format:%h%x09%an%x09%ad%x09%s', '--date=short',
  ], { encoding: 'utf8' }).trim();
  if (!out) return [];
  return out.split('\n').map((line) => {
    const [sha, author, date, ...rest] = line.split('\t');
    return { sha, author, date, subject: rest.join('\t') };
  });
}

function bucketize(prs: Pr[]): { buckets: Bucket[]; other: Bucket } {
  const buckets: Bucket[] = CATEGORIES.map((c) => ({ label: c.label, emoji: c.emoji, prs: [] }));
  const other: Bucket = { label: 'Other', emoji: '📦', prs: [] };
  for (const pr of prs) {
    const idx = CATEGORIES.findIndex((c) => c.match.test(pr.title));
    if (idx >= 0) buckets[idx].prs.push(pr);
    else other.prs.push(pr);
  }
  return { buckets: buckets.filter((b) => b.prs.length > 0), other };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function imageToBase64(filePath: string): string {
  const buf = readFileSync(filePath);
  const ext = filePath.split('.').pop()?.toLowerCase() ?? 'png';
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// ─── HTML ────────────────────────────────────────────────────────────────────

function renderHtml(opts: {
  isoWeek: string;
  since: string;
  until: string;
  prs: Pr[];
  commits: Commit[];
  buckets: Bucket[];
  other: Bucket;
  highlights: Highlight[];
}): string {
  const { isoWeek, since, until, prs, commits, buckets, other, highlights } = opts;
  const additions = prs.reduce((s, p) => s + (p.additions || 0), 0);
  const deletions = prs.reduce((s, p) => s + (p.deletions || 0), 0);
  const authors = new Map<string, number>();
  for (const pr of prs) authors.set(pr.author.login, (authors.get(pr.author.login) || 0) + 1);
  const topAuthors = [...authors.entries()].sort((a, b) => b[1] - a[1]);

  const renderHighlight = (h: Highlight, idx: number) => {
    const imgTag = h.screenshot
      ? `<img class="hl-img" src="${imageToBase64(h.screenshot)}" alt="${escapeHtml(h.title)}">`
      : '';
    const prLinks = (h.prs ?? [])
      .map((n) => `<a class="hl-pr" href="https://github.com/VelocityFibre/FF_Next.js/pull/${n}">#${n}</a>`)
      .join(' ');
    return `
    <div class="highlight">
      <div class="hl-body">
        <div class="hl-text">
          <div class="hl-num">${String(idx + 1).padStart(2, '0')}</div>
          <h3 class="hl-title">${escapeHtml(h.title)}</h3>
          <p class="hl-blurb">${escapeHtml(h.blurb)}</p>
          ${prLinks ? `<div class="hl-prs">${prLinks}</div>` : ''}
        </div>
        ${imgTag ? `<div class="hl-img-wrap">${imgTag}</div>` : ''}
      </div>
    </div>`;
  };

  const renderBucket = (b: Bucket) => `
    <section class="bucket">
      <h2>${b.emoji} ${escapeHtml(b.label)} <span class="count">${b.prs.length}</span></h2>
      <ul>
        ${b.prs.map((pr) => `
          <li>
            <a class="pr-num" href="${pr.url}">#${pr.number}</a>
            <span class="pr-title">${escapeHtml(pr.title)}</span>
            <span class="pr-meta">by ${escapeHtml(pr.author.login)} · +${pr.additions}/-${pr.deletions}</span>
          </li>`).join('')}
      </ul>
    </section>`;

  const allBuckets = [...buckets, ...(other.prs.length ? [other] : [])];
  const authorBarMax = topAuthors[0]?.[1] ?? 1;
  const authorBars = topAuthors.slice(0, 8).map(([login, count]) => `
    <div class="author-row">
      <span class="author-name">${escapeHtml(login)}</span>
      <div class="author-bar-wrap"><div class="author-bar" style="width:${Math.round((count / authorBarMax) * 100)}%"></div></div>
      <span class="author-count">${count}</span>
    </div>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>FibreFlow Weekly Report ${isoWeek}</title>
<style>
  :root {
    --bg: #0f172a; --bg-card: #1e293b; --bg-card2: #162032;
    --border: #2d3f55; --accent: #38bdf8; --accent2: #818cf8;
    --fg: #f1f5f9; --muted: #94a3b8; --radius: 10px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--fg); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12.5px; line-height: 1.6; }

  .header { background: linear-gradient(135deg, #0369a1 0%, #1e40af 50%, #4f46e5 100%); padding: 36px 48px 30px; position: relative; overflow: hidden; }
  .header::before { content:''; position:absolute; inset:0; background:url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none'%3E%3Cg fill='%23ffffff' fill-opacity='0.04'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E"); }
  .header-inner { position:relative; z-index:1; }
  .header-brand { font-size:10px; letter-spacing:0.14em; text-transform:uppercase; opacity:0.65; margin-bottom:5px; }
  .header h1 { font-size:28px; font-weight:800; letter-spacing:-0.03em; }
  .header-sub { margin-top:4px; opacity:0.7; font-size:12px; }
  .header-week { display:inline-block; background:rgba(255,255,255,0.15); border-radius:999px; padding:2px 14px; font-size:11.5px; font-weight:600; margin-top:10px; }

  .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; padding:18px 48px; }
  .stat { background:var(--bg-card); border:1px solid var(--border); border-radius:var(--radius); padding:14px 16px; }
  .stat .v { font-size:24px; font-weight:700; color:var(--accent); line-height:1; margin-bottom:3px; }
  .stat .l { font-size:10px; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted); }

  .section-title { font-size:10px; text-transform:uppercase; letter-spacing:0.12em; color:var(--accent); font-weight:700; padding:16px 48px 8px; border-top:1px solid var(--border); margin-top:4px; }

  .highlights { padding:0 48px; display:flex; flex-direction:column; gap:14px; margin-bottom:4px; }
  .highlight { background:var(--bg-card); border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; page-break-inside:avoid; }
  .hl-body { display:flex; align-items:stretch; }
  .hl-text { padding:18px 20px; flex:0 0 230px; display:flex; flex-direction:column; gap:7px; justify-content:center; border-right:1px solid var(--border); }
  .hl-num { font-size:28px; font-weight:800; color:var(--border); line-height:1; }
  .hl-title { font-size:12.5px; font-weight:700; color:var(--fg); line-height:1.35; }
  .hl-blurb { font-size:11px; color:var(--muted); line-height:1.55; }
  .hl-prs { display:flex; flex-wrap:wrap; gap:4px; margin-top:2px; }
  .hl-pr { color:var(--accent); font-size:10.5px; font-weight:600; text-decoration:none; background:rgba(56,189,248,0.12); padding:2px 7px; border-radius:999px; }
  .hl-img-wrap { flex:1; overflow:hidden; max-height:210px; }
  .hl-img { width:100%; height:100%; object-fit:cover; object-position:top left; display:block; }

  .buckets { padding:0 48px; display:flex; flex-direction:column; gap:14px; }
  .bucket { background:var(--bg-card); border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; page-break-inside:avoid; }
  .bucket h2 { font-size:11.5px; padding:10px 14px; background:var(--bg-card2); border-bottom:1px solid var(--border); display:flex; align-items:center; gap:7px; }
  .count { background:var(--accent); color:var(--bg); border-radius:999px; padding:1px 8px; font-size:9.5px; font-weight:700; }
  .bucket ul { list-style:none; }
  .bucket li { display:flex; flex-wrap:wrap; gap:8px; align-items:baseline; padding:6px 14px; border-bottom:1px solid var(--border); }
  .bucket li:last-child { border-bottom:none; }
  a.pr-num { color:var(--accent); font-weight:600; font-size:10.5px; min-width:46px; text-decoration:none; }
  .pr-title { flex:1; font-size:11.5px; }
  .pr-meta { color:var(--muted); font-size:10px; }

  .contributors { padding:0 48px; margin-bottom:20px; }
  .contributors-card { background:var(--bg-card); border:1px solid var(--border); border-radius:var(--radius); padding:14px 16px; }
  .contributors-card h2 { font-size:11.5px; margin-bottom:12px; }
  .author-row { display:flex; align-items:center; gap:10px; margin-bottom:6px; }
  .author-name { width:110px; font-size:11px; color:var(--muted); flex-shrink:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .author-bar-wrap { flex:1; background:var(--border); border-radius:999px; height:5px; }
  .author-bar { background:linear-gradient(90deg,var(--accent),var(--accent2)); border-radius:999px; height:5px; }
  .author-count { width:22px; text-align:right; font-size:10.5px; color:var(--fg); font-weight:600; }

  footer { padding:10px 48px; border-top:1px solid var(--border); font-size:10px; color:var(--muted); display:flex; justify-content:space-between; margin-top:6px; }

  @page { size:A4; margin:0; }
</style>
</head>
<body>

<div class="header">
  <div class="header-inner">
    <div class="header-brand">FibreFlow · Engineering Report</div>
    <h1>Weekly Recap</h1>
    <div class="header-sub">${since} → ${until}</div>
    <div class="header-week">${isoWeek}</div>
  </div>
</div>

<div class="stats">
  <div class="stat"><div class="v">${prs.length}</div><div class="l">PRs Merged</div></div>
  <div class="stat"><div class="v">${commits.length}</div><div class="l">Commits</div></div>
  <div class="stat"><div class="v">+${additions.toLocaleString()}</div><div class="l">Lines Added</div></div>
  <div class="stat"><div class="v">-${deletions.toLocaleString()}</div><div class="l">Lines Removed</div></div>
</div>

${highlights.length > 0 ? `
<div class="section-title">Highlights</div>
<div class="highlights">
  ${highlights.map(renderHighlight).join('')}
</div>` : ''}

<div class="section-title">Shipped This Week</div>
<div class="buckets">
  ${allBuckets.map(renderBucket).join('')}
</div>

<div class="section-title">Contributors</div>
<div class="contributors">
  <div class="contributors-card">
    <h2>👥 Top Contributors</h2>
    ${authorBars || '<p style="color:var(--muted)">No PRs merged.</p>'}
  </div>
</div>

<footer>
  <span>FibreFlow Next.js · auto-generated by /weekly-report</span>
  <span>Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC</span>
</footer>

</body>
</html>`;
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

async function htmlToPdf(html: string, pdfPath: string) {
  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.default.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } });
  } finally {
    await browser.close();
  }
}

// ─── Entry ───────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let range: { since: string; until: string; isoWeek: string };

  if (args.since && args.until) {
    range = { since: String(args.since), until: String(args.until), isoWeek: `custom-${args.since}_${args.until}` };
  } else if (args.week) {
    range = parseIsoWeek(String(args.week));
  } else {
    range = isoWeekRange();
  }

  const highlights: Highlight[] = args.highlights
    ? (JSON.parse(readFileSync(String(args.highlights), 'utf8')) as Highlight[])
    : [];

  console.log(`[weekly-report] ${range.isoWeek}: ${range.since} → ${range.until}`);
  if (highlights.length) console.log(`[weekly-report] ${highlights.length} highlight(s) loaded`);

  console.log('[weekly-report] fetching merged PRs...');
  const prs = fetchPrs(range.since, range.until);
  console.log(`[weekly-report] ${prs.length} PRs merged`);

  console.log('[weekly-report] fetching commits...');
  const commits = fetchCommits(range.since, range.until);
  console.log(`[weekly-report] ${commits.length} commits`);

  const { buckets, other } = bucketize(prs);
  const html = renderHtml({ ...range, prs, commits, buckets, other, highlights });

  const outDir = join(process.cwd(), 'docs', 'weekly-dev-reports');
  mkdirSync(outDir, { recursive: true });
  const base = join(outDir, range.isoWeek);
  writeFileSync(`${base}.html`, html);
  console.log(`[weekly-report] wrote ${base}.html`);

  if (args['no-pdf']) { console.log('[weekly-report] --no-pdf, skipping'); return; }

  console.log('[weekly-report] rendering PDF...');
  await htmlToPdf(html, `${base}.pdf`);
  console.log(`[weekly-report] wrote ${base}.pdf`);
}

main().catch((err) => { console.error('[weekly-report] FAILED:', err); process.exit(1); });
