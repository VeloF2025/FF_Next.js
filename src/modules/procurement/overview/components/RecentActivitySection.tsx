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
    <div className="bg-card rounded-lg border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">Recent Activity</h2>
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
            className="flex items-center justify-between p-3 hover:bg-background rounded-lg cursor-pointer transition-colors"
            onClick={() => onNavigate(`/app/procurement/boq/${boq.id}`)}
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <FileText className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{boq.title}</p>
                <p className="text-xs text-muted-foreground">BOQ {boq.version} - Updated 2 hours ago</p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-sm font-medium text-foreground">
                R {boq.totalEstimatedValue?.toLocaleString() || '0'}
              </span>
              <div className="text-xs text-muted-foreground">Total Value</div>
            </div>
          </div>
        ))}
        {rfqs?.slice(0, 2).map((rfq) => (
          <div
            key={rfq.id}
            className="flex items-center justify-between p-3 hover:bg-background rounded-lg cursor-pointer transition-colors"
            onClick={() => onNavigate(`/app/procurement/rfq/${rfq.id}`)}
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <Send className="h-4 w-4 text-green-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{rfq.title}</p>
                <p className="text-xs text-muted-foreground">RFQ {rfq.rfqNumber}</p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-sm font-medium text-foreground">
                {rfq.invitedSuppliers?.length || 0} suppliers
              </span>
              <div className="text-xs text-muted-foreground">Invited</div>
            </div>
          </div>
        ))}

        {/* Show message when no activities */}
        {(!boqs || boqs.length === 0) && (!rfqs || rfqs.length === 0) && (
          <div className="text-center py-4 text-muted-foreground">
            No recent procurement activity
          </div>
        )}
      </div>
    </div>
  );
}
