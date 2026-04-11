/**
 * Category Section — Category + Discipline + Priority picker
 *
 * Replaces the old SourceSection. Manual ticket creation is now a two-step
 * pick: what KIND of ticket (category) and which DISCIPLINE handles it
 * (ticket_type). Source is always derived as 'manual' — users never pick it.
 *
 * Allowed combinations come from MANUAL_TICKET_TAXONOMY. Auto-ingest-only
 * types (Non-Invoicable, Fibertime/QContact, Tera snags, HSE near-miss) are
 * deliberately NOT offered here — they arrive via their respective ingest
 * pipelines.
 */

'use client';

import {
  Tag,
  Wrench,
  ShieldAlert,
  Bug,
  BugPlay,
  TrendingUp,
  HelpCircle,
  type LucideIcon,
} from 'lucide-react';
import { TicketCategory, TicketType, TicketPriority } from '../../../types/ticket';
import {
  TICKET_PRIORITY_LABELS,
  PRIORITY_COLORS,
  type TicketFormData,
  type TicketFormErrors,
} from '../../../hooks/useTicketForm';
import {
  MANUAL_CATEGORIES,
  CATEGORY_LABELS,
  getDisciplinesForCategory,
} from '../../../constants/manualTicketTaxonomy';

interface CategorySectionProps {
  formData: TicketFormData;
  errors: TicketFormErrors;
  setField: <K extends keyof TicketFormData>(field: K, value: TicketFormData[K]) => void;
  setFields: (fields: Partial<TicketFormData>) => void;
  disabled?: boolean;
}

const CATEGORY_ICONS: Record<TicketCategory, LucideIcon> = {
  [TicketCategory.DEV_OPS]:      Bug,
  [TicketCategory.HSE_INCIDENT]: ShieldAlert,
  [TicketCategory.MAINTENANCE]:  Wrench,
  [TicketCategory.SALES_LEAD]:   TrendingUp,
  [TicketCategory.SNAG]:         BugPlay,
  [TicketCategory.UNSPECIFIED]:  HelpCircle,
};

export function CategorySection({
  formData,
  errors,
  setField,
  setFields,
  disabled,
}: CategorySectionProps) {
  const selectedCategory = formData.category as TicketCategory | null;
  const disciplineRows = selectedCategory
    ? getDisciplinesForCategory(selectedCategory)
    : [];
  const showDisciplineStep = disciplineRows.length > 1;

  const handleCategoryChange = (category: TicketCategory) => {
    const rows = getDisciplinesForCategory(category);
    const firstRow = rows[0];
    // Auto-select the single discipline when there's only one option. This
    // covers DevOps, H&S, Sales Lead, and Unspecified — the user shouldn't
    // have to click through a radio group with one choice.
    if (rows.length === 1 && firstRow) {
      setFields({
        category,
        ticket_type: firstRow.ticket_type,
      });
    } else {
      // Multi-discipline category (Maintenance, Snag) — clear any stale
      // ticket_type so the user has to make an explicit pick.
      setFields({
        category,
        ticket_type: '' as TicketType,
      });
    }
  };

  const handleDisciplineChange = (ticketType: TicketType) => {
    setField('ticket_type', ticketType);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-lg font-semibold text-[var(--ff-text-primary)]">
        <Tag className="w-5 h-5 text-blue-400" />
        Category &amp; Discipline
      </div>

      {/* Step 1 — Category */}
      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
          Category <span className="text-red-400">*</span>
        </label>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          {MANUAL_CATEGORIES.map((category) => {
            const Icon = CATEGORY_ICONS[category];
            const isSelected = selectedCategory === category;
            return (
              <button
                key={category}
                type="button"
                onClick={() => handleCategoryChange(category)}
                disabled={disabled}
                className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition-colors ${
                  isSelected
                    ? 'bg-blue-500/20 border-blue-500 text-blue-400'
                    : 'bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:border-[var(--ff-border-medium)] hover:text-[var(--ff-text-primary)]'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <Icon className="w-4 h-4" />
                <span className="text-xs font-medium">{CATEGORY_LABELS[category]}</span>
              </button>
            );
          })}
        </div>
        {errors.category && (
          <p className="mt-1 text-sm text-red-400">{errors.category}</p>
        )}
      </div>

      {/* Step 2 — Discipline (only for Maintenance + Snag) */}
      {showDisciplineStep && (
        <div>
          <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
            Discipline <span className="text-red-400">*</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {disciplineRows.map((row) => {
              const isSelected = formData.ticket_type === row.ticket_type;
              return (
                <button
                  key={row.ticket_type}
                  type="button"
                  onClick={() => handleDisciplineChange(row.ticket_type)}
                  disabled={disabled}
                  className={`px-4 py-2 rounded-full text-sm font-medium border transition-all ${
                    isSelected
                      ? 'bg-blue-500/20 border-blue-500 text-blue-300'
                      : 'bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:border-[var(--ff-border-medium)] hover:text-[var(--ff-text-primary)]'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {row.disciplineLabel}
                </button>
              );
            })}
          </div>
          {errors.ticket_type && (
            <p className="mt-1 text-sm text-red-400">{errors.ticket_type}</p>
          )}
        </div>
      )}

      {/* Step 3 — Priority (always visible) */}
      <div>
        <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
          Priority
        </label>
        <div className="flex flex-wrap gap-2">
          {Object.entries(TICKET_PRIORITY_LABELS).map(([value, label]) => {
            const isSelected = formData.priority === value;
            const colorClass = PRIORITY_COLORS[value as TicketPriority];
            return (
              <button
                key={value}
                type="button"
                onClick={() => setField('priority', value as TicketPriority)}
                disabled={disabled}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                  isSelected
                    ? colorClass + ' ring-2 ring-offset-2 ring-offset-[var(--ff-bg-secondary)]'
                    : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)]'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
