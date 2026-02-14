/**
 * Metric Card Component
 */

import { TrendingUp } from 'lucide-react';
import type { MetricCardProps } from '../types/analytics.types';

export function MetricCard({ title, value, subtitle, icon, trend, color }: MetricCardProps) {
  const colorClasses = {
    blue: 'bg-blue-100 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400',
    green: 'bg-green-100 text-green-600 dark:bg-green-900/20 dark:text-green-400',
    yellow: 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-400',
    red: 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400',
    purple: 'bg-purple-100 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400'
  };

  return (
    <div className="bg-background rounded-lg p-6 border border-border">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground mb-1">{title}</p>
          <p className="text-2xl font-bold text-foreground">{value}</p>
          {subtitle && (
            <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
          )}
        </div>
        <div className={`p-3 rounded-lg ${colorClasses[color]}`}>
          {icon}
        </div>
      </div>
      {trend && (
        <div className="flex items-center mt-3">
          <TrendingUp className={`w-4 h-4 mr-1 ${
            trend.direction === 'up' ? 'text-green-600' : 'text-red-600'
          }`} />
          <span className={`text-sm font-medium ${
            trend.direction === 'up' ? 'text-green-600' : 'text-red-600'
          }`}>
            {trend.percentage}%
          </span>
          <span className="text-sm text-muted-foreground ml-1">
            vs last month
          </span>
        </div>
      )}
    </div>
  );
}
