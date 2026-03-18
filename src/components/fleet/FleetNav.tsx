/**
 * Sage-style horizontal navigation bar for fleet pages.
 * Delegates to ModuleNav with amber accent colors.
 */

import { ModuleNav } from '../layout/ModuleNav';
import { TABS, getActiveTabId } from './fleetNavConfig';

export function FleetNav() {
  return <ModuleNav tabs={TABS} getActiveTabId={getActiveTabId} accentColor="amber" navLabel="Fleet navigation" />;
}
