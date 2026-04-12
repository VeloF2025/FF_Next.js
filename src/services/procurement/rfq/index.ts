/**
 * RFQ Service - Main Orchestrator
 * Maintains backward compatibility with original NeonRFQService
 * Delegates to modular services
 */

import { RFQ, RFQFormData, RFQStatus } from '@/types/procurement.types';
import { RfqCrudService } from './core/RfqCrudService';

/** Shape of a supplier response submitted to an RFQ */
export interface RfqSubmitResponse {
  supplierId: string;
  supplierName: string;
  totalAmount: number;
  currency?: string;
  validityPeriod?: number;
  paymentTerms?: string;
  deliveryTerms?: string;
  deliveryDate?: string;
  attachments?: unknown[];
  technicalCompliance?: boolean;
  commercialTerms?: Record<string, unknown>;
  notes?: string;
  items?: Array<{
    rfqItemId: string;
    unitPrice: number;
    totalPrice?: number;
    quantity?: number;
    discountPercent?: number;
    deliveryDays?: number;
    complianceStatus?: string;
    alternativeOffered?: boolean;
    alternativeDescription?: string;
    notes?: string;
  }>;
}

/** Shape of an RFQ notification record */
export interface RfqNotificationInput {
  type: string;
  recipientType: string;
  recipientId?: string;
  recipientEmail?: string;
  subject: string;
  message: string;
  metadata?: Record<string, unknown>;
  id?: string;
}

/** Statistics returned by getStatistics */
export interface RfqStatistics {
  totalRFQs: number;
  byStatus: Record<string, number>;
  totalBudget: number;
  averageBudget: number;
}

/** Evaluation result from evaluateResponses */
export type RfqEvaluationResult = Record<string, unknown>;

/** Comparison result from compareResponses */
export type RfqComparisonResult = Record<string, unknown>;
import { RfqQueryService } from './core/RfqQueryService';
import { RfqItemService } from './core/RfqItemService';
import { RfqLifecycleService } from './lifecycle/RfqLifecycleService';
import { RfqResponseService } from './lifecycle/RfqResponseService';
import { RfqEvaluationService } from './lifecycle/RfqEvaluationService';
import { RfqNotificationService } from './notifications/RfqNotificationService';
import { RfqReminderService } from './notifications/RfqReminderService';

/**
 * Comprehensive RFQ Service for Neon
 * Orchestrator that delegates to modular services
 */
export class NeonRFQService {
  // ============= CRUD OPERATIONS =============

  static async create(data: RFQFormData): Promise<string> {
    return RfqCrudService.create(data);
  }

  static async getById(id: string): Promise<RFQ> {
    return RfqCrudService.getById(id);
  }

  static async update(id: string, data: Partial<RFQFormData>): Promise<void> {
    return RfqCrudService.update(id, data);
  }

  static async delete(id: string): Promise<void> {
    return RfqCrudService.delete(id);
  }

  // ============= LIFECYCLE MANAGEMENT =============

  static async sendToSuppliers(id: string, supplierIds?: string[]): Promise<void> {
    return RfqLifecycleService.sendToSuppliers(id, supplierIds);
  }

  static async closeRFQ(rfqId: string, reason: string): Promise<void> {
    return RfqLifecycleService.closeRFQ(rfqId, reason);
  }

  static async cancelRFQ(rfqId: string, reason: string): Promise<void> {
    return RfqLifecycleService.cancelRFQ(rfqId, reason);
  }

  static async extendDeadline(rfqId: string, newDeadline: Date, reason?: string): Promise<void> {
    return RfqLifecycleService.extendDeadline(rfqId, newDeadline, reason);
  }

  // ============= RESPONSE MANAGEMENT =============

  static async submitResponse(rfqId: string, response: RfqSubmitResponse): Promise<string> {
    return RfqResponseService.submitResponse(rfqId, response);
  }

  static async selectResponse(rfqId: string, responseId: string, reason?: string): Promise<void> {
    return RfqResponseService.selectResponse(rfqId, responseId, reason);
  }

  // ============= WORKFLOW OPERATIONS =============

  static async evaluateResponses(rfqId: string): Promise<RfqEvaluationResult> {
    return RfqEvaluationService.evaluateResponses(rfqId);
  }

  static async compareResponses(rfqId: string): Promise<RfqComparisonResult> {
    return RfqEvaluationService.compareResponses(rfqId);
  }

  // ============= NOTIFICATION SYSTEM =============

  static async createNotification(rfqId: string, notification: RfqNotificationInput): Promise<void> {
    return RfqNotificationService.createNotification(rfqId, notification);
  }

  static async createSupplierNotification(rfqId: string, supplierId: string, type: string): Promise<void> {
    return RfqNotificationService.createSupplierNotification(rfqId, supplierId, type);
  }

  static async sendDeadlineReminders(): Promise<void> {
    return RfqReminderService.sendDeadlineReminders();
  }

  // ============= QUERY OPERATIONS =============

  static async getAll(filter?: {
    projectId?: string;
    status?: RFQStatus;
    supplierId?: string;
    page?: number;
    limit?: number;
  }): Promise<{ rfqs: RFQ[], total: number }> {
    return RfqQueryService.getAll(filter);
  }

  static async getStatistics(projectId?: string): Promise<RfqStatistics> {
    return RfqQueryService.getStatistics(projectId);
  }
}

// Export for backward compatibility
export default NeonRFQService;

// Export individual services for direct access
export {
  RfqCrudService,
  RfqQueryService,
  RfqItemService,
  RfqLifecycleService,
  RfqResponseService,
  RfqEvaluationService,
  RfqNotificationService,
  RfqReminderService
};