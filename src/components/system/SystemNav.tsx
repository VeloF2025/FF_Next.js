/**
 * Horizontal navigation bar for system and settings pages.
 * Delegates to ModuleNav with slate accent colors.
 */

import { ModuleNav } from '../layout/ModuleNav';
import { TABS, getActiveTabId } from './systemNavConfig';

export function SystemNav() {
  return <ModuleNav tabs={TABS} getActiveTabId={getActiveTabId} accentColor="slate" />;
}
