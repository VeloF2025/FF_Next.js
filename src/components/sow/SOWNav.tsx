/**
 * Horizontal navigation bar for SOW (Scope of Work) pages.
 * Delegates to the generic ModuleNav with teal accent colors.
 */

import { ModuleNav } from '../layout/ModuleNav';
import { TABS, getActiveTabId } from './sowNavConfig';

// 🟢 WORKING: Thin wrapper — all rendering logic lives in ModuleNav.
export function SOWNav() {
  return <ModuleNav tabs={TABS} getActiveTabId={getActiveTabId} accentColor="teal" navLabel="SOW navigation" />;
}
