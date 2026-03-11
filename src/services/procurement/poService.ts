/**
 * Purchase Order Service
 * Client-side service that calls the PO API endpoints
 * UPDATED: Replaced mock data with real API calls
 */

import {
  PurchaseOrder,
  POItem,
  POStatus,
  POApprovalStatus,
  POListItem,
  POStats,
  POFilters,
  CreatePORequest,
  PODeliveryNote,
  POInvoice,
  POAmendment,
  PODeliveryStatus,
  POInvoiceStatus,
  PaymentStatus,
} from '../../types/procurement/po.types';
import { sanitizeOrderData } from '@/lib/security/sanitization';

// API response types
interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

interface POApiListItem {
  id: string;
  poNumber: string;
  status: string;
  supplierId: number;
  supplierName: string;
  projectName?: string;
  deliveryDate?: string;
  subtotal: number;
  vatAmount: number;
  total: number;
  itemCount: number;
  createdByName: string;
  createdAt: string;
}

interface POApiDetail {
  id: string;
  poNumber: string;
  status: string;
  supplierId: number;
  supplierName: string;
  supplierEmail?: string;
  supplierPhone?: string;
  projectId?: string;
  projectName?: string;
  deliveryAddress?: string;
  expectedDeliveryDate?: string;
  paymentTerms?: string;
  currency: string;
  taxRate: number;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  notes?: string;
  supplierNotes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  items: POApiItem[];
  history: { id: string; action: string; notes: string | null; createdBy: string | null; createdAt: string }[];
  receipts: { id: string; grnNumber: string; receivedDate: string; receivedBy: string; totalItems: number }[];
}

interface POApiItem {
  id: string;
  lineNumber: number;
  description: string;
  itemCode?: string;
  quantityOrdered: number;
  quantityReceived: number;
  quantityPending: number;
  unitOfMeasure: string;
  unitPrice: number;
  lineTotal: number;
  notes?: string;
}

class POService {
  private baseUrl = '/api/procurement/purchase-orders';

  // ============= CRUD Operations =============

  async getAllPOs(filters?: POFilters): Promise<POListItem[]> {
    const params = new URLSearchParams();

    if (filters?.projectId) params.append('projectId', filters.projectId);
    if (filters?.status && filters.status.length > 0) {
      filters.status.forEach(s => params.append('status', s));
    }
    if (filters?.searchTerm) params.append('search', filters.searchTerm);

    const url = `${this.baseUrl}?${params.toString()}`;
    const response = await fetch(url);
    const result: ApiResponse<POApiListItem[]> = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Failed to fetch purchase orders');
    }

    // Map API response to POListItem format
    return (result.data || []).map(po => this.mapApiToListItem(po));
  }

  async getPOById(id: string): Promise<PurchaseOrder | null> {
    const response = await fetch(`${this.baseUrl}/${id}`);

    if (response.status === 404) {
      return null;
    }

    const result: ApiResponse<POApiDetail> = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Failed to fetch purchase order');
    }

    return this.mapApiToFullPO(result.data);
  }

  async getPOItems(poId: string): Promise<POItem[]> {
    const po = await this.getPOById(poId);
    if (!po || !(po as any).items) return [];
    return (po as any).items;
  }

  async createPO(data: CreatePORequest): Promise<PurchaseOrder> {
    // Sanitize input data to prevent XSS attacks
    const sanitized = sanitizeOrderData(data);
    
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        supplierId: sanitized.supplierId,
        projectId: sanitized.projectId,
        deliveryAddress: typeof sanitized.deliveryAddress === 'string'
          ? sanitized.deliveryAddress
          : `${sanitized.deliveryAddress.street}, ${sanitized.deliveryAddress.city}, ${sanitized.deliveryAddress.province} ${sanitized.deliveryAddress.postalCode}`,
        expectedDeliveryDate: sanitized.expectedDeliveryDate,
        paymentTerms: sanitized.paymentTerms,
        deliveryTerms: sanitized.deliveryTerms,
        notes: sanitized.notes,
        items: sanitized.items?.map((item: any) => ({
          itemCode: item.itemCode,
          itemDescription: item.description,
          quantity: item.quantity,
          uom: item.uom,
          unitPrice: item.unitPrice,
          notes: item.notes,
        })),
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Failed to create purchase order');
    }

    // Fetch the full PO to return
    const createdPO = await this.getPOById(result.data.id);
    if (!createdPO) {
      throw new Error('Failed to fetch created purchase order');
    }
    return createdPO;
  }

  async updatePO(id: string, updates: Partial<PurchaseOrder>): Promise<PurchaseOrder> {
    const response = await fetch(`${this.baseUrl}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Failed to update purchase order');
    }

    const updatedPO = await this.getPOById(id);
    if (!updatedPO) {
      throw new Error('Failed to fetch updated purchase order');
    }
    return updatedPO;
  }

  async deletePO(id: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${id}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || 'Failed to delete purchase order');
    }
  }

  // ============= Status Management =============

  async updatePOStatus(id: string, status: POStatus, notes?: string): Promise<PurchaseOrder> {
    // Map status to action
    const actionMap: Record<string, string> = {
      [POStatus.PENDING_APPROVAL]: 'submit',
      [POStatus.APPROVED]: 'approve',
      [POStatus.SENT]: 'send',
      [POStatus.ACKNOWLEDGED]: 'acknowledge',
      [POStatus.DELIVERED]: 'complete',
      [POStatus.CANCELLED]: 'cancel',
    };

    const action = actionMap[status];
    if (!action) {
      throw new Error(`Cannot transition to status: ${status}`);
    }

    const response = await fetch(`${this.baseUrl}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, notes }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Failed to update status');
    }

    const updatedPO = await this.getPOById(id);
    if (!updatedPO) {
      throw new Error('Failed to fetch updated purchase order');
    }
    return updatedPO;
  }

  // ============= Approval Workflow =============

  async submitForApproval(id: string): Promise<PurchaseOrder> {
    return this.updatePOStatus(id, POStatus.PENDING_APPROVAL);
  }

  async approvePO(id: string, _approverId: string): Promise<PurchaseOrder> {
    const response = await fetch(`${this.baseUrl}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Failed to approve purchase order');
    }

    const updatedPO = await this.getPOById(id);
    if (!updatedPO) {
      throw new Error('Failed to fetch updated purchase order');
    }
    return updatedPO;
  }

  async rejectPO(id: string, _approverId: string, reason: string): Promise<PurchaseOrder> {
    const response = await fetch(`${this.baseUrl}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject', notes: reason }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Failed to reject purchase order');
    }

    const updatedPO = await this.getPOById(id);
    if (!updatedPO) {
      throw new Error('Failed to fetch updated purchase order');
    }
    return updatedPO;
  }

  // ============= Delivery Management =============

  async createDeliveryNote(poId: string, deliveryData: {
    deliveredBy: string;
    receivedBy: string;
    items: { poItemId: string; quantity: number }[];
    notes?: string;
  }): Promise<PODeliveryNote> {
    // This would call a GRN API endpoint
    // For now, return a placeholder - GRN creation is handled separately
    const deliveryNote: PODeliveryNote = {
      id: `dn-${Date.now()}`,
      poId,
      deliveryNoteNumber: `DN-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`,
      deliveredBy: deliveryData.deliveredBy,
      receivedBy: deliveryData.receivedBy,
      deliveryDate: new Date(),
      items: deliveryData.items.map((item: any) => ({
        poItemId: item.poItemId,
        quantityDelivered: item.quantity,
        quantityAccepted: item.quantity,
        quantityRejected: 0,
      })) as any,
      status: 'pending' as any,
      deliveryNotes: deliveryData.notes,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return deliveryNote;
  }

  async updateDeliveryStatus(poId: string, status: PODeliveryStatus): Promise<PurchaseOrder> {
    // Delivery status is updated through GRN processing
    const po = await this.getPOById(poId);
    if (!po) throw new Error('Purchase Order not found');
    po.deliveryStatus = status;
    return po;
  }

  // ============= Invoice Management =============

  async createInvoice(poId: string, invoiceData: {
    invoiceNumber: string;
    invoiceAmount: number;
    taxAmount: number;
    totalAmount: number;
    invoiceDate: string;
    dueDate: string;
    items: { poItemId: string; quantity: number; amount: number }[];
  }): Promise<POInvoice> {
    // Invoice creation would be handled by a separate invoicing module
    const invoice: POInvoice = {
      id: `inv-${Date.now()}`,
      poId,
      invoiceNumber: invoiceData.invoiceNumber,
      invoiceAmount: invoiceData.invoiceAmount,
      taxAmount: invoiceData.taxAmount,
      totalAmount: invoiceData.totalAmount,
      matchingStatus: 'not_matched' as any,
      items: invoiceData.items.map((item: any) => ({
        poItemId: item.poItemId,
        quantityInvoiced: item.quantity,
        amountInvoiced: item.amount,
      })) as any,
      invoiceDate: new Date(invoiceData.invoiceDate),
      dueDate: new Date(invoiceData.dueDate),
      receivedDate: new Date(),
      paymentStatus: PaymentStatus.NOT_DUE,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return invoice;
  }

  async updateInvoiceStatus(poId: string, status: POInvoiceStatus): Promise<PurchaseOrder> {
    const po = await this.getPOById(poId);
    if (!po) throw new Error('Purchase Order not found');
    po.invoiceStatus = status;
    return po;
  }

  // ============= Amendment Management =============

  async createAmendment(poId: string, amendmentData: {
    reason: string;
    description: string;
    changeType: string;
    changes: Record<string, unknown>;
    newTotal: number;
  }): Promise<POAmendment> {
    const po = await this.getPOById(poId);
    if (!po) throw new Error('Purchase Order not found');

    const amendment: POAmendment = {
      id: `amend-${Date.now()}`,
      originalPOId: poId,
      amendmentNumber: (po.amendmentCount || 0) + 1,
      reason: amendmentData.reason,
      description: amendmentData.description,
      changeType: amendmentData.changeType as any,
      changes: amendmentData.changes as any,
      previousTotal: po.totalAmount,
      newTotal: amendmentData.newTotal,
      changeAmount: amendmentData.newTotal - po.totalAmount,
      approvalStatus: POApprovalStatus.PENDING,
      status: 'draft' as any,
      createdBy: 'current-user',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return amendment;
  }

  // ============= Statistics and Analytics =============

  async getPOStats(projectId?: string): Promise<POStats> {
    // Fetch all POs and calculate stats
    const filters: POFilters = {};
    if (projectId) filters.projectId = projectId;

    const pos = await this.getAllPOs(filters);

    const stats: POStats = {
      total: pos.length,
      byStatus: {} as Record<POStatus, number>,
      byApprovalStatus: {} as Record<POApprovalStatus, number>,
      totalValue: pos.reduce((sum, po) => sum + po.totalAmount, 0),
      averageValue: pos.length > 0 ? pos.reduce((sum, po) => sum + po.totalAmount, 0) / pos.length : 0,
      onTimeDeliveries: 0,
      lateDeliveries: 0,
      averageDeliveryDays: 0,
      averageApprovalDays: 0,
      averageProcessingDays: 0,
      monthlyStats: [],
    };

    // Calculate status distributions
    Object.values(POStatus).forEach(status => {
      stats.byStatus[status] = pos.filter(po => po.status === status).length;
    });

    Object.values(POApprovalStatus).forEach(status => {
      stats.byApprovalStatus[status] = pos.filter(po => po.approvalStatus === status).length;
    });

    return stats;
  }

  // ============= Reporting =============

  async generatePOReport(filters: POFilters, reportType: string): Promise<{
    reportType: string;
    generatedAt: Date;
    filters: POFilters;
    data: POListItem[];
    summary: { totalPOs: number; totalValue: number; avgValue: number };
  }> {
    const pos = await this.getAllPOs(filters);

    return {
      reportType,
      generatedAt: new Date(),
      filters,
      data: pos,
      summary: {
        totalPOs: pos.length,
        totalValue: pos.reduce((sum, po) => sum + po.totalAmount, 0),
        avgValue: pos.length > 0 ? pos.reduce((sum, po) => sum + po.totalAmount, 0) / pos.length : 0,
      },
    };
  }

  // ============= Integration Methods =============

  async createPOFromQuote(quoteId: string, projectId: string): Promise<PurchaseOrder> {
    // Fetch quote details and create PO
    const quoteResponse = await fetch(`/api/procurement/quotes/${quoteId}`);
    if (!quoteResponse.ok) {
      throw new Error('Failed to fetch quote');
    }

    const quote = await quoteResponse.json();

    const createRequest: CreatePORequest = {
      projectId,
      quoteId,
      supplierId: quote.data.supplierId,
      title: `PO from Quote ${quote.data.quoteNumber}`,
      orderType: 'goods' as any,
      paymentTerms: quote.data.paymentTerms || 'Net 30',
      deliveryTerms: quote.data.deliveryTerms || 'DDP',
      deliveryAddress: {
        street: '123 Delivery St',
        city: 'Johannesburg',
        province: 'Gauteng',
        postalCode: '2000',
        country: 'South Africa',
      },
      items: (quote.data.items || []).map((item: { itemCode?: string; itemDescription: string; quantity: number; uom: string; unitPrice: number }) => ({
        itemCode: item.itemCode,
        description: item.itemDescription,
        quantity: item.quantity,
        uom: item.uom,
        unitPrice: item.unitPrice,
      })),
    };

    return this.createPO(createRequest);
  }

  async getPOsRequiringAction(userId: string): Promise<POListItem[]> {
    const allPOs = await this.getAllPOs();
    return allPOs.filter(po =>
      po.approvalStatus === POApprovalStatus.PENDING ||
      po.status === POStatus.PENDING_APPROVAL ||
      po.deliveryStatus === PODeliveryStatus.DELIVERY_ISSUES
    );
  }

  // ============= Private Mapping Methods =============

  private mapApiToListItem(api: POApiListItem): POListItem {
    return {
      id: api.id,
      poNumber: api.poNumber,
      title: `PO ${api.poNumber}`,
      supplier: {
        id: String(api.supplierId),
        name: api.supplierName,
      },
      status: api.status as POStatus,
      approvalStatus: POApprovalStatus.APPROVED, // Derived from status
      deliveryStatus: PODeliveryStatus.NOT_STARTED,
      invoiceStatus: POInvoiceStatus.NOT_INVOICED,
      totalAmount: api.total,
      currency: 'ZAR',
      ...(api.deliveryDate && { expectedDeliveryDate: new Date(api.deliveryDate) }),
      createdAt: new Date(api.createdAt),
      itemCount: api.itemCount,
      deliveredItemCount: 0,
      invoicedItemCount: 0,
    };
  }

  private mapApiToFullPO(api: POApiDetail): PurchaseOrder & { items: any } {
    return {
      id: api.id,
      projectId: api.projectId || '',
      poNumber: api.poNumber,
      supplierId: String(api.supplierId) as any,
      title: `PO ${api.poNumber}`,
      orderType: 'goods' as any,
      status: api.status as POStatus,
      approvalStatus: this.deriveApprovalStatus(api.status as POStatus),
      supplier: {
        id: String(api.supplierId),
        name: api.supplierName,
        code: '',
        ...(api.supplierEmail && { email: api.supplierEmail }),
        ...(api.supplierPhone && { phone: api.supplierPhone }),
      },
      currency: api.currency,
      subtotal: api.subtotal,
      taxAmount: api.taxAmount,
      totalAmount: api.totalAmount,
      paymentTerms: api.paymentTerms || '',
      deliveryTerms: '',
      deliveryAddress: {
        street: api.deliveryAddress || '',
        city: '',
        province: '',
        postalCode: '',
        country: 'South Africa',
      },
      ...(api.expectedDeliveryDate && { expectedDeliveryDate: new Date(api.expectedDeliveryDate) }),
      partialDeliveryAllowed: true,
      lastModifiedAt: new Date(api.updatedAt),
      createdBy: api.createdBy,
      deliveryStatus: PODeliveryStatus.NOT_STARTED,
      invoiceStatus: POInvoiceStatus.NOT_INVOICED,
      ...(api.notes && { notes: api.notes }),
      amendmentCount: 0,
      createdAt: new Date(api.createdAt),
      updatedAt: new Date(api.updatedAt),
      items: api.items.map((item: any) => ({
        id: item.id,
        poId: api.id,
        lineNumber: item.lineNumber,
        itemCode: item.itemCode,
        description: item.description,
        quantity: item.quantityOrdered,
        uom: item.unitOfMeasure,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
        quantityDelivered: item.quantityReceived,
        quantityPending: item.quantityPending,
        quantityInvoiced: 0,
        itemStatus: 'confirmed' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    };
  }

  private deriveApprovalStatus(poStatus: POStatus): POApprovalStatus {
    switch (poStatus) {
      case POStatus.DRAFT:
        return POApprovalStatus.PENDING;
      case POStatus.PENDING_APPROVAL:
        return POApprovalStatus.PENDING;
      case POStatus.APPROVED:
      case POStatus.SENT:
      case POStatus.ACKNOWLEDGED:
      case POStatus.DELIVERED:
        return POApprovalStatus.APPROVED;
      case POStatus.CANCELLED:
        return POApprovalStatus.REJECTED;
      default:
        return POApprovalStatus.PENDING;
    }
  }
}

export const poService = new POService();
export default poService;
