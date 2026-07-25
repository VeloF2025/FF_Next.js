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
export const DENIED_GROUPS = new Set(['accounting', 'staff', 'my']);

/**
 * Surfaced by the first full run and left OUT of DENIED_GROUPS pending Hein's call —
 * the flattened-route convention means these are NOT covered by the groups above:
 *   `staff-documents`, `staff-documents-download`  (HR documents; `staff` does not match)
 *   `database`                                     (/api/database/query runs SQL; admin-gated)
 * Recorded here rather than added silently, because widening the guard is a judgement
 * call about what the connector is for, not a bug fix.
 */

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
 * 405`) is the dominant idiom in this codebase — 462 files use it against 210 for
 * `===`. Matching only `===`, as a first reading of the plan suggested, would drop
 * two-thirds of the read surface and leave Claude concluding those routes don't exist.
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
  for (const m of source.matchAll(/\bmethods\s*:\s*\[([^\]]*)\]/g)) {
    for (const q of m[1]!.matchAll(/['"](GET|HEAD|POST|PUT|PATCH|DELETE)['"]/g)) found.add(q[1]!);
  }
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
    if (DENIED_GROUPS.has(group)) {
      deniedHits[group] = (deniedHits[group] ?? 0) + 1;
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
      // App Router shadows the Pages equivalent at runtime; keep one entry, union methods.
      existing.methods = [...new Set([...existing.methods, ...readable])].sort();
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
