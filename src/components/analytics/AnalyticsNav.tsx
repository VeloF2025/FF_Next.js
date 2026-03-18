/**
 * Sage-style horizontal navigation bar for Analytics & Reporting pages.
 * Delegates to ModuleNav with violet accent colors.
 */

import { ModuleNav } from '../layout/ModuleNav';
import { TABS, getActiveTabId } from './analyticsNavConfig';

export function AnalyticsNav() {
  return <ModuleNav tabs={TABS} getActiveTabId={getActiveTabId} accentColor="violet" navLabel="Analytics navigation" />;
}
