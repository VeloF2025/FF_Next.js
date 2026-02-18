/**
 * Infrastructure Health Monitoring Types
 * Comprehensive type definitions for system-wide health tracking
 */

export type ServiceStatusValue = 'up' | 'down' | 'degraded' | 'unknown';
export type OverallStatus = 'healthy' | 'degraded' | 'critical';
export type ServiceType = 'app' | 'container' | 'systemd' | 'vps' | 'database' | 'tunnel';
export type RecoveryResult = 'success' | 'failed' | 'pending';
export type AlertChannel = 'whatsapp' | 'email' | 'slack';

export interface ServiceStatus {
  status: ServiceStatusValue;
  latencyMs: number | null;
  lastCheck: string;
  message?: string;
  error?: string;
}

export interface ContainerStatus {
  name: string;
  status: 'running' | 'stopped' | 'restarting' | 'unknown';
  uptime?: string;
  containerId?: string;
}

export interface DatabaseStatus extends ServiceStatus {
  connectionPool?: {
    active: number;
    idle: number;
    total: number;
  };
  branch?: string;
  endpoint?: string;
}

export interface QFieldStatus {
  overall: OverallStatus;
  containers: ContainerStatus[];
  syncWebhook: ServiceStatus;
  totalContainers: number;
  runningContainers: number;
}

export interface RecoveryAction {
  id: string;
  timestamp: string;
  serviceName: string;
  serviceType: ServiceType;
  actionTaken: string;
  previousStatus: ServiceStatusValue;
  resultStatus: RecoveryResult;
  errorMessage?: string;
  alertSent: boolean;
  minutesAgo?: number;
}

export interface SystemHealthResponse {
  timestamp: string;
  overall: OverallStatus;
  checkDurationMs: number;

  apps: {
    production: ServiceStatus;
    staging: ServiceStatus;
    dev: ServiceStatus;
    backup: ServiceStatus;
  };

  qfield: QFieldStatus;

  ai: {
    vlm: ServiceStatus;
    ollama: ServiceStatus;
    qdrant: ServiceStatus;
  };

  messaging: {
    waFeedback: ServiceStatus;
    waBridgeVPS: ServiceStatus;
  };

  databases: {
    neonProduction: DatabaseStatus;
    neonDev: DatabaseStatus;
    qfieldDb: DatabaseStatus;
  };

  infrastructure: {
    cloudflared: ServiceStatus;
    pdfcraft: ServiceStatus;
    grafana: ServiceStatus;
    portainer: ServiceStatus;
  };

  summary: {
    totalServices: number;
    healthyCount: number;
    degradedCount: number;
    downCount: number;
    healthPercentage: number;
    criticalServicesDown: string[];
  };

  recentRecoveryActions: RecoveryAction[];
}

export interface ServiceConfig {
  id: string;
  serviceName: string;
  serviceType: ServiceType;
  displayName: string;
  healthUrl: string | null;
  healthMethod: string;
  expectedStatus: number;
  timeoutMs: number;
  autoRecoveryEnabled: boolean;
  recoveryCommand: string | null;
  maxRecoveryAttempts: number;
  recoveryCooldownMinutes: number;
  alertOnFailure: boolean;
  alertChannels: AlertChannel[];
  category: string;
  sortOrder: number;
  isCritical: boolean;
}

export interface HealthCheckOptions {
  includeRecoveryLog?: boolean;
  recoveryLogLimit?: number;
  saveToHistory?: boolean;
  triggerAlerts?: boolean;
}

export interface HealthHistoryEntry {
  id: string;
  timestamp: string;
  overallStatus: OverallStatus;
  totalServices: number;
  healthyCount: number;
  degradedCount: number;
  downCount: number;
  healthPercentage: number;
}

export interface HealthTrendData {
  timestamps: string[];
  healthy: number[];
  degraded: number[];
  down: number[];
  healthPercentage: number[];
}
