// ============= Message Category Configuration =============
// Category badge color configuration

export interface CategoryConfig {
  label: string;
  color: string;
}

type MessageCategoryKey = 'general' | 'rfq' | 'contract' | 'quality' | 'delivery' | 'payment' | 'compliance';

export const categoryConfig: Record<MessageCategoryKey, CategoryConfig> = {
  general: { label: 'General', color: 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200' },
  rfq: { label: 'RFQ', color: 'bg-blue-100 text-blue-800' },
  contract: { label: 'Contract', color: 'bg-purple-100 text-purple-800' },
  quality: { label: 'Quality', color: 'bg-green-100 text-green-800' },
  delivery: { label: 'Delivery', color: 'bg-orange-100 text-orange-800' },
  payment: { label: 'Payment', color: 'bg-yellow-100 text-yellow-800' },
  compliance: { label: 'Compliance', color: 'bg-red-100 text-red-800' }
};
