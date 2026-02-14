/**
 * Database Performance Card Component
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function DatabasePerformanceCard() {
  const dbMetrics = [
    {
      label: 'Avg Query Time',
      value: '42ms',
      status: '↓ 80% faster',
      statusColor: 'text-green-600',
    },
    {
      label: 'Slow Queries',
      value: '3',
      status: '>100ms threshold',
      statusColor: 'text-yellow-600',
    },
    {
      label: 'N+1 Queries',
      value: '0',
      status: '✓ No issues detected',
      statusColor: 'text-green-600',
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Database Performance</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {dbMetrics.map((metric) => (
            <div key={metric.label}>
              <div className="text-sm text-gray-600 dark:text-gray-400">{metric.label}</div>
              <div className="text-2xl font-bold">{metric.value}</div>
              <div className={`text-sm ${metric.statusColor}`}>{metric.status}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
