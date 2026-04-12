/**
 * Stock Error Handler - Modular Export Barrel
 * Central export point for all handler components
 */

// Core handler types
export * from './handler-types';

// Core error handler
export { CoreErrorHandler } from './error-handler';

// Recovery and retry handler
export { RecoveryHandler } from './recovery-handler';

// Notification and escalation handler
export { NotificationHandler } from './notification-handler';

// Legacy compatibility - re-export everything as StockErrorHandler for backward compatibility
export { CoreErrorHandler as StockErrorHandler } from './error-handler';

// Combined handler result type for convenience
export interface StockHandlerResult<T = unknown> {
  error: T;
  recoveryOptions: import('./handler-types').RecoveryOption[];
  retryStrategies?: import('./handler-types').RetryStrategy[];
  notifications?: {
    sent: boolean;
    channels: string[];
    messageId?: string;
  };
  severity: 'low' | 'medium' | 'high' | 'critical';
  autoRecoverable: boolean;
  requiresManualIntervention: boolean;
}