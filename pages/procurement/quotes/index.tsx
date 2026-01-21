/**
 * Quotes Page - Quote evaluation and comparison
 *
 * Part of the procurement workflow: BOQ → RFQ → Quotes → PO → GRN
 */

import { AppLayout } from '@/components/layout';
import QuoteEvaluationPage from '@/modules/procurement/quotes/QuoteEvaluationPage';

export default function QuotesPage() {
  return (
    <AppLayout>
      <QuoteEvaluationPage />
    </AppLayout>
  );
}
