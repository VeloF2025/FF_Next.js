/**
 * Sage Business Cloud Accounting API Client
 *
 * OAuth 2.0 authenticated client for SageOne API v2.0.0 (South Africa)
 * Handles authentication, token refresh, and API requests.
 *
 * API Docs: https://accounting.sageone.co.za/api/2.0.0/
 * Base URL: https://accounting.sageone.co.za
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'sageClient' });

// ============================================================================
// Types
// ============================================================================

export interface SageClientConfig {
  clientId: string;
  clientSecret: string;
  companyId: string;
  baseUrl?: string;
  apiVersion?: string;
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
// Sage Client Class
// ============================================================================

export class SageClient {
  private baseUrl: string;
  private apiVersion: string;
  private clientId: string;
  private clientSecret: string;
  private companyId: string;
  private tokens: SageTokens | null = null;

  constructor(config: SageClientConfig) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.companyId = config.companyId;
    this.baseUrl = config.baseUrl || 'https://accounting.sageone.co.za';
    this.apiVersion = config.apiVersion || '2.0.0';
  }

  // ==========================================================================
  // Authentication
  // ==========================================================================

  /**
   * Get OAuth authorization URL for user consent
   */
  getAuthorizationUrl(redirectUri: string, state?: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'full_access',
    });

    if (state) {
      params.append('state', state);
    }

    return `${this.baseUrl}/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(code: string, redirectUri: string): Promise<SageTokens> {
    logger.info('Exchanging authorization code for tokens');

    const response = await fetch(`${this.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }).toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error('Token exchange failed', { status: response.status, error });
      throw new Error(`Token exchange failed: ${error}`);
    }

    const data = await response.json();

    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
      tokenType: data.token_type || 'Bearer',
    };

    logger.info('Token exchange successful', { expiresAt: this.tokens.expiresAt });
    return this.tokens;
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(): Promise<SageTokens> {
    if (!this.tokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    logger.info('Refreshing access token');

    const response = await fetch(`${this.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.tokens.refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }).toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error('Token refresh failed', { status: response.status, error });
      throw new Error(`Token refresh failed: ${error}`);
    }

    const data = await response.json();

    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || this.tokens.refreshToken,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
      tokenType: data.token_type || 'Bearer',
    };

    logger.info('Token refresh successful', { expiresAt: this.tokens.expiresAt });
    return this.tokens;
  }

  /**
   * Set tokens directly (e.g., from database)
   */
  setTokens(tokens: SageTokens): void {
    this.tokens = tokens;
  }

  /**
   * Get current tokens
   */
  getTokens(): SageTokens | null {
    return this.tokens;
  }

  /**
   * Check if tokens need refresh (5 minute buffer)
   */
  private isTokenExpired(): boolean {
    if (!this.tokens) return true;
    const buffer = 5 * 60 * 1000; // 5 minutes
    return new Date() >= new Date(this.tokens.expiresAt.getTime() - buffer);
  }

  /**
   * Ensure we have valid tokens, refresh if needed
   */
  private async ensureValidToken(): Promise<void> {
    if (!this.tokens) {
      throw new Error('Not authenticated. Call exchangeCodeForTokens or setTokens first.');
    }

    if (this.isTokenExpired()) {
      await this.refreshAccessToken();
    }
  }

  // ==========================================================================
  // HTTP Methods
  // ==========================================================================

  /**
   * Make authenticated API request
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown,
    retryOnAuth = true
  ): Promise<T> {
    await this.ensureValidToken();

    const url = `${this.baseUrl}/api/${this.apiVersion}/${endpoint}`;

    const headers: Record<string, string> = {
      'Authorization': `${this.tokens!.tokenType} ${this.tokens!.accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    // Add company ID header if required
    if (this.companyId) {
      headers['X-Company-Id'] = this.companyId;
    }

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

    // Handle auth errors with retry
    if (response.status === 401 && retryOnAuth) {
      logger.warn('Auth failed, attempting token refresh');
      await this.refreshAccessToken();
      return this.request<T>(method, endpoint, body, false);
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
  }): Promise<SageApiResponse<SageSupplierPayment>> {
    const params = new URLSearchParams();
    if (options?.skip) params.append('$skip', String(options.skip));
    if (options?.take) params.append('$top', String(options.take));
    if (options?.filter) params.append('$filter', options.filter);

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
      await this.ensureValidToken();

      // Try to fetch company info or a simple endpoint
      const suppliers = await this.getSuppliers({ take: 1 });

      return {
        success: true,
        message: 'Connection successful',
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
  getApiInfo(): { baseUrl: string; apiVersion: string; companyId: string; hasTokens: boolean } {
    return {
      baseUrl: this.baseUrl,
      apiVersion: this.apiVersion,
      companyId: this.companyId,
      hasTokens: !!this.tokens,
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create SageClient from environment variables
 */
export function createSageClient(): SageClient {
  const clientId = process.env.SAGE_CLIENT_ID;
  const clientSecret = process.env.SAGE_CLIENT_SECRET;
  const companyId = process.env.SAGE_COMPANY_ID;

  if (!clientId || !clientSecret || !companyId) {
    throw new Error(
      'SAGE_CLIENT_ID, SAGE_CLIENT_SECRET, and SAGE_COMPANY_ID environment variables required'
    );
  }

  return new SageClient({
    clientId,
    clientSecret,
    companyId,
    baseUrl: process.env.SAGE_BASE_URL,
    apiVersion: process.env.SAGE_API_VERSION,
  });
}

/**
 * Create SageClient from database config
 */
export function createSageClientFromConfig(config: {
  clientId: string;
  clientSecret: string;
  companyId: string;
  baseUrl?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: Date;
}): SageClient {
  const client = new SageClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    companyId: config.companyId,
    baseUrl: config.baseUrl,
  });

  // Set tokens if available
  if (config.accessToken && config.refreshToken && config.expiresAt) {
    client.setTokens({
      accessToken: config.accessToken,
      refreshToken: config.refreshToken,
      expiresAt: config.expiresAt,
      tokenType: 'Bearer',
    });
  }

  return client;
}
