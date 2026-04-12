/**
 * Stock Error Handler Types
 * TypeScript interfaces and types for error handling
 */

export interface RecoveryOption {
  type: string;
  description: string;
  action: string;
  /** Arbitrary payload for this recovery option — access with type narrowing or assertion */
  data?: Record<string, unknown>;
  priority?: number;
  estimatedTime?: string;
  cost?: number;
}

export interface RetryStrategy {
  type: string;
  description: string;
  action: string;
  /** Arbitrary payload for this retry strategy — access with type narrowing or assertion */
  data?: Record<string, unknown>;
  maxAttempts?: number;
  backoffMs?: number;
}

export interface HandlerResult<T = unknown> {
  error: T;
  recoveryOptions: RecoveryOption[];
  retryStrategy?: RetryStrategy;
  severity: 'low' | 'medium' | 'high' | 'critical';
  autoRecoverable: boolean;
  requiresManualIntervention: boolean;
}

export interface ErrorHandlerConfig {
  maxRetryAttempts: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  enableAutoRecovery: boolean;
  notifyOnFailure: boolean;
  escalationLevel: 'none' | 'supervisor' | 'manager' | 'director';
}