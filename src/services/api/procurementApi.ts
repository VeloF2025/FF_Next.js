// Procurement API service for handling all procurement-related API calls

const API_BASE = '/api/procurement';

/**
 * Build a URLSearchParams from a flat object with primitive values.
 * Undefined values are omitted; all others are coerced to strings.
 */
function buildQuery(params: Record<string, string | number | boolean | undefined>): URLSearchParams {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      qs.set(key, String(value));
    }
  }
  return qs;
}

// Helper function to handle API responses
async function handleResponse<T>(response: Response): Promise<T> {
  const data = await response.json();

  // Handle both formats:
  // 1. Standard apiResponse format: {success: true, data: ...}
  // 2. Raw response format: {items: [...], boqs: [...], ...}
  if (data.success === false) {
    throw new Error(data.error?.message || data.error || 'API request failed');
  }

  // If wrapped response, return data property
  if (data.success === true && data.data !== undefined) {
    return data.data;
  }

  // Otherwise return raw data
  return data;
}

export interface StockPosition {
  id: string;
  projectId: string;
  itemCode: string;
  itemName: string;
  itemDescription?: string;
  category: string;
  unitOfMeasure: string;
  availableQuantity: number;
  reservedQuantity: number;
  totalQuantity: number;
  reorderPoint?: number;
  reorderQuantity?: number;
  unitCost: number;
  totalValue: number;
  warehouseLocation?: string;
  binLocation?: string;
  stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock';
  lastMovementDate?: Date;
  lastCountDate?: Date;
  supplierId?: string;
  manufacturer?: string;
  partNumber?: string;
  barcode?: string;
  leadTimeDays?: number;
  minimumOrderQuantity?: number;
  maximumStockLevel?: number;
  hazmatInfo?: Record<string, unknown>;
  storageConditions?: Record<string, unknown>;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StockMovement {
  id: string;
  projectId: string;
  movementType: 'inbound' | 'outbound' | 'transfer' | 'adjustment';
  referenceNumber: string;
  referenceType?: string;
  referenceId?: string;
  fromLocation?: string;
  toLocation?: string;
  fromProjectId?: string;
  toProjectId?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  movementDate: Date;
  createdBy: string;
  notes?: string;
  reason?: string;
  approvedBy?: string;
  approvalDate?: Date;
  items?: StockMovementItem[];
  createdAt: Date;
  updatedAt: Date;
}

export interface StockMovementItem {
  id: string;
  movementId: string;
  itemCode: string;
  itemName: string;
  plannedQuantity: number;
  actualQuantity: number;
  unitCost: number;
  totalCost: number;
  status: string;
  lotNumber?: string;
  serialNumbers?: string[];
  expiryDate?: Date;
  notes?: string;
}

export interface PurchaseOrder {
  id: string;
  projectId: string;
  poNumber: string;
  supplierId: string;
  status: 'draft' | 'pending' | 'approved' | 'sent' | 'acknowledged' | 'partial' | 'completed' | 'cancelled';
  orderDate: Date;
  expectedDate?: Date;
  deliveryDate?: Date;
  deliveryAddress?: string;
  billingAddress?: string;
  paymentTerms?: string;
  shippingMethod?: string;
  shippingCost?: number;
  taxAmount?: number;
  discountAmount?: number;
  subtotal: number;
  totalAmount: number;
  currency: string;
  notes?: string;
  internalNotes?: string;
  items?: Record<string, unknown>[];
  createdBy: string;
  approvedBy?: string;
  approvalDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface RFQ {
  id: string;
  projectId: string;
  rfqNumber: string;
  title: string;
  description?: string;
  status: 'draft' | 'published' | 'closed' | 'awarded' | 'cancelled';
  issueDate: Date;
  dueDate: Date;
  validityPeriod?: number;
  deliveryTerms?: string;
  paymentTerms?: string;
  evaluationCriteria?: Record<string, unknown>;
  termsConditions?: string;
  contactPerson?: string;
  contactEmail?: string;
  contactPhone?: string;
  attachments?: string[];
  items?: Record<string, unknown>[];
  suppliers?: Record<string, unknown>[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface BOQ {
  id: string;
  projectId: string;
  name: string;
  version?: string;
  status: 'draft' | 'active' | 'archived';
  description?: string;
  totalAmount?: number;
  currency?: string;
  validFrom?: Date;
  validTo?: Date;
  createdBy: string;
  approvedBy?: string;
  approvalDate?: Date;
  items?: Record<string, unknown>[];
  createdAt: Date;
  updatedAt: Date;
}

/** A single line item within a Bill of Quantities */
export interface BOQItem {
  id: string;
  boqId: string;
  itemCode?: string;
  description: string;
  unit: string;
  quantity: number;
  unitRate: number;
  totalAmount: number;
  category?: string;
  notes?: string;
}

/** A BOQ import exception requiring manual resolution */
export interface BOQException {
  id: string;
  boqId: string;
  rowNumber?: number;
  field?: string;
  value?: string;
  reason: string;
  status: 'pending' | 'resolved' | 'ignored';
  resolvedBy?: string;
  resolvedAt?: Date;
}

/** Raw row data from an uploaded BOQ spreadsheet (shape unknown until mapped) */
export type BOQRawRow = Record<string, string | number | boolean | null | undefined>;

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface StockDashboard {
  totalItems: number;
  totalValue: number;
  lowStockItems: number;
  criticalStockItems: number;
  recentMovements: StockMovement[];
  topCategories: Array<{
    category: string;
    item_count: number;
    total_value: number;
  }>;
  stockLevels: Array<{
    status: string;
    count: number;
    percentage: number;
  }>;
}

// Stock Operations
export const stockApi = {
  // Get all stock positions with pagination and filters
  async getPositions(projectId: string, params?: {
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    category?: string;
    stockStatus?: string;
    warehouseLocation?: string;
    binLocation?: string;
    itemCode?: string;
    lowStock?: boolean;
  }): Promise<PaginatedResponse<StockPosition>> {
    const queryParams = buildQuery({ resource: 'stock', projectId, ...params });
    const response = await fetch(`${API_BASE}?${queryParams}`, {
      method: 'GET'
    });

    return handleResponse<PaginatedResponse<StockPosition>>(response);
  },

  // Get single stock position
  async getPosition(projectId: string, positionId: string): Promise<StockPosition> {
    const response = await fetch(`${API_BASE}?resource=stock&projectId=${projectId}&id=${positionId}`, {
      method: 'GET'
    });
    
    return handleResponse<StockPosition>(response);
  },

  // Create stock position
  async createPosition(projectId: string, data: Partial<StockPosition>): Promise<StockPosition> {
    const response = await fetch(`${API_BASE}?resource=stock&projectId=${projectId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data)
    });
    
    return handleResponse<StockPosition>(response);
  },

  // Update stock position
  async updatePosition(projectId: string, positionId: string, data: Partial<StockPosition>): Promise<StockPosition> {
    const response = await fetch(`${API_BASE}?resource=stock&projectId=${projectId}&id=${positionId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data)
    });
    
    return handleResponse<StockPosition>(response);
  },

  // Delete stock position
  async deletePosition(projectId: string, positionId: string): Promise<void> {
    const response = await fetch(`${API_BASE}?resource=stock&projectId=${projectId}&id=${positionId}`, {
      method: 'DELETE'
    });
    
    await handleResponse<void>(response);
  },

  // Get stock movements
  async getMovements(projectId: string, params?: {
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    movementType?: string;
    status?: string;
    fromDate?: string;
    toDate?: string;
    referenceNumber?: string;
  }): Promise<PaginatedResponse<StockMovement>> {
    const queryParams = buildQuery({ resource: 'stock', action: 'movements', projectId, ...params });
    const response = await fetch(`${API_BASE}?${queryParams}`, {
      method: 'GET'
    });
    
    return handleResponse<PaginatedResponse<StockMovement>>(response);
  },

  // Create stock movement
  async createMovement(projectId: string, data: Partial<StockMovement>): Promise<StockMovement> {
    const response = await fetch(`${API_BASE}?resource=stock&action=movement&projectId=${projectId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data)
    });
    
    return handleResponse<StockMovement>(response);
  },

  // Process bulk movement
  async processBulkMovement(projectId: string, data: {
    movementType: string;
    referenceNumber: string;
    referenceType?: string;
    referenceId?: string;
    fromLocation?: string;
    toLocation?: string;
    fromProjectId?: string;
    toProjectId?: string;
    notes?: string;
    reason?: string;
    userId: string;
    items: Array<{
      itemCode: string;
      itemName?: string;
      plannedQuantity: number;
      unitCost?: number;
      lotNumbers?: string[];
      serialNumbers?: string[];
    }>;
  }): Promise<{ movement: StockMovement; items: StockMovementItem[] }> {
    const response = await fetch(`${API_BASE}?resource=stock&action=bulk-movement&projectId=${projectId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data)
    });
    
    return handleResponse<{ movement: StockMovement; items: StockMovementItem[] }>(response);
  },

  // Get stock dashboard
  async getDashboard(projectId: string): Promise<StockDashboard> {
    const response = await fetch(`${API_BASE}?resource=stock&action=dashboard&projectId=${projectId}`, {
      method: 'GET'
    });
    
    return handleResponse<StockDashboard>(response);
  }
};

// Purchase Order Operations
export const purchaseOrderApi = {
  // Get all purchase orders
  async getOrders(projectId: string, params?: {
    page?: number;
    limit?: number;
    status?: string;
    supplierId?: string;
    fromDate?: string;
    toDate?: string;
  }): Promise<PaginatedResponse<PurchaseOrder>> {
    const queryParams = buildQuery({ resource: 'purchase-orders', projectId, ...params });
    const response = await fetch(`${API_BASE}?${queryParams}`, {
      method: 'GET'
    });

    return handleResponse<PaginatedResponse<PurchaseOrder>>(response);
  },

  // Get single purchase order
  async getOrder(projectId: string, orderId: string): Promise<PurchaseOrder> {
    const response = await fetch(`${API_BASE}?resource=purchase-orders&projectId=${projectId}&id=${orderId}`, {
      method: 'GET'
    });
    
    return handleResponse<PurchaseOrder>(response);
  },

  // Create purchase order
  async createOrder(projectId: string, data: Partial<PurchaseOrder>): Promise<PurchaseOrder> {
    const response = await fetch(`${API_BASE}?resource=purchase-orders&projectId=${projectId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data)
    });
    
    return handleResponse<PurchaseOrder>(response);
  },

  // Update purchase order
  async updateOrder(projectId: string, orderId: string, data: Partial<PurchaseOrder>): Promise<PurchaseOrder> {
    const response = await fetch(`${API_BASE}?resource=purchase-orders&projectId=${projectId}&id=${orderId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data)
    });
    
    return handleResponse<PurchaseOrder>(response);
  },

  // Delete purchase order
  async deleteOrder(projectId: string, orderId: string): Promise<void> {
    const response = await fetch(`${API_BASE}?resource=purchase-orders&projectId=${projectId}&id=${orderId}`, {
      method: 'DELETE'
    });
    
    await handleResponse<void>(response);
  }
};

// RFQ Operations
export const rfqApi = {
  // Get all RFQs
  async getRFQs(projectId: string, params?: {
    page?: number;
    limit?: number;
    status?: string;
    fromDate?: string;
    toDate?: string;
  }): Promise<PaginatedResponse<RFQ>> {
    const queryParams = buildQuery({ resource: 'rfq', projectId, ...params });
    const response = await fetch(`${API_BASE}?${queryParams}`, {
      method: 'GET'
    });

    return handleResponse<PaginatedResponse<RFQ>>(response);
  },

  // Get single RFQ
  async getRFQ(projectId: string, rfqId: string): Promise<RFQ> {
    const response = await fetch(`${API_BASE}?resource=rfq&projectId=${projectId}&id=${rfqId}`, {
      method: 'GET'
    });
    
    return handleResponse<RFQ>(response);
  },

  // Create RFQ
  async createRFQ(projectId: string, data: Partial<RFQ>): Promise<RFQ> {
    const response = await fetch(`${API_BASE}?resource=rfq&projectId=${projectId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data)
    });
    
    return handleResponse<RFQ>(response);
  },

  // Update RFQ
  async updateRFQ(projectId: string, rfqId: string, data: Partial<RFQ>): Promise<RFQ> {
    const response = await fetch(`${API_BASE}?resource=rfq&projectId=${projectId}&id=${rfqId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data)
    });
    
    return handleResponse<RFQ>(response);
  },

  // Delete RFQ
  async deleteRFQ(projectId: string, rfqId: string): Promise<void> {
    const response = await fetch(`${API_BASE}?resource=rfq&projectId=${projectId}&id=${rfqId}`, {
      method: 'DELETE'
    });
    
    await handleResponse<void>(response);
  },

  // Get supplier RFQ history
  async getSupplierHistory(projectId: string, supplierId: string): Promise<RFQ[]> {
    const response = await fetch(`${API_BASE}?resource=rfq&action=supplier-history&projectId=${projectId}&supplierId=${supplierId}`, {
      method: 'GET'
    });
    
    return handleResponse<RFQ[]>(response);
  },

  // Add suppliers to RFQ
  async addSuppliers(projectId: string, rfqId: string, supplierIds: string[]): Promise<void> {
    const response = await fetch(`${API_BASE}?resource=rfq&action=add-suppliers&projectId=${projectId}&id=${rfqId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ supplierIds })
    });
    
    await handleResponse<void>(response);
  },

  // Replace RFQ suppliers
  async replaceSuppliers(projectId: string, rfqId: string, supplierIds: string[]): Promise<void> {
    const response = await fetch(`${API_BASE}?resource=rfq&action=replace-suppliers&projectId=${projectId}&id=${rfqId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ supplierIds })
    });
    
    await handleResponse<void>(response);
  },

  // Remove suppliers from RFQ
  async removeSuppliers(projectId: string, rfqId: string, supplierIds: string[]): Promise<void> {
    const response = await fetch(`${API_BASE}?resource=rfq&action=remove-suppliers&projectId=${projectId}&id=${rfqId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ supplierIds })
    });
    
    await handleResponse<void>(response);
  }
};

// BOQ Operations
export const boqApi = {
  // Get all BOQs
  async getBOQs(projectId: string, params?: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<PaginatedResponse<BOQ>> {
    const queryParams = new URLSearchParams();
    if (projectId) queryParams.set('projectId', projectId);
    if (params?.page) queryParams.set('page', String(params.page));
    if (params?.limit) queryParams.set('limit', String(params.limit));
    if (params?.status) queryParams.set('status', params.status);

    const url = queryParams.toString()
      ? `${API_BASE}/boq?${queryParams}`
      : `${API_BASE}/boq`;

    const response = await fetch(url, {
      method: 'GET'
    });

    return handleResponse<PaginatedResponse<BOQ>>(response);
  },

  // Get single BOQ
  async getBOQ(projectId: string, boqId: string): Promise<BOQ> {
    const response = await fetch(`${API_BASE}/boq/${boqId}?projectId=${projectId}`, {
      method: 'GET'
    });

    return handleResponse<BOQ>(response);
  },

  // Create BOQ
  async createBOQ(projectId: string, data: Partial<BOQ>): Promise<BOQ> {
    const response = await fetch(`${API_BASE}/boq?projectId=${projectId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data)
    });

    return handleResponse<BOQ>(response);
  },

  // Update BOQ
  async updateBOQ(projectId: string, boqId: string, data: Partial<BOQ>): Promise<BOQ> {
    const response = await fetch(`${API_BASE}/boq/${boqId}?projectId=${projectId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data)
    });

    return handleResponse<BOQ>(response);
  },

  // Delete BOQ
  async deleteBOQ(projectId: string, boqId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/boq/${boqId}?projectId=${projectId}`, {
      method: 'DELETE'
    });

    await handleResponse<void>(response);
  },

  // Get BOQ items
  async getItems(projectId: string, boqId: string): Promise<BOQItem[]> {
    const response = await fetch(`${API_BASE}/boq/${boqId}/items?projectId=${projectId}`, {
      method: 'GET'
    });

    return handleResponse<BOQItem[]>(response);
  },

  // Get BOQ exceptions
  async getExceptions(projectId: string, boqId: string): Promise<BOQException[]> {
    const response = await fetch(`${API_BASE}/boq/${boqId}/exceptions?projectId=${projectId}`, {
      method: 'GET'
    });

    return handleResponse<BOQException[]>(response);
  },

  // Import BOQ
  async importBOQ(projectId: string, data: {
    name: string;
    data: BOQRawRow[];
    mappings?: Record<string, string>;
  }): Promise<BOQ> {
    const response = await fetch(`${API_BASE}/boq/import?projectId=${projectId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data)
    });

    return handleResponse<BOQ>(response);
  },

  // Perform BOQ mapping
  async performMapping(projectId: string, boqId: string, mappings: Record<string, string>): Promise<void> {
    const response = await fetch(`${API_BASE}/boq/${boqId}/map?projectId=${projectId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ mappings })
    });

    await handleResponse<void>(response);
  },

  // Resolve BOQ exception
  async resolveException(projectId: string, exceptionId: string, resolution: {
    action: 'map' | 'create' | 'ignore';
    mappingId?: string;
    newItemData?: BOQItem;
  }): Promise<void> {
    const response = await fetch(`${API_BASE}/boq/exception/${exceptionId}/resolve?projectId=${projectId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(resolution)
    });

    await handleResponse<void>(response);
  }
};

// Health check
export const procurementHealthCheck = async (): Promise<{ status: string; timestamp: string }> => {
  const response = await fetch(`${API_BASE}?resource=health`, {
    method: 'GET'
  });
  
  return handleResponse<{ status: string; timestamp: string }>(response);
};

// Export all APIs as a single object for convenience
export const procurementApi = {
  stock: stockApi,
  purchaseOrders: purchaseOrderApi,
  rfq: rfqApi,
  boq: boqApi,
  healthCheck: procurementHealthCheck
};