/** Quick-action shortcuts for the field-stock Dashboard v2 tab. Carried over from the
 * legacy FieldStockDashboard so promoting v2 to default keeps the tab-jump shortcuts.
 * Only rendered when an onNavigate handler is supplied (i.e. inside the tabbed page). */
import { Package, ScanLine, ArrowRightLeft, MapPin } from 'lucide-react';

interface DashboardV2QuickActionsProps {
  onNavigate: (tab: string) => void;
}

export function DashboardV2QuickActions({ onNavigate }: DashboardV2QuickActionsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <button onClick={() => onNavigate('pickings')} className="flex items-center gap-3 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-4 text-left hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
        <div className="rounded-lg bg-blue-100 p-2 dark:bg-blue-900/30">
          <Package className="h-5 w-5 text-blue-600 dark:text-blue-400" />
        </div>
        <div>
          <p className="font-medium text-[var(--ff-text-primary)]">Issue Stock</p>
          <p className="text-sm text-[var(--ff-text-tertiary)]">Create new transfer</p>
        </div>
      </button>

      <button onClick={() => onNavigate('consumptions')} className="flex items-center gap-3 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-4 text-left hover:border-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors">
        <div className="rounded-lg bg-green-100 p-2 dark:bg-green-900/30">
          <ScanLine className="h-5 w-5 text-green-600 dark:text-green-400" />
        </div>
        <div>
          <p className="font-medium text-[var(--ff-text-primary)]">Record Consumption</p>
          <p className="text-sm text-[var(--ff-text-tertiary)]">Link material to job</p>
        </div>
      </button>

      <button onClick={() => onNavigate('returns')} className="flex items-center gap-3 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-4 text-left hover:border-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors">
        <div className="rounded-lg bg-purple-100 p-2 dark:bg-purple-900/30">
          <ArrowRightLeft className="h-5 w-5 text-purple-600 dark:text-purple-400" />
        </div>
        <div>
          <p className="font-medium text-[var(--ff-text-primary)]">Process Return</p>
          <p className="text-sm text-[var(--ff-text-tertiary)]">Return unused stock</p>
        </div>
      </button>

      <button onClick={() => onNavigate('locations')} className="flex items-center gap-3 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-4 text-left hover:border-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors">
        <div className="rounded-lg bg-orange-100 p-2 dark:bg-orange-900/30">
          <MapPin className="h-5 w-5 text-orange-600 dark:text-orange-400" />
        </div>
        <div>
          <p className="font-medium text-[var(--ff-text-primary)]">Manage Locations</p>
          <p className="text-sm text-[var(--ff-text-tertiary)]">View all locations</p>
        </div>
      </button>
    </div>
  );
}
