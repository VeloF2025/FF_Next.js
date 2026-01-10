/**
 * Analytics Dashboard Top Clients Section
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/Card';
import { TopClientsProps, TopClient } from './AnalyticsDashboardTypes';

export function TopClientsSection({ topClients }: TopClientsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top Clients by Revenue</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {topClients.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-[var(--ff-text-tertiary)]">No clients found</p>
              <p className="text-sm text-[var(--ff-text-tertiary)]">Client data will appear here once available</p>
            </div>
          ) : (
            topClients.map((client: TopClient, index: number) => (
              <div key={client.clientId} className="flex items-center justify-between border-b border-[var(--ff-border-light)] pb-2">
                <div className="flex items-center space-x-4">
                  <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-sm font-semibold text-blue-400">
                    {index + 1}
                  </div>
                  <div>
                    <p className="font-medium">{client.clientName}</p>
                    <p className="text-sm text-[var(--ff-text-secondary)]">{client.totalProjects || 0} projects</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold">R {Number(client.totalRevenue || 0).toLocaleString()}</p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">
                    Score: {Number(client.paymentScore || 0).toFixed(0)}%
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}