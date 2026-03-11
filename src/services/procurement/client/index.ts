/**
 * Procurement Client Services
 * 
 * This module provides client-side access to procurement APIs.
 * All frontend components should import from this module instead of backend services.
 * 
 * Backend services (those in /services/procurement/api, /services/procurement/stock, etc.)
 * use direct database connections and will NOT work in the browser.
 */

import { procurementApiService as _pApi } from './procurementClientService';
export {
  ProcurementClientService,
  procurementApiService
} from './procurementClientService';
const procurementApiService = _pApi;

// Re-export the API types for convenience
export type {
  StockPosition,
  StockMovement,
  StockMovementItem,
  PurchaseOrder,
  RFQ,
  BOQ,
  PaginatedResponse,
  StockDashboard
} from '@/services/api/procurementApi';

// Export stock client separately for direct access
export const stockClient = {
  getPositions: procurementApiService.getStockPositions,
  getPositionById: procurementApiService.getStockPositionById,
  createPosition: procurementApiService.createStockPosition,
  updatePosition: procurementApiService.updateStockPosition,
  getMovements: procurementApiService.getStockMovements,
  createMovement: procurementApiService.createStockMovement,
  processBulkMovement: procurementApiService.processBulkMovement,
  getDashboard: procurementApiService.getDashboardData
};

// Export BOQ client separately for direct access
export const boqClient = {
  getBOQsByProject: procurementApiService.getBOQsByProject,
  getBOQ: procurementApiService.getBOQ,
  getBOQWithItems: procurementApiService.getBOQWithItems,
  createBOQ: procurementApiService.createBOQ,
  updateBOQ: procurementApiService.updateBOQ,
  deleteBOQ: procurementApiService.deleteBOQ,
  importBOQ: procurementApiService.importBOQ,
  getItems: procurementApiService.getBOQItems,
  getExceptions: procurementApiService.getBOQExceptions
};

// Export RFQ client separately for direct access
export const rfqClient = {
  getRFQList: procurementApiService.getRFQList,
  getRFQById: procurementApiService.getRFQById,
  createRFQ: procurementApiService.createRFQ,
  updateRFQ: procurementApiService.updateRFQ,
  deleteRFQ: procurementApiService.deleteRFQ
};

// Export Purchase Order client separately for direct access
export const purchaseOrderClient = {
  getOrders: procurementApiService.getPurchaseOrders,
  getOrderById: procurementApiService.getPurchaseOrderById,
  createOrder: procurementApiService.createPurchaseOrder,
  updateOrder: procurementApiService.updatePurchaseOrder,
  deleteOrder: procurementApiService.deletePurchaseOrder
};