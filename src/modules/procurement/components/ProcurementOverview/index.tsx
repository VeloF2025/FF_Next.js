/**
 * Procurement Overview Component
 *
 * Clean dashboard with:
 * - Key metrics stats cards
 * - Visual workflow stepper
 * - Action cards linking to relevant pages
 */

import Link from 'next/link';
import {
  FileSpreadsheet,
  FileQuestion,
  Scale,
  ShoppingCart,
  PackageCheck,
  Boxes,
  Truck,
  CheckCircle,
  ArrowRight,
  TrendingUp,
  Clock,
  AlertTriangle,
  Package,
  Wallet,
} from 'lucide-react';
import type { AggregateProjectMetrics } from '@/types/procurement/portal.types';
import type { Project } from '@/types/project.types';

interface ProcurementOverviewProps {
  project?: Project;
  aggregateMetrics?: AggregateProjectMetrics;
  isLoading?: boolean;
}

export function ProcurementOverview({
  project,
  aggregateMetrics,
  isLoading
}: ProcurementOverviewProps) {
  const title = project ? `${project.name} Overview` : 'Procurement Overview';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-[var(--ff-text-primary)]">{title}</h2>
        {isLoading && (
          <span className="text-sm text-[var(--ff-text-tertiary)]">Loading...</span>
        )}
      </div>

      {/* Stats Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard
          label="Active RFQs"
          value={aggregateMetrics?.totalActiveRFQs ?? 0}
          icon={FileQuestion}
          color="blue"
          href="/procurement/sourcing?tab=rfq"
        />
        <StatCard
          label="Purchase Orders"
          value={aggregateMetrics?.totalPurchaseOrders ?? 0}
          icon={ShoppingCart}
          color="purple"
          href="/procurement/purchasing?tab=purchase-orders"
        />
        <StatCard
          label="Stock Items"
          value={aggregateMetrics?.totalStockItems ?? 0}
          icon={Boxes}
          color="green"
          href="/procurement/inventory?tab=items"
        />
        <StatCard
          label="Suppliers"
          value={aggregateMetrics?.totalSuppliers ?? 0}
          icon={Truck}
          color="orange"
          href="/procurement/sourcing?tab=suppliers"
        />
        <StatCard
          label="Cycle Days"
          value={`${aggregateMetrics?.averageCycleDays ?? 0}d`}
          icon={Clock}
          color="slate"
          subtitle="avg"
        />
        <StatCard
          label="Supplier OTIF"
          value={`${aggregateMetrics?.averageSupplierOTIF ?? 0}%`}
          icon={TrendingUp}
          color="emerald"
          subtitle="on-time"
        />
      </div>

      {/* Workflow Stepper */}
      <WorkflowStepper />

      {/* Action Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <ActionCard
          title="Bill of Quantities"
          description="Create and manage project BOQs"
          icon={FileSpreadsheet}
          href="/procurement/sourcing?tab=boq"
          color="blue"
        />
        <ActionCard
          title="Request for Quote"
          description="Send RFQs to suppliers"
          icon={FileQuestion}
          href="/procurement/sourcing?tab=rfq"
          color="cyan"
          badge={aggregateMetrics?.totalActiveRFQs}
        />
        <ActionCard
          title="Quote Evaluation"
          description="Compare and select quotes"
          icon={Scale}
          href="/procurement/purchasing?tab=quotes"
          color="purple"
        />
        <ActionCard
          title="Purchase Orders"
          description="Manage purchase orders"
          icon={ShoppingCart}
          href="/procurement/purchasing?tab=purchase-orders"
          color="indigo"
          badge={aggregateMetrics?.totalPurchaseOrders}
        />
        <ActionCard
          title="Goods Receipt"
          description="Record received goods"
          icon={PackageCheck}
          href="/procurement/purchasing?tab=grn"
          color="green"
        />
        <ActionCard
          title="Stock Management"
          description="Track inventory levels"
          icon={Package}
          href="/procurement/inventory?tab=stock"
          color="teal"
        />
        <ActionCard
          title="Suppliers"
          description="Manage supplier database"
          icon={Truck}
          href="/procurement/sourcing?tab=suppliers"
          color="orange"
          badge={aggregateMetrics?.totalSuppliers}
        />
        <ActionCard
          title="Budget Overview"
          description="Track spending and budgets"
          icon={Wallet}
          href="/procurement/financial?tab=budget"
          color="amber"
        />
        <ActionCard
          title="Approvals"
          description="Review pending approvals"
          icon={CheckCircle}
          href="/procurement/approvals"
          color="rose"
          badge={aggregateMetrics?.pendingApprovals}
          badgeType="warning"
        />
      </div>
    </div>
  );
}

// Stats Card Component - Clickable when href provided
interface StatCardProps {
  label: string;
  value: number | string;
  icon: React.ElementType;
  color: 'blue' | 'purple' | 'green' | 'orange' | 'slate' | 'emerald' | 'amber';
  subtitle?: string;
  href?: string;
}

function StatCard({ label, value, icon: Icon, color, subtitle, href }: StatCardProps) {
  const colorStyles = {
    blue: 'bg-[var(--ff-primary-500)]/10 text-[var(--ff-primary-500)]',
    purple: 'bg-[var(--ff-accent-500)]/10 text-[var(--ff-accent-500)]',
    green: 'bg-green-500/10 text-green-500',
    orange: 'bg-orange-500/10 text-orange-500',
    slate: 'bg-slate-500/10 text-slate-400',
    emerald: 'bg-emerald-500/10 text-emerald-500',
    amber: 'bg-amber-500/10 text-amber-500',
  };

  const content = (
    <div className="flex items-center gap-3">
      <div className={`p-2 rounded-lg ${colorStyles[color]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-[var(--ff-text-primary)] truncate">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
        <p className="text-xs text-[var(--ff-text-tertiary)] truncate">
          {label}{subtitle ? ` (${subtitle})` : ''}
        </p>
      </div>
    </div>
  );

  const baseClasses = "bg-[var(--ff-bg-secondary)] border border-[var(--ff-border)] rounded-lg p-4";

  if (href) {
    return (
      <Link href={href} className={`${baseClasses} hover:border-[var(--ff-accent-500)]/50 transition-colors block`}>
        {content}
      </Link>
    );
  }

  return <div className={baseClasses}>{content}</div>;
}

// Workflow Stepper Component
function WorkflowStepper() {
  const steps = [
    { id: 'boq', label: 'BOQ', href: '/procurement/sourcing?tab=boq', icon: FileSpreadsheet },
    { id: 'rfq', label: 'RFQ', href: '/procurement/sourcing?tab=rfq', icon: FileQuestion },
    { id: 'quotes', label: 'Quotes', href: '/procurement/purchasing?tab=quotes', icon: Scale },
    { id: 'po', label: 'PO', href: '/procurement/purchasing?tab=purchase-orders', icon: ShoppingCart },
    { id: 'grn', label: 'GRN', href: '/procurement/purchasing?tab=grn', icon: PackageCheck },
    { id: 'stock', label: 'Stock', href: '/procurement/inventory?tab=stock', icon: Boxes },
  ];

  return (
    <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border)] rounded-lg p-4">
      <h3 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-4">
        Procurement Workflow
      </h3>

      <div className="flex items-center justify-between overflow-x-auto pb-2">
        {steps.map((step, index) => (
          <div key={step.id} className="flex items-center">
            <Link
              href={step.href}
              className="flex flex-col items-center group min-w-[72px]"
            >
              <div className="w-10 h-10 rounded-full bg-[var(--ff-accent-500)]/10 flex items-center justify-center group-hover:bg-[var(--ff-accent-500)]/20 transition-colors">
                <step.icon className="h-5 w-5 text-[var(--ff-accent-500)]" />
              </div>
              <span className="mt-2 text-xs font-medium text-[var(--ff-text-secondary)] group-hover:text-[var(--ff-accent-500)] transition-colors">
                {step.label}
              </span>
            </Link>

            {index < steps.length - 1 && (
              <div className="flex-1 mx-2 min-w-[20px]">
                <ArrowRight className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Action Card Component
interface ActionCardProps {
  title: string;
  description: string;
  icon: React.ElementType;
  href: string;
  color: 'blue' | 'cyan' | 'purple' | 'indigo' | 'green' | 'teal' | 'orange' | 'amber' | 'rose';
  badge?: number;
  badgeType?: 'info' | 'warning';
}

function ActionCard({ title, description, icon: Icon, href, color, badge, badgeType = 'info' }: ActionCardProps) {
  const colorStyles = {
    blue: { bg: 'bg-[var(--ff-primary-500)]/10', text: 'text-[var(--ff-primary-500)]', hover: 'hover:border-[var(--ff-primary-500)]/50' },
    cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-500', hover: 'hover:border-cyan-500/50' },
    purple: { bg: 'bg-[var(--ff-accent-500)]/10', text: 'text-[var(--ff-accent-500)]', hover: 'hover:border-[var(--ff-accent-500)]/50' },
    indigo: { bg: 'bg-indigo-500/10', text: 'text-indigo-500', hover: 'hover:border-indigo-500/50' },
    green: { bg: 'bg-green-500/10', text: 'text-green-500', hover: 'hover:border-green-500/50' },
    teal: { bg: 'bg-teal-500/10', text: 'text-teal-500', hover: 'hover:border-teal-500/50' },
    orange: { bg: 'bg-orange-500/10', text: 'text-orange-500', hover: 'hover:border-orange-500/50' },
    amber: { bg: 'bg-amber-500/10', text: 'text-amber-500', hover: 'hover:border-amber-500/50' },
    rose: { bg: 'bg-rose-500/10', text: 'text-rose-500', hover: 'hover:border-rose-500/50' },
  };

  const styles = colorStyles[color];
  const badgeStyles = badgeType === 'warning'
    ? 'bg-amber-500/20 text-amber-400'
    : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]';

  return (
    <Link
      href={href}
      className={`bg-[var(--ff-bg-secondary)] border border-[var(--ff-border)] rounded-lg p-4 ${styles.hover} transition-colors block group`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2 rounded-lg ${styles.bg}`}>
          <Icon className={`h-5 w-5 ${styles.text}`} />
        </div>
        {badge !== undefined && badge > 0 && (
          <span className={`text-xs px-2 py-0.5 rounded-full ${badgeStyles}`}>
            {badge}
          </span>
        )}
      </div>
      <h3 className="font-semibold text-[var(--ff-text-primary)] mb-1 group-hover:text-[var(--ff-accent-400)] transition-colors">
        {title}
      </h3>
      <p className="text-sm text-[var(--ff-text-tertiary)]">{description}</p>
      <div className="mt-3 flex items-center text-xs text-[var(--ff-text-tertiary)] group-hover:text-[var(--ff-accent-400)] transition-colors">
        <span>Open</span>
        <ArrowRight className="h-3 w-3 ml-1 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </Link>
  );
}

export default ProcurementOverview;
