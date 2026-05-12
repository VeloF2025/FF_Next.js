/**
 * Sage-style horizontal navigation bar for Works QA pages.
 * Delegates to ModuleNav with teal accent colors.
 */

import { ModuleNav } from '@/components/layout/ModuleNav';
import { TABS, getActiveTabId } from './worksQaNavConfig';

export function WorksQANav() {
  return <ModuleNav tabs={TABS} getActiveTabId={getActiveTabId} accentColor="teal" navLabel="Works QA navigation" />;
}
