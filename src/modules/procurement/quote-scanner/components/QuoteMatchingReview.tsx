/**
 * Quote Matching Review Component
 *
 * Displays side-by-side comparison of extracted items vs RFQ items
 * Allows manual adjustment of matches before creating the quote
 *
 * Status: WORKING - OCR Quote Scanner Feature
 */

import { useState, useMemo } from 'react';
import {
  Link2,
  Unlink,
  Check,
  AlertTriangle,
  ChevronDown,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import type {
  QuoteExtractionResult,
  QuoteMatchingResult,
  ItemMatchResult,
} from '../types/extraction.types';

// ============================================================================
// TYPES
// ============================================================================

interface RfqItem {
  id: string;
  description: string;
  itemCode?: string;
  quantity: number;
  unit: string;
}

interface QuoteMatchingReviewProps {
  extraction: QuoteExtractionResult;
  matching: QuoteMatchingResult;
  rfqItems: RfqItem[];
  onMatchChange: (extractedIndex: number, rfqItemId: string | null) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function QuoteMatchingReview({
  extraction,
  matching,
  rfqItems,
  onMatchChange,
  onConfirm,
  onCancel,
}: QuoteMatchingReviewProps) {
  const [expandedItem, setExpandedItem] = useState<number | null>(null);

  // Build match map for quick lookup
  const matchMap = useMemo(() => {
    const map = new Map<number, ItemMatchResult>();
    matching.matchedItems.forEach((match) => {
      map.set(match.extractedIndex, match);
    });
    return map;
  }, [matching.matchedItems]);

  // Find which RFQ items are already matched
  const usedRfqItemIds = useMemo(() => {
    return new Set(
      matching.matchedItems
        .filter((m) => m.rfqItemId)
        .map((m) => m.rfqItemId!)
    );
  }, [matching.matchedItems]);

  // Get available RFQ items for matching
  const getAvailableRfqItems = (currentExtractedIndex: number) => {
    const currentMatch = matchMap.get(currentExtractedIndex);
    return rfqItems.filter(
      (item) =>
        !usedRfqItemIds.has(item.id) ||
        currentMatch?.rfqItemId === item.id
    );
  };

  // Get match status badge
  const getMatchBadge = (match: ItemMatchResult | undefined) => {
    if (!match || !match.rfqItemId) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
          <XCircle className="h-3 w-3" />
          Unmatched
        </span>
      );
    }

    if (match.matchReason === 'exact_code') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
          <CheckCircle className="h-3 w-3" />
          Exact Match
        </span>
      );
    }

    if (match.matchReason === 'manual') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
          <Link2 className="h-3 w-3" />
          Manual
        </span>
      );
    }

    if (match.matchConfidence >= 0.8) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
          <Check className="h-3 w-3" />
          High ({Math.round(match.matchConfidence * 100)}%)
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
        <AlertTriangle className="h-3 w-3" />
        Low ({Math.round(match.matchConfidence * 100)}%)
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Summary Header */}
      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-foreground">
              Review Item Matching
            </h3>
            <p className="text-sm text-muted-foreground">
              {matching.rfqNumber} - {extraction.lineItems?.length || 0} extracted items
            </p>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-muted-foreground">
                {matching.totalMatched} matched
              </span>
            </div>
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-500" />
              <span className="text-muted-foreground">
                {matching.totalUnmatched} unmatched
              </span>
            </div>
          </div>
        </div>

        {/* Overall Confidence */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            Overall Confidence:
          </span>
          <div className="flex-1 max-w-xs bg-secondary rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${
                matching.overallConfidence >= 0.8
                  ? 'bg-green-500'
                  : matching.overallConfidence >= 0.5
                  ? 'bg-yellow-500'
                  : 'bg-red-500'
              }`}
              style={{ width: `${matching.overallConfidence * 100}%` }}
            />
          </div>
          <span className="text-sm font-medium text-foreground">
            {Math.round(matching.overallConfidence * 100)}%
          </span>
        </div>

        {/* Warnings */}
        {matching.warnings.length > 0 && (
          <div className="mt-4 space-y-1">
            {matching.warnings.map((warning, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-xs text-yellow-600 dark:text-yellow-400"
              >
                <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                <span>{warning}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Item Matching List */}
      <div className="space-y-3">
        {(extraction.lineItems || []).map((item, index) => {
          const match = matchMap.get(item.lineNumber);
          const isExpanded = expandedItem === index;
          const matchedRfqItem = match?.rfqItemId
            ? rfqItems.find((r) => r.id === match.rfqItemId)
            : null;

          return (
            <div
              key={index}
              className="bg-card rounded-lg border border-border overflow-hidden"
            >
              {/* Item Header */}
              <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-accent/30"
                onClick={() => setExpandedItem(isExpanded ? null : index)}
              >
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <span className="text-sm font-medium text-muted-foreground w-8">
                    #{item.lineNumber}
                  </span>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {item.description}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {item.quantity} {item.unit} × R {(item.unitPrice || 0).toLocaleString()}
                      {' = '}
                      <span className="font-medium">
                        R {(item.totalPrice || 0).toLocaleString()}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {getMatchBadge(match)}
                  <ChevronDown
                    className={`h-5 w-5 text-gray-400 transition-transform ${
                      isExpanded ? 'rotate-180' : ''
                    }`}
                  />
                </div>
              </div>

              {/* Expanded Content */}
              {isExpanded && (
                <div className="border-t border-border p-4 bg-input/50">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Extracted Item Details */}
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                        Extracted Item
                      </h4>
                      <div className="bg-card rounded-lg border border-border p-3 space-y-2">
                        {item.itemCode && (
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Code:</span>
                            <span className="font-medium text-foreground">
                              {item.itemCode}
                            </span>
                          </div>
                        )}
                        <div className="text-sm">
                          <span className="text-muted-foreground">Description:</span>
                          <p className="font-medium text-foreground mt-1">
                            {item.description}
                          </p>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Quantity:</span>
                          <span className="font-medium text-foreground">
                            {item.quantity} {item.unit}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Unit Price:</span>
                          <span className="font-medium text-foreground">
                            R {(item.unitPrice || 0).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* RFQ Item Match */}
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                        Matched RFQ Item
                      </h4>

                      {/* RFQ Item Selector */}
                      <div className="space-y-2">
                        <select
                          value={match?.rfqItemId || ''}
                          onChange={(e) =>
                            onMatchChange(
                              item.lineNumber,
                              e.target.value || null
                            )
                          }
                          className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                        >
                          <option value="">-- Select RFQ Item --</option>
                          {getAvailableRfqItems(item.lineNumber).map((rfqItem) => (
                            <option key={rfqItem.id} value={rfqItem.id}>
                              {rfqItem.itemCode ? `[${rfqItem.itemCode}] ` : ''}
                              {rfqItem.description.substring(0, 50)}
                              {rfqItem.description.length > 50 ? '...' : ''}
                            </option>
                          ))}
                        </select>

                        {/* Selected RFQ Item Details */}
                        {matchedRfqItem && (
                          <div className="bg-card rounded-lg border border-border p-3 space-y-2">
                            {matchedRfqItem.itemCode && (
                              <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Code:</span>
                                <span className="font-medium text-foreground">
                                  {matchedRfqItem.itemCode}
                                </span>
                              </div>
                            )}
                            <div className="text-sm">
                              <span className="text-muted-foreground">Description:</span>
                              <p className="font-medium text-foreground mt-1">
                                {matchedRfqItem.description}
                              </p>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">Required Qty:</span>
                              <span className="font-medium text-foreground">
                                {matchedRfqItem.quantity} {matchedRfqItem.unit}
                              </span>
                            </div>

                            {/* Quantity Match Check */}
                            {item.quantity !== matchedRfqItem.quantity && (
                              <div className="flex items-center gap-2 text-xs text-yellow-600 dark:text-yellow-400 pt-2 border-t border-gray-100 dark:border-gray-700">
                                <AlertTriangle className="h-3 w-3" />
                                <span>
                                  Quantity differs: {item.quantity} vs {matchedRfqItem.quantity}
                                </span>
                              </div>
                            )}
                          </div>
                        )}

                        {!matchedRfqItem && (
                          <div className="bg-secondary/50 rounded-lg p-3 text-center">
                            <Unlink className="h-8 w-8 mx-auto text-gray-400 mb-2" />
                            <p className="text-sm text-muted-foreground">
                              No RFQ item selected
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Unmatched RFQ Items Warning */}
      {rfqItems.length > 0 && (
        <div className="bg-card rounded-lg border border-border p-4">
          <h4 className="text-sm font-semibold text-foreground mb-3">
            RFQ Items Not in Quote
          </h4>
          <div className="space-y-2">
            {rfqItems
              .filter((item) => !usedRfqItemIds.has(item.id))
              .map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <XCircle className="h-4 w-4 text-red-400" />
                  <span className="truncate">
                    {item.itemCode ? `[${item.itemCode}] ` : ''}
                    {item.description}
                  </span>
                  <span className="text-gray-400">
                    ({item.quantity} {item.unit})
                  </span>
                </div>
              ))}
            {rfqItems.filter((item) => !usedRfqItemIds.has(item.id)).length === 0 && (
              <p className="text-sm text-green-600 dark:text-green-400 flex items-center gap-2">
                <CheckCircle className="h-4 w-4" />
                All RFQ items are covered in this quote
              </p>
            )}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onConfirm}>
          <Check className="h-4 w-4 mr-2" />
          Confirm & Create Quote
        </Button>
      </div>
    </div>
  );
}

export default QuoteMatchingReview;
