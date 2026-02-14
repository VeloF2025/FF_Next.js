/**
 * BOQ Active Import Jobs Component
 */

import { Activity, Loader2 } from 'lucide-react';
import { ImportJob } from '@/services/procurement/boqImportService';

interface BOQActiveImportJobsProps {
  activeJobs: ImportJob[];
}

export default function BOQActiveImportJobs({ activeJobs }: BOQActiveImportJobsProps) {
  if (activeJobs.length === 0) {
    return null;
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border">
      <div className="p-6 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Active Imports</h3>
          <Activity className="h-5 w-5 text-blue-500" />
        </div>
      </div>
      <div className="p-6 space-y-4">
        {activeJobs.map((job) => (
          <div key={job.id} className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
            <div className="flex items-center space-x-3">
              <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
              <div>
                <p className="font-medium text-gray-900 dark:text-gray-100">{job.fileName}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {job.status} - {Math.round(job.progress)}% complete
                </p>
              </div>
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {job.metadata.processedRows} / {job.metadata.totalRows} rows
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}