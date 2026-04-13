/**
 * Stock Management Module - Main Export Index
 * Central exports for all stock management services, types, and utilities
 */

// 🟢 WORKING: Main Service Classes
export { default as StockService } from './StockService';
export { default as StockQueryService } from './core/StockQueryService';
export { default as StockCommandService } from './core/StockCommandService';
export { default as StockMovementService } from './core/StockMovementService';

// 🟢 WORKING: API Operations
export { StockOperations } from '../api/stockOperations';

// 🟢 WORKING: Utilities and Calculations
export {
  StockCalculations,
  stockCalculations,
  default as stockCalculationsDefault
} from './utils/stockCalculations';

// 🟢 WORKING: Service Types and Interfaces
export type {
  StockFilters,
  MovementFilters,
  StockDashboardData,
  BulkMovementRequest
} from './StockService';

export type {
  CreateStockPositionData,
  StockAdjustmentData,
  StockReservationData
} from './core/StockCommandService';

export type {
  GRNData,
  IssueData,
  TransferData,
  ReturnData
} from './core/StockMovementService';

// 🟢 WORKING: Calculation Types
export type {
  StockValueBreakdown,
  StockABC,
  ReorderAnalysis,
  CableDrumUtilization,
  TurnoverAnalysis
} from './utils/stockCalculations';

// 🟢 WORKING: Re-export all stock types from the main types module
export type {
  StockPosition,
  StockMovement,
  StockMovementItem,
  CableDrum,
  DrumUsageHistory,
  StockStatusType,
  MovementTypeType,
  MovementStatusType,
  ItemStatusType,
  QualityCheckStatusType
} from '@/types/procurement/stock';

// 🟢 WORKING: Error classes
export {
  StockError,
  InsufficientStockError,
  StockReservationError,
  StockMovementError,
  StockTransferError,
  StockAdjustmentError,
  StockTrackingError,
  StockErrorHandler,
  StockErrorFactory,
  isStockError,
  getStockErrorType
} from '../errors/stock';

// 🟢 WORKING: Service initialization and health check
export type { StockServiceHealth } from './index-modules/initialization/ServiceInitializer';

export {
  initializeStockServices,
  createStockService,
  createStockOperations
} from './index-modules/initialization/ServiceInitializer';

// 🟢 WORKING: Utility functions for common operations
export { StockUtils } from './index-modules/utils';

// 🟢 WORKING: Constants and enums
export {
  STOCK_CONSTANTS,
  STOCK_STATUS_PRIORITIES,
  MOVEMENT_TYPE_PRIORITIES
} from './index-modules/config/constants';

// 🟢 WORKING: Version information
export {
  STOCK_SERVICE_VERSION,
  STOCK_SERVICE_BUILD_DATE,
  getModuleInfo
} from './index-modules/config/version';

// Default export for convenience — imported inline to avoid redeclaration conflicts with named exports above
import _StockService from './StockService';
import { StockOperations as _StockOperations } from '../api/stockOperations';
import { StockCalculations as _StockCalculations } from './utils/stockCalculations';
import { StockUtils as _StockUtils } from './index-modules/utils';
import { STOCK_CONSTANTS as _STOCK_CONSTANTS } from './index-modules/config/constants';
import {
  initializeStockServices as _initializeStockServices,
  createStockService as _createStockService,
  createStockOperations as _createStockOperations,
} from './index-modules/initialization/ServiceInitializer';
import { getModuleInfo as _getModuleInfo } from './index-modules/config/version';

export default {
  StockService: _StockService,
  StockOperations: _StockOperations,
  StockCalculations: _StockCalculations,
  StockUtils: _StockUtils,
  STOCK_CONSTANTS: _STOCK_CONSTANTS,
  initializeStockServices: _initializeStockServices,
  createStockService: _createStockService,
  createStockOperations: _createStockOperations,
  getModuleInfo: _getModuleInfo,
};
