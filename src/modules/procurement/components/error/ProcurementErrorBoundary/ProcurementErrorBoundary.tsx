/**
 * Procurement Error Boundary Component
 * Specialized error handling for procurement operations with modular components
 */

import React, { Component, ErrorInfo } from 'react';
import { ErrorBoundaryProps, ErrorBoundaryState } from './types/errorBoundary.types';
import { 
  getProcurementErrorMessage, 
  getProcurementContext, 
  createErrorLogData, 
  logProcurementError 
} from './utils/errorUtils';
import { ErrorDisplay } from './components/ErrorDisplay';
import { ErrorActions } from './components/ErrorActions';
import { TechnicalDetails } from './components/TechnicalDetails';
import { log } from '@/lib/logger';

export class ProcurementErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    errorInfo: null,
    showDetails: false,
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { 
      hasError: true, 
      error,
      errorInfo: null,
      showDetails: false 
    };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    log.error('Procurement Module Error:', { data: error, errorInfo }, 'ProcurementErrorBoundary');
    
    const context = getProcurementContext();
    const errorData = createErrorLogData(error, errorInfo, context);
    logProcurementError(errorData);
    
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
  };

  private handleReload = () => {
    window.location.reload();
  };

  private toggleDetails = () => {
    this.setState(prev => ({ showDetails: !prev.showDetails }));
  };

  public override render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const errorDetails = getProcurementErrorMessage(this.state.error!);
      const isComponentLevel = this.props.level === 'component';

      return (
        <div className={`${isComponentLevel ? 'bg-red-50 border border-red-200 rounded-lg p-4' : 'min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4'}`}>
          <div className={`${isComponentLevel ? 'w-full' : 'max-w-2xl w-full'}`}>
            <ErrorDisplay
              errorDetails={errorDetails}
              error={this.state.error}
              isComponentLevel={isComponentLevel}
            />

            <ErrorActions
              onReset={this.handleReset}
              onReload={this.handleReload}
              isComponentLevel={isComponentLevel}
            />

            <TechnicalDetails
              error={this.state.error}
              errorInfo={this.state.errorInfo}
              showDetails={this.state.showDetails}
              onToggleDetails={this.toggleDetails}
            />

            {/* Help Text */}
            {!isComponentLevel && (
              <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-6">
                If this problem persists, please contact support with the error details above.
              </p>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// HOC wrapper for easier use
export function withProcurementErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  level: 'module' | 'component' | 'page' = 'component'
) {
  const WrappedComponent = (props: P) => (
    <ProcurementErrorBoundary level={level}>
      <Component {...props} />
    </ProcurementErrorBoundary>
  );
  WrappedComponent.displayName = `withProcurementErrorBoundary(${Component.displayName || Component.name})`;
  return WrappedComponent;
}