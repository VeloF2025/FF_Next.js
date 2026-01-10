/**
 * Analytics Dashboard Financial Overview
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/Card';
import { FinancialOverviewProps } from './AnalyticsDashboardTypes';

export function FinancialOverview({ financialOverview }: FinancialOverviewProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Financial Overview</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">
              R {Number(financialOverview.totalAmount || 0).toLocaleString()}
            </div>
            <p className="text-sm text-[var(--ff-text-secondary)]">Total Revenue</p>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">
              R {Number(financialOverview.paidAmount || 0).toLocaleString()}
            </div>
            <p className="text-sm text-[var(--ff-text-secondary)]">Paid Amount</p>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-yellow-600">
              R {Number(financialOverview.pendingAmount || 0).toLocaleString()}
            </div>
            <p className="text-sm text-[var(--ff-text-secondary)]">Pending Amount</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}