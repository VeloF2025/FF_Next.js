import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home, Mail } from 'lucide-react';
import { log } from '@/lib/logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({
      error,
      errorInfo,
    });

    // Call custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Log error to console in development
    if (process.env.NODE_ENV === 'development') {
      log.error('ErrorBoundary caught an error:', { data: error, errorInfo }, 'ErrorBoundary');
    }

    // In production, you would send this to your error tracking service
    // Example: Sentry.captureException(error, { contexts: { react: errorInfo } });
  }

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleGoHome = () => {
    window.location.href = '/app/dashboard';
  };

  handleReportError = () => {
    const { error, errorInfo } = this.state;
    const errorReport = {
      message: error?.message || 'Unknown error',
      stack: error?.stack || 'No stack trace',
      componentStack: errorInfo?.componentStack || 'No component stack',
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
    };

    // Create mailto link with error details
    const subject = encodeURIComponent('FibreFlow Error Report');
    const body = encodeURIComponent(`
Error Details:
${JSON.stringify(errorReport, null, 2)}

Please describe what you were doing when this error occurred:
[Your description here]
    `);
    
    window.location.href = `mailto:support@fibreflow.com?subject=${subject}&body=${body}`;
  };

  override render() {
    if (this.state.hasError) {
      // Custom fallback UI if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <div className="min-h-screen bg-[var(--ff-background-secondary)] flex items-center justify-center p-4">
          <div className="max-w-lg w-full bg-[var(--ff-surface-primary)] rounded-lg shadow-xl border border-[var(--ff-border-primary)] p-8">
            {/* Error Icon */}
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 bg-error-100 rounded-full flex items-center justify-center">
                <AlertTriangle className="w-8 h-8 text-error-600" />
              </div>
            </div>

            {/* Error Message */}
            <div className="text-center mb-6">
              <h1 className="text-2xl font-bold text-[var(--ff-text-primary)] mb-2">
                Something went wrong
              </h1>
              <p className="text-[var(--ff-text-secondary)] mb-4">
                We&apos;re sorry, but something unexpected happened. The error has been logged and we&apos;ll look into it.
              </p>

              {/* Error Details (Development only) */}
              {process.env.NODE_ENV === 'development' && this.state.error && (
                <details className="mt-4 p-4 bg-[var(--ff-surface-secondary)] rounded-lg border border-[var(--ff-border-secondary)] text-left">
                  <summary className="cursor-pointer font-medium text-[var(--ff-text-primary)] mb-2">
                    Error Details (Development)
                  </summary>
                  <div className="text-sm text-[var(--ff-text-secondary)] space-y-2">
                    <div>
                      <strong>Message:</strong>
                      <pre className="mt-1 p-2 bg-[var(--ff-background-tertiary)] rounded text-xs overflow-auto">
                        {this.state.error.message}
                      </pre>
                    </div>
                    {this.state.error.stack && (
                      <div>
                        <strong>Stack Trace:</strong>
                        <pre className="mt-1 p-2 bg-[var(--ff-background-tertiary)] rounded text-xs overflow-auto max-h-32">
                          {this.state.error.stack}
                        </pre>
                      </div>
                    )}
                    {this.state.errorInfo?.componentStack && (
                      <div>
                        <strong>Component Stack:</strong>
                        <pre className="mt-1 p-2 bg-[var(--ff-background-tertiary)] rounded text-xs overflow-auto max-h-32">
                          {this.state.errorInfo.componentStack}
                        </pre>
                      </div>
                    )}
                  </div>
                </details>
              )}
            </div>

            {/* Action Buttons */}
            <div className="space-y-3">
              <button
                onClick={this.handleRetry}
                className="w-full bg-primary-600 hover:bg-primary-700 text-white font-medium py-3 px-4 rounded-lg transition-colors duration-200 flex items-center justify-center space-x-2"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Try Again</span>
              </button>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={this.handleGoHome}
                  className="bg-[var(--ff-surface-secondary)] hover:bg-[var(--ff-surface-tertiary)] text-[var(--ff-text-primary)] font-medium py-2 px-4 rounded-lg border border-[var(--ff-border-primary)] transition-colors duration-200 flex items-center justify-center space-x-2"
                >
                  <Home className="w-4 h-4" />
                  <span>Go Home</span>
                </button>

                <button
                  onClick={this.handleReportError}
                  className="bg-[var(--ff-surface-secondary)] hover:bg-[var(--ff-surface-tertiary)] text-[var(--ff-text-primary)] font-medium py-2 px-4 rounded-lg border border-[var(--ff-border-primary)] transition-colors duration-200 flex items-center justify-center space-x-2"
                >
                  <Mail className="w-4 h-4" />
                  <span>Report</span>
                </button>
              </div>
            </div>

            {/* Additional Help */}
            <div className="mt-6 text-center text-sm text-[var(--ff-text-tertiary)]">
              <p>If this problem persists, please contact support with the error report.</p>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Functional wrapper for easier usage
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<Props, 'children'>
) {
  const WrappedComponent = (props: P) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <Component {...props} />
    </ErrorBoundary>
  );

  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`;
  
  return WrappedComponent;
}

// Hook for throwing errors in functional components
export function useErrorHandler() {
  return (error: Error, _errorInfo?: string) => {
    throw error;
  };
}