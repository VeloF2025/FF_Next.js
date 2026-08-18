#!/usr/bin/env tsx
/**
 * Builds apps/ff_mcp/endpoints.json — the read-route catalogue the FibreFlow remote
 * MCP connector uses for discovery.
 *
 * The connector exposes a passthrough GET tool over ~1300 API routes. Without a
 * catalogue Claude has to guess paths, so discovery is the whole point of this file.
 *
 * Usage: npm run mcp:catalogue
 *
 * Deliberately NOT wired into `next build`: it writes into apps/, and a generated
 * file that changes on every build churns the repo.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

/**
 * Route groups withheld from the MCP catalogue.
 *
 * This is a blast-radius guard, NOT a security boundary: anyone holding the token can
 * still curl these paths directly, and RBAC + the read-only gate remain the real
 * controls. Its job is to stop an agent wandering into payroll while answering a
 * question about drops.
 */
export const DENIED_GROUPS = new Set([
  'accounting',
  'staff',
  'my',
  // The MCP edge proxies are TRANSPORT, not data. They forward any method and body to an
  // internal service on 127.0.0.1 and are unauthenticated by design (the upstream issues
  // its own OAuth challenge). An agent has no reason to call them, and cataloguing them
  // invites exactly the wandering this list exists to prevent.
  'cortex-remote-mcp',
  'ff-remote-mcp',
  // Added 2026-08-18 after an audit of the COMBINED tool surface. Each of these groups
  // holds a route that reads the same rows as a sanctioned reporting tool, under a
  // weaker gate — so an agent that wandered into them got around the narrowing the tool
  // advertises. This list is blast-radius, not a boundary (see above): the routes below
  // still need their own RBAC, tracked separately. What it does buy is that a model
  // answering a question about drops cannot stumble into them.
  //   meetings    — /api/meetings is withAuth-only and returns full summary JSONB,
  //                 participants and user_notes; find_meetings requires people.meetings
  //                 and deliberately returns an index with no summary text.
  //   procurement — /api/procurement/purchase-orders and boq-spend-summary are
  //                 withAuth-only and expose per-PO totals and BOQ spend, which
  //                 get_procurement_summary withholds from callers lacking
  //                 `procurement` view.
  //
  // `field` is deliberately NOT here. /api/field/attendance is the problem route, but
  // isDeniedGroup below matches hyphenated siblings, so 'field' would also remove
  // `field-stock` — the entire warehouse module — plus nine unrelated /api/field/*
  // routes. It is denied by PATH instead, in DENIED_PATHS in apps/ff_mcp/tools.py.
  // This list and that one must stay in step; test_catalogue.py checks the catalogue
  // against the runtime guard, and test_guards.py pins field-stock as reachable.
  'meetings',
  'procurement',
  // `action-items` rows carry meeting content — descriptions extracted verbatim from
  // transcripts. FibreFlow gates meetings on ATTENDANCE (see
  // pages/api/meetings/[id]/transcript.ts), but /api/action-items is withAuth-only with
  // no participant filter and returns up to 500 full rows including description and
  // meeting_id. Leaving the group catalogued would let an agent read through
  // fibreflow_get exactly what /api/reporting/action-items withholds, making that
  // route's attendance scope cosmetic. The scoped reporting route lives in the
  // `reporting` group and is unaffected.
  'action-items',
]);

/**
 * Matches a denied group OR any hyphenated sibling of one: `staff` also withholds
 * `staff-documents` and `staff-documents-download`.
 *
 * Exact matching is not enough here. Routes in this repo are flattened, so one logical
 * area spreads across sibling group names (`contractors`, `contractors-documents`,
 * `contractors-documents-export`, …). The first full run caught HR documents sitting in
 * the catalogue because `staff` did not match `staff-documents` — and a guard that has
 * to be re-audited every time someone adds a flat route is a guard that rots.
 *
 * `/api/database/query` was reviewed and deliberately left catalogued: it is
 * withRole('admin') gated, so only an admin's connector reaches it at all.
 */
/**
 * Individual routes withheld where denying the whole GROUP would be too broad.
 *
 * MUST mirror DENIED_PATHS in apps/ff_mcp/tools.py. The runtime guard refuses these, so
 * cataloguing them would advertise an endpoint that always fails — and worse, it would
 * leave the two mechanisms disagreeing about what is reachable, which is how a denylist
 * quietly stops meaning anything.
 *
 * `/api/field/attendance` cannot be denied as a group: `field` would also match
 * `field-stock` (the warehouse module) and nine unrelated `/api/field/*` routes.
 */
export const DENIED_PATHS = ['/api/field/attendance'];

/** Exact match, or a prefix on a path-segment boundary. */
export function isDeniedPath(routePath: string): string | undefined {
  for (const denied of DENIED_PATHS) {
    if (routePath === denied || routePath.startsWith(`${denied}/`)) return denied;
  }
  return undefined;
}

export function isDeniedGroup(group: string): string | undefined {
  for (const denied of DENIED_GROUPS) {
    if (group === denied || group.startsWith(`${denied}-`)) return denied;
  }
  return undefined;
}

/** Only these are callable with an MCP credential; anything else is context noise. */
const CATALOGUED_METHODS = new Set(['GET', 'HEAD']);

const SKIP_DIRS = new Set(['__tests__', 'cron', 'node_modules']);

export interface CatalogueRoute {
  path: string;
  methods: string[];
  group: string;
  description?: string;
}

export interface CatalogueResult {
  routes: CatalogueRoute[];
  /** How many routes each denied group withheld. A zero here means a typo'd entry. */
  deniedHits: Record<string, number>;
  /** Handlers with no method guard: Next.js runs those for every verb, so GET is real. */
  assumedGet: string[];
  /** Colocated helper modules under pages/api that export no handler — not routes. */
  nonHandlers: number;
  /** Total route files walked, before any filtering. */
  scanned: number;
}

function walk(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    // `_app`, `_middleware`, `__tests__` — never routable.
    if (entry.name.startsWith('_')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      // Test files live under pages/api in a couple of places; they are not routes.
      if (/\.(test|spec|d)\.ts$/.test(entry.name)) continue;
      out.push(full);
    }
  }
  return out;
}

/** `[projectId]` → `:projectId`, `[...path]` → `:path*`, `[[...path]]` → `:path*`. */
function segmentToParam(segment: string): string {
  const catchAll = segment.match(/^\[{1,2}\.\.\.(.+?)\]{1,2}$/);
  if (catchAll) return `:${catchAll[1]}*`;
  const dynamic = segment.match(/^\[(.+?)\]$/);
  if (dynamic) return `:${dynamic[1]}`;
  return segment;
}

/** `projects/[projectId].ts` → `/api/projects/:projectId` (Pages Router). */
export function toPagesRoute(relPath: string): string {
  const segments = relPath.replace(/\.ts$/, '').split('/');
  if (segments[segments.length - 1] === 'index') segments.pop();
  return `/api/${segments.map(segmentToParam).join('/')}`.replace(/\/$/, '') || '/api';
}

/** `noc/tickets/route.ts` → `/api/noc/tickets` (App Router). */
export function toAppRoute(relPath: string): string {
  const segments = relPath.split('/');
  segments.pop(); // drop `route.ts`
  return `/api/${segments.map(segmentToParam).join('/')}`.replace(/\/$/, '') || '/api';
}

/**
 * Which HTTP methods a handler answers.
 *
 * Both comparison directions count. The `!==` guard (`if (req.method !== 'GET') return
 * 405`) is by a wide margin the dominant idiom here — roughly 812 files versus 237 for
 * `===` at time of writing. Matching only `===` would drop most of the read surface and
 * leave the agent concluding those routes do not exist.
 *
 * Treat the figures as indicative, not as a fixture: they move with the codebase, and an
 * earlier revision of this comment quoted counts that no longer reproduced.
 */
export function extractMethods(source: string, isAppRouter: boolean): string[] {
  const found = new Set<string>();

  if (isAppRouter) {
    for (const m of source.matchAll(/export\s+(?:async\s+)?function\s+(GET|HEAD|POST|PUT|PATCH|DELETE)\b/g)) {
      found.add(m[1]!);
    }
    for (const m of source.matchAll(/export\s+const\s+(GET|HEAD|POST|PUT|PATCH|DELETE)\s*[:=]/g)) {
      found.add(m[1]!);
    }
    return [...found];
  }

  for (const m of source.matchAll(/\bmethod\s*(?:===|!==)\s*['"](GET|HEAD|POST|PUT|PATCH|DELETE)['"]/g)) {
    found.add(m[1]!);
  }
  for (const m of source.matchAll(/\bcase\s+['"](GET|HEAD|POST|PUT|PATCH|DELETE)['"]\s*:/g)) {
    found.add(m[1]!);
  }
  // A `methods: [...]` array literal is deliberately NOT matched. It is not scoped to an
  // HTTP dispatch context, so it also hits things like Socket.IO's CORS config in
  // pages/api/ws.ts:49 (`methods: ['GET', 'POST']`) — a route whose real verb is decided by
  // its own `req.method !== 'GET'` guard. Inferring verbs from an arbitrary object key is
  // guessing, and a wrong GET sends an agent to a 405.
  return [...found];
}

/** First prose line of the leading JSDoc block, capped at 120 chars. Absent → undefined. */
export function extractDescription(source: string): string | undefined {
  const block = source.match(/^\s*\/\*\*([\s\S]*?)\*\//);
  if (!block) return undefined;
  for (const raw of block[1]!.split('\n')) {
    const line = raw.replace(/^\s*\*\s?/, '').trim();
    if (!line || line.startsWith('@')) continue;
    return line.length > 120 ? `${line.slice(0, 117)}...` : line;
  }
  return undefined;
}

/** Pages routes need a default export; without one the file is a colocated helper. */
export function hasDefaultExport(source: string): boolean {
  return /^\s*export\s+default\b/m.test(source);
}

/** `/api/projects/:projectId` → `projects`. */
export function groupOf(routePath: string): string {
  return routePath.replace(/^\/api\/?/, '').split('/')[0] || 'root';
}

export function buildCatalogue(repoRoot: string): CatalogueResult {
  const sources: { file: string; route: string; isAppRouter: boolean }[] = [];

  const pagesApi = join(repoRoot, 'pages', 'api');
  for (const file of walk(pagesApi)) {
    sources.push({ file, route: toPagesRoute(relative(pagesApi, file)), isAppRouter: false });
  }

  const appApi = join(repoRoot, 'app', 'api');
  for (const file of walk(appApi)) {
    if (!file.endsWith('/route.ts')) continue;
    sources.push({ file, route: toAppRoute(relative(appApi, file)), isAppRouter: true });
  }

  const deniedHits: Record<string, number> = {};
  for (const group of DENIED_GROUPS) deniedHits[group] = 0;

  const byPath = new Map<string, CatalogueRoute>();
  const assumedGet: string[] = [];
  let nonHandlers = 0;

  for (const { file, route, isAppRouter } of sources) {
    const group = groupOf(route);
    const denied = isDeniedGroup(group) ?? isDeniedPath(route);
    if (denied) {
      deniedHits[denied] = (deniedHits[denied] ?? 0) + 1;
      continue;
    }

    const source = readFileSync(file, 'utf8');
    let methods = extractMethods(source, isAppRouter);

    if (!isAppRouter && !hasDefaultExport(source)) {
      nonHandlers += 1;
      continue;
    }
    if (methods.length === 0) {
      if (isAppRouter) {
        nonHandlers += 1;
        continue;
      }
      // A Pages handler with no method guard runs for every verb, GET included.
      // That is a fact about Next.js routing, not a guess — record it visibly anyway.
      assumedGet.push(relative(repoRoot, file));
      methods = ['GET'];
    }

    const readable = methods.filter((m) => CATALOGUED_METHODS.has(m)).sort();
    if (readable.length === 0) continue;

    const description = extractDescription(source);
    const existing = byPath.get(route);
    if (existing) {
      // Path collision between the two routers. The PAGES entry wins at runtime — verified
      // against Next.js 14's matcher registration order, and consistent with a case where
      // an App page was silently shadowed by a Pages dynamic route and never built.
      //
      // Do NOT union the methods. The losing side's handler never runs, so advertising its
      // verbs would put a method in the catalogue that 405s in practice — a false positive,
      // which for a discovery tool is worse than an omission. Pages routes are walked
      // first, so the existing entry is already the winner: keep it untouched.
      //
      // No such collision exists in this repo today (0 overlapping paths across 125 app
      // and ~1143 pages routes); this is here so the first one cannot surprise us.
      if (!existing.description && description) existing.description = description;
      continue;
    }
    byPath.set(route, { path: route, methods: readable, group, ...(description ? { description } : {}) });
  }

  const routes = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  return { routes, deniedHits, assumedGet, nonHandlers, scanned: sources.length };
}

function main(): void {
  const repoRoot = resolve(__dirname, '..');
  const { routes, deniedHits, assumedGet, nonHandlers, scanned } = buildCatalogue(repoRoot);

  const groups = new Set(routes.map((r) => r.group));
  const write = (line: string) => process.stdout.write(`${line}\n`);

  write(`Scanned ${scanned} route files (${nonHandlers} colocated helpers, not routes)`);
  write(`Catalogued ${routes.length} read routes across ${groups.size} groups`);
  write(`Withheld by denylist: ${Object.entries(deniedHits).map(([g, n]) => `${g}=${n}`).join(', ')}`);
  if (assumedGet.length) {
    write(`Unguarded handlers catalogued as GET: ${assumedGet.length}`);
    for (const f of assumedGet) write(`  - ${f}`);
  }

  // A silently short catalogue is worse than none: Claude reads "absent" as
  // "doesn't exist" and stops looking. Fail loudly instead of shipping it.
  if (routes.length < 100 || routes.length > scanned) {
    process.stderr.write(
      `FAIL: catalogue has ${routes.length} routes, expected 100..${scanned}. The walker is wrong — fix it, do not ship this.\n`,
    );
    process.exit(1);
  }
  for (const [group, hits] of Object.entries(deniedHits)) {
    if (hits === 0) {
      process.stderr.write(`FAIL: denied group '${group}' matched no route — stale or typo'd denylist entry.\n`);
      process.exit(1);
    }
  }

  const outDir = join(repoRoot, 'apps', 'ff_mcp');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, 'endpoints.json');
  writeFileSync(outFile, `${JSON.stringify({ generatedAt: new Date().toISOString(), routes }, null, 2)}\n`);
  write(`Wrote ${relative(repoRoot, outFile)}`);
  process.exit(0);
}

// Run only as a CLI; the pure helpers above are imported by the test.
if (process.argv[1]?.includes('build-mcp-endpoint-catalogue')) {
  main();
}
