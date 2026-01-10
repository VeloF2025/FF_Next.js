/**
 * Database Health Indicator Component
 * Shows connection status and provides fallback UI for database errors
 */

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { log } from '@/lib/logger';

interface DatabaseHealthIndicatorProps {
  showDetails?: boolean;
  children?: React.ReactNode;
}

export const DatabaseHealthIndicator: React.FC<DatabaseHealthIndicatorProps> = ({
  showDetails = false,
  children
}) => {
  const [lastCheck, setLastCheck] = useState<Date | null>(null);

  const {
    data: healthStatus,
    isLoading,
    isError,
    error,
    refetch
  } = useQuery({
    queryKey: ['database-health'],
    queryFn: async () => {
      try {
        // Use API endpoint for health check instead of direct database connection
        const response = await fetch('/api/health');
        const data = await response.json();
        setLastCheck(new Date());
        return {
          success: data.database === 'connected',
          timestamp: new Date().toISOString()
        };
      } catch (error) {
        log.error('Database health check failed:', { data: error }, 'DatabaseHealthIndicator');
        throw error;
      }
    },
    refetchInterval: 5 * 60 * 1000, // Check every 5 minutes
    retry: (failureCount, error) => {
      // Don't retry on auth errors
      if (error && typeof error === 'object') {
        const errorMessage = 'message' in error ? (error as any).message : '';
        if (errorMessage.includes('password authentication failed') || 
            errorMessage.includes('connection refused')) {
          return false;
        }
      }
      return failureCount < 2;
    },
    retryDelay: 30000, // Wait 30 seconds between retries
    staleTime: 2 * 60 * 1000, // 2 minutes
  });

  const isHealthy = !isError && healthStatus?.success;
  const statusColor = isLoading ? 'text-yellow-500' : isHealthy ? 'text-green-500' : 'text-red-500';
  const statusText = isLoading ? 'Checking...' : isHealthy ? 'Connected' : 'Disconnected';

  const handleRetryConnection = () => {
    refetch();
  };

  if (!showDetails && !isError) {
    return <>{children}</>;
  }

  if (isError && !showDetails) {
    // Render fallback UI when database is unavailable
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--ff-bg-primary)]">
        <div className="max-w-md w-full mx-auto p-6">
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-lg p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-red-500/20 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.966-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>

            <h2 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-2">
              Database Connection Issue
            </h2>

            <p className="text-[var(--ff-text-secondary)] mb-6">
              We're having trouble connecting to the database. This may be due to network issues or server maintenance.
            </p>

            <div className="space-y-4">
              <button
                onClick={handleRetryConnection}
                className="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                disabled={isLoading}
              >
                {isLoading ? 'Reconnecting...' : 'Try Again'}
              </button>

              {error && (
                <details className="text-left">
                  <summary className="text-sm text-[var(--ff-text-secondary)] cursor-pointer hover:text-[var(--ff-text-primary)]">
                    Technical Details
                  </summary>
                  <div className="mt-2 p-3 bg-[var(--ff-bg-tertiary)] rounded text-xs text-[var(--ff-text-secondary)] font-mono">
                    {error instanceof Error ? error.message : 'Unknown error'}
                  </div>
                </details>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {showDetails && (
        <div className="flex items-center gap-2 px-3 py-1 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg shadow-sm">
          <div className={`w-2 h-2 rounded-full ${isHealthy ? 'bg-green-500' : 'bg-red-500'} ${isLoading ? 'animate-pulse' : ''}`} />
          <span className={`text-xs font-medium ${statusColor}`}>
            Database: {statusText}
          </span>
          {showDetails && lastCheck && (
            <span className="text-xs text-[var(--ff-text-tertiary)]">
              • Last check: {lastCheck.toLocaleTimeString()}
            </span>
          )}
          {isError && (
            <button
              onClick={handleRetryConnection}
              className="text-xs text-blue-400 hover:text-blue-300 underline ml-2"
              disabled={isLoading}
            >
              Retry
            </button>
          )}
        </div>
      )}
      {children}
    </>
  );
};

export default DatabaseHealthIndicator;