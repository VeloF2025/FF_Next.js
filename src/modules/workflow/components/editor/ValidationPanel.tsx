// 🟢 WORKING: Validation panel for real-time workflow validation feedback
import React, { useEffect, useMemo } from 'react';
import { 
  AlertTriangle, 
  CheckCircle, 
  Info, 
  ExternalLink,
  RefreshCw
} from 'lucide-react';
import { useWorkflowEditor } from '../../context/WorkflowEditorContext';
import type { WorkflowValidationError, WorkflowValidationWarning } from '../../types/workflow.types';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';

interface ValidationItemProps {
  item: WorkflowValidationError | WorkflowValidationWarning;
  type: 'error' | 'warning';
  onJumpTo?: (itemId?: string) => void;
}

const ValidationItem: React.FC<ValidationItemProps> = ({ item, type, onJumpTo }) => {
  const icon = type === 'error' ? AlertTriangle : Info;
  const bgColor = type === 'error' 
    ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
    : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800';
  const textColor = type === 'error'
    ? 'text-red-700 dark:text-red-400'
    : 'text-amber-700 dark:text-amber-400';

  const Icon = icon;

  return (
    <div className={`p-3 border rounded-lg ${bgColor} ${textColor} mb-2`}>
      <div className="flex items-start space-x-2">
        <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium uppercase tracking-wide">
              {item.level} {type}
            </span>
            {item.itemId && (
              <button
                onClick={() => onJumpTo?.(item.itemId)}
                className="text-xs underline hover:no-underline flex items-center space-x-1"
              >
                <span>Jump to</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            )}
          </div>
          
          <p className="text-sm font-medium mb-1">{item.message}</p>
          
          {'field' in item && item.field && (
            <p className="text-xs opacity-75">Field: {'field' in item ? item.field : ''}</p>
          )}
          
          {'suggestion' in item && item.suggestion && (
            <p className="text-xs mt-1 opacity-90">
              <strong>Suggestion:</strong> {item.suggestion}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export function ValidationPanel() {
  const { 
    state, 
    validateTemplate, 
    selectNode,
    setActivePanel 
  } = useWorkflowEditor();

  // Auto-validate when nodes change
  useEffect(() => {
    if (state.templateId && state.nodes.length > 0) {
      const validateTimeout = setTimeout(() => {
        validateTemplate();
      }, 1000); // Debounce validation

      return () => clearTimeout(validateTimeout);
    }
    return undefined; // Explicit return for else case
  }, [state.nodes, state.templateId, validateTemplate]);

  // Calculate validation summary
  const validationSummary = useMemo(() => {
    if (!state.validationResult) {
      return { errors: 0, warnings: 0, isValid: false };
    }

    return {
      errors: state.validationResult.errors.length,
      warnings: state.validationResult.warnings.length,
      isValid: state.validationResult.isValid
    };
  }, [state.validationResult]);

  // Handle jump to item
  const handleJumpTo = (itemId?: string) => {
    if (itemId) {
      selectNode(itemId);
      setActivePanel('properties');
    }
  };

  // Handle manual validation
  const handleManualValidation = () => {
    if (state.templateId) {
      validateTemplate();
    }
  };

  return (
    <div className="h-full flex flex-col bg-card">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            {validationSummary.isValid ? (
              <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
            )}
            <h2 className="font-semibold text-foreground">Validation</h2>
          </div>

          <button
            onClick={handleManualValidation}
            disabled={state.isValidating || !state.templateId}
            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
            title="Refresh Validation"
          >
            <RefreshCw className={`w-4 h-4 text-muted-foreground ${state.isValidating ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Validation Summary */}
        <div className="bg-gray-50 dark:bg-gray-750 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-foreground">
              Overall Status
            </span>
            {validationSummary.isValid ? (
              <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full dark:bg-green-900 dark:text-green-300">
                Valid
              </span>
            ) : (
              <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded-full dark:bg-red-900 dark:text-red-300">
                Invalid
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 text-center">
            <div>
              <div className="text-lg font-bold text-red-600 dark:text-red-400">
                {validationSummary.errors}
              </div>
              <div className="text-xs text-muted-foreground">Errors</div>
            </div>
            <div>
              <div className="text-lg font-bold text-amber-600 dark:text-amber-400">
                {validationSummary.warnings}
              </div>
              <div className="text-xs text-muted-foreground">Warnings</div>
            </div>
          </div>
        </div>
      </div>

      {/* Validation Results */}
      <div className="flex-1 overflow-y-auto p-4">
        {state.isValidating ? (
          <div className="flex items-center justify-center py-8">
            <div className="flex items-center space-x-3">
              <InlineSpinner size="sm" className="text-blue-600 dark:text-blue-400" />
              <span className="text-sm text-muted-foreground">
                Validating workflow...
              </span>
            </div>
          </div>
        ) : !state.validationResult ? (
          <div className="text-center py-8">
            <AlertTriangle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">
              No Validation Results
            </h3>
            <p className="text-muted-foreground mb-4">
              Start building your workflow to see validation feedback.
            </p>
            {state.templateId && (
              <button
                onClick={handleManualValidation}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Run Validation
              </button>
            )}
          </div>
        ) : (
          <div>
            {/* Errors */}
            {state.validationResult.errors.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center space-x-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" />
                  <h3 className="font-medium text-red-900 dark:text-red-100">
                    Errors ({state.validationResult.errors.length})
                  </h3>
                </div>
                
                {state.validationResult.errors.map((error, index) => (
                  <ValidationItem
                    key={`error-${index}`}
                    item={error}
                    type="error"
                    onJumpTo={handleJumpTo}
                  />
                ))}
              </div>
            )}

            {/* Warnings */}
            {state.validationResult.warnings.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center space-x-2 mb-3">
                  <Info className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  <h3 className="font-medium text-amber-900 dark:text-amber-100">
                    Warnings ({state.validationResult.warnings.length})
                  </h3>
                </div>
                
                {state.validationResult.warnings.map((warning, index) => (
                  <ValidationItem
                    key={`warning-${index}`}
                    item={warning}
                    type="warning"
                    onJumpTo={handleJumpTo}
                  />
                ))}
              </div>
            )}

            {/* Success State */}
            {validationSummary.isValid && (
              <div className="text-center py-8">
                <CheckCircle className="w-12 h-12 text-green-600 dark:text-green-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-green-900 dark:text-green-100 mb-2">
                  Workflow is Valid
                </h3>
                <p className="text-green-700 dark:text-green-300">
                  Your workflow passes all validation checks.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer with Validation Info */}
      <div className="p-4 border-t border-border">
        <div className="text-xs text-muted-foreground space-y-1">
          <div>• Validation runs automatically as you edit</div>
          <div>• Click &quot;Jump to&quot; to navigate to problematic items</div>
          <div>• Fix all errors before saving your workflow</div>
        </div>
      </div>
    </div>
  );
}

export default ValidationPanel;