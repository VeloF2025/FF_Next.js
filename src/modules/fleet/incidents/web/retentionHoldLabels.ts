/**
 * How each retention-hold category is named to an operator.
 *
 * In its own module rather than beside the row component so both the row and
 * the create form can read it without either importing a component from the
 * other — and so neither file exports a constant alongside a component, which
 * is what breaks fast refresh.
 */
import type { RetentionHoldCategory } from '../analytics/aggregateSchema';

export const CATEGORY_LABELS: Record<RetentionHoldCategory, string> = {
  health_safety: 'Health & safety', accident: 'Accident', insurance: 'Insurance',
  disciplinary: 'Disciplinary', legal: 'Legal', other_approved: 'Other (approved)',
};
