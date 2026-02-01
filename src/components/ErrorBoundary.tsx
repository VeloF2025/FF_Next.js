import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home, ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    showDetails: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { 
      hasError: true, 
      error,
      errorInfo: null,
      showDetails: false 
    };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // TODO: Replace with proper logging service
    // log.error('Uncaught error:', { data: error, errorInfo }, 'ErrorBoundary');
    this.setState({
      error,
      errorInfo,
    });
  }

  private handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    });
    window.location.reload();
  };

  private handleGoHome = () => {
    window.location.href = '/app/dashboard';
  };

  private toggleDetails = () => {
    this.setState(prev => ({ showDetails: !prev.showDetails }));
  };

  public override render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-[var(--ff-bg-primary)] flex items-center justify-center px-4">
          <div className="max-w-2xl w-full">
            <div className="bg-[var(--ff-bg-secondary)] shadow-lg rounded-lg p-8">
              {/* Error Icon and Title */}
              <div className="flex items-center justify-center mb-6">
                <div className="bg-red-500/20 rounded-full p-3">
                  <AlertTriangle className="h-12 w-12 text-red-400" />
                </div>
              </div>

              <h1 className="text-2xl font-bold text-[var(--ff-text-primary)] text-center mb-2">
                Oops! Something went wrong
              </h1>

              <p className="text-[var(--ff-text-secondary)] text-center mb-6">
                We&apos;re sorry, but something unexpected happened. The error has been logged and we&apos;ll look into it.
              </p>

              {/* Error Message */}
              {this.state.error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6">
                  <p className="text-sm font-mono text-red-400">
                    {this.state.error.message || 'An unexpected error occurred'}
                  </p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-3 mb-6">
                <button
                  onClick={this.handleReset}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <RefreshCw className="h-4 w-4" />
                  Try Again
                </button>
                <button
                  onClick={this.handleGoHome}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] rounded-lg hover:bg-[var(--ff-bg-hover)] transition-colors"
                >
                  <Home className="h-4 w-4" />
                  Go to Dashboard
                </button>
              </div>

              {/* Technical Details (Collapsible) */}
              <div className="border-t border-[var(--ff-border-light)] pt-4">
                <button
                  onClick={this.toggleDetails}
                  className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
                >
                  {this.state.showDetails ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                  Technical Details
                </button>

                {this.state.showDetails && this.state.errorInfo && (
                  <div className="mt-4 space-y-4">
                    {/* Stack Trace */}
                    <div>
                      <h3 className="text-xs font-semibold text-[var(--ff-text-secondary)] tracking-wide mb-2">
                        Stack Trace
                      </h3>
                      <pre className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] p-4 rounded-lg overflow-x-auto text-xs border border-[var(--ff-border-light)]">
                        {this.state.error?.stack}
                      </pre>
                    </div>

                    {/* Component Stack */}
                    <div>
                      <h3 className="text-xs font-semibold text-[var(--ff-text-secondary)] tracking-wide mb-2">
                        Component Stack
                      </h3>
                      <pre className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] p-4 rounded-lg overflow-x-auto text-xs border border-[var(--ff-border-light)]">
                        {this.state.errorInfo.componentStack}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Help Text */}
            <p className="text-center text-sm text-[var(--ff-text-secondary)] mt-6">
              If this problem persists, please contact support with the error details above.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Functional component wrapper for easier use with hooks
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  fallback?: ReactNode
) {
  const WrappedComponent = (props: P) => (
    <ErrorBoundary fallback={fallback}>
      <Component {...props} />
    </ErrorBoundary>
  );
  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`;
  return WrappedComponent;
}

// Default export for compatibility
export default ErrorBoundary;