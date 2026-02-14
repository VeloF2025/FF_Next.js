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
    <div className="bg-card rounded-lg border">
      <div className="p-6 border-b border-border">
        <h3 className="text-lg font-medium text-foreground">Import Statistics</h3>
      </div>
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="text-center">
            <p className="text-2xl font-bold text-foreground">{importStats.totalJobs}</p>
            <p className="text-sm text-muted-foreground">Total Imports</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-green-600">{importStats.completedJobs}</p>
            <p className="text-sm text-muted-foreground">Successful</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-red-600">{importStats.failedJobs}</p>
            <p className="text-sm text-muted-foreground">Failed</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-blue-600">{importStats.totalItemsImported.toLocaleString()}</p>
            <p className="text-sm text-muted-foreground">Items Imported</p>
          </div>
        </div>
      </div>
    </div>
  );
}