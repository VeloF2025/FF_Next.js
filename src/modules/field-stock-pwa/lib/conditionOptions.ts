/**
 * Inspect-time condition vocabulary. Phase 3 UI exposes a 3-option subset of
 * the stock_return_lines.condition CHECK ('new', 'good', 'fair', 'poor',
 * 'damaged', 'non_functional'). Storemen don't need finer-grained options here.
 */

export type ReturnCondition = 'good' | 'damaged' | 'non_functional';

export interface ConditionOption {
  code: ReturnCondition;
  label: string;
  description: string;
}

export const CONDITION_OPTIONS: ConditionOption[] = [
  { code: 'good',           label: 'Good',           description: 'No visible damage, ready to re-issue' },
  { code: 'damaged',        label: 'Damaged',        description: 'Cosmetic or minor damage — repair candidate' },
  { code: 'non_functional', label: 'Non-functional', description: 'Does not power on or fails self-test' },
];
