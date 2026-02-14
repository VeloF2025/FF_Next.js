/**
 * BOQ Import Statistics Component
 */

import { ImportStats } from '@/services/procurement/boqImportService';

interface BOQImportStatisticsProps {
  importStats: ImportStats | null;
}

export default function BOQImportStatistics({ importStats }: BOQImportStatisticsProps) {
  if (!importStats) {
    return null;
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border">
      <div className="p-6 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Import Statistics</h3>
      </div>
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{importStats.totalJobs}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">Total Imports</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-green-600">{importStats.completedJobs}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">Successful</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-red-600">{importStats.failedJobs}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">Failed</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-blue-600">{importStats.totalItemsImported.toLocaleString()}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">Items Imported</p>
          </div>
        </div>
      </div>
    </div>
  );
}