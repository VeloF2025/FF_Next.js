/**
 * BOQ Mapping Review Component - Refactored Version
 * Interface for reviewing and approving catalog mappings after BOQ import
 */

import { X, AlertCircle, Loader2, CheckCircle } from 'lucide-react';
import { useBOQMapping } from './mapping/useBOQMapping';
import BOQMappingFilters from './mapping/BOQMappingFilters';
import BOQMappingBatchActions from './mapping/BOQMappingBatchActions';
import BOQExceptionCard from './mapping/BOQExceptionCard';
import { BOQMappingReviewProps } from './mapping/BOQMappingTypes';

export default function BOQMappingReview({ 
  boqId, 
  onMappingComplete, 
  onClose, 
  className 
}: BOQMappingReviewProps) {
  const {
    boq,
    exceptions,
    totalExceptions,
    selectedExceptions,
    filters,
    isLoading,
    isProcessing,
    expandedException,
    setFilters,
    setSelectedExceptions,
    setExpandedException,
    handleApproveMapping,
    handleDismissException,
    handleBatchApprove,
    handleBatchDismiss,
    loadData
  } = useBOQMapping(boqId, onMappingComplete);

  const toggleExceptionSelection = (exceptionId: string) => {
    setSelectedExceptions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(exceptionId)) {
        newSet.delete(exceptionId);
      } else {
        newSet.add(exceptionId);
      }
      return newSet;
    });
  };

  const clearSelection = () => {
    setSelectedExceptions(new Set());
  };

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center h-64 ${className}`}>
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <span className="ml-2 text-gray-600 dark:text-gray-400">Loading mapping review...</span>
      </div>
    );
  }

  if (!boq) {
    return (
      <div className={`flex items-center justify-center h-64 ${className}`}>
        <AlertCircle className="h-8 w-8 text-red-500" />
        <span className="ml-2 text-gray-600 dark:text-gray-400">BOQ not found</span>
      </div>
    );
  }

  if (exceptions.length === 0) {
    return (
      <div className={`${className}`}>
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-8">
          <div className="text-center">
            <CheckCircle className="mx-auto h-12 w-12 text-green-500" />
            <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-gray-100">All items mapped successfully</h3>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              No exceptions found for BOQ "{boq.fileName}"
            </p>
            {onClose && (
              <button
                onClick={onClose}
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700"
              >
                Continue
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100">Mapping Review</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Review and approve catalog mappings for BOQ: {boq.fileName}
            </p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 dark:text-gray-400"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-4">
          <div className="flex items-center">
            <AlertCircle className="h-8 w-8 text-orange-500" />
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Exceptions</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{totalExceptions}</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-4">
          <div className="flex items-center">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">High Severity</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {exceptions.filter(e => e.severity === 'high').length}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-4">
          <div className="flex items-center">
            <AlertCircle className="h-8 w-8 text-yellow-500" />
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Medium Severity</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {exceptions.filter(e => e.severity === 'medium').length}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-4">
          <div className="flex items-center">
            <AlertCircle className="h-8 w-8 text-blue-500" />
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Low Severity</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {exceptions.filter(e => e.severity === 'low').length}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <BOQMappingFilters
        filters={filters}
        onFilterChange={setFilters}
        totalCount={totalExceptions}
        filteredCount={exceptions.length}
      />

      {/* Batch Actions */}
      <BOQMappingBatchActions
        selectedCount={selectedExceptions.size}
        isProcessing={isProcessing}
        onBatchApprove={handleBatchApprove}
        onBatchDismiss={handleBatchDismiss}
        onClearSelection={clearSelection}
        onRefresh={loadData}
      />

      {/* Exception List */}
      <div className="space-y-4">
        {exceptions.map((exception) => (
          <BOQExceptionCard
            key={exception.id}
            exception={exception}
            isExpanded={expandedException === exception.id}
            isSelected={selectedExceptions.has(exception.id)}
            isProcessing={isProcessing}
            onToggleExpand={() => setExpandedException(
              expandedException === exception.id ? null : exception.id
            )}
            onToggleSelect={() => toggleExceptionSelection(exception.id)}
            onApproveMapping={(index) => handleApproveMapping(exception.id, index)}
            onDismiss={(reason) => handleDismissException(exception.id, reason)}
          />
        ))}
      </div>
    </div>
  );
}