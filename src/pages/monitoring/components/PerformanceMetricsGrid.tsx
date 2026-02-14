/**
 * Performance Metrics Grid Component
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function PerformanceMetricsGrid() {
  const metrics = [
    {
      title: 'Avg Response Time',
      value: '234ms',
      change: '↓ 45% faster',
      changeColor: 'text-green-600',
    },
    {
      title: 'Cache Hit Rate',
      value: '73.2%',
      change: '↑ Target: >70%',
      changeColor: 'text-green-600',
    },
    {
      title: 'Error Rate',
      value: '0.08%',
      change: '✓ Target: <0.1%',
      changeColor: 'text-green-600',
    },
    {
      title: 'Active Users',
      value: '1,247',
      change: '↑ 12% vs yesterday',
      changeColor: 'text-muted-foreground',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {metrics.map((metric) => (
        <Card key={metric.title}>
          <CardHeader>
            <CardTitle className="text-sm">{metric.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{metric.value}</div>
            <div className={`text-sm mt-1 ${metric.changeColor}`}>
              {metric.change}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
