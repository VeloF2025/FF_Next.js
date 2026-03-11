/**
 * Memory Manager Types
 * Type definitions for memory monitoring and management
 */

import type { MemoryStats } from '../../../types';
export type { MemoryStats };

/**
 * Memory event types
 */
export type MemoryEventType =
  | 'warning'
  | 'critical'
  | 'cache-cleared'
  | 'cleanup'
  | 'weakref-cleared';

/**
 * Memory level indicators
 */
export type MemoryLevel = 'normal' | 'high' | 'critical';

/**
 * Memory trend indicators
 */
export type MemoryTrend = 'stable' | 'increasing' | 'decreasing';

/**
 * Memory event data
 */
export interface MemoryEventData {
  level?: MemoryLevel;
  usage?: MemoryStats;
  suggestion?: string;
  message?: string;
}

/**
 * File processing feasibility result
 */
export interface ProcessingFeasibility {
  canProcess: boolean;
  reason?: string;
  suggestions: string[];
}

/**
 * Memory report
 */
export interface MemoryReport {
  current: MemoryStats;
  peak: number;
  trend: MemoryTrend;
  recommendations: string[];
  history: MemoryStats[];
}

/**
 * Memory thresholds configuration
 */
export interface MemoryThresholds {
  warning: number;   // e.g., 0.8 for 80%
  critical: number;  // e.g., 0.9 for 90%
}
