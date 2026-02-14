/**
 * Monitoring Header Component
 */

interface MonitoringHeaderProps {
  lastCheck: string;
}

export function MonitoringHeader({ lastCheck }: MonitoringHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-3xl font-bold">System Monitoring</h1>
        <p className="text-muted-foreground mt-1">
          Real-time performance metrics and system health
        </p>
      </div>
      <div className="text-right">
        <div className="text-sm text-muted-foreground">Last updated</div>
        <div className="text-sm font-medium">
          {new Date(lastCheck).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}
