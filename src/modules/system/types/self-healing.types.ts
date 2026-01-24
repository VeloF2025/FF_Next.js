/**
 * Self-Healing Infrastructure Types
 *
 * Type definitions for the self-healing infrastructure agent system.
 * Covers services, recovery actions, incidents, and learning.
 */

// ============================================
// Service Registry Types
// ============================================

export type ServiceCategory = 'app' | 'ai' | 'messaging' | 'database' | 'infrastructure';
export type HealthCheckType = 'http' | 'systemd' | 'tcp' | 'custom';
export type HealthStatus = 'healthy' | 'unhealthy' | 'degraded' | 'timeout' | 'error';
export type OverallStatus = 'healthy' | 'degraded' | 'critical';

export interface ServiceDefinition {
  id: string;
  name: string;
  category: ServiceCategory;
  description?: string;
  healthEndpoint?: string;
  healthCheckType: HealthCheckType;
  isCritical: boolean;
  isEnabled: boolean;
  timeoutMs: number;

  // Recovery configuration
  recoveryEnabled: boolean;
  maxRecoveryAttempts: number;
  cooldownMinutes: number;

  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

export interface ServiceHealth {
  serviceId: string;
  serviceName: string;
  status: HealthStatus;
  responseTimeMs?: number;
  statusCode?: number;
  errorMessage?: string;
  lastChecked: Date;
}

export interface AggregatedHealth {
  overall: OverallStatus;
  services: ServiceHealth[];
  healthyCount: number;
  unhealthyCount: number;
  criticalDown: boolean;
  checkedAt: Date;
}

// ============================================
// Recovery Action Types
// ============================================

export type RiskLevel = 'safe' | 'moderate' | 'dangerous';
export type CommandType = 'bash' | 'ssh' | 'api';

export interface RecoveryAction {
  id: string;
  serviceId: string;
  actionName: string;
  description?: string;
  command: string;
  commandType: CommandType;

  // SSH configuration
  sshHost?: string;
  sshUser?: string;
  sshKeyPath?: string;

  // Risk classification
  riskLevel: RiskLevel;
  requiresApproval: boolean;

  // Verification
  successIndicator?: string;
  rollbackCommand?: string;

  // Execution tracking
  executionOrder: number;
  successCount: number;
  failureCount: number;
  lastExecuted?: Date;
  lastSuccess?: Date;
  lastFailure?: Date;

  // Auto-classification
  consecutiveSuccess: number;
  consecutiveFailure: number;
  autoAdjustEnabled: boolean;

  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

export interface RecoveryActionInput {
  serviceId: string;
  actionName: string;
  description?: string;
  command: string;
  commandType?: CommandType;
  sshHost?: string;
  sshUser?: string;
  riskLevel: RiskLevel;
  requiresApproval?: boolean;
  successIndicator?: string;
  rollbackCommand?: string;
  executionOrder?: number;
}

export interface ActionExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  executionTimeMs: number;
  verified: boolean;
  verificationOutput?: string;
}

// ============================================
// Incident Types
// ============================================

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface Incident {
  id: string;
  serviceId: string;
  serviceName?: string;

  // Issue details
  issueType?: string;
  symptoms: string[];
  errorMessage?: string;

  // Diagnosis
  rootCause?: string;
  confidence?: ConfidenceLevel;

  // Resolution
  resolved: boolean;
  resolvedBy?: string; // 'auto', 'manual', or user_id
  resolutionActionId?: string;
  timeToResolveSeconds?: number;

  // Learning
  humanIntervention: boolean;
  humanNotes?: string;
  learnings: string[];

  // KB Export
  kbExported: boolean;
  kbFilePath?: string;

  // Metadata
  createdAt: Date;
  resolvedAt?: Date;
}

export interface IncidentAction {
  id: string;
  incidentId: string;
  actionId: string;
  actionName?: string;
  attemptNumber: number;
  executedAt: Date;
  executionTimeMs?: number;
  success: boolean;
  output?: string;
  error?: string;
  verified: boolean;
  verificationOutput?: string;
}

export interface IncidentInput {
  serviceId: string;
  issueType?: string;
  symptoms?: string[];
  errorMessage?: string;
}

// ============================================
// Approval Queue Types
// ============================================

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'auto_expired';
export type EscalationLevel = 1 | 2 | 3;
export type EscalationChannel = 'dashboard' | 'whatsapp' | 'email' | 'slack';

export interface ApprovalQueueItem {
  id: string;
  incidentId: string;
  actionId: string;
  actionName?: string;
  serviceName?: string;
  riskLevel?: RiskLevel;

  // Request details
  requestedAt: Date;
  escalationLevel: EscalationLevel;
  escalationChannel: EscalationChannel;

  // Approval token
  approvalToken?: string;
  tokenExpiresAt?: Date;

  // Decision
  status: ApprovalStatus;
  decidedBy?: string;
  decidedAt?: Date;
  decisionReason?: string;

  // Execution
  executed: boolean;
  executionSuccess?: boolean;
  executionOutput?: string;

  // Incident context
  incident?: {
    issueType?: string;
    symptoms?: string[];
    createdAt: Date;
  };
}

export interface ApprovalDecision {
  pendingId: string;
  action: 'approve' | 'reject';
  reason?: string;
  decidedBy: string;
}

// ============================================
// Human Override Types
// ============================================

export type OverrideType = 'approve' | 'reject';

export interface RecoveryOverride {
  id: string;
  actionId: string;
  incidentId?: string;
  overrideType: OverrideType;
  overriderId?: string;
  reason?: string;
  createdAt: Date;
}

export interface OverrideInput {
  actionId: string;
  incidentId?: string;
  userId?: string;
  type: OverrideType;
  reason?: string;
}

export interface OverrideHistory {
  approvals: number;
  rejections: number;
}

// ============================================
// Classification Suggestion Types
// ============================================

export type SuggestionType = 'promote' | 'demote';
export type SuggestionStatus = 'pending' | 'approved' | 'dismissed';

export interface ClassificationSuggestion {
  id: string;
  actionId: string;
  actionName?: string;
  currentLevel: RiskLevel;
  suggestedLevel: RiskLevel;
  suggestionType: SuggestionType;
  reason: string;
  overrideCount: number;
  status: SuggestionStatus;
  decidedBy?: string;
  decidedAt?: Date;
  dismissedReason?: string;
  createdAt: Date;
  requiresConfirmation?: boolean;
}

export interface SuggestionInput {
  actionId: string;
  type: SuggestionType;
}

// ============================================
// Learning Types
// ============================================

export interface ClassificationAdjustmentResult {
  changed: boolean;
  oldLevel: RiskLevel;
  newLevel: RiskLevel;
  reason?: string;
  thresholdUsed?: {
    failureThreshold: number;
    successThreshold: number;
  };
}

export interface ConsecutiveCounts {
  consecutiveSuccess: number;
  consecutiveFailure: number;
  currentRiskLevel: RiskLevel;
  autoAdjustEnabled?: boolean;
}

export interface SuccessRate {
  actionId?: string;
  serviceId?: string;
  rate: number | null;
  totalSuccess: number;
  totalFailure: number;
  message?: string;
}

export interface MTTR {
  mttrSeconds: number | null;
  mttrFormatted: string;
  incidentCount: number;
}

export interface CommonFailure {
  type: string;
  count: number;
  percentage: number;
}

export interface ActionTrend {
  actionId: string;
  actionName?: string;
  improvement?: number;
  decline?: number;
  currentRate: number;
}

export interface PeriodStats {
  successRate: number;
  incidentCount: number;
  mttrSeconds?: number;
}

export interface PeriodComparison {
  currentPeriod: PeriodStats;
  previousPeriod: PeriodStats;
  delta: {
    successRateChange: number;
    incidentCountChange: number;
    trend: 'improving' | 'declining' | 'stable';
  };
}

// ============================================
// Knowledge Base Types
// ============================================

export interface KBExportResult {
  success: boolean;
  filePath?: string;
  content?: string;
  directoryCreated?: boolean;
  error?: string;
}

export interface KBIndexEntry {
  id: string;
  date: string;
  service: string;
  issueType?: string;
  file: string;
}

// ============================================
// Statistics Types
// ============================================

export interface SystemStats {
  overallSuccessRate: number | null;
  mttrSeconds: number | null;
  mttrFormatted: string;
  incidentCount: number;
  activeIncidents: number;
  autoFixesToday: number;
  escalationsToday: number;
  pendingApprovals: number;
  serviceStats: Array<{
    serviceId: string;
    serviceName: string;
    rate: number;
    totalAttempts: number;
  }>;
  commonFailures: CommonFailure[];
  recentActivity: ActivityEvent[];
}

export interface ActivityEvent {
  id: string;
  type: 'incident_created' | 'action_executed' | 'incident_resolved' | 'approval_requested' | 'approval_decided';
  description: string;
  timestamp: Date;
  serviceId?: string;
  serviceName?: string;
  success?: boolean;
}

export interface TimeRangeStats {
  timeRange: {
    from: Date;
    to: Date;
  };
  successRate: number;
  incidentCount: number;
  mttrSeconds: number;
}

// ============================================
// Alert Suppression Types
// ============================================

export interface AlertSuppression {
  id: string;
  serviceId: string;
  reason: string;
  startsAt: Date;
  endsAt: Date;
  createdBy?: string;
  createdAt: Date;
}

export interface SuppressionInput {
  serviceId: string;
  reason: string;
  startsAt: Date;
  endsAt: Date;
  createdBy?: string;
}

// ============================================
// Health Daemon Types
// ============================================

export interface HealthCheckResult {
  serviceId: string;
  status: HealthStatus;
  responseTimeMs: number;
  statusCode?: number;
  responseBody?: Record<string, unknown>;
  errorMessage?: string;
  checkedAt: Date;
}

export interface MonitoringLoopConfig {
  intervalMs: number;
  parallelChecks: boolean;
  autoRecoveryEnabled: boolean;
  maxConcurrentChecks: number;
}

export interface DaemonStatus {
  running: boolean;
  lastCheck?: Date;
  nextCheck?: Date;
  checksPerformed: number;
  issuesDetected: number;
  autoFixesExecuted: number;
}

// ============================================
// Escalation Types
// ============================================

export interface EscalationConfig {
  level1: {
    channel: 'dashboard';
    description: string;
  };
  level2: {
    channel: 'whatsapp';
    description: string;
    groupJid?: string;
  };
  level3: {
    channel: 'whatsapp';
    description: string;
    directNumbers?: string[];
  };
}

export interface EscalationMessage {
  title: string;
  service: string;
  status: string;
  firstDetected: Date;
  attemptedFixes: Array<{
    name: string;
    result: string;
  }>;
  suggestedAction: string;
  riskLevel: RiskLevel;
  approvalToken?: string;
}

export interface AlertResult {
  success: boolean;
  channel: EscalationChannel;
  messageId?: string;
  error?: string;
  suppressed?: boolean;
  suppressionReason?: string;
}

// ============================================
// Dashboard Types
// ============================================

export interface DashboardData {
  overallStatus: OverallStatus;
  services: ServiceHealth[];
  stats: {
    servicesUp: string; // "14/14"
    activeIncidents: number;
    vlmLatency: string; // "45ms"
    dbQueryTime: string; // "12ms"
    autoFixesToday: number;
    lastIssue: string; // "2h ago"
  };
  pendingApprovals: ApprovalQueueItem[];
  recentActivity: ActivityEvent[];
  successRate: number;
}

export type DashboardTab = 'overview' | 'infrastructure' | 'qfield' | 'self-healing';
