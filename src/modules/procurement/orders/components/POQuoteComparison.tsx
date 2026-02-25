// ============= PO Quote Comparison Component =============
// Shows RFQ and quote context for PO approvers

import React from 'react';
import { FileText, Check, AlertCircle, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { formatDisplayDate } from '@/utils/dateFormat';

interface Quote {
  id: string;
  quoteNumber: string;
  supplierName: string;
  totalAmount: number;
  isSelected: boolean;
}

interface QuoteComparison {
  rfqId: string | null;
  rfqNumber: string | null;
  rfqTitle: string | null;
  selectedQuoteId: string | null;
  selectedQuote: {
    id: string;
    quoteNumber: string;
    supplierName: string;
    totalAmount: number;
    validUntil: string | null;
    deliveryDays: number | null;
    paymentTerms: string | null;
  } | null;
  allQuotes: Quote[];
}

interface POQuoteComparisonProps {
  quoteComparison: QuoteComparison | null;
  poAmount: number;
  currency?: string;
}

export const POQuoteComparison: React.FC<POQuoteComparisonProps> = ({
  quoteComparison,
  poAmount,
  currency = 'ZAR'
}) => {
  if (!quoteComparison || !quoteComparison.rfqId) {
    return (
      <div className="p-4 bg-background rounded-lg border border-border">
        <div className="flex items-center gap-2 text-muted-foreground">
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm">No RFQ linked to this purchase order</span>
        </div>
      </div>
    );
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
    }).format(value);
  };

  const formatDate = (dateStr: string | null) => formatDisplayDate(dateStr, '-');

  const selectedQuote = quoteComparison.selectedQuote;
  const otherQuotes = quoteComparison.allQuotes.filter(q => !q.isSelected);

  // Calculate price variance from lowest quote
  const lowestQuoteAmount = Math.min(...quoteComparison.allQuotes.map(q => q.totalAmount));
  const priceVariance = selectedQuote
    ? ((selectedQuote.totalAmount - lowestQuoteAmount) / lowestQuoteAmount * 100)
    : 0;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-blue-50 border-b border-blue-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-blue-600" />
            <span className="font-medium text-blue-900">Quote Comparison</span>
          </div>
          <Link
            href={`/procurement/rfq/${quoteComparison.rfqId}`}
            className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
          >
            View RFQ {quoteComparison.rfqNumber}
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
        {quoteComparison.rfqTitle && (
          <p className="text-sm text-blue-700 mt-1">{quoteComparison.rfqTitle}</p>
        )}
      </div>

      {/* Selected Quote */}
      {selectedQuote && (
        <div className="p-4 bg-green-50 border-b border-green-100">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-green-600" />
              <span className="font-medium text-green-900">Selected Quote</span>
            </div>
            <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded">
              {selectedQuote.quoteNumber}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3">
            <div>
              <p className="text-xs text-green-600 mb-1">Supplier</p>
              <p className="text-sm font-medium text-green-900">{selectedQuote.supplierName}</p>
            </div>
            <div>
              <p className="text-xs text-green-600 mb-1">Quote Amount</p>
              <p className="text-sm font-medium text-green-900">
                {formatCurrency(selectedQuote.totalAmount)}
              </p>
            </div>
            <div>
              <p className="text-xs text-green-600 mb-1">Valid Until</p>
              <p className="text-sm font-medium text-green-900">
                {formatDate(selectedQuote.validUntil)}
              </p>
            </div>
            <div>
              <p className="text-xs text-green-600 mb-1">Delivery</p>
              <p className="text-sm font-medium text-green-900">
                {selectedQuote.deliveryDays
                  ? `${selectedQuote.deliveryDays} days`
                  : '-'}
              </p>
            </div>
          </div>

          {/* Variance Warning */}
          {priceVariance > 5 && (
            <div className="mt-3 p-2 bg-amber-100 rounded flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <span className="text-sm text-amber-800">
                Selected quote is {priceVariance.toFixed(1)}% higher than the lowest quote
              </span>
            </div>
          )}

          {/* PO vs Quote Variance */}
          {Math.abs(poAmount - selectedQuote.totalAmount) > 1 && (
            <div className="mt-2 p-2 bg-blue-100 rounded flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-blue-600" />
              <span className="text-sm text-blue-800">
                PO amount ({formatCurrency(poAmount)}) differs from quote by{' '}
                {formatCurrency(Math.abs(poAmount - selectedQuote.totalAmount))}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Other Quotes Comparison */}
      {otherQuotes.length > 0 && (
        <div className="p-4">
          <p className="text-sm font-medium text-muted-foreground mb-3">
            Other Quotes Received ({otherQuotes.length})
          </p>
          <div className="space-y-2">
            {otherQuotes.map((quote) => (
              <div
                key={quote.id}
                className="flex items-center justify-between p-3 bg-background rounded-lg"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {quote.supplierName}
                  </p>
                  <p className="text-xs text-muted-foreground">{quote.quoteNumber}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-foreground">
                    {formatCurrency(quote.totalAmount)}
                  </p>
                  {selectedQuote && (
                    <p className={`text-xs ${
                      quote.totalAmount < selectedQuote.totalAmount
                        ? 'text-green-600'
                        : 'text-muted-foreground'
                    }`}>
                      {quote.totalAmount < selectedQuote.totalAmount
                        ? `${formatCurrency(selectedQuote.totalAmount - quote.totalAmount)} cheaper`
                        : quote.totalAmount > selectedQuote.totalAmount
                          ? `${formatCurrency(quote.totalAmount - selectedQuote.totalAmount)} more`
                          : 'Same price'}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary Footer */}
      <div className="px-4 py-3 bg-background border-t border-border">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {quoteComparison.allQuotes.length} quote{quoteComparison.allQuotes.length !== 1 ? 's' : ''} received
          </span>
          <span className="text-muted-foreground">
            Range: {formatCurrency(lowestQuoteAmount)} - {formatCurrency(Math.max(...quoteComparison.allQuotes.map(q => q.totalAmount)))}
          </span>
        </div>
      </div>
    </div>
  );
};
