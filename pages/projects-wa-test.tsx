/**
 * Test Page for WA Monitor Integration
 * Route: /projects-wa-test
 */

import { useWaMonitorSummary } from '@/modules/wa-monitor/hooks/useWaMonitorStats';
import { CheckCircle } from 'lucide-react';

export default function ProjectsWaTestPage() {
  const { data: waStats, isLoading, error } = useWaMonitorSummary();

  return (
    <div className="min-h-screen bg-[var(--ff-bg-tertiary)] p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8 text-[var(--ff-text-primary)]">WA Monitor Integration Test</h1>

        {/* Debug Info */}
        <div className="mb-6 p-4 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
          <h2 className="font-semibold mb-2 text-[var(--ff-text-primary)]">Debug Info:</h2>
          <p className="text-[var(--ff-text-secondary)]">Loading: {isLoading ? 'Yes' : 'No'}</p>
          <p className="text-[var(--ff-text-secondary)]">Error: {error ? error.message : 'None'}</p>
          <p className="text-[var(--ff-text-secondary)]">Data: {waStats ? 'Loaded' : 'No data'}</p>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="p-6 bg-blue-500/20 rounded-lg">
            <p className="text-[var(--ff-text-primary)]">Loading WA Monitor stats...</p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="p-6 bg-red-500/20 rounded-lg">
            <p className="text-red-400">Error: {error.message}</p>
          </div>
        )}

        {/* WA Stats Card */}
        {waStats && (
          <div className="mb-6 bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)] shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-sm text-[var(--ff-text-secondary)]">QA Drops Today</p>
                <p className="text-2xl font-bold text-[var(--ff-text-primary)] mt-1">
                  {waStats.total.toLocaleString()}
                </p>
                {waStats.total > 0 && (
                  <>
                    <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
                      {waStats.complete} Complete • {waStats.incomplete} Incomplete
                    </p>
                    <div className="flex items-center mt-2">
                      <span className={`text-sm font-medium ${
                        waStats.completionRate >= 80 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {waStats.completionRate >= 80 ? '↑' : '↓'} {waStats.completionRate}% Complete
                      </span>
                    </div>
                  </>
                )}
              </div>
              <div className="h-12 w-12 bg-purple-500/20 rounded-full flex items-center justify-center flex-shrink-0 ml-4">
                <CheckCircle className="h-6 w-6 text-purple-400" />
              </div>
            </div>
          </div>
        )}

        {/* Raw Data */}
        {waStats && (
          <div className="p-6 bg-[var(--ff-bg-tertiary)] rounded-lg border border-[var(--ff-border-light)]">
            <h2 className="font-semibold mb-2 text-[var(--ff-text-primary)]">Raw API Response:</h2>
            <pre className="text-xs overflow-auto text-[var(--ff-text-primary)]">
              {JSON.stringify(waStats, null, 2)}
            </pre>
          </div>
        )}

        {/* API Test Link */}
        <div className="mt-6 p-4 bg-blue-500/20 rounded-lg border border-[var(--ff-border-light)]">
          <p className="mb-2 text-[var(--ff-text-primary)]">Test API directly:</p>
          <a
            href="/api/wa-monitor-projects-summary"
            target="_blank"
            className="text-blue-600 underline"
          >
            /api/wa-monitor-projects-summary
          </a>
        </div>
      </div>
    </div>
  );
}
