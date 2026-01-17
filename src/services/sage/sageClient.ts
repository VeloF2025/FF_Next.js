/**
 * Sage Business Cloud Accounting API Client (South Africa)
 *
 * Basic Authentication + API Key client for SageOne API v2.0.0 (South Africa)
 *
 * Authentication: Basic Auth (username:password) + API key query parameter
 * API Docs: https://accounting.sageone.co.za/api/2.0.0/
 * Base URL: https://accounting.sageone.co.za
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'sageClient' });

// ============================================================================
// Types
// ============================================================================

export interface SageClientConfig {
  apiKey: string;
  username: string;
  password: string;
  companyId: string;
  baseUrl?: string;
  apiVersion?: string;
}

// Legacy config interface for backwards compatibility
export interface SageClientConfigLegacy {
  clientId: string;      // Maps to apiKey
  clientSecret: string;  // Not used in Basic Auth
  companyId: string;
  baseUrl?: string;
  apiVersion?: string;
  // Basic Auth credentials
  username?: string;
  password?: string;
}

export interface SageTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  tokenType: string;
}

export interface SageSupplier {
  ID: string;
  Name: string;
  Category?: { ID: string; Description: string };
  TaxReference?: string;
  ContactName?: string;
  Telephone?: string;
  Fax?: string;
  Mobile?: string;
  Email?: string;
  WebAddress?: string;
  Active: boolean;
  Balance?: number;
  CreditLimit?: number;
  PostalAddress01?: string;
  PostalAddress02?: string;
  PostalAddress03?: string;
  PostalAddress04?: string;
  PostalAddress05?: string;
  DeliveryAddress01?: string;
  DeliveryAddress02?: string;
  DeliveryAddress03?: string;
  DeliveryAddress04?: string;
  DeliveryAddress05?: string;
  AutoAllocateToOldestInvoice?: boolean;
  TextField1?: string;
  TextField2?: string;
  TextField3?: string;
  NumericField1?: number;
  NumericField2?: number;
  NumericField3?: number;
  YesNoField1?: boolean;
  YesNoField2?: boolean;
  YesNoField3?: boolean;
  DateField1?: string;
  DateField2?: string;
  DateField3?: string;
  DefaultDiscountPercentage?: number;
  DefaultTaxTypeID?: string;
  DueDateMethodId?: number;
  DueDateMethodValue?: number;
  CurrencyId?: string;
  CurrencySymbol?: string;
  HasActivity?: boolean;
  DefaultAccount?: { ID: string; Name: string };
  Created?: string;
  Modified?: string;
}

export interface SageSupplierInvoice {
  ID: string;
  DueDate: string;
  Paid: boolean;
  Status: string;
  FromDocument?: string;
  Locked: boolean;
  HasAdditionalCost: boolean;
  SupplierID: string;
  SupplierName: string;
  Supplier?: SageSupplier;
  Modified?: string;
  Created?: string;
  Date: string;
  Inclusive: boolean;
  DiscountPercentage?: number;
  TaxReference?: string;
  DocumentNumber?: string;
  Reference?: string;
  Message?: string;
  Discount?: number;
  Exclusive?: number;
  Tax?: number;
  Rounding?: number;
  Total?: number;
  AmountDue?: number;
  PostalAddress01?: string;
  PostalAddress02?: string;
  PostalAddress03?: string;
  PostalAddress04?: string;
  PostalAddress05?: string;
  DeliveryAddress01?: string;
  DeliveryAddress02?: string;
  DeliveryAddress03?: string;
  DeliveryAddress04?: string;
  DeliveryAddress05?: string;
  Printed?: boolean;
  TaxPeriodId?: string;
  Editable?: boolean;
  Lines?: SageInvoiceLine[];
}

export interface SageInvoiceLine {
  ID?: string;
  SelectionId?: string;
  TaxTypeId?: string;
  Description: string;
  UnitPriceExclusive?: number;
  UnitPriceInclusive?: number;
  DiscountPercentage?: number;
  Quantity?: number;
  Unit?: number;
  Exclusive?: number;
  Discount?: number;
  Tax?: number;
  Total?: number;
  Account?: { ID: string; Name: string };
}

export interface SageSupplierPayment {
  ID: string;
  SupplierID: string;
  SupplierName: string;
  Date: string;
  PaymentMethod?: number;
  DocumentNumber?: string;
  Reference?: string;
  Description?: string;
  Total?: number;
  Reconciled?: boolean;
  BankAccountId?: string;
  Taxable?: boolean;
  TaxTypeId?: string;
  Locked?: boolean;
  Editable?: boolean;
  Modified?: string;
  Created?: string;
}

export interface SageAccount {
  ID: string;
  Name: string;
  Category?: { ID: string; Description: string };
  Active: boolean;
  Balance?: number;
  Description?: string;
  ReportingGroupId?: string;
  UnallocatedAccount?: boolean;
  IsTaxLocked?: boolean;
  Modified?: string;
  Created?: string;
  AccountType?: number;
  HasActivity?: boolean;
  DefaultTaxTypeId?: string;
  DefaultTaxType?: { ID: string; Name: string };
}

export interface SagePurchaseOrder {
  ID?: string;
  SupplierID: string;
  SupplierName?: string;
  Date: string;
  DeliveryDate?: string;
  Reference?: string;
  Status?: string;
  StatusId?: number;
  Modified?: string;
  Created?: string;
  Exclusive?: number;
  Discount?: number;
  Tax?: number;
  Total?: number;
  Printed?: boolean;
  Editable?: boolean;
  Lines: SagePurchaseOrderLine[];
}

export interface SagePurchaseOrderLine {
  ID?: string;
  Description: string;
  Quantity: number;
  UnitPriceExclusive?: number;
  UnitPriceInclusive?: number;
  DiscountPercentage?: number;
  TaxTypeId?: string;
  AccountID?: string;
  Account?: { ID: string; Name: string };
  Unit?: number;
  Exclusive?: number;
  Discount?: number;
  Tax?: number;
  Total?: number;
}

export interface SageApiResponse<T> {
  TotalResults?: number;
  ReturnedResults?: number;
  Results: T[];
}

export interface SageApiError {
  Message: string;
  ErrorCode?: string;
  Details?: string;
}

// ============================================================================
// Sage Client Class - Basic Auth
// ============================================================================

export class SageClient {
  private baseUrl: string;
  private apiVersion: string;
  private apiKey: string;
  private username: string;
  private password: string;
  private companyId: string;
  private authHeader: string;

  constructor(config: SageClientConfig) {
    this.apiKey = config.apiKey;
    this.username = config.username;
    this.password = config.password;
    this.companyId = config.companyId;
    this.baseUrl = config.baseUrl || 'https://accounting.sageone.co.za';
    this.apiVersion = config.apiVersion || '2.0.0';

    // Pre-compute Basic Auth header
    const credentials = `${this.username}:${this.password}`;
    this.authHeader = `Basic ${Buffer.from(credentials).toString('base64')}`;
  }

  // ==========================================================================
  // Authentication (Basic Auth - no token refresh needed)
  // ==========================================================================

  /**
   * Get tokens - returns null for Basic Auth (no tokens used)
   * Kept for backwards compatibility
   */
  getTokens(): SageTokens | null {
    return null;
  }

  /**
   * Set tokens - no-op for Basic Auth
   * Kept for backwards compatibility
   */
  setTokens(_tokens: SageTokens): void {
    // No-op - Basic Auth doesn't use tokens
  }

  // ==========================================================================
  // HTTP Methods
  // ==========================================================================

  /**
   * Make authenticated API request using Basic Auth + API Key
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    // Build URL with API key
    const baseEndpoint = `${this.baseUrl}/api/${this.apiVersion}/${endpoint}`;
    const separator = endpoint.includes('?') ? '&' : '?';
    const url = `${baseEndpoint}${separator}apikey=${encodeURIComponent(this.apiKey)}`;

    const headers: Record<string, string> = {
      'Authorization': this.authHeader,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    logger.debug('Sage API request', { method, endpoint });

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60000;
      logger.warn('Rate limited by Sage API', { retryAfter: waitTime });
      throw new Error(`Rate limited. Retry after ${waitTime}ms`);
    }

    // Handle auth errors
    if (response.status === 401) {
      logger.error('Sage authentication failed - check username/password/API key');
      throw new Error('Authentication failed. Please verify your Sage credentials.');
    }

    if (!response.ok) {
      const errorText = await response.text();
      let errorData: SageApiError;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { Message: errorText };
      }

      logger.error('Sage API error', {
        status: response.status,
        endpoint,
        error: errorData
      });

      throw new Error(`Sage API error: ${errorData.Message}`);
    }

    const data = await response.json();
    return data as T;
  }

  private async get<T>(endpoint: string): Promise<T> {
    return this.request<T>('GET', endpoint);
  }

  private async post<T>(endpoint: string, body: unknown): Promise<T> {
    return this.request<T>('POST', endpoint, body);
  }

  private async put<T>(endpoint: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', endpoint, body);
  }

  // ==========================================================================
  // Suppliers
  // ==========================================================================

  /**
   * Get all suppliers
   */
  async getSuppliers(options?: {
    skip?: number;
    take?: number;
    filter?: string;
  }): Promise<SageApiResponse<SageSupplier>> {
    const params = new URLSearchParams();
    if (options?.skip) params.append('$skip', String(options.skip));
    if (options?.take) params.append('$top', String(options.take));
    if (options?.filter) params.append('$filter', options.filter);

    const query = params.toString();
    const endpoint = `Supplier/Get${query ? `?${query}` : ''}`;

    return this.get<SageApiResponse<SageSupplier>>(endpoint);
  }

  /**
   * Get supplier by ID
   */
  async getSupplier(id: string): Promise<SageSupplier> {
    return this.get<SageSupplier>(`Supplier/Get/${id}`);
  }

  /**
   * Create a new supplier
   */
  async createSupplier(supplier: Partial<SageSupplier>): Promise<SageSupplier> {
    return this.post<SageSupplier>('Supplier/Save', supplier);
  }

  /**
   * Update an existing supplier
   */
  async updateSupplier(supplier: SageSupplier): Promise<SageSupplier> {
    return this.put<SageSupplier>('Supplier/Save', supplier);
  }

  // ==========================================================================
  // Supplier Invoices
  // ==========================================================================

  /**
   * Get supplier invoices with optional filtering
   */
  async getSupplierInvoices(options?: {
    skip?: number;
    take?: number;
    filter?: string;
    includeDetail?: boolean;
  }): Promise<SageApiResponse<SageSupplierInvoice>> {
    const params = new URLSearchParams();
    if (options?.skip) params.append('$skip', String(options.skip));
    if (options?.take) params.append('$top', String(options.take));
    if (options?.filter) params.append('$filter', options.filter);
    if (options?.includeDetail) params.append('$includeDetail', 'true');

    const query = params.toString();
    const endpoint = `SupplierInvoice/Get${query ? `?${query}` : ''}`;

    return this.get<SageApiResponse<SageSupplierInvoice>>(endpoint);
  }

  /**
   * Get supplier invoices modified since a date
   */
  async getSupplierInvoicesSince(since: Date): Promise<SageApiResponse<SageSupplierInvoice>> {
    const isoDate = since.toISOString();
    return this.getSupplierInvoices({
      filter: `Modified gt datetime'${isoDate}'`,
      includeDetail: true,
    });
  }

  /**
   * Get supplier invoice by ID
   */
  async getSupplierInvoice(id: string): Promise<SageSupplierInvoice> {
    return this.get<SageSupplierInvoice>(`SupplierInvoice/Get/${id}`);
  }

  // ==========================================================================
  // Supplier Payments
  // ==========================================================================

  /**
   * Get supplier payments with optional filtering
   */
  async getSupplierPayments(options?: {
    skip?: number;
    take?: number;
    filter?: string;
    pageSize?: number;
    fromDate?: string;
  }): Promise<SageApiResponse<SageSupplierPayment>> {
    const params = new URLSearchParams();
    if (options?.skip) params.append('$skip', String(options.skip));
    if (options?.take || options?.pageSize) params.append('$top', String(options.take || options.pageSize));
    if (options?.filter) params.append('$filter', options.filter);
    if (options?.fromDate) params.append('$filter', `Date ge datetime'${options.fromDate}'`);

    const query = params.toString();
    const endpoint = `SupplierPayment/Get${query ? `?${query}` : ''}`;

    return this.get<SageApiResponse<SageSupplierPayment>>(endpoint);
  }

  /**
   * Get supplier payments modified since a date
   */
  async getSupplierPaymentsSince(since: Date): Promise<SageApiResponse<SageSupplierPayment>> {
    const isoDate = since.toISOString();
    return this.getSupplierPayments({
      filter: `Modified gt datetime'${isoDate}'`,
    });
  }

  /**
   * Get supplier payment by ID
   */
  async getSupplierPayment(id: string): Promise<SageSupplierPayment> {
    return this.get<SageSupplierPayment>(`SupplierPayment/Get/${id}`);
  }

  // ==========================================================================
  // Purchase Orders
  // ==========================================================================

  /**
   * Get purchase orders
   */
  async getPurchaseOrders(options?: {
    skip?: number;
    take?: number;
    filter?: string;
  }): Promise<SageApiResponse<SagePurchaseOrder>> {
    const params = new URLSearchParams();
    if (options?.skip) params.append('$skip', String(options.skip));
    if (options?.take) params.append('$top', String(options.take));
    if (options?.filter) params.append('$filter', options.filter);

    const query = params.toString();
    const endpoint = `SupplierPurchaseOrder/Get${query ? `?${query}` : ''}`;

    return this.get<SageApiResponse<SagePurchaseOrder>>(endpoint);
  }

  /**
   * Get purchase order by ID
   */
  async getPurchaseOrder(id: string): Promise<SagePurchaseOrder> {
    return this.get<SagePurchaseOrder>(`SupplierPurchaseOrder/Get/${id}`);
  }

  /**
   * Create a purchase order
   */
  async createPurchaseOrder(po: SagePurchaseOrder): Promise<SagePurchaseOrder> {
    return this.post<SagePurchaseOrder>('SupplierPurchaseOrder/Save', po);
  }

  /**
   * Update a purchase order
   */
  async updatePurchaseOrder(po: SagePurchaseOrder): Promise<SagePurchaseOrder> {
    return this.put<SagePurchaseOrder>('SupplierPurchaseOrder/Save', po);
  }

  // ==========================================================================
  // Chart of Accounts
  // ==========================================================================

  /**
   * Get all accounts (Chart of Accounts)
   */
  async getAccounts(options?: {
    skip?: number;
    take?: number;
    filter?: string;
  }): Promise<SageApiResponse<SageAccount>> {
    const params = new URLSearchParams();
    if (options?.skip) params.append('$skip', String(options.skip));
    if (options?.take) params.append('$top', String(options.take));
    if (options?.filter) params.append('$filter', options.filter);

    const query = params.toString();
    const endpoint = `Account/Get${query ? `?${query}` : ''}`;

    return this.get<SageApiResponse<SageAccount>>(endpoint);
  }

  /**
   * Get account by ID
   */
  async getAccount(id: string): Promise<SageAccount> {
    return this.get<SageAccount>(`Account/Get/${id}`);
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Test API connection
   */
  async testConnection(): Promise<{ success: boolean; message: string; companyId?: string }> {
    try {
      // Try to fetch suppliers to verify connection
      const suppliers = await this.getSuppliers({ take: 1 });

      return {
        success: true,
        message: `Connection successful. Found ${suppliers.TotalResults || 0} suppliers.`,
        companyId: this.companyId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Sage connection test failed', { error: message });

      return {
        success: false,
        message,
      };
    }
  }

  /**
   * Get API info for debugging
   */
  getApiInfo(): { baseUrl: string; apiVersion: string; companyId: string; authType: string } {
    return {
      baseUrl: this.baseUrl,
      apiVersion: this.apiVersion,
      companyId: this.companyId,
      authType: 'Basic',
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create SageClient from environment variables
 */
export function createSageClient(): SageClient {
  const apiKey = process.env.SAGE_API_KEY || process.env.SAGE_CLIENT_ID;
  const username = process.env.SAGE_USERNAME;
  const password = process.env.SAGE_PASSWORD;
  const companyId = process.env.SAGE_COMPANY_ID;

  if (!apiKey || !username || !password || !companyId) {
    throw new Error(
      'SAGE_API_KEY, SAGE_USERNAME, SAGE_PASSWORD, and SAGE_COMPANY_ID environment variables required'
    );
  }

  return new SageClient({
    apiKey,
    username,
    password,
    companyId,
    baseUrl: process.env.SAGE_BASE_URL,
    apiVersion: process.env.SAGE_API_VERSION,
  });
}

/**
 * Create SageClient from database config (Basic Auth)
 */
export function createSageClientFromConfig(config: {
  clientId?: string;  // Legacy - maps to apiKey
  apiKey?: string;
  clientSecret?: string;  // Unused in Basic Auth
  username: string;
  password: string;
  companyId: string;
  baseUrl?: string;
  // Legacy OAuth fields - ignored
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: Date;
}): SageClient {
  const apiKey = config.apiKey || config.clientId;

  if (!apiKey) {
    throw new Error('API key (clientId or apiKey) is required');
  }

  if (!config.username || !config.password) {
    throw new Error('Username and password are required for Basic Auth');
  }

  return new SageClient({
    apiKey,
    username: config.username,
    password: config.password,
    companyId: config.companyId,
    baseUrl: config.baseUrl,
  });
}
