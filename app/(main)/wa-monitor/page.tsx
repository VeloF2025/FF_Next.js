/**
 * WA Monitor Page
 * Route: /wa-monitor
 * WhatsApp QA Drop Monitoring Dashboard
 */

import { WaMonitorDashboard } from '@/modules/wa-monitor/components';

export const metadata = {
  title: 'WA Monitor | FibreFlow',
  description: 'WhatsApp QA Drop Monitoring Dashboard - Real-time drop status tracking',
};

export default function WaMonitorPage() {
  return <WaMonitorDashboard />;
}
