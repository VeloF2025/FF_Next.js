// ============= Recent Activity Section Component =============

import { FileText, Send, ShoppingCart, Package } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import type { BOQItem, RFQItem } from '../types/types';

interface RecentActivitySectionProps {
  boqs?: BOQItem[];
  rfqs?: RFQItem[];
  onNavigate: (path: string) => void;
}

export function RecentActivitySection({ boqs, rfqs, onNavigate }: RecentActivitySectionProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Recent Activity</h2>
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
            className="flex items-center justify-between p-3 hover:bg-gray-50 rounded-lg cursor-pointer transition-colors"
            onClick={() => onNavigate(`/app/procurement/boq/${boq.id}`)}
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <FileText className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{boq.title}</p>
                <p className="text-xs text-gray-500">BOQ {boq.version} - Updated 2 hours ago</p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-sm font-medium text-gray-900">
                R {boq.totalEstimatedValue?.toLocaleString() || '0'}
              </span>
              <div className="text-xs text-gray-500">Total Value</div>
            </div>
          </div>
        ))}
        {rfqs?.slice(0, 2).map((rfq) => (
          <div
            key={rfq.id}
            className="flex items-center justify-between p-3 hover:bg-gray-50 rounded-lg cursor-pointer transition-colors"
            onClick={() => onNavigate(`/app/procurement/rfq/${rfq.id}`)}
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <Send className="h-4 w-4 text-green-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{rfq.title}</p>
                <p className="text-xs text-gray-500">RFQ {rfq.rfqNumber} - Sent 1 day ago</p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-sm font-medium text-gray-900">
                {rfq.invitedSuppliers?.length || 0} suppliers
              </span>
              <div className="text-xs text-gray-500">Invited</div>
            </div>
          </div>
        ))}

        {/* Mock additional activities */}
        <div className="flex items-center justify-between p-3 hover:bg-gray-50 rounded-lg cursor-pointer transition-colors">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-100 rounded-lg">
              <ShoppingCart className="h-4 w-4 text-orange-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">PO-2024-045 Created</p>
              <p className="text-xs text-gray-500">Fiber Optic Cables - Pending approval</p>
            </div>
          </div>
          <div className="text-right">
            <span className="text-sm font-medium text-gray-900">R 25,000</span>
            <div className="text-xs text-gray-500">Amount</div>
          </div>
        </div>

        <div className="flex items-center justify-between p-3 hover:bg-gray-50 rounded-lg cursor-pointer transition-colors">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <Package className="h-4 w-4 text-indigo-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">Stock Received</p>
              <p className="text-xs text-gray-500">GRN-2024-123 - 500m Cable Drum</p>
            </div>
          </div>
          <div className="text-right">
            <span className="text-xs text-green-600 font-medium">Completed</span>
            <div className="text-xs text-gray-500">Status</div>
          </div>
        </div>
      </div>
    </div>
  );
}
