/**
 * ConfirmDeactivateModal - Confirmation dialog for deactivating a monitored group
 */

import React, { useEffect } from 'react';
import { AlertCircle } from 'lucide-react';

interface ConfirmDeactivateModalProps {
  groupName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDeactivateModal: React.FC<ConfirmDeactivateModalProps> = ({ groupName, onConfirm, onCancel }) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--ff-bg-card)] rounded-lg shadow-xl w-full max-w-sm mx-4 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-red-600" />
          </div>
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
            Deactivate Group
          </h3>
        </div>
        <p className="text-[var(--ff-text-secondary)] mb-6">
          Are you sure you want to deactivate &quot;{groupName}&quot;? The Bridge will stop monitoring this group.
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
          >
            Deactivate
          </button>
        </div>
      </div>
    </div>
  );
};
