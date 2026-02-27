/**
 * Sage Business Cloud Accounting Integration
 *
 * Services for syncing procurement data with Sage Accounting.
 * South Africa - API v2.0.0 with Basic Auth
 */

export {
  SageClient,
  createSageClient,
  createSageClientFromConfig,
  getSageClientFromDb,
  type SageClientConfig,
  type SageSupplier,
  type SageSupplierInvoice,
  type SageSupplierPayment,
  type SagePurchaseOrder,
  type SagePurchaseOrderLine,
  type SageAccount,
  type SageCompany,
  type SageApiResponse,
  type SageApiError,
  type SageCustomer,
  type SageCustomerInvoice,
  type SageAnalysisType,
  type SageAnalysisCategory,
  type SageAccountCategory,
  type SageReportingGroup,
  type SageDetailedLedgerTransaction,
  type SageTrialBalanceEntry,
  type SageAccountBudget,
} from './sageClient';

export {
  pullSuppliersFromSage,
  getUnmatchedSuppliers,
  manuallyMapSupplier,
  getSupplierMapping,
} from './entities/supplierSync';

export {
  pullCustomersFromSage,
  manuallyMapCustomer,
} from './entities/customerSync';

export {
  pullInvoicesFromSage,
  getUnmatchedInvoices,
  manuallyMatchInvoice,
} from './entities/invoiceSync';

export {
  pullCustomerInvoicesFromSage,
} from './entities/customerInvoiceSync';

export {
  pullPaymentsFromSage,
  getPOPaymentSummary,
} from './entities/paymentSync';

export {
  pullAnalysisData,
  getAnalysisSyncStatus,
} from './entities/analysisSync';

export {
  pullLedgerTransactions,
  getLedgerSyncStatus,
} from './entities/ledgerSync';

export {
  pullChartOfAccounts,
} from './entities/chartOfAccountsSync';
