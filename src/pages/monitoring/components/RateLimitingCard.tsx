/**
 * Rate Limiting Card Component
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function RateLimitingCard() {
  const rateLimitStats = [
    {
      label: 'API Requests Blocked',
      description: 'Last 24 hours',
      value: '127',
    },
    {
      label: 'Active Rate Limit Entries',
      description: 'Current',
      value: '2,453',
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rate Limiting</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {rateLimitStats.map((stat) => (
            <div
              key={stat.label}
              className="flex items-center justify-between p-3 border rounded"
            >
              <div>
                <div className="font-medium">{stat.label}</div>
                <div className="text-sm text-muted-foreground">{stat.description}</div>
              </div>
              <div className="text-2xl font-bold">{stat.value}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
