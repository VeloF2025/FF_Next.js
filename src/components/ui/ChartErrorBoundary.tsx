import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { log } from '@/lib/logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ChartErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    log.error('Chart Error Boundary caught error:', { data: error }, 'ChartErrorBoundary');
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    log.error('Chart Error details:', { data: { error, errorInfo } }, 'ChartErrorBoundary');
    
    // Check for specific forwardRef errors from recharts
    if (error.message?.includes('forwardRef') || 
        error.message?.includes('Cannot read properties of undefined') ||
        error.stack?.includes('Surface.js')) {
      log.warn('Detected recharts forwardRef error - this is a known bundling issue', undefined, 'ChartErrorBoundary');
    }
    
    this.props.onError?.(error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false });
  };

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-tertiary)]">
          <AlertTriangle className="w-12 h-12 text-amber-500 mb-4" />
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-2">
            Chart Loading Error
          </h3>
          <p className="text-[var(--ff-text-secondary)] text-center mb-4 max-w-md">
            There was an issue loading the chart component. This might be due to a temporary
            loading problem with the chart library.
          </p>

          {/* Error details for development */}
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <details className="mt-4 w-full">
              <summary className="cursor-pointer text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]">
                Error Details (Development)
              </summary>
              <pre className="mt-2 text-xs text-red-400 bg-red-500/10 p-2 rounded border border-red-500/30 overflow-auto max-h-40">
                {this.state.error.message}
                {'\n'}
                {this.state.error.stack}
              </pre>
            </details>
          )}

          <button
            onClick={this.handleRetry}
            className="mt-4 flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry Loading
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// Hook version for functional components
export const useChartErrorHandler = () => {
  const handleChartError = (error: Error, errorInfo?: ErrorInfo) => {
    log.error('Chart error caught:', { data: error, errorInfo }, 'ChartErrorBoundary');
    
    // Report specific recharts/forwardRef errors
    if (error.message?.includes('forwardRef') || 
        error.message?.includes('Cannot read properties of undefined')) {
      log.warn('Recharts forwardRef error detected - falling back to alternative visualization', undefined, 'ChartErrorBoundary');
      
      // Could dispatch to error tracking service here
      // errorTrackingService.report(error, { context: 'chart-rendering' });
    }
  };

  return { handleChartError };
};