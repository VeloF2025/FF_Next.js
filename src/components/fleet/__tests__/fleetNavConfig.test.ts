/**
 * Route-resolution tests for the single fleet nav.
 *
 * The fleet module previously rendered two tab rows: the top FleetNav (this
 * config) and a second row from ModulePage/fleetConfig. The second row was the
 * only way to reach /fleet/mileage and /fleet/import, and this config had no
 * matcher for either — so both silently resolved to 'dashboard'. Now that the
 * duplicate row is hidden, these branches are the only thing keeping those two
 * routes reachable and correctly highlighted.
 */
import { describe, expect, it } from 'vitest';
import { TABS, getActiveTabId } from '../fleetNavConfig';
import type { Tab } from '../../accounting/accountingNavConfig';

/** Every href reachable from the tab bar, flattened across dropdowns. */
function allHrefs(tabs: Tab[]): string[] {
  const out: string[] = [];
  for (const tab of tabs) {
    if (tab.href) out.push(tab.href);
    for (const item of tab.topItems ?? []) out.push(item.href);
    for (const section of tab.items ?? []) {
      for (const item of section.items) out.push(item.href);
    }
  }
  return out;
}

describe('getActiveTabId', () => {
  it("resolves /fleet exactly to dashboard, not as a prefix of every /fleet/*", () => {
    expect(getActiveTabId('/fleet', {})).toBe('dashboard');
  });

  it.each([
    ['/fleet/map', 'map'],
    ['/fleet/analytics', 'analytics'],
    ['/fleet/vehicles', 'vehicles'],
    ['/fleet/portal', 'vehicles'],
    ['/fleet/drivers', 'operations'],
    ['/fleet/assignments', 'operations'],
    ['/fleet/fuel', 'operations'],
    ['/fleet/maintenance', 'operations'],
    ['/fleet/check-in', 'check-ins'],
    ['/fleet/check-in/history', 'check-ins'],
    ['/fleet/investigation', 'investigation'],
    ['/fleet/locations', 'investigation'],
  ])('resolves %s to %s', (pathname, expected) => {
    expect(getActiveTabId(pathname, {})).toBe(expected);
  });

  // The two routes the hidden second row used to own. Before this config
  // gained matchers for them, both fell through to 'dashboard' — the nav
  // highlighted Dashboard while the user was on Mileage or Import.
  it('resolves /fleet/mileage to operations, not dashboard', () => {
    expect(getActiveTabId('/fleet/mileage', {})).toBe('operations');
  });

  it('resolves /fleet/import to vehicles, not dashboard', () => {
    expect(getActiveTabId('/fleet/import', {})).toBe('vehicles');
  });

  // Same class again: a page reachable from the nav but with no matcher highlights Dashboard
  // while the user is standing on it.
  it('resolves /fleet/daily-stats to vehicles, not dashboard', () => {
    expect(getActiveTabId('/fleet/daily-stats', {})).toBe('vehicles');
  });

  it('resolves a vehicle stats sub-page to vehicles', () => {
    expect(getActiveTabId('/fleet/vehicles/abc-123/stats', {})).toBe('vehicles');
  });

  it('resolves nested detail routes to their parent tab', () => {
    expect(getActiveTabId('/fleet/vehicles/abc-123', {})).toBe('vehicles');
    expect(getActiveTabId('/fleet/vehicles/abc-123/check-in-history', {})).toBe('vehicles');
    expect(getActiveTabId('/fleet/investigation/job-1', {})).toBe('investigation');
    expect(getActiveTabId('/fleet/drivers/staff-1', {})).toBe('operations');
  });

  // Both parking routes live under Operations. The approval queue is a nested
  // route, so it is the case most likely to fall through to the catch-all —
  // exactly how mileage and import were swallowed before.
  it('resolves the parking compliance dashboard to operations', () => {
    expect(getActiveTabId('/fleet/parking', {})).toBe('operations');
  });

  it('resolves the parking approval queue to operations', () => {
    expect(getActiveTabId('/fleet/parking/requests', {})).toBe('operations');
  });

  it('resolves the incident review queue to operations', () => {
    expect(getActiveTabId('/fleet/incidents', {})).toBe('operations');
  });

  it('falls back to dashboard for an unknown fleet route', () => {
    expect(getActiveTabId('/fleet/not-a-real-page', {})).toBe('dashboard');
  });
});

describe('TABS', () => {
  it('exposes mileage and import, which only the removed second row used to reach', () => {
    const hrefs = allHrefs(TABS);
    expect(hrefs).toContain('/fleet/mileage');
    expect(hrefs).toContain('/fleet/import');
  });

  it('exposes the map, parking, requests, and locations routes', () => {
    const hrefs = allHrefs(TABS);
    expect(hrefs).toEqual(expect.arrayContaining(['/fleet/map', '/fleet/parking', '/fleet/parking/requests', '/fleet/locations']));
  });

  it('exposes the incident review queue under Operations, not a new Dashboard tab', () => {
    const operations = TABS.find((tab) => tab.id === 'operations');
    const hrefs = operations ? allHrefs([operations]) : [];
    expect(hrefs).toContain('/fleet/incidents');
    const dashboard = TABS.find((tab) => tab.id === 'dashboard');
    expect(dashboard?.href).toBe('/fleet');
  });

  it('exposes the fleet-wide daily stats table under Vehicles', () => {
    // The page is otherwise reachable only by typing the URL: nothing links to it from the
    // per-vehicle page, which goes the other way.
    const vehicles = TABS.find((tab) => tab.id === 'vehicles');
    const hrefs = vehicles ? allHrefs([vehicles]) : [];
    expect(hrefs).toContain('/fleet/daily-stats');
    expect(vehicles?.items?.flatMap((s) => s.items).find((i) => i.href === '/fleet/daily-stats')?.label)
      .toBe('Daily stats');
  });

  it('exposes Assignments under Operations', () => {
    const operations = TABS.find((tab) => tab.id === 'operations');
    const hrefs = operations ? allHrefs([operations]) : [];
    expect(hrefs).toContain('/fleet/assignments');
  });

  it('resolves every advertised href to the tab that advertises it', () => {
    // Guards the class of bug this change fixed: a link present in the bar but
    // with no matcher, so clicking it highlights the wrong tab.
    for (const tab of TABS) {
      const hrefs: string[] = [];
      if (tab.href) hrefs.push(tab.href);
      for (const item of tab.topItems ?? []) hrefs.push(item.href);
      for (const section of tab.items ?? []) {
        for (const item of section.items) hrefs.push(item.href);
      }
      for (const href of hrefs) {
        expect(getActiveTabId(href, {}), `${href} should activate '${tab.id}'`).toBe(tab.id);
      }
    }
  });
});
