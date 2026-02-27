/**
 * BOQ Viewer Summary Footer Component
 * Displays filtered item count, total value, and percentage
 */

import { BOQItem, BOQWithItems } from '@/types/procurement/boq.types';

interface BOQViewerSummaryFooterProps {
  boqData: BOQWithItems;
  filteredItems: BOQItem[];
}

export default function BOQViewerSummaryFooter({
  boqData,
  filteredItems
}: BOQViewerSummaryFooterProps) {
  // Calculate totals
  const totalValue = boqData.items.reduce((sum, item) => sum + (item.totalPrice || 0), 0);
  const filteredValue = filteredItems.reduce((sum, item) => sum + (item.totalPrice || 0), 0);
  const percentage = boqData.items.length > 0 
    ? ((filteredItems.length / boqData.items.length) * 100).toFixed(1)
    : 0;

  return (
    <div className="bg-[var(--ff-bg-tertiary)] border-t border-[var(--ff-border-light)] px-6 py-3 flex items-center justify-between text-sm">
      <div className="flex items-center space-x-6">
        <div>
          <span className="text-[var(--ff-text-secondary)]">Filtered Items: </span>
          <span className="font-semibold text-[var(--ff-text-primary)]">
            {filteredItems.length} of {boqData.items.length}
          </span>
        </div>
        <div>
          <span className="text-[var(--ff-text-secondary)]">Percentage: </span>
          <span className="font-semibold text-[var(--ff-text-primary)]">{percentage}%</span>
        </div>
      </div>
      <div>
        <span className="text-[var(--ff-text-secondary)]">Filtered Total: </span>
        <span className="font-semibold text-[var(--ff-text-primary)]">
          R {filteredValue.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>
    </div>
  );
}
