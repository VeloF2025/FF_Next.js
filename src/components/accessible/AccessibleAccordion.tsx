/**
 * AccessibleAccordion
 *
 * WCAG 2.1 AA compliant accordion (card variant).
 *
 * Implements:
 *   - aria-expanded on trigger button           (WCAG 4.1.2)
 *   - aria-controls linking button → panel      (WCAG 4.1.2)
 *   - aria-labelledby linking panel → button    (WCAG 1.3.1)
 *   - Enter / Space keyboard activation         (WCAG 2.1.1)
 *   - Focus ring on trigger                     (WCAG 2.4.7)
 *   - All interactive content keyboard reachable
 *
 * Usage:
 *   <AccessibleAccordion
 *     items={phases.map(p => ({
 *       id: p.phase,
 *       header: (expanded) => <PhaseHeader phase={p} expanded={expanded} />,
 *       body: <PhaseBody items={p.items} />,
 *     }))}
 *     expandedIds={expandedPhases}
 *     onToggle={togglePhase}
 *   />
 */

import React from 'react';
import { cn } from '@/lib/utils';

export interface AccordionItemConfig {
  id: string;
  /** Render prop — receives current expanded state so header can show ▲ / ▼ */
  header: (expanded: boolean) => React.ReactNode;
  body: React.ReactNode;
  /** Extra classes on the outer card wrapper */
  className?: string;
  /** Extra classes on the trigger button */
  headerClassName?: string;
  /** Extra classes on the body panel */
  bodyClassName?: string;
}

export interface AccessibleAccordionProps {
  items: AccordionItemConfig[];
  /** Controlled expanded state — Set of item ids that are currently open */
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  className?: string;
}

export function AccessibleAccordion({
  items,
  expandedIds,
  onToggle,
  className,
}: AccessibleAccordionProps) {
  return (
    <div className={cn('space-y-3', className)}>
      {items.map((item) => {
        const isExpanded = expandedIds.has(item.id);
        const triggerId = `accordion-trigger-${item.id}`;
        const panelId = `accordion-panel-${item.id}`;

        return (
          <div
            key={item.id}
            className={cn(
              'bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden',
              item.className,
            )}
          >
            {/* ── Trigger ── */}
            <button
              id={triggerId}
              type="button"
              aria-expanded={isExpanded}
              aria-controls={panelId}
              onClick={() => onToggle(item.id)}
              className={cn(
                'w-full flex items-center justify-between px-4 py-3',
                'hover:bg-[var(--ff-bg-tertiary)] transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--ff-accent)]',
                item.headerClassName,
              )}
            >
              {item.header(isExpanded)}
            </button>

            {/* ── Panel ── */}
            <div
              id={panelId}
              role="region"
              aria-labelledby={triggerId}
              hidden={!isExpanded}
              className={cn('border-t border-[var(--ff-border-light)]', item.bodyClassName)}
            >
              {item.body}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default AccessibleAccordion;
