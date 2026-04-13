/**
 * Memory Manager
 * Monitors and optimizes memory usage during file processing
 *
 * This is the main coordinator class that delegates to specialized modules
 */

import type { MemoryStats } from '../types';
import type { MemoryReport, MemoryTrend, ProcessingFeasibility } from './manager/types/memory-manager.types';

import {
  MemoryMonitor,
  MemoryStatsCollector,
  MemoryThresholdHandler,
  GarbageCollector,
  MemoryCleanup,
  MemoryAnalyzer,
  FileProcessingAnalyzer
} from './manager';

export class MemoryManager {
  // Module instances
  private monitor: MemoryMonitor;
  private statsCollector: MemoryStatsCollector;
  private thresholdHandler: MemoryThresholdHandler;
  private garbageCollector: GarbageCollector;
  private memoryCleanup: MemoryCleanup;
  private analyzer: MemoryAnalyzer;
  private fileAnalyzer: FileProcessingAnalyzer;

  constructor() {
    // Initialize all modules
    this.monitor = new MemoryMonitor();
    this.statsCollector = new MemoryStatsCollector();
    this.thresholdHandler = new MemoryThresholdHandler({ warning: 0.8, critical: 0.9 });
    this.garbageCollector = new GarbageCollector();
    this.memoryCleanup = new MemoryCleanup();
    this.analyzer = new MemoryAnalyzer({ warning: 0.8, critical: 0.9 });
    this.fileAnalyzer = new FileProcessingAnalyzer();

    this.startMonitoring();
  }

  /**
   * Start memory monitoring
   */
  private startMonitoring(): void {
    if (typeof window === 'undefined') return;

    this.monitor.start((_stats: MemoryStats) => {
      const currentStats = this.statsCollector.getCurrentMemoryStats();
      this.statsCollector.recordMemoryStats(currentStats);
      this.checkMemoryThresholds(currentStats);
    });
  }

  /**
   * Stop memory monitoring
   */
  public stopMonitoring(): void {
    this.monitor.stop();
  }

  /**
   * Get current memory statistics
   */
  public getCurrentMemoryStats(): MemoryStats {
    return this.statsCollector.getCurrentMemoryStats();
  }

  /**
   * Check memory thresholds and take action
   */
  private checkMemoryThresholds(stats: MemoryStats): void {
    this.thresholdHandler.checkThresholds(
      stats,
      () => this.handleHighMemory(stats),
      () => this.handleCriticalMemory(stats)
    );
  }

  /**
   * Handle high memory usage
   */
  private handleHighMemory(stats: MemoryStats): void {
    this.garbageCollector.suggest();
    this.thresholdHandler.handleHighMemory(stats);
  }

  /**
   * Handle critical memory usage
   */
  private handleCriticalMemory(stats: MemoryStats): void {
    this.garbageCollector.force();
    this.memoryCleanup.clearCaches((keepCount) =>
      this.statsCollector.trimHistory(keepCount)
    );
    this.thresholdHandler.handleCriticalMemory(stats);
  }

  /**
   * Force garbage collection
   */
  public forceGarbageCollection(): void {
    this.memoryCleanup.performFullCleanup(
      (keepCount) => this.statsCollector.trimHistory(keepCount),
      () => this.garbageCollector.force()
    );
  }

  /**
   * Get memory usage trend
   */
  public getMemoryTrend(): MemoryTrend {
    const history = this.statsCollector.getHistory();
    return this.analyzer.getMemoryTrend(history);
  }

  /**
   * Get memory recommendations
   */
  public getMemoryRecommendations(): string[] {
    const currentStats = this.getCurrentMemoryStats();
    const history = this.statsCollector.getHistory();
    const peakUsage = this.statsCollector.getPeakUsage();

    return this.analyzer.getMemoryRecommendations(currentStats, history, peakUsage);
  }

  /**
   * Estimate memory needed for processing
   */
  public estimateMemoryNeeded(fileSize: number, fileType: string): number {
    return this.fileAnalyzer.estimateMemoryNeeded(fileSize, fileType);
  }

  /**
   * Check if processing is feasible with current memory
   */
  public canProcessFile(fileSize: number, fileType: string): ProcessingFeasibility {
    const currentStats = this.getCurrentMemoryStats();
    return this.fileAnalyzer.canProcessFile(fileSize, fileType, currentStats);
  }

  /**
   * Get memory report
   */
  public getMemoryReport(): MemoryReport {
    return {
      current: this.getCurrentMemoryStats(),
      peak: this.statsCollector.getPeakUsage(),
      trend: this.getMemoryTrend(),
      recommendations: this.getMemoryRecommendations(),
      history: this.statsCollector.getHistory()
    };
  }

  /**
   * Reset memory tracking
   */
  public reset(): void {
    this.statsCollector.clearHistory();
  }

  /**
   * Clean up resources
   */
  public cleanup(): void {
    this.stopMonitoring();
    this.reset();
  }

  /**
   * Destructor
   */
  public destroy(): void {
    this.cleanup();
  }
}
