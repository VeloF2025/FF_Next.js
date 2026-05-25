/**
 * Serial-register reconciliation (PR-11) — orphaned route, discovery by URL only
 * (Wave 2 convention #11). Read-only drift detection over the serial master register.
 */
import { AppLayout } from '@/components/layout';
import { ShieldCheck } from 'lucide-react';
import { ReconciliationPanel } from '@/components/field-stock/serial-reconciliation/ReconciliationPanel';

export default function SerialReconciliationPage() {
  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="flex items-center gap-3 px-6 py-4">
            <div className="rounded-lg bg-purple-500/10 p-2"><ShieldCheck className="h-6 w-6 text-purple-500" /></div>
            <div>
              <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Serial Register Reconciliation</h1>
              <p className="text-sm text-[var(--ff-text-secondary)]">Read-only drift checks between the serial master register and its source-of-truth integrations</p>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <ReconciliationPanel />
        </div>
      </div>
    </AppLayout>
  );
}
