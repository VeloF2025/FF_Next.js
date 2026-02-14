// ============= Recent Activity Section Component =============

import { FileText, Send } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import type { BOQItem, RFQItem } from '../types/types';

interface RecentActivitySectionProps {
  boqs?: BOQItem[];
  rfqs?: RFQItem[];
  onNavigate: (path: string) => void;
}

export function RecentActivitySection({ boqs, rfqs, onNavigate }: RecentActivitySectionProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Recent Activity</h2>
        <Button
          onClick={() => onNavigate('/app/procurement/reports?view=activity')}
          variant="outline"
          size="sm"
        >
          View All
        </Button>
      </div>
      <div className="space-y-3">
        {boqs?.slice(0, 2).map((boq) => (
          <div
            key={boq.id}
            className="flex items-center justify-between p-3 hover:bg-gray-50 dark:bg-gray-900 rounded-lg cursor-pointer transition-colors"
            onClick={() => onNavigate(`/app/procurement/boq/${boq.id}`)}
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <FileText className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{boq.title}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">BOQ {boq.version} - Updated 2 hours ago</p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                R {boq.totalEstimatedValue?.toLocaleString() || '0'}
              </span>
              <div className="text-xs text-gray-500 dark:text-gray-400">Total Value</div>
            </div>
          </div>
        ))}
        {rfqs?.slice(0, 2).map((rfq) => (
          <div
            key={rfq.id}
            className="flex items-center justify-between p-3 hover:bg-gray-50 dark:bg-gray-900 rounded-lg cursor-pointer transition-colors"
            onClick={() => onNavigate(`/app/procurement/rfq/${rfq.id}`)}
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <Send className="h-4 w-4 text-green-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{rfq.title}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">RFQ {rfq.rfqNumber}</p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {rfq.invitedSuppliers?.length || 0} suppliers
              </span>
              <div className="text-xs text-gray-500 dark:text-gray-400">Invited</div>
            </div>
          </div>
        ))}

        {/* Show message when no activities */}
        {(!boqs || boqs.length === 0) && (!rfqs || rfqs.length === 0) && (
          <div className="text-center py-4 text-gray-500 dark:text-gray-400">
            No recent procurement activity
          </div>
        )}
      </div>
    </div>
  );
}
