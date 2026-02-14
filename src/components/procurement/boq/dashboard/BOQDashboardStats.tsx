/**
 * BOQ Dashboard Statistics Cards
 */

import { FileText, CheckCircle, Clock, TrendingUp, AlertTriangle, Activity } from 'lucide-react';
import { QuickStats } from './BOQDashboardTypes';

interface BOQDashboardStatsProps {
  stats: QuickStats;
  isLoading: boolean;
}

export default function BOQDashboardStats({ stats, isLoading }: BOQDashboardStatsProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="bg-white dark:bg-gray-800 p-6 rounded-lg border">
            <div className="animate-pulse">
              <div className="h-4 bg-gray-300 rounded w-3/4 mb-2"></div>
              <div className="h-8 bg-gray-300 rounded w-1/2"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  const statCards = [
    {
      title: 'Total BOQs',
      value: stats.totalBOQs,
      icon: FileText,
      color: 'blue',
      bgColor: 'bg-blue-50',
      iconColor: 'text-blue-500'
    },
    {
      title: 'Active BOQs',
      value: stats.activeBOQs,
      icon: Activity,
      color: 'green',
      bgColor: 'bg-green-50',
      iconColor: 'text-green-500'
    },
    {
      title: 'Pending Mappings',
      value: stats.pendingMappings,
      icon: Clock,
      color: 'yellow',
      bgColor: 'bg-yellow-50',
      iconColor: 'text-yellow-500'
    },
    {
      title: 'Completed',
      value: stats.completedMappings,
      icon: CheckCircle,
      color: 'green',
      bgColor: 'bg-green-50',
      iconColor: 'text-green-500'
    },
    {
      title: 'Total Value',
      value: `R${stats.totalValue.toLocaleString()}`,
      icon: TrendingUp,
      color: 'purple',
      bgColor: 'bg-purple-50',
      iconColor: 'text-purple-500'
    },
    {
      title: 'Avg Progress',
      value: `${Math.round(stats.averageProgress)}%`,
      icon: AlertTriangle,
      color: 'indigo',
      bgColor: 'bg-indigo-50',
      iconColor: 'text-indigo-500'
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      {statCards.map((card) => {
        const Icon = card.icon;
        return (
          <div key={card.title} className="bg-white dark:bg-gray-800 p-4 rounded-lg border">
            <div className="flex items-center">
              <div className={`p-2 rounded-lg ${card.bgColor}`}>
                <Icon className={`h-5 w-5 ${card.iconColor}`} />
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{card.title}</p>
                <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{card.value}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}