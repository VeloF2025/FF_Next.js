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
