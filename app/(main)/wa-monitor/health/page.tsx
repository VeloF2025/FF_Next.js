/**
 * WA Monitor System Health Page
 * Dedicated page for monitoring all WA Monitor system components
 */

import { SystemHealthPanel } from '@/modules/wa-monitor/components';

export default function WAMonitorHealthPage() {
  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">WA Monitor System Health</h1>
        <p className="text-sm text-gray-600 mt-2">
          Real-time monitoring of all system components
        </p>
      </div>

      <SystemHealthPanel autoRefresh={true} refreshInterval={30000} />
    </div>
  );
}
