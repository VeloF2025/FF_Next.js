/**
 * BOQ Mapping Suggestions Component
 */

import { Check, ExternalLink } from 'lucide-react';
import { MappingSuggestion } from '@/types/procurement/boq.types';

interface BOQMappingSuggestionsProps {
  suggestions: MappingSuggestion[];
  onSelectSuggestion: (index: number) => void;
  isProcessing: boolean;
}

export default function BOQMappingSuggestions({
  suggestions,
  onSelectSuggestion,
  isProcessing
}: BOQMappingSuggestionsProps) {
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return 'text-green-600 bg-green-100';
    if (confidence >= 60) return 'text-yellow-600 bg-yellow-100';
    return 'text-red-600 bg-red-100';
  };

  if (suggestions.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500 dark:text-gray-400">
        <p className="text-sm">No catalog matches found</p>
        <p className="text-xs mt-1">This item may need to be added to the catalog</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 px-4 pt-2">
        Suggested Mappings ({suggestions.length})
      </h4>
      {suggestions.map((suggestion, index) => (
        <div
          key={index}
          className="px-4 py-3 hover:bg-gray-50 dark:bg-gray-900 border-b border-gray-100 last:border-b-0"
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {suggestion.catalogItemCode}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  getConfidenceColor(suggestion.confidence)
                }`}>
                  {suggestion.confidence}% match
                </span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                {suggestion.catalogItemName}
              </p>
              <div className="flex items-center space-x-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
                {suggestion.priceEstimate && (
                  <span>Price: R{suggestion.priceEstimate.toFixed(2)}</span>
                )}
                {suggestion.leadTimeEstimate && (
                  <span>Lead Time: {suggestion.leadTimeEstimate} days</span>
                )}
                {suggestion.catalogItemId && (
                  <a
                    href={`/catalog/${suggestion.catalogItemId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 flex items-center"
                  >
                    View in catalog
                    <ExternalLink className="h-3 w-3 ml-1" />
                  </a>
                )}
              </div>
            </div>
            <button
              onClick={() => onSelectSuggestion(index)}
              disabled={isProcessing}
              className="ml-4 px-3 py-1.5 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
            >
              <Check className="h-4 w-4 mr-1" />
              Use
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}