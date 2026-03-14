// WORKING: Procurement Workflow Wizard page
import { AppLayout } from '@/components/layout';
import { ProcurementWorkflowWizard } from '@/modules/procurement/workflow/ProcurementWorkflowWizard';
import { Workflow } from 'lucide-react';

export default function ProcurementWorkflowPage() {
  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Header */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/20">
                <Workflow className="h-6 w-6 text-purple-400" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">
                  New Procurement Workflow
                </h1>
                <p className="text-sm text-[var(--ff-text-secondary)]">
                  9-step guided procurement cycle — from requirements to payment approval
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Wizard Content */}
        <div className="p-6">
          <ProcurementWorkflowWizard />
        </div>
      </div>
    </AppLayout>
  );
}
