/**
 * Database Health Monitor
 * Provides centralized health monitoring for database connections
 */

import React from 'react';
import { log } from '@/lib/logger';
import { neonUtils } from '@/lib/neon/connection';

interface HealthStatus {
  isHealthy: boolean;
  lastCheck: Date;
  error?: string | undefined;
  timing?: number | undefined;
  consecutiveFailures: number;
}

class DatabaseHealthMonitor {
  private healthStatus: HealthStatus = {
    isHealthy: true,
    lastCheck: new Date(),
    consecutiveFailures: 0,
  };

  private checkInterval: NodeJS.Timeout | null = null;
  private readonly MAX_CONSECUTIVE_FAILURES = 3;

  get isMonitoring(): boolean {
    return this.checkInterval !== null;
  }
  private readonly CHECK_INTERVAL_MS = 30000; // 30 seconds

  /**
   * Start continuous health monitoring
   */
  startMonitoring(): void {
    if (this.checkInterval) {
      return; // Already monitoring
    }

    log.info('Starting database health monitoring', {}, 'DatabaseHealthMonitor');

    // Initial check
    this.checkHealth();

    // Set up periodic checks
    this.checkInterval = setInterval(() => {
      this.checkHealth();
    }, this.CHECK_INTERVAL_MS);
  }

  /**
   * Stop health monitoring
   */
  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      log.info('Stopped database health monitoring', {}, 'DatabaseHealthMonitor');
    }
  }

  /**
   * Perform immediate health check
   */
  async checkHealth(): Promise<HealthStatus> {
    const startTime = Date.now();
    
    try {
      const pingResult = await neonUtils.ping();
      const timing = Date.now() - startTime;
      
      if (pingResult.success) {
        // Health check passed
        const wasUnhealthy = !this.healthStatus.isHealthy;
        
        this.healthStatus = {
          isHealthy: true,
          lastCheck: new Date(),
          error: undefined,
          timing,
          consecutiveFailures: 0,
        };

        if (wasUnhealthy) {
          log.info('Database connection restored', { data: { timing } }, 'DatabaseHealthMonitor');
        }
      } else {
        // Health check failed
        this.handleHealthFailure(pingResult.error || 'Unknown error', Date.now() - startTime);
      }
    } catch (error) {
      // Health check threw exception
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.handleHealthFailure(errorMessage, Date.now() - startTime);
    }

    return this.healthStatus;
  }

  /**
   * Handle health check failure
   */
  private handleHealthFailure(error: string, timing: number): void {
    const consecutiveFailures = this.healthStatus.consecutiveFailures + 1;
    const isHealthy = consecutiveFailures < this.MAX_CONSECUTIVE_FAILURES;

    this.healthStatus = {
      isHealthy,
      lastCheck: new Date(),
      error,
      timing,
      consecutiveFailures,
    };

    if (consecutiveFailures === 1) {
      log.warn('Database health check failed', { 
        data: { error, timing, consecutiveFailures } 
      }, 'DatabaseHealthMonitor');
    } else if (consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
      log.error('Database connection lost', { 
        data: { error, timing, consecutiveFailures } 
      }, 'DatabaseHealthMonitor');
    }
  }

  /**
   * Get current health status
   */
  getHealthStatus(): HealthStatus {
    return { ...this.healthStatus };
  }

  /**
   * Check if database is currently healthy
   */
  isHealthy(): boolean {
    return this.healthStatus.isHealthy;
  }

  /**
   * Get time since last health check
   */
  getTimeSinceLastCheck(): number {
    return Date.now() - this.healthStatus.lastCheck.getTime();
  }

  /**
   * Force health status (for testing/emergency scenarios)
   */
  setHealthStatus(isHealthy: boolean, error?: string | undefined): void {
    this.healthStatus = {
      ...this.healthStatus,
      isHealthy,
      error: error || undefined,
      lastCheck: new Date(),
      consecutiveFailures: isHealthy ? 0 : this.MAX_CONSECUTIVE_FAILURES,
    };

    log.warn('Health status manually set', { 
      data: { isHealthy, error } 
    }, 'DatabaseHealthMonitor');
  }

  /**
   * Get health metrics for monitoring dashboards
   */
  getMetrics(): {
    isHealthy: boolean;
    lastCheckAge: number;
    consecutiveFailures: number;
    averageResponseTime: number | null;
  } {
    return {
      isHealthy: this.healthStatus.isHealthy,
      lastCheckAge: this.getTimeSinceLastCheck(),
      consecutiveFailures: this.healthStatus.consecutiveFailures,
      averageResponseTime: this.healthStatus.timing || null,
    };
  }
}

// Create singleton instance
export const databaseHealthMonitor = new DatabaseHealthMonitor();

// React hook for using health status in components
export function useDatabaseHealth() {
  const [healthStatus, setHealthStatus] = React.useState<HealthStatus>(
    databaseHealthMonitor.getHealthStatus()
  );

  React.useEffect(() => {
    // Start monitoring when first component mounts
    databaseHealthMonitor.startMonitoring();

    // Set up polling for health status updates
    const interval = setInterval(() => {
      setHealthStatus(databaseHealthMonitor.getHealthStatus());
    }, 5000); // Update UI every 5 seconds

    return () => {
      clearInterval(interval);
    };
  }, []);

  return {
    ...healthStatus,
    checkHealth: () => databaseHealthMonitor.checkHealth(),
    isMonitoring: databaseHealthMonitor.isMonitoring,
  };
}

export default databaseHealthMonitor;