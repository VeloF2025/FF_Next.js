import { ModuleNav } from '@/components/layout/ModuleNav';
import type { Tab } from '@/components/accounting/accountingNavConfig';

const TABS: Tab[] = [
  { id: 'fibreflow', label: 'FibreFlow', href: '/connections/fibreflow' },
  { id: 'cortex', label: 'Cortex', href: '/connections/cortex' },
];

function getActiveTabId(pathname: string): string {
  return pathname.startsWith('/connections/cortex')
    ? 'cortex'
    : 'fibreflow';
}

export function ConnectionsNav() {
  return (
    <ModuleNav
      tabs={TABS}
      getActiveTabId={getActiveTabId}
      accentColor="violet"
      navLabel="AI Connections navigation"
    />
  );
}
