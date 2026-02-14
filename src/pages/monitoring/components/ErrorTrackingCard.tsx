/**
 * Error Tracking Card Component
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorEvent } from '../types/monitoring.types';

interface ErrorTrackingCardProps {
  errors: ErrorEvent[];
}

export function ErrorTrackingCard({ errors }: ErrorTrackingCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Errors (Last 24 Hours)</CardTitle>
      </CardHeader>
      <CardContent>
        {errors.length === 0 ? (
          <div className="text-center py-8 text-green-600">
            <svg
              className="w-12 h-12 mx-auto mb-2"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="font-semibold">No Errors Detected</p>
            <p className="text-sm text-muted-foreground mt-1">System is running smoothly</p>
          </div>
        ) : (
          <div className="space-y-3">
            {errors.slice(0, 5).map((error, index) => (
              <div
                key={index}
                className="flex items-start justify-between p-3 border rounded-lg hover:bg-background"
              >
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <span
                      className={`px-2 py-1 text-xs font-semibold rounded uppercase ${
                        error.severity === 'fatal' || error.severity === 'error'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-yellow-100 text-yellow-700'
                      }`}
                    >
                      {error.severity}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {new Date(error.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    {error.message}
                  </p>
                </div>
                <div className="ml-4 text-right">
                  <div className="text-lg font-bold text-foreground">{error.count}</div>
                  <div className="text-xs text-muted-foreground">occurrences</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
