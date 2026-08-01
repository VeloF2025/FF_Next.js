/**
 * Behavioural cover for the dual-URL nav-state problem.
 *
 * `tests/pages/healthSafetyCanonicalRoute.test.ts` pins the ROUTING (which URL
 * is canonical) by scanning source text. That is deliberately a narrow pin and
 * cannot see nav STATE: the sidebar highlighted "Projects" and the module tab
 * strip showed no active tab while rendering the H&S dashboard, and every
 * assertion there stayed green. These tests exercise the resolvers directly.
 */

import { describe, it, expect } from 'vitest';
import { canonicalizePath } from '../legacyPaths';
import {
  getModuleConfigByPath,
  getActiveTabByPath,
  getActiveSubTabByPath,
  registerModuleConfig,
} from '../config/registry';
import { healthSafetyConfig } from '../config/modules/health-safety.config';
import { projectsConfig } from '../config/modules/projects.config';

registerModuleConfig(projectsConfig);
registerModuleConfig(healthSafetyConfig);

const LEGACY = '/projects/health-safety';
const CANONICAL = '/health-safety';

describe('canonicalizePath', () => {
  it('rewrites the legacy H&S root', () => {
    expect(canonicalizePath(LEGACY)).toBe(CANONICAL);
  });

  it('preserves the sub-path', () => {
    expect(canonicalizePath(`${LEGACY}/training`)).toBe(`${CANONICAL}/training`);
    expect(canonicalizePath(`${LEGACY}/capa/abc-9`)).toBe(`${CANONICAL}/capa/abc-9`);
  });

  it('leaves unrelated paths alone', () => {
    for (const p of ['/projects', '/projects/list', '/health-safety', '/field-ops']) {
      expect(canonicalizePath(p)).toBe(p);
    }
  });

  it('canonicalises through a query string or hash', () => {
    // usePathname() never carries these, but getModuleConfigByPath /
    // getActiveTabByPath are exported and a caller passing asPath would
    // otherwise silently get the un-canonicalised behaviour.
    expect(canonicalizePath(`${LEGACY}?tab=incidents`)).toBe(`${CANONICAL}?tab=incidents`);
    expect(canonicalizePath(`${LEGACY}/training?filter=expired`)).toBe(
      `${CANONICAL}/training?filter=expired`
    );
    expect(canonicalizePath(`${LEGACY}#section`)).toBe(`${CANONICAL}#section`);
  });

  it('does not rewrite a path that merely starts with the same characters', () => {
    // `/projects/health-safety-archive` is a different route, not a sub-path.
    expect(canonicalizePath('/projects/health-safety-archive')).toBe(
      '/projects/health-safety-archive'
    );
    expect(canonicalizePath('/projects/health-safetyX')).toBe('/projects/health-safetyX');
  });

  it('handles an empty path without throwing', () => {
    expect(canonicalizePath('')).toBe('');
  });
});

describe('module resolution at the legacy H&S path', () => {
  it('resolves to Health & Safety, not Projects', () => {
    // Without canonicalisation this matched projectsConfig.basePath by prefix.
    expect(getModuleConfigByPath(LEGACY)?.moduleId).toBe('health-safety');
    expect(getModuleConfigByPath(`${LEGACY}/training`)?.moduleId).toBe('health-safety');
  });

  it('still resolves real Projects paths to Projects', () => {
    expect(getModuleConfigByPath('/projects')?.moduleId).toBe('projects');
  });

  it('activates a tab rather than leaving the strip blank', () => {
    expect(getActiveTabByPath(healthSafetyConfig, LEGACY)).toBeDefined();
    expect(getActiveTabByPath(healthSafetyConfig, `${LEGACY}/training`)?.path).toBe(
      `${CANONICAL}/training`
    );
  });

  it('resolves the canonical path identically — the two URLs must not diverge', () => {
    expect(getActiveTabByPath(healthSafetyConfig, LEGACY)).toEqual(
      getActiveTabByPath(healthSafetyConfig, CANONICAL)
    );
    expect(getModuleConfigByPath(LEGACY)).toEqual(getModuleConfigByPath(CANONICAL));
  });
});

describe('sub-tab resolution at the legacy H&S path', () => {
  // healthSafetyConfig declares no subTabs today, so this uses a synthetic tab.
  // The point is that the resolver must not regress the moment one is added.
  const tab = {
    id: 'incidents',
    label: 'Incidents',
    path: `${CANONICAL}/incidents`,
    subTabs: [
      { id: 'open', label: 'Open', path: `${CANONICAL}/incidents` },
      { id: 'closed', label: 'Closed', path: `${CANONICAL}/incidents/closed` },
    ],
  } as Parameters<typeof getActiveSubTabByPath>[0];

  it('resolves a sub-tab from the legacy path', () => {
    expect(getActiveSubTabByPath(tab, `${LEGACY}/incidents/closed`)?.id).toBe('closed');
  });

  it('resolves the legacy and canonical paths identically', () => {
    expect(getActiveSubTabByPath(tab, `${LEGACY}/incidents/closed`)).toEqual(
      getActiveSubTabByPath(tab, `${CANONICAL}/incidents/closed`)
    );
  });
});
