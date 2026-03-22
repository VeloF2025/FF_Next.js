/**
 * Quick Stats Component
 * Displays key procurement statistics and metrics
 */

import Link from 'next/link';
import { QuickStat } from '../types/dashboard.types';

interface QuickStatsProps {
  stats: QuickStat[];
}

export function QuickStats({ stats }: QuickStatsProps) {
  return (
    <div className="bg-card shadow rounded-lg">
      <div className="px-6 py-4 border-b border-border">
        <h3 className="text-lg font-medium text-foreground">Quick Stats</h3>
      </div>
      <div className="p-6">
        <div className="space-y-4">
          {stats.map((stat, index) => (
            <div key={index} className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">{stat.label}</span>
              <span className={`text-lg font-semibold ${
                stat.color === 'green' ? 'text-green-600' : 'text-foreground'
              }`}>
                {stat.value}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-6">
          <Link href="/app/procurement/reports/cost-analysis"
            className="text-sm font-medium text-blue-600 hover:text-blue-500"
          >
            View detailed analytics →
          </Link>
        </div>
      </div>
    </div>
  );
}