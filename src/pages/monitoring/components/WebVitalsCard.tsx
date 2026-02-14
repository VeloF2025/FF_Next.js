/**
 * Web Vitals Card Component
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { WebVitalMetric } from '../types/monitoring.types';
import { getStatusColor, formatValue } from '../hooks/useMonitoringData';

interface WebVitalsCardProps {
  webVitals: WebVitalMetric[];
}

const VITAL_NAMES = ['LCP', 'FID', 'CLS', 'TTFB', 'FCP', 'INP'];

export function WebVitalsCard({ webVitals }: WebVitalsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Core Web Vitals (Last Hour)</CardTitle>
      </CardHeader>
      <CardContent>
        {webVitals.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>No metrics collected yet</p>
            <p className="text-sm mt-2">
              Web Vitals will appear here as users interact with the application
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {VITAL_NAMES.map((metricName) => {
              const metric = webVitals.find((m) => m.name === metricName);

              if (!metric) {
                return (
                  <div
                    key={metricName}
                    className="p-4 border rounded-lg bg-background"
                  >
                    <div className="text-sm font-medium text-muted-foreground">
                      {metricName}
                    </div>
                    <div className="text-2xl font-bold text-gray-400">-</div>
                    <div className="text-xs text-muted-foreground mt-1">No data</div>
                  </div>
                );
              }

              return (
                <div
                  key={metricName}
                  className={`p-4 border rounded-lg ${getStatusColor(metric.rating)}`}
                >
                  <div className="text-sm font-medium">{metric.name}</div>
                  <div className="text-2xl font-bold">
                    {formatValue(metric.name, metric.value)}
                  </div>
                  <div className="text-xs mt-1 uppercase font-semibold">
                    {metric.rating}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
