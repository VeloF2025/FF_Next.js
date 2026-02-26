/**
 * BOQ Viewer Summary Footer
 * Shows filtered item count, filtered total value, and percentage of BOQ
 */

import { BOQItem } from '@/types/procurement/boq.types';

interface BOQViewerSummaryProps {
  filteredItems: BOQItem[];
  totalItems: number;
  totalBOQValue: number;
}

function fmtZAR(n: number) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 2,
  }).format(n);
}

export default function BOQViewerSummary({
  filteredItems,
  totalItems,
  totalBOQValue,
}: BOQViewerSummaryProps) {
  const filteredValue = filteredItems.reduce(
    (sum, item) => sum + (item.totalPrice || 0),
    0
  );
  const percentage =
    totalBOQValue > 0 ? ((filteredValue / totalBOQValue) * 100).toFixed(1) : '0.0';
  const isFiltered = filteredItems.length !== totalItems;

  return (
    <div className="px-6 py-3 border-t border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="text-sm">
            <span className="text-[var(--ff-text-tertiary)]">Items: </span>
            <span className="font-medium text-[var(--ff-text-primary)]">
              {filteredItems.length}
              {isFiltered && (
                <span className="text-[var(--ff-text-tertiary)]"> / {totalItems}</span>
              )}
            </span>
          </div>

          <div className="text-sm">
            <span className="text-[var(--ff-text-tertiary)]">
              {isFiltered ? 'Filtered Value: ' : 'Total Value: '}
            </span>
            <span className="font-semibold text-[var(--ff-text-primary)]">
              {fmtZAR(filteredValue)}
            </span>
          </div>

          {isFiltered && (
            <div className="text-sm">
              <span className="text-[var(--ff-text-tertiary)]">of BOQ: </span>
              <span className="font-medium text-blue-400">{percentage}%</span>
            </div>
          )}
        </div>

        {!isFiltered && (
          <div className="text-xs text-[var(--ff-text-tertiary)]">
            Showing all items
          </div>
        )}
      </div>
    </div>
  );
}
