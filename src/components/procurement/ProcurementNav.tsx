/**
 * Sage-style horizontal navigation bar for procurement pages.
 * Delegates to ModuleNav with blue accent colors.
 */

import { ModuleNav } from '../layout/ModuleNav';
import { TABS, getActiveTabId } from './procurementNavConfig';

export function ProcurementNav() {
  return <ModuleNav tabs={TABS} getActiveTabId={getActiveTabId} accentColor="blue" />;
}
