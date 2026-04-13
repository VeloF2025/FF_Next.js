/**
 * Supplier Subscription Types
 * Type definitions for real-time supplier subscriptions
 */

import { Supplier, SupplierStatus, SupplierRating, ComplianceStatus } from '@/types/supplier/base.types';

/**
 * Subscription callback types
 */
export type SupplierCallback = (supplier: Supplier) => void;
export type SuppliersCallback = (suppliers: Supplier[]) => void;
export type SupplierErrorCallback = (error: Error) => void;

/**
 * Subscription filter options
 */
export interface SupplierSubscriptionFilter {
  status?: SupplierStatus;
  isPreferred?: boolean;
  category?: string;
  limit?: number;
}

/**
 * Subscription configuration options
 */
export interface SubscriptionOptions {
  onError?: SupplierErrorCallback;
  includeMetadata?: boolean;
}

/**
 * Supplier rating data for rating subscriptions
 */
export interface SupplierRatingData {
  id: string;
  rating: SupplierRating | number;
  companyName: string;
}

/**
 * Supplier compliance data for compliance subscriptions
 */
export interface SupplierComplianceData {
  id: string;
  companyName: string;
  complianceStatus: ComplianceStatus;
  status: SupplierStatus;
}

/**
 * Subscription manager interface
 */
export interface ISubscriptionManager {
  add(name: string, unsubscribe: () => void): void;
  remove(name: string): void;
  removeAll(): void;
  getActiveSubscriptions(): string[];
  hasSubscription(name: string): boolean;
  getSubscriptionCount(): number;
  destroy(): void;
}