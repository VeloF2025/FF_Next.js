/**
 * Sage Business Cloud Accounting Integration
 *
 * Services for syncing procurement data with Sage Accounting.
 */

export {
  SageClient,
  createSageClient,
  createSageClientFromConfig,
  type SageClientConfig,
  type SageTokens,
  type SageSupplier,
  type SageSupplierInvoice,
  type SageSupplierPayment,
  type SagePurchaseOrder,
  type SagePurchaseOrderLine,
  type SageAccount,
  type SageApiResponse,
  type SageApiError,
} from './sageClient';

// Sync services
export {
  pullSuppliersFromSage,
  getUnmatchedSuppliers,
  manuallyMapSupplier,
  getSupplierMapping,
} from './entities/supplierSync';

export {
  pullInvoicesFromSage,
  getUnmatchedInvoices,
  manuallyMatchInvoice,
} from './entities/invoiceSync';

export {
  pullPaymentsFromSage,
  getPOPaymentSummary,
} from './entities/paymentSync';
