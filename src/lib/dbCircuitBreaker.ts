/**
 * Database Circuit Breaker
 *
 * Protects the app from cascading failures when Neon DB goes slow or unresponsive.
 *
 * States:
 * - CLOSED (normal): queries pass through, failures are counted
 * - OPEN (tripped): queries fast-fail immediately, a probe runs every `resetTimeoutMs`
 * - HALF_OPEN: one probe query allowed through to test recovery
 *
 * When the circuit trips, a WhatsApp alert is sent via the escalation service.
 */

import { log } from '@/lib/logger';

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerConfig {
  /** Consecutive failures before tripping (default: 5) */
  failureThreshold: number;
  /** How long to stay open before probing (default: 30s) */
  resetTimeoutMs: number;
  /** Slow query threshold that counts as a failure (default: 15s) */
  slowQueryThresholdMs: number;
}

interface CircuitStats {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
  trippedAt: number | null;
  totalTrips: number;
  totalFailures: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  slowQueryThresholdMs: 15_000,
};

class DbCircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private lastFailureAt: number | null = null;
  private lastSuccessAt: number | null = null;
  private trippedAt: number | null = null;
  private totalTrips = 0;
  private totalFailures = 0;
  private config: CircuitBreakerConfig;
  private alertSent = false;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute a query through the circuit breaker
   */
  async execute<T>(queryFn: () => Promise<T>): Promise<T> {
    // Check if circuit should transition from OPEN → HALF_OPEN
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - (this.trippedAt || 0);
      if (elapsed >= this.config.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
        log.info('[CircuitBreaker] Transitioning to HALF_OPEN, probing DB...');
      } else {
        throw new CircuitOpenError(
          `Database circuit breaker is OPEN. Fast-failing to protect the app. Resets in ${Math.ceil((this.config.resetTimeoutMs - elapsed) / 1000)}s.`
        );
      }
    }

    const start = Date.now();
    try {
      const result = await queryFn();
      const duration = Date.now() - start;

      // Slow query counts as degraded but not a failure
      if (duration > this.config.slowQueryThresholdMs) {
        log.warn(`[CircuitBreaker] Slow query: ${duration}ms (threshold: ${this.config.slowQueryThresholdMs}ms)`);
      }

      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      log.info('[CircuitBreaker] Probe succeeded, closing circuit');
    }

    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.lastSuccessAt = Date.now();
    this.alertSent = false;
  }

  private onFailure(error: unknown): void {
    this.consecutiveFailures++;
    this.totalFailures++;
    this.lastFailureAt = Date.now();

    const errMsg = error instanceof Error ? error.message : String(error);
    log.error(`[CircuitBreaker] DB failure #${this.consecutiveFailures}: ${errMsg}`);

    // If in HALF_OPEN, a single failure re-opens
    if (this.state === 'HALF_OPEN') {
      this.trip('Probe query failed during HALF_OPEN');
      return;
    }

    // In CLOSED state, check threshold
    if (this.consecutiveFailures >= this.config.failureThreshold) {
      this.trip(`${this.consecutiveFailures} consecutive failures`);
    }
  }

  private trip(reason: string): void {
    this.state = 'OPEN';
    this.trippedAt = Date.now();
    this.totalTrips++;

    log.error(`[CircuitBreaker] CIRCUIT TRIPPED: ${reason}. Fast-failing for ${this.config.resetTimeoutMs / 1000}s.`);

    // Send alert (fire-and-forget, don't block)
    if (!this.alertSent) {
      this.alertSent = true;
      this.sendAlert(reason).catch((err) => {
        log.error('[CircuitBreaker] Failed to send alert:', err);
      });
    }
  }

  private async sendAlert(reason: string): Promise<void> {
    const WA_FEEDBACK_URL = process.env.WA_FEEDBACK_URL || 'http://100.96.203.105:8092';
    const WA_GROUP_JID = process.env.WA_INFRA_GROUP_JID || '120363421664266245@g.us';

    const message = [
      '🚨 *DATABASE CIRCUIT BREAKER TRIPPED*',
      '',
      `*Reason:* ${reason}`,
      `*Total trips:* ${this.totalTrips}`,
      `*Total failures:* ${this.totalFailures}`,
      `*Reset timeout:* ${this.config.resetTimeoutMs / 1000}s`,
      '',
      '_Queries are fast-failing to protect the app._',
      '_Circuit will probe again after the reset timeout._',
    ].join('\n');

    try {
      await fetch(`${WA_FEEDBACK_URL}/send-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_jid: WA_GROUP_JID, message }),
        signal: AbortSignal.timeout(5000),
      });
      log.info('[CircuitBreaker] WhatsApp alert sent');
    } catch {
      log.warn('[CircuitBreaker] Could not send WhatsApp alert');
    }
  }

  /** Get current circuit breaker stats */
  getStats(): CircuitStats {
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      lastFailureAt: this.lastFailureAt,
      lastSuccessAt: this.lastSuccessAt,
      trippedAt: this.trippedAt,
      totalTrips: this.totalTrips,
      totalFailures: this.totalFailures,
    };
  }

  /** Force-reset the circuit (for manual recovery) */
  reset(): void {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.trippedAt = null;
    this.alertSent = false;
    log.info('[CircuitBreaker] Circuit manually reset');
  }
}

/** Custom error for when the circuit is open */
export class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}

/** Singleton instance */
export const dbCircuitBreaker = new DbCircuitBreaker();

export default dbCircuitBreaker;
