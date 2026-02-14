/**
 * Quick Stats Component
 * Displays key procurement statistics and metrics
 */

import { Link } from 'react-router-dom';
import { QuickStat } from '../types/dashboard.types';

interface QuickStatsProps {
  stats: QuickStat[];
}

export function QuickStats({ stats }: QuickStatsProps) {
  return (
    <div className="bg-white dark:bg-gray-800 shadow rounded-lg">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Quick Stats</h3>
      </div>
      <div className="p-6">
        <div className="space-y-4">
          {stats.map((stat, index) => (
            <div key={index} className="flex justify-between items-center">
              <span className="text-sm text-gray-600 dark:text-gray-400">{stat.label}</span>
              <span className={`text-lg font-semibold ${
                stat.color === 'green' ? 'text-green-600' : 'text-gray-900 dark:text-gray-100'
              }`}>
                {stat.value}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-6">
          <Link
            to="/app/procurement/reports/cost-analysis"
            className="text-sm font-medium text-blue-600 hover:text-blue-500"
          >
            View detailed analytics →
          </Link>
        </div>
      </div>
    </div>
  );
}