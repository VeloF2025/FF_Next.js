/**
 * Database Error Boundary Component
 * Specifically handles database connection failures and prevents infinite re-rendering loops
 */

import { Component, ReactNode } from 'react';
import { log } from '@/lib/logger';

interface DatabaseErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: any;
  isDatabaseError: boolean;
}

interface DatabaseErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: any) => void;
}

export class DatabaseErrorBoundary extends Component<
  DatabaseErrorBoundaryProps,
  DatabaseErrorBoundaryState
> {
  constructor(props: DatabaseErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      isDatabaseError: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<DatabaseErrorBoundaryState> {
    // Check if this is a database-related error
    const isDatabaseError = error.message.includes('password authentication failed') ||
                           error.message.includes('connection refused') ||
                           error.message.includes('network error') ||
                           error.message.includes('NeonDbError') ||
                           error.message.includes('database') ||
                           error.message.includes('ECONNREFUSED');

    return {
      hasError: true,
      error,
      isDatabaseError,
    };
  }

  override componentDidCatch(error: Error, errorInfo: any) {
    this.setState({
      errorInfo,
    });

    // Log the error
    log.error('Database Error Boundary caught error:', { 
      data: { error: error.message, errorInfo, stack: error.stack } 
    }, 'DatabaseErrorBoundary');

    // Call the onError callback if provided
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      isDatabaseError: false,
    });
  };

  handleReload = () => {
    window.location.reload();
  };

  override render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Special handling for database errors
      if (this.state.isDatabaseError) {
        return (
          <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
            <div className="max-w-lg w-full">
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 text-center">
                {/* Error Icon */}
                <div className="w-16 h-16 mx-auto mb-6 bg-red-100 rounded-full flex items-center justify-center">
                  <svg 
                    className="w-8 h-8 text-red-500" 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path 
                      strokeLinecap="round" 
                      strokeLinejoin="round" 
                      strokeWidth={2} 
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" 
                    />
                  </svg>
                </div>

                {/* Title */}
                <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-3">
                  Database Connection Issue
                </h1>

                {/* Description */}
                <p className="text-gray-600 dark:text-gray-400 mb-8 leading-relaxed">
                  We're experiencing connectivity issues with the database. This may be temporary due to network conditions or server maintenance.
                </p>

                {/* Action Buttons */}
                <div className="space-y-3">
                  <button 
                    onClick={this.handleRetry}
                    className="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-3 px-4 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                  >
                    Try Again
                  </button>
                  
                  <button 
                    onClick={this.handleReload}
                    className="w-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-medium py-3 px-4 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
                  >
                    Reload Application
                  </button>
                </div>

                {/* Technical Details (Expandable) */}
                <details className="mt-6 text-left">
                  <summary className="text-sm text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:text-gray-300 focus:outline-none">
                    Technical Details
                  </summary>
                  <div className="mt-3 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                    <div className="text-xs font-mono text-gray-700 dark:text-gray-300 break-all">
                      <div className="mb-2">
                        <strong>Error:</strong> {this.state.error?.message}
                      </div>
                      <div className="text-gray-500 dark:text-gray-400">
                        <strong>Time:</strong> {new Date().toLocaleString()}
                      </div>
                    </div>
                  </div>
                </details>

                {/* Support Information */}
                <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                  <p className="text-sm text-blue-700">
                    <strong>Need Help?</strong> If this issue persists, please contact your system administrator or check the system status page.
                  </p>
                </div>
              </div>
            </div>
          </div>
        );
      }

      // Generic error fallback
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
          <div className="max-w-md w-full">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 text-center">
              <div className="w-12 h-12 mx-auto mb-4 bg-red-100 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                Something went wrong
              </h2>
              
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                An unexpected error occurred. Please try again.
              </p>
              
              <div className="space-y-2">
                <button 
                  onClick={this.handleRetry}
                  className="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  Try Again
                </button>
                
                <button 
                  onClick={this.handleReload}
                  className="w-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  Reload Page
                </button>
              </div>

              <details className="mt-4 text-left">
                <summary className="text-xs text-gray-500 dark:text-gray-400 cursor-pointer">Error Details</summary>
                <div className="mt-2 p-2 bg-gray-100 dark:bg-gray-800 rounded text-xs font-mono text-gray-700 dark:text-gray-300 break-all">
                  {this.state.error?.message}
                </div>
              </details>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default DatabaseErrorBoundary;