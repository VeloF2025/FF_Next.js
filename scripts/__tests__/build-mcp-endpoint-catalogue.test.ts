import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  DENIED_GROUPS,
  buildCatalogue,
  extractDescription,
  extractMethods,
  groupOf,
  hasDefaultExport,
  isDeniedGroup,
  toAppRoute,
  toPagesRoute,
  type CatalogueResult,
} from '../build-mcp-endpoint-catalogue';

const REPO_ROOT = process.cwd();

describe('MCP endpoint catalogue', () => {
  let result: CatalogueResult;

  beforeAll(() => {
    // Guard the assumption the rest of the suite rests on: vitest runs from the repo root.
    expect(existsSync(join(REPO_ROOT, 'pages', 'api'))).toBe(true);
    result = buildCatalogue(REPO_ROOT);
  });

  describe('denylist', () => {
    it('emits no route from a denied group', () => {
      const leaked = result.routes.filter((r) => DENIED_GROUPS.has(r.group));
      expect(leaked.map((r) => r.path)).toEqual([]);
    });

    it('emits no route from a hyphenated sibling of a denied group', () => {
      // Routes here are flattened, so one area spreads across sibling group names.
      // Exact matching left /api/staff-documents/* catalogued on the first real run.
      //
      // Asserted against literal prefixes, NOT against isDeniedGroup — reusing the
      // function under test here makes the assertion vacuous the moment that function
      // regresses, which is precisely when it needs to fire.
      // `/api/my` was removed from this list when the `my` group was opened: those
      // routes authenticate via the separate ff_my_session cookie, which an MCP bearer
      // token cannot present, so they are unreachable rather than merely scoped.
      //
      // meetings / action-items / procurement are listed because they were opened and
      // then re-denied: they are withAuth-only, so authentication bounds them and RBAC
      // does not. Leaving them out let the leak assertion pass while saying nothing
      // about the three groups whose exposure prompted the re-narrow.
      const WITHHELD_PREFIXES = [
        '/api/accounting',
        '/api/staff',
        '/api/meetings',
        '/api/action-items',
        '/api/procurement',
      ];
      const leaked = result.routes.filter((r) => WITHHELD_PREFIXES.some((p) => r.path.startsWith(p)));
      expect(leaked.map((r) => r.path)).toEqual([]);
    });

    it('every denied group actually matched routes', () => {
      // A typo'd entry withholds nothing and would otherwise pass silently.
      for (const group of DENIED_GROUPS) {
        expect(result.deniedHits[group], `denied group '${group}' matched no route`).toBeGreaterThan(0);
      }
    });
  });

  describe('catalogue shape', () => {
    it('is not silently truncated', () => {
      // A short catalogue makes Claude conclude endpoints don't exist, which is worse
      // than no catalogue at all. Bound it on both sides.
      expect(result.routes.length).toBeGreaterThan(100);
      expect(result.routes.length).toBeLessThanOrEqual(result.scanned);
    });

    it('lists only methods callable with a read-only credential', () => {
      const bad = result.routes.filter((r) => r.methods.some((m) => m !== 'GET' && m !== 'HEAD'));
      expect(bad.map((r) => `${r.path} ${r.methods.join(',')}`)).toEqual([]);
    });

    it('gives every route a path, at least one method, and a group', () => {
      for (const route of result.routes) {
        expect(route.path.startsWith('/api/')).toBe(true);
        expect(route.methods.length).toBeGreaterThan(0);
        expect(route.group).not.toBe('');
      }
    });

    it('has no duplicate paths', () => {
      const paths = result.routes.map((r) => r.path);
      expect(paths.length).toBe(new Set(paths).size);
    });
  });

  describe('committed endpoints.json', () => {
    it('parses and carries a usable route set', () => {
      const file = join(REPO_ROOT, 'apps', 'ff_mcp', 'endpoints.json');
      expect(existsSync(file)).toBe(true);
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      expect(Array.isArray(parsed.routes)).toBe(true);
      expect(parsed.routes.length).toBeGreaterThan(100);
      expect(parsed.routes.some((r: { group: string }) => DENIED_GROUPS.has(r.group))).toBe(false);
    });
  });
});

describe('route path derivation', () => {
  it('maps Pages Router files to URL paths', () => {
    expect(toPagesRoute('projects/index.ts')).toBe('/api/projects');
    expect(toPagesRoute('projects/[projectId].ts')).toBe('/api/projects/:projectId');
    expect(toPagesRoute('contractors-list.ts')).toBe('/api/contractors-list');
    expect(toPagesRoute('sow/drops/stats.ts')).toBe('/api/sow/drops/stats');
    expect(toPagesRoute('uploads/[...path].ts')).toBe('/api/uploads/:path*');
    expect(toPagesRoute('foo/[[...slug]].ts')).toBe('/api/foo/:slug*');
  });

  it('maps App Router route.ts files to URL paths', () => {
    expect(toAppRoute('noc/tickets/route.ts')).toBe('/api/noc/tickets');
    expect(toAppRoute('assets/[assetId]/route.ts')).toBe('/api/assets/:assetId');
  });

  it('derives the group from the first path segment', () => {
    expect(groupOf('/api/projects/:projectId')).toBe('projects');
    expect(groupOf('/api/staff-documents-download')).toBe('staff-documents-download');
  });
});

describe('method extraction', () => {
  it('reads the === comparison idiom', () => {
    expect(extractMethods(`if (req.method === 'GET') {}`, false)).toEqual(['GET']);
  });

  it('reads the !== guard idiom', () => {
    // The dominant idiom in this codebase; missing it would drop most read routes.
    expect(extractMethods(`if (req.method !== 'GET') return res.status(405).end();`, false)).toEqual(['GET']);
  });

  it('reads a multi-verb guard', () => {
    const src = `if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();`;
    expect(extractMethods(src, false).sort()).toEqual(['GET', 'POST']);
  });

  it('reads switch/case dispatch', () => {
    expect(extractMethods(`switch (req.method) { case 'GET': break; case 'DELETE': break; }`, false).sort()).toEqual([
      'DELETE',
      'GET',
    ]);
  });

  it('reads App Router named exports', () => {
    expect(extractMethods('export async function GET() {}\nexport function POST() {}', true).sort()).toEqual([
      'GET',
      'POST',
    ]);
  });

  it('returns nothing when no method markers are present', () => {
    expect(extractMethods('export default handler;', false)).toEqual([]);
  });

  it('ignores a methods:[...] array literal — it is not an HTTP dispatch signal', () => {
    // Real case: Socket.IO CORS config in pages/api/ws.ts:49. Inferring verbs from an
    // arbitrary object key is guessing, and a wrong GET sends an agent to a 405.
    const socketIoCors = `const io = new Server({ cors: { origin: '*', methods: ['GET', 'POST'] } });`;
    expect(extractMethods(socketIoCors, false)).toEqual([]);
  });
});

describe('description extraction', () => {
  it('takes the first prose line of the leading JSDoc block', () => {
    expect(extractDescription('/**\n * Projects API Route\n * @param req\n */\nexport default h;')).toBe(
      'Projects API Route',
    );
  });

  it('skips tag-only lines', () => {
    expect(extractDescription('/**\n * @deprecated\n * Real summary\n */')).toBe('Real summary');
  });

  it('omits rather than inventing when there is no JSDoc', () => {
    expect(extractDescription('export default handler;')).toBeUndefined();
  });

  it('truncates past 120 characters', () => {
    const long = `/**\n * ${'x'.repeat(200)}\n */`;
    expect(extractDescription(long)).toHaveLength(120);
  });
});

describe('denied group matching', () => {
  it('matches the group itself', () => {
    expect(isDeniedGroup('staff')).toBe('staff');
    expect(isDeniedGroup('accounting')).toBe('accounting');
  });

  it('matches hyphenated siblings, attributing them to the entry that caught them', () => {
    expect(isDeniedGroup('staff-documents')).toBe('staff');
    expect(isDeniedGroup('staff-documents-download')).toBe('staff');
  });

  it('does not over-match on a shared prefix without the hyphen', () => {
    // 'stafford' must not be withheld just because it starts with 'staff'.
    expect(isDeniedGroup('stafford')).toBeUndefined();
    expect(isDeniedGroup('myriad')).toBeUndefined();
  });

  it('leaves unrelated groups alone', () => {
    expect(isDeniedGroup('projects')).toBeUndefined();
    // Reviewed and deliberately allowed: admin-gated, so only an admin's connector reaches it.
    expect(isDeniedGroup('database')).toBeUndefined();
  });

  it('withholds both MCP transport proxies', () => {
    // Transport, not data: they forward any method/body to an internal service and are
    // unauthenticated by design. An agent has no reason to call them.
    expect(isDeniedGroup('cortex-remote-mcp')).toBe('cortex-remote-mcp');
    expect(isDeniedGroup('ff-remote-mcp')).toBe('ff-remote-mcp');
  });
});

describe('handler detection', () => {
  it('accepts a default export', () => {
    expect(hasDefaultExport('export default withAuth(handler);')).toBe(true);
  });

  it('rejects colocated helper modules', () => {
    expect(hasDefaultExport('export async function querySnagsByReport() {}')).toBe(false);
  });
});
