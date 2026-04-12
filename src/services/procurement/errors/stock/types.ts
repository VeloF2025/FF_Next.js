/**
 * Stock Error System - Foundation Types
 * Base interfaces and types with zero dependencies to prevent circular imports
 */

/**
 * Recovery option interface
 */
export interface RecoveryOption {
  type: string;
  description: string;
  action: string;
  data: Record<string, unknown>;
  priority?: number;
  estimatedTime?: string;
  cost?: number;
}

/**
 * Retry strategy interface
 */
export interface RetryStrategy {
  type: string;
  description: string;
  action: string;
  data: Record<string, unknown>;
  maxAttempts?: number;
  backoffMs?: number;
  estimatedTime?: string;
}

/**
 * Error severity levels
 */
export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Handler result interface
 */
export interface HandlerResult<T = unknown> {
  error: T;
  recoveryOptions?: RecoveryOption[];
  retryStrategies?: RetryStrategy[];
  severity: ErrorSeverity;
  autoRecoverable: boolean;
  requiresManualIntervention?: boolean;
}

/**
 * Error context interface
 */
export interface ErrorContext {
  timestamp?: Date;
  correlationId?: string;
  userId?: string;
  sessionId?: string;
  requestId?: string;
  operation?: string;
  metadata?: Record<string, unknown>;
}

/**
 * User error display interface
 */
export interface UserErrorDisplay {
  title: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  actions?: Array<{
    label: string;
    action: string;
    primary?: boolean;
  }>;
  category: string | undefined;
  itemCode: string | undefined;
  priority: ErrorSeverity | undefined;
  details?: {
    itemCode: string | undefined;
    location: string | undefined;
    quantity: number | undefined;
    timestamp: Date | undefined;
  } | undefined;
}

/**
 * System error log interface
 */
export interface SystemErrorLog {
  timestamp: Date;
  errorId: string;
  errorType: string;
  severity: ErrorSeverity;
  message: string;
  details: Record<string, unknown>;
  stackTrace: string | undefined;
  context: ErrorContext | undefined;
  tags: string[];
}

/**
 * Error analysis result interface
 */
export interface ErrorAnalysisResult {
  patterns: ErrorPattern[];
  trends: ErrorTrend[];
  insights: ErrorInsight[];
  recommendations: string[];
}

/**
 * Error pattern interface
 */
export interface ErrorPattern {
  type: string;
  frequency: number;
  description: string;
  impact: ErrorSeverity;
  suggestedActions: string[];
}

/**
 * Error trend interface
 */
export interface ErrorTrend {
  period: string;
  errorType: string;
  count: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  percentageChange: number;
}

/**
 * Error insight interface
 */
export interface ErrorInsight {
  category: string;
  description: string;
  impact: ErrorSeverity;
  actionable: boolean;
  priority: number;
}

/**
 * Stock error type union
 */
export type StockErrorType = 
  | 'insufficient_stock'
  | 'stock_movement_failed'
  | 'stock_reservation_failed'
  | 'stock_transfer_failed'
  | 'stock_adjustment_failed'
  | 'stock_tracking_failed';

/**
 * Movement type union
 */
export type MovementType = 'inbound' | 'outbound' | 'transfer' | 'adjustment';

/**
 * Adjustment type union
 */
export type AdjustmentType = 'increase' | 'decrease' | 'recount';

/**
 * Alternative location interface
 */
export interface AlternativeLocation {
  location: string;
  locationId: string;
  availableQuantity: number;
  estimatedTransferTime?: string;
  transferCost?: number;
}

/**
 * Alternative item interface
 */
export interface AlternativeItem {
  itemCode: string;
  itemName: string;
  availableQuantity: number;
  compatibility: number;
  priceDifference?: number;
}

/**
 * Existing reservation interface
 */
export interface ExistingReservation {
  reservationId: string;
  quantity: number;
  expiresAt?: Date;
  purpose: string;
}

/**
 * Movement options interface
 */
export interface MovementOptions {
  fromLocation?: string;
  toLocation?: string;
  movementId?: string;
}

/**
 * Transfer options interface
 */
export interface TransferOptions {
  transferId?: string;
}

/**
 * Adjustment options interface
 */
export interface AdjustmentOptions {
  adjustmentReason?: string;
}

/**
 * Insufficient stock options interface
 */
export interface InsufficientStockOptions {
  reservedQuantity?: number;
  category?: string;
  specifications?: Record<string, unknown>;
  unitPrice?: number;
  alternativeLocations?: AlternativeLocation[];
  alternativeItems?: AlternativeItem[];
}

/**
 * Tracking options interface
 */
export interface TrackingOptions {
  trackingId?: string;
}