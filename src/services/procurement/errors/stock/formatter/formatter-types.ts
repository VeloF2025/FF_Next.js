/**
 * Formatter Types
 * TypeScript interfaces and types for stock error formatters
 */

export interface UserErrorDisplay {
  title: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  actions?: Array<{
    label: string;
    action: string;
    primary?: boolean;
    variant?: 'default' | 'destructive' | 'outline';
  }>;
  details: {
    itemCode: string | undefined;
    location: string | undefined;
    quantity: number | undefined;
    timestamp: Date | undefined;
  } | undefined;
}

export interface SystemErrorLog {
  timestamp: Date;
  errorId: string;
  errorType: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  details: Record<string, unknown>;
  stackTrace: string | undefined;
  context: Record<string, unknown> | undefined;
  tags: string[];
}

export interface ApiErrorResponse {
  error: true;
  errorType: string;
  message: string;
  code: string;
  details: Record<string, unknown>;
  timestamp: string;
}

export interface MultipleErrorsResult {
  summary: {
    total: number;
    byType: Record<string, number>;
    severity: 'error' | 'warning' | 'info';
  };
  errors: UserErrorDisplay[];
}

export interface ErrorReport {
  reportId: string;
  generatedAt: Date;
  timeRange: { start: Date; end: Date };
  summary: {
    totalErrors: number;
    errorsByType: Record<string, number>;
    errorsByItem: Record<string, number>;
    errorsByLocation: Record<string, number>;
  };
  trends: {
    errorRateByHour: Array<{ hour: number; count: number }>;
    mostProblematicItems: Array<{ itemCode: string; count: number; errorTypes: string[] }>;
    mostProblematicLocations: Array<{ location: string; count: number; errorTypes: string[] }>;
  };
  recommendations: string[];
}

export interface ErrorContext {
  [key: string]: unknown;
}

export type ErrorSeverity = 'critical' | 'high' | 'medium' | 'low';
export type DisplaySeverity = 'error' | 'warning' | 'info';
export type ErrorActionVariant = 'default' | 'destructive' | 'outline';