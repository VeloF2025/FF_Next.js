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
} from './sageClient';

// Sync services (if they exist)
// export {
//   pullSuppliersFromSage,
//   getUnmatchedSuppliers,
//   manuallyMapSupplier,
//   getSupplierMapping,
// } from './entities/supplierSync';

// export {
//   pullInvoicesFromSage,
//   getUnmatchedInvoices,
//   manuallyMatchInvoice,
// } from './entities/invoiceSync';

// export {
//   pullPaymentsFromSage,
//   getPOPaymentSummary,
// } from './entities/paymentSync';
