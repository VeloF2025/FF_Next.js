/**
 * /staff/payslips/import — HR-only payslip importer.
 *
 * Two tabs:
 *   - Combined PDF (default, recommended): drop the VIP "Velocity-payslips.pdf"
 *     export, the server splits it per-employee, auto-matches to staff, and
 *     HR resolves any unmatched rows via inline dropdowns. PRD-040 Phase 4.
 *   - CSV + PDFs (legacy): the original Phase 3 flow. Still useful for
 *     custom Sage/ISAFlow exports that don't follow the VIP layout.
 *
 * The body of each tab lives under `src/modules/payslips/components/import/`.
 * This file is intentionally a thin shell: layout chrome + tab routing.
 */

import React from 'react';

import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { staffConfig } from '@/modules/navigation';

import { CombinedPdfTab } from '@/modules/payslips/components/import/CombinedPdfTab';
import { LegacyCsvTab } from '@/modules/payslips/components/import/legacy/LegacyCsvTab';

type Tab = 'combined' | 'legacy';

export default function PayslipsImportPage() {
  const [tab, setTab] = React.useState<Tab>('combined');

  return (
    <AppLayout>
      <ModulePage config={staffConfig}>
        <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
          <header>
            <h1 className="text-2xl font-bold">Import payslips</h1>
            <p className="text-sm text-neutral-400 mt-1">
              Upload the monthly payslip export. Preview the result, then confirm.
            </p>
          </header>

          <div className="flex border-b border-neutral-800">
            <TabButton active={tab === 'combined'} onClick={() => setTab('combined')}>
              Combined PDF (recommended)
            </TabButton>
            <TabButton active={tab === 'legacy'} onClick={() => setTab('legacy')}>
              CSV + PDFs (legacy)
            </TabButton>
          </div>

          {tab === 'combined' ? <CombinedPdfTab /> : <LegacyCsvTab />}
        </div>
      </ModulePage>
    </AppLayout>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? 'border-blue-500 text-white'
          : 'border-transparent text-neutral-400 hover:text-neutral-200'
      }`}
    >
      {children}
    </button>
  );
}

export const getServerSideProps = async () => {
  return { props: {} };
};
