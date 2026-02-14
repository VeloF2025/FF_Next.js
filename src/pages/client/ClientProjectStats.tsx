/**
 * Client Project Statistics Component
 */

import { Client } from '@/types/client.types';

interface ClientProjectStatsProps {
  client: Client;
  formatCurrency: (amount: number) => string;
}

export function ClientProjectStats({ client, formatCurrency }: ClientProjectStatsProps) {
  return (
    <div>
      <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">Project Statistics</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-blue-50 rounded-lg p-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">Total Projects</p>
          <p className="text-2xl font-semibold text-blue-900">{client.totalProjects}</p>
        </div>

        <div className="bg-green-50 rounded-lg p-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">Active Projects</p>
          <p className="text-2xl font-semibold text-green-900">{client.activeProjects}</p>
        </div>

        <div className="bg-purple-50 rounded-lg p-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">Completed Projects</p>
          <p className="text-2xl font-semibold text-purple-900">{client.completedProjects}</p>
        </div>
      </div>

      {/* Project Value Statistics */}
      <div className="mt-4 bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">Total Project Value</p>
        <p className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
          {formatCurrency(client.totalProjectValue)}
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Avg: {formatCurrency(client.averageProjectValue)}
        </p>
      </div>
    </div>
  );
}