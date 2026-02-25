/**
 * Base RFQ Content Generator
 * Handles core notification generation and configuration
 */

import { RFQ } from '@/types/procurement.types';
import { RFQNotificationEvent } from './types';
import { formatDisplayDateTime } from '@/utils/dateFormat';

export abstract class BaseRFQGenerator {
  protected static baseUrl: string = '';

  /**
   * Set the base URL for generating links
   */
  static setBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  /**
   * Get the configured base URL
   */
  protected static getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Generate a standard RFQ link
   */
  protected static generateRFQLink(rfqId: string, path: string = ''): string {
    const basePath = `/procurement/rfq/${rfqId}`;
    return path ? `${basePath}${path}` : basePath;
  }

  /**
   * Generate supplier-specific RFQ link
   */
  protected static generateSupplierRFQLink(rfqId: string, path: string = ''): string {
    const basePath = `/supplier/rfq/${rfqId}`;
    return path ? `${basePath}${path}` : basePath;
  }

  /**
   * Create standard notification metadata
   */
  protected static createMetadata(rfq: RFQ, event: RFQNotificationEvent, additionalData?: any): Record<string, any> {
    return {
      rfqId: rfq.id,
      projectId: rfq.projectId,
      eventType: event,
      timestamp: new Date().toISOString(),
      ...additionalData
    };
  }

  /**
   * Check if RFQ is overdue
   */
  protected static isOverdue(rfq: RFQ): boolean {
    const deadline = rfq.responseDeadline;
    return deadline ? deadline < new Date() : false;
  }

  /**
   * Check if RFQ deadline is approaching (within 24 hours)
   */
  protected static isDeadlineApproaching(rfq: RFQ): boolean {
    const deadline = rfq.responseDeadline;
    if (!deadline) return false;
    
    const now = new Date();
    const timeRemaining = deadline.getTime() - now.getTime();
    return timeRemaining > 0 && timeRemaining < 24 * 60 * 60 * 1000;
  }

  /**
   * Get hours remaining until deadline
   */
  protected static getHoursRemaining(rfq: RFQ): number {
    const deadline = rfq.responseDeadline;
    if (!deadline) return 0;
    
    const now = new Date();
    const timeRemaining = deadline.getTime() - now.getTime();
    return Math.max(0, Math.floor(timeRemaining / (60 * 60 * 1000)));
  }

  /**
   * Format deadline for display
   */
  protected static formatDeadline(deadline: Date): string {
    return formatDisplayDateTime(deadline);
  }
}