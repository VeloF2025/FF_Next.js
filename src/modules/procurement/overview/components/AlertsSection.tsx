// ============= Alerts Section Component =============

import { XCircle, Clock, CheckCircle, Activity } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';

interface AlertsSectionProps {
  onNavigate: (path: string) => void;
}

export function AlertsSection({ onNavigate }: AlertsSectionProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Alerts & Notifications</h2>
      <div className="space-y-3">
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
          <XCircle className="h-5 w-5 text-red-600 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-900">Critical Stock Alert</p>
            <p className="text-sm text-red-700">5 items below minimum stock level - Production may be affected</p>
          </div>
          <Button
            onClick={() => onNavigate('/app/procurement/stock?filter=low-stock')}
            variant="outline"
            size="sm"
            className="border-red-300 text-red-700 hover:bg-red-100"
          >
            View Stock
          </Button>
        </div>
        <div className="flex items-start gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <Clock className="h-5 w-5 text-yellow-600 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-yellow-900">RFQ Responses Overdue</p>
            <p className="text-sm text-yellow-700">3 RFQs past deadline - Contact suppliers immediately</p>
          </div>
          <Button
            onClick={() => onNavigate('/app/procurement/rfq?filter=overdue')}
            variant="outline"
            size="sm"
            className="border-yellow-300 text-yellow-700 hover:bg-yellow-100"
          >
            Review RFQs
          </Button>
        </div>
        <div className="flex items-start gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
          <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-green-900">Savings Achievement</p>
            <p className="text-sm text-green-700">12.5% cost reduction achieved vs budget - R125,000 saved</p>
          </div>
          <Button
            onClick={() => onNavigate('/app/procurement/reports?view=savings')}
            variant="outline"
            size="sm"
            className="border-green-300 text-green-700 hover:bg-green-100"
          >
            View Report
          </Button>
        </div>
        <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <Activity className="h-5 w-5 text-blue-600 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-blue-900">Approval Required</p>
            <p className="text-sm text-blue-700">6 Purchase Orders waiting for approval (Total: R45,000)</p>
          </div>
          <Button
            onClick={() => onNavigate('/app/procurement/orders?filter=pending-approval')}
            variant="outline"
            size="sm"
            className="border-blue-300 text-blue-700 hover:bg-blue-100"
          >
            Approve
          </Button>
        </div>
      </div>
    </div>
  );
}
