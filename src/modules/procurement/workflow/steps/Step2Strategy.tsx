/**
 * Step2Strategy — Strategy selection step for the Procurement Workflow Wizard.
 * Presents two large clickable cards: RFQ and Direct Purchase Order.
 */

import { Send, ShoppingCart, ArrowLeft, AlertCircle } from 'lucide-react';
import type { WorkflowState } from '../useWorkflowState';

// 🟢 WORKING: strategy card definitions
const STRATEGIES: {
  value: 'rfq' | 'direct_po';
  label: string;
  subtitle: string;
  description: string;
  badge: string;
  Icon: React.ComponentType<{ className?: string }>;
  accent: {
    ring: string;
    icon: string;
    badge: string;
    heading: string;
  };
}[] = [
  {
    value: 'rfq',
    label: 'Request for Quotation (RFQ)',
    subtitle: 'Get Competitive Quotes',
    description:
      'Get competitive quotes from multiple suppliers. Best for orders ≥ R10,000 or strategic purchases.',
    badge: 'Recommended for large orders',
    Icon: Send,
    accent: {
      ring: 'ring-amber-500/60',
      icon: 'bg-amber-500/20 text-amber-400',
      badge: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
      heading: 'text-amber-400',
    },
  },
  {
    value: 'direct_po',
    label: 'Direct Purchase Order',
    subtitle: 'Order from Preferred Supplier',
    description:
      'Order directly from a preferred supplier. Best for urgent or small purchases < R10,000.',
    badge: 'Fastest for small orders',
    Icon: ShoppingCart,
    accent: {
      ring: 'ring-blue-500/60',
      icon: 'bg-blue-500/20 text-blue-400',
      badge: 'bg-blue-500/15 text-blue-400 border border-blue-500/30',
      heading: 'text-blue-400',
    },
  },
];

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);

const THRESHOLD = 10_000;

function getHint(estimatedTotal?: number): { message: string; recommended: 'rfq' | 'direct_po' } | null {
  if (estimatedTotal === undefined || estimatedTotal <= 0) return null;
  if (estimatedTotal >= THRESHOLD) {
    return {
      message: `Your estimate is ${formatCurrency(estimatedTotal)}, which meets the RFQ threshold. We recommend requesting competitive quotes.`,
      recommended: 'rfq',
    };
  }
  return {
    message: `Your estimate is ${formatCurrency(estimatedTotal)}, which is under R10,000. Either option works — Direct PO is faster.`,
    recommended: 'direct_po',
  };
}

export interface Step2StrategyProps {
  state: WorkflowState;
  onComplete: (update: Partial<WorkflowState>) => void;
  onBack: () => void;
}

/**
 * Step 2: The user selects either RFQ or Direct PO.
 * Clicking a card immediately calls `onComplete` — no explicit "Next" button.
 */
export function Step2Strategy({ state, onBack, onComplete }: Step2StrategyProps) {
  const hint = getHint(state.estimatedTotal);

  const handleSelect = (strategy: 'rfq' | 'direct_po') => {
    onComplete({ strategy });
  };

  return (
    <div className="space-y-6">
      {/* Heading */}
      <div>
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Choose Procurement Strategy</h3>
        <p className="mt-1 text-sm text-[var(--ff-text-secondary)]">
          Select how you want to fulfil this requisition.
        </p>
      </div>

      {/* Estimated total hint */}
      {hint && (
        <div className="flex items-start gap-3 p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
          <AlertCircle className="h-5 w-5 text-[var(--ff-text-tertiary)] flex-shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-sm text-[var(--ff-text-secondary)]">{hint.message}</p>
        </div>
      )}

      {/* Strategy cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {STRATEGIES.map((strategy) => {
          const isSelected = state.strategy === strategy.value;
          const isRecommended = hint?.recommended === strategy.value;

          return (
            <button
              key={strategy.value}
              type="button"
              onClick={() => handleSelect(strategy.value)}
              className={[
                'relative text-left w-full p-6 rounded-xl border bg-[var(--ff-bg-secondary)] transition-all duration-200',
                'hover:bg-[var(--ff-bg-hover)] focus:outline-none focus:ring-2',
                strategy.accent.ring,
                isSelected
                  ? `ring-2 ${strategy.accent.ring} border-transparent`
                  : 'border-[var(--ff-border-light)]',
              ].join(' ')}
              aria-pressed={isSelected}
              aria-label={`Select ${strategy.label}`}
            >
              {/* Recommended ribbon */}
              {isRecommended && (
                <span className="absolute top-3 right-3 text-xs px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/30 font-medium">
                  Recommended
                </span>
              )}

              {/* Icon */}
              <div className={`inline-flex p-3 rounded-lg mb-4 ${strategy.accent.icon}`}>
                <strategy.Icon className="h-6 w-6" aria-hidden="true" />
              </div>

              {/* Labels */}
              <p className="text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide mb-1">
                {strategy.subtitle}
              </p>
              <h4 className={`text-base font-semibold mb-2 ${strategy.accent.heading}`}>
                {strategy.label}
              </h4>
              <p className="text-sm text-[var(--ff-text-secondary)] leading-relaxed mb-4">
                {strategy.description}
              </p>

              {/* Badge */}
              <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${strategy.accent.badge}`}>
                {strategy.badge}
              </span>
            </button>
          );
        })}
      </div>

      {/* Back */}
      <div className="pt-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Requirements
        </button>
      </div>
    </div>
  );
}
