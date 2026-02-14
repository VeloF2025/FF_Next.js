/**
 * Performance Budget Card Component
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PerformanceBudgetItem } from '../types/monitoring.types';

interface PerformanceBudgetCardProps {
  items: PerformanceBudgetItem[];
}

export function PerformanceBudgetCard({ items }: PerformanceBudgetCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Performance Budget Compliance</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.metric}
              className="flex items-center justify-between p-3 border rounded"
            >
              <div className="flex-1">
                <div className="font-medium">{item.metric}</div>
                <div className="text-sm text-muted-foreground">Budget: {item.budget}</div>
              </div>
              <div className="flex items-center space-x-3">
                <div className="text-right">
                  <div className="text-lg font-bold">{item.current}</div>
                </div>
                <div
                  className={`px-3 py-1 rounded font-semibold text-sm ${
                    item.status === 'pass'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-red-100 text-red-700'
                  }`}
                >
                  {item.status === 'pass' ? '✓ PASS' : '✗ FAIL'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
