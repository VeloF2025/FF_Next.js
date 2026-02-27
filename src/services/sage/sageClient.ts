/**
 * Sage Business Cloud Accounting API Client (South Africa)
 *
 * Basic Auth client for SageOne API v2.0.0 (South Africa)
 *
 * Authentication: Basic Auth (username:password) + API Key
 * - Header: Authorization: Basic base64(username:password)
 * - API Key passed as query parameter
 *
 * API Docs: https://accounting.sageone.co.za/api/2.0.0/Help
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('sageClient');

// ============================================================================
// Constants
// ============================================================================

const SAGE_API_BASE_URL = 'https://accounting.sageone.co.za';
const DEFAULT_API_VERSION = '2.0.0';

// ============================================================================
// Types
// ============================================================================

export interface SageClientConfig {
  apiKey: string;
  username: string;
  password: string;
  companyId?: string;
  baseUrl?: string;
  apiVersion?: string;
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

export interface SageCustomer {
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

export interface SageCustomerInvoice {
  ID: string;
  DueDate: string;
  Paid: boolean;
  Status: string;
  FromDocument?: string;
  Locked: boolean;
  HasAdditionalCost: boolean;
  CustomerID: string;
  CustomerName: string;
  Customer?: SageCustomer;
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

export interface SageCompany {
  ID: string;
  Name: string;
  CurrencySymbol?: string;
  TaxNumber?: string;
  RegistrationNumber?: string;
  Created?: string;
  Modified?: string;
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
  message?: string;
}

// ============================================================================
// Analysis & Reporting Types
// ============================================================================

export interface SageAnalysisType {
  ID: string;
  Description: string;
  Active: boolean;
  SystemDefined?: boolean;
  Created?: string;
  Modified?: string;
}

export interface SageAnalysisCategory {
  ID: string;
  AnalysisTypeId: string;
  Description: string;
  Active: boolean;
  Order?: number;
  Created?: string;
  Modified?: string;
}

export interface SageAccountCategory {
  ID: string;
  Description: string;
  Comment?: string;
  Order?: number;
  Created?: string;
  Modified?: string;
}

export interface SageReportingGroup {
  ID: string;
  Description: string;
  AccountCategoryId?: string;
  Order?: number;
  Active: boolean;
  Created?: string;
  Modified?: string;
}

export interface SageDetailedLedgerTransaction {
  ID?: string;
  Date: string;
  Description?: string;
  DocumentNumber?: string;
  Reference?: string;
  AccountId: string;
  AccountName?: string;
  Debit: number;
  Credit: number;
  Tax?: number;
  TaxTypeId?: string;
  AnalysisCategoryId1?: string;
  AnalysisCategoryId2?: string;
  AnalysisCategoryId3?: string;
  AnalysisTypeId1?: string;
  AnalysisTypeId2?: string;
  AnalysisTypeId3?: string;
  SourceModule?: string;
  SourceDocumentId?: string;
  Created?: string;
  Modified?: string;
}

export interface SageTrialBalanceEntry {
  AccountId: string;
  AccountName?: string;
  AccountCategoryId?: string;
  AccountCategoryDescription?: string;
  ReportingGroupId?: string;
  ReportingGroupDescription?: string;
  Debit: number;
  Credit: number;
  OpeningBalance?: number;
  ClosingBalance?: number;
  TotalMovement?: number;
}

export interface SageAccountBudget {
  AccountId: string;
  AccountName?: string;
  BudgetItems?: Array<{
    Month: number;
    Year: number;
    Amount: number;
  }>;
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
    this.companyId = config.companyId || '';
    this.baseUrl = config.baseUrl || SAGE_API_BASE_URL;
    this.apiVersion = config.apiVersion || DEFAULT_API_VERSION;

    // Create Basic Auth header
    const credentials = `${this.username}:${this.password}`;
    this.authHeader = `Basic ${Buffer.from(credentials).toString('base64')}`;
  }

  // ==========================================================================
  // HTTP Methods
  // ==========================================================================

  /**
   * Make authenticated API request using Basic Auth
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    // Add API key as query parameter
    const separator = endpoint.includes('?') ? '&' : '?';
    const url = `${this.baseUrl}/api/${this.apiVersion}/${endpoint}${separator}apikey=${encodeURIComponent(this.apiKey)}`;

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
      throw new Error('Authentication failed. Please check your Sage credentials.');
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

      const errorMessage = errorData.Message || errorData.message || 'Unknown error';

      if (response.status === 403) {
        throw new Error(`Access denied: ${errorMessage}. Please check your Sage permissions.`);
      }

      throw new Error(`Sage API error (${response.status}): ${errorMessage}`);
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
  // Company
  // ==========================================================================

  /**
   * Get current company info
   */
  async getCompany(): Promise<SageCompany> {
    return this.get<SageCompany>('Company/Get');
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
  // Customers
  // ==========================================================================

  /**
   * Get all customers
   */
  async getCustomers(options?: {
    skip?: number;
    take?: number;
    filter?: string;
  }): Promise<SageApiResponse<SageCustomer>> {
    const params = new URLSearchParams();
    if (options?.skip) params.append('$skip', String(options.skip));
    if (options?.take) params.append('$top', String(options.take));
    if (options?.filter) params.append('$filter', options.filter);

    const query = params.toString();
    const endpoint = `Customer/Get${query ? `?${query}` : ''}`;

    return this.get<SageApiResponse<SageCustomer>>(endpoint);
  }

  /**
   * Get customer by ID
   */
  async getCustomer(id: string): Promise<SageCustomer> {
    return this.get<SageCustomer>(`Customer/Get/${id}`);
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
  // Customer Invoices (Tax Invoices)
  // ==========================================================================

  /**
   * Get customer invoices (Tax Invoices in Sage SA)
   */
  async getCustomerInvoices(options?: {
    skip?: number;
    take?: number;
    filter?: string;
    includeDetail?: boolean;
  }): Promise<SageApiResponse<SageCustomerInvoice>> {
    const params = new URLSearchParams();
    if (options?.skip) params.append('$skip', String(options.skip));
    if (options?.take) params.append('$top', String(options.take));
    if (options?.filter) params.append('$filter', options.filter);
    if (options?.includeDetail) params.append('$includeDetail', 'true');

    const query = params.toString();
    const endpoint = `TaxInvoice/Get${query ? `?${query}` : ''}`;

    return this.get<SageApiResponse<SageCustomerInvoice>>(endpoint);
  }

  /**
   * Get customer invoices modified since a date
   */
  async getCustomerInvoicesSince(
    since: Date
  ): Promise<SageApiResponse<SageCustomerInvoice>> {
    const isoDate = since.toISOString();
    return this.getCustomerInvoices({
      filter: `Modified gt datetime'${isoDate}'`,
      includeDetail: true,
    });
  }

  /**
   * Get customer invoice by ID
   */
  async getCustomerInvoice(id: string): Promise<SageCustomerInvoice> {
    return this.get<SageCustomerInvoice>(`TaxInvoice/Get/${id}`);
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
  // Analysis Types & Categories (Business Units / Sites)
  // ==========================================================================

  /**
   * Get analysis type definitions (e.g., "Site", "BU")
   */
  async getAnalysisTypes(): Promise<SageApiResponse<SageAnalysisType>> {
    return this.get<SageApiResponse<SageAnalysisType>>('AnalysisType/Get');
  }

  /**
   * Get analysis categories (individual sites/BUs under a type)
   */
  async getAnalysisCategories(options?: {
    skip?: number;
    take?: number;
    filter?: string;
  }): Promise<SageApiResponse<SageAnalysisCategory>> {
    const params = new URLSearchParams();
    if (options?.skip) params.append('$skip', String(options.skip));
    if (options?.take) params.append('$top', String(options.take));
    if (options?.filter) params.append('$filter', options.filter);

    const query = params.toString();
    const endpoint = `AnalysisCategory/Get${query ? `?${query}` : ''}`;

    return this.get<SageApiResponse<SageAnalysisCategory>>(endpoint);
  }

  /**
   * Get categories for a specific analysis type
   */
  async getAnalysisCategoriesByType(
    typeId: string
  ): Promise<SageApiResponse<SageAnalysisCategory>> {
    return this.getAnalysisCategories({
      filter: `AnalysisTypeId eq guid'${typeId}'`,
    });
  }

  // ==========================================================================
  // Account Categories & Reporting Groups
  // ==========================================================================

  /**
   * Get account categories (Sales, COS, Expenses, etc.)
   */
  async getAccountCategories(): Promise<SageApiResponse<SageAccountCategory>> {
    return this.get<SageApiResponse<SageAccountCategory>>('AccountCategory/Get');
  }

  /**
   * Get reporting groups (hierarchy under account categories)
   */
  async getReportingGroups(): Promise<SageApiResponse<SageReportingGroup>> {
    return this.get<SageApiResponse<SageReportingGroup>>('ReportingGroup/Get');
  }

  /**
   * Get full chart of accounts with categories
   */
  async getChartOfAccounts(): Promise<SageApiResponse<SageAccount>> {
    return this.getAccounts({ take: 1000 });
  }

  // ==========================================================================
  // Detailed Ledger Transactions
  // ==========================================================================

  /**
   * Get detailed ledger transactions with analysis codes.
   * Supports pagination. Sage returns max 200 per page.
   */
  async getDetailedLedgerTransactions(options?: {
    skip?: number;
    take?: number;
    filter?: string;
    fromDate?: string;
    toDate?: string;
  }): Promise<SageApiResponse<SageDetailedLedgerTransaction>> {
    const filters: string[] = [];
    if (options?.filter) filters.push(options.filter);
    if (options?.fromDate) {
      filters.push(`Date ge datetime'${options.fromDate}'`);
    }
    if (options?.toDate) {
      filters.push(`Date le datetime'${options.toDate}'`);
    }

    const params = new URLSearchParams();
    if (options?.skip) params.append('$skip', String(options.skip));
    params.append('$top', String(options?.take || 200));
    if (filters.length > 0) {
      params.append('$filter', filters.join(' and '));
    }

    const query = params.toString();
    const endpoint = `DetailedLedgerTransaction/Get?${query}`;

    return this.get<SageApiResponse<SageDetailedLedgerTransaction>>(endpoint);
  }

  /**
   * Get all ledger transactions for a date range with automatic pagination.
   * Handles Sage's 200-per-page limit.
   */
  async getAllLedgerTransactions(
    fromDate: string,
    toDate: string
  ): Promise<SageDetailedLedgerTransaction[]> {
    const pageSize = 200;
    let skip = 0;
    const allTransactions: SageDetailedLedgerTransaction[] = [];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const response = await this.getDetailedLedgerTransactions({
        skip,
        take: pageSize,
        fromDate,
        toDate,
      });

      const batch = response.Results || [];
      allTransactions.push(...batch);

      if (batch.length < pageSize) break;
      skip += pageSize;

      // Safety limit: max 50 pages (10,000 transactions)
      if (skip >= 10000) {
        logger.warn('Ledger transaction pagination hit safety limit', {
          totalFetched: allTransactions.length,
        });
        break;
      }
    }

    return allTransactions;
  }

  // ==========================================================================
  // Trial Balance & Budgets
  // ==========================================================================

  /**
   * Get trial balance for a period
   */
  async getTrialBalance(options?: {
    fromDate?: string;
    toDate?: string;
  }): Promise<SageApiResponse<SageTrialBalanceEntry>> {
    const params = new URLSearchParams();
    if (options?.fromDate) params.append('FromDate', options.fromDate);
    if (options?.toDate) params.append('ToDate', options.toDate);

    const query = params.toString();
    const endpoint = `TrialBalance/Get${query ? `?${query}` : ''}`;

    return this.get<SageApiResponse<SageTrialBalanceEntry>>(endpoint);
  }

  /**
   * Get account budgets from Sage
   */
  async getAccountBudgets(): Promise<SageApiResponse<SageAccountBudget>> {
    return this.get<SageApiResponse<SageAccountBudget>>(
      'AccountBalance/GetAccountBudgets'
    );
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Test API connection
   */
  async testConnection(): Promise<{ success: boolean; message: string; companyName?: string }> {
    try {
      // Try to fetch company info to verify connection
      const company = await this.getCompany();

      return {
        success: true,
        message: `Connected to ${company.Name}`,
        companyName: company.Name,
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
// Database Helper - Shared Sage Client from DB Config
// ============================================================================

/**
 * Get a SageClient using credentials stored in sage_api_config table.
 * Shared helper used by all sync API routes.
 */
export async function getSageClientFromDb(
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>
): Promise<SageClient> {
  const configResult = await sql`
    SELECT
      api_key,
      username,
      password,
      company_id,
      base_url,
      api_version
    FROM sage_api_config
    WHERE is_active = true AND is_connected = true
    LIMIT 1
  `;

  if (configResult.length === 0) {
    throw new Error('Sage is not configured or not connected. Please configure Sage credentials in Settings.');
  }

  const config = configResult[0];

  if (!config.api_key || !config.username || !config.password) {
    throw new Error('Sage credentials incomplete. Please check API Key, Username, and Password in Settings.');
  }

  return createSageClientFromConfig({
    apiKey: config.api_key as string,
    username: config.username as string,
    password: config.password as string,
    companyId: config.company_id as string | undefined,
    baseUrl: config.base_url as string | undefined,
    apiVersion: config.api_version as string | undefined,
  });
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create SageClient from environment variables
 */
export function createSageClient(): SageClient {
  const apiKey = process.env.SAGE_API_KEY;
  const username = process.env.SAGE_USERNAME;
  const password = process.env.SAGE_PASSWORD;

  if (!apiKey || !username || !password) {
    throw new Error(
      'SAGE_API_KEY, SAGE_USERNAME, and SAGE_PASSWORD environment variables required'
    );
  }

  return new SageClient({
    apiKey,
    username,
    password,
    companyId: process.env.SAGE_COMPANY_ID,
    baseUrl: process.env.SAGE_BASE_URL,
    apiVersion: process.env.SAGE_API_VERSION,
  });
}

/**
 * Create SageClient from database config (Basic Auth)
 */
export function createSageClientFromConfig(config: {
  apiKey: string;
  username: string;
  password: string;
  companyId?: string;
  baseUrl?: string;
  apiVersion?: string;
}): SageClient {
  if (!config.apiKey) {
    throw new Error('API Key is required');
  }

  if (!config.username) {
    throw new Error('Username is required');
  }

  if (!config.password) {
    throw new Error('Password is required');
  }

  return new SageClient({
    apiKey: config.apiKey,
    username: config.username,
    password: config.password,
    companyId: config.companyId,
    baseUrl: config.baseUrl,
    apiVersion: config.apiVersion,
  });
}
