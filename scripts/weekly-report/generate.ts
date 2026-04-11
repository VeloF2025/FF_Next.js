#!/usr/bin/env tsx
/**
 * Weekly Dev Report Generator
 *
 * Pulls merged PRs and commits for the current (or specified) ISO week and
 * renders an HTML + PDF report under docs/weekly-dev-reports/.
 *
 * Usage:
 *   tsx scripts/weekly-report/generate.ts                # current week
 *   tsx scripts/weekly-report/generate.ts --week 2026-15 # explicit ISO week
 *   tsx scripts/weekly-report/generate.ts --since 2026-04-07 --until 2026-04-13
 *   tsx scripts/weekly-report/generate.ts --no-pdf       # HTML only
 */

import { execFileSync } from 'node:child_process';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function assertDate(label: string, value: string): string {
  if (!ISO_DATE.test(value)) throw new Error(`${label} must be YYYY-MM-DD, got: ${value}`);
  return value;
}
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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

const CATEGORIES: Array<{ key: string; label: string; emoji: string; match: RegExp }> = [
  { key: 'feat', label: 'Features', emoji: '✨', match: /^feat(\(|:|!)/i },
  { key: 'fix', label: 'Bug Fixes', emoji: '🐛', match: /^fix(\(|:|!)/i },
  { key: 'perf', label: 'Performance', emoji: '⚡', match: /^perf(\(|:|!)/i },
  { key: 'refactor', label: 'Refactors', emoji: '♻️', match: /^refactor(\(|:|!)/i },
  { key: 'docs', label: 'Documentation', emoji: '📝', match: /^docs(\(|:|!)/i },
  { key: 'test', label: 'Tests', emoji: '✅', match: /^test(\(|:|!)/i },
  { key: 'chore', label: 'Chores & Infra', emoji: '🔧', match: /^(chore|build|ci|infra)(\(|:|!)/i },
];

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
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
  const week =
    1 +
    Math.round(
      ((target.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );

  const fmt = (x: Date) => x.toISOString().slice(0, 10);
  return {
    since: fmt(monday),
    until: fmt(sunday),
    isoWeek: `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`,
  };
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
  // Append explicit time so PRs merged late on the until-day aren't clipped.
  const search = `is:pr is:merged merged:${since}T00:00:00Z..${until}T23:59:59Z`;
  const json = execFileSync(
    'gh',
    [
      'pr',
      'list',
      '--state',
      'merged',
      '--search',
      search,
      '--limit',
      '200',
      '--json',
      'number,title,author,mergedAt,url,labels,additions,deletions',
    ],
    { encoding: 'utf8' },
  );
  return JSON.parse(json) as Pr[];
}

function fetchCommits(since: string, until: string): Commit[] {
  assertDate('since', since);
  assertDate('until', until);
  const out = execFileSync(
    'git',
    [
      'log',
      '--no-merges',
      `--since=${since}`,
      `--until=${until}T23:59:59`,
      '--pretty=format:%h%x09%an%x09%ad%x09%s',
      '--date=short',
    ],
    { encoding: 'utf8' },
  ).trim();
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
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!),
  );
}

function renderHtml(opts: {
  isoWeek: string;
  since: string;
  until: string;
  prs: Pr[];
  commits: Commit[];
  buckets: Bucket[];
  other: Bucket;
}): string {
  const { isoWeek, since, until, prs, commits, buckets, other } = opts;
  const additions = prs.reduce((s, p) => s + (p.additions || 0), 0);
  const deletions = prs.reduce((s, p) => s + (p.deletions || 0), 0);
  const authors = new Map<string, number>();
  for (const pr of prs) authors.set(pr.author.login, (authors.get(pr.author.login) || 0) + 1);
  const authorRows = [...authors.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(
      ([login, count]) =>
        `<tr><td>${escapeHtml(login)}</td><td class="num">${count}</td></tr>`,
    )
    .join('');

  const renderBucket = (b: Bucket) => `
    <section class="bucket">
      <h2>${b.emoji} ${escapeHtml(b.label)} <span class="count">${b.prs.length}</span></h2>
      <ul>
        ${b.prs
          .map(
            (pr) => `
          <li>
            <a class="pr" href="${pr.url}">#${pr.number}</a>
            <span class="title">${escapeHtml(pr.title)}</span>
            <span class="meta">by ${escapeHtml(pr.author.login)} · +${pr.additions}/-${pr.deletions}</span>
          </li>`,
          )
          .join('')}
      </ul>
    </section>`;

  const allBuckets = [...buckets, ...(other.prs.length ? [other] : [])];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>FibreFlow Weekly Report ${isoWeek}</title>
<style>
  :root {
    --fg: #0f172a;
    --muted: #64748b;
    --accent: #0ea5e9;
    --border: #e2e8f0;
    --bg-soft: #f8fafc;
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: var(--fg);
    margin: 0;
    padding: 40px 56px;
    font-size: 13px;
    line-height: 1.5;
  }
  header {
    border-bottom: 3px solid var(--accent);
    padding-bottom: 16px;
    margin-bottom: 24px;
  }
  header h1 { margin: 0 0 4px 0; font-size: 26px; letter-spacing: -0.02em; }
  header .sub { color: var(--muted); font-size: 13px; }
  .stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin: 20px 0 28px;
  }
  .stat {
    background: var(--bg-soft);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 16px;
  }
  .stat .v { font-size: 24px; font-weight: 700; color: var(--accent); }
  .stat .l { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
  .bucket { margin: 0 0 22px; page-break-inside: avoid; }
  .bucket h2 {
    font-size: 15px;
    border-bottom: 1px solid var(--border);
    padding-bottom: 6px;
    margin: 0 0 10px;
  }
  .bucket .count {
    background: var(--accent);
    color: white;
    border-radius: 999px;
    padding: 2px 10px;
    font-size: 11px;
    margin-left: 6px;
    vertical-align: middle;
  }
  .bucket ul { list-style: none; padding: 0; margin: 0; }
  .bucket li {
    padding: 6px 0;
    border-bottom: 1px dashed var(--border);
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: baseline;
  }
  .bucket li:last-child { border-bottom: none; }
  a.pr { color: var(--accent); font-weight: 600; text-decoration: none; min-width: 56px; }
  .title { flex: 1; }
  .meta { color: var(--muted); font-size: 11px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--border); }
  th { font-size: 11px; text-transform: uppercase; color: var(--muted); }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  footer { margin-top: 32px; color: var(--muted); font-size: 11px; text-align: center; border-top: 1px solid var(--border); padding-top: 12px; }
  @page { size: A4; margin: 18mm 14mm; }
</style>
</head>
<body>
  <header>
    <h1>FibreFlow Weekly Report</h1>
    <div class="sub">${isoWeek} · ${since} → ${until} · generated ${new Date().toISOString().slice(0, 10)}</div>
  </header>

  <div class="stats">
    <div class="stat"><div class="v">${prs.length}</div><div class="l">PRs Merged</div></div>
    <div class="stat"><div class="v">${commits.length}</div><div class="l">Commits</div></div>
    <div class="stat"><div class="v">+${additions.toLocaleString()}</div><div class="l">Additions</div></div>
    <div class="stat"><div class="v">-${deletions.toLocaleString()}</div><div class="l">Deletions</div></div>
  </div>

  ${allBuckets.map(renderBucket).join('')}

  <section class="bucket">
    <h2>👥 Contributors</h2>
    <table>
      <thead><tr><th>Author</th><th class="num">PRs</th></tr></thead>
      <tbody>${authorRows || '<tr><td colspan="2">No PRs merged.</td></tr>'}</tbody>
    </table>
  </section>

  <footer>FibreFlow Next.js · weekly-report skill</footer>
</body>
</html>`;
}

async function htmlToPdf(html: string, pdfPath: string) {
  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.default.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '14mm', right: '14mm' },
    });
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let range: { since: string; until: string; isoWeek: string };
  if (args.since && args.until) {
    range = {
      since: String(args.since),
      until: String(args.until),
      isoWeek: `custom-${args.since}_${args.until}`,
    };
  } else if (args.week) {
    range = parseIsoWeek(String(args.week));
  } else {
    range = isoWeekRange();
  }

  console.log(`[weekly-report] ${range.isoWeek}: ${range.since} → ${range.until}`);
  console.log('[weekly-report] fetching merged PRs from GitHub...');
  const prs = fetchPrs(range.since, range.until);
  console.log(`[weekly-report] ${prs.length} PRs merged`);

  console.log('[weekly-report] fetching git commits...');
  const commits = fetchCommits(range.since, range.until);
  console.log(`[weekly-report] ${commits.length} commits`);

  const { buckets, other } = bucketize(prs);

  const html = renderHtml({ ...range, prs, commits, buckets, other });
  const outDir = join(process.cwd(), 'docs', 'weekly-dev-reports');
  mkdirSync(outDir, { recursive: true });
  const base = join(outDir, range.isoWeek);
  const htmlPath = `${base}.html`;
  const pdfPath = `${base}.pdf`;
  writeFileSync(htmlPath, html);
  console.log(`[weekly-report] wrote ${htmlPath}`);

  if (args['no-pdf']) {
    console.log('[weekly-report] --no-pdf set, skipping PDF render');
    return;
  }
  console.log('[weekly-report] rendering PDF via puppeteer...');
  await htmlToPdf(html, pdfPath);
  console.log(`[weekly-report] wrote ${pdfPath}`);
}

main().catch((err) => {
  console.error('[weekly-report] FAILED:', err);
  process.exit(1);
});
