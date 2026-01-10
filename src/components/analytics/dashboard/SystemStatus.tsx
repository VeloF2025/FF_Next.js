/**
 * Analytics Dashboard System Status
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/Card';
import { SystemStatusProps } from './AnalyticsDashboardTypes';

export function SystemStatus({ lastSyncTime }: SystemStatusProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>System Status</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 rounded-full bg-green-500"></div>
            <span>Firebase (Real-time)</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 rounded-full bg-blue-500"></div>
            <span>Neon (Analytics)</span>
          </div>
          {lastSyncTime && (
            <span className="text-sm text-[var(--ff-text-secondary)]">
              Last synced: {lastSyncTime.toLocaleString()}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}