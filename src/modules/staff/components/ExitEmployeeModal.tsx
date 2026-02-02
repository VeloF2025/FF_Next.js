/**
 * ExitEmployeeModal - Modal for processing employee exits
 * Handles resignation, termination, retirement, and other separation scenarios
 */

import { useState, useEffect } from 'react';
import { X, AlertTriangle, UserMinus, CheckCircle } from 'lucide-react';
import {
  ExitType,
  EXIT_TYPE_LABELS,
  StaffStatus,
  getExitTypeForStatus,
} from '@/types/staff/enums.types';
import { log } from '@/lib/logger';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ExitEmployeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (exitData: ExitFormData) => void;
  staffName: string;
  staffId: string;
  currentStatus: StaffStatus;
  targetStatus: StaffStatus;
}

export interface ExitFormData {
  exitType: ExitType;
  exitReason: string;
  endDate: string;
  isRehireable: boolean;
  finalStatus: StaffStatus;
}

const inputClasses = "w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500";
const labelClasses = "block text-sm font-medium text-[var(--ff-text-secondary)] mb-1";
const selectTriggerClasses = "w-full h-10 px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500";

export function ExitEmployeeModal({
  isOpen,
  onClose,
  onConfirm,
  staffName,
  staffId,
  currentStatus,
  targetStatus,
}: ExitEmployeeModalProps) {
  const [exitType, setExitType] = useState<ExitType>(
    getExitTypeForStatus(targetStatus) || ExitType.VOLUNTARY
  );
  const [exitReason, setExitReason] = useState('');
  const [endDate, setEndDate] = useState<string>(new Date().toISOString().split('T')[0] || '');
  const [isRehireable, setIsRehireable] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setExitType(getExitTypeForStatus(targetStatus) || ExitType.VOLUNTARY);
      setExitReason('');
      setEndDate(new Date().toISOString().split('T')[0] || '');
      setIsRehireable(targetStatus !== StaffStatus.TERMINATED);
      setErrors({});
    }
  }, [isOpen, targetStatus]);

  // Update exit type when target status changes
  useEffect(() => {
    const suggestedType = getExitTypeForStatus(targetStatus);
    if (suggestedType) {
      setExitType(suggestedType);
    }
  }, [targetStatus]);

  // Auto-set rehireable based on exit type
  useEffect(() => {
    if (exitType === ExitType.INVOLUNTARY || exitType === ExitType.ABSCONDED) {
      setIsRehireable(false);
    }
  }, [exitType]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!exitReason.trim()) {
      newErrors.exitReason = 'Exit reason is required';
    } else if (exitReason.trim().length < 10) {
      newErrors.exitReason = 'Please provide a more detailed reason (min 10 characters)';
    }

    if (!endDate) {
      newErrors.endDate = 'End date is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      await onConfirm({
        exitType,
        exitReason: exitReason.trim(),
        endDate,
        isRehireable,
        finalStatus: targetStatus,
      });
      onClose();
    } catch (error) {
      log.error('Error processing exit', error, 'ExitEmployeeModal');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const getStatusColor = () => {
    switch (targetStatus) {
      case StaffStatus.TERMINATED:
        return 'text-red-400';
      case StaffStatus.RESIGNED:
        return 'text-orange-400';
      case StaffStatus.RETIRED:
        return 'text-blue-400';
      default:
        return 'text-[var(--ff-text-tertiary)]';
    }
  };

  const getStatusLabel = () => {
    switch (targetStatus) {
      case StaffStatus.TERMINATED:
        return 'Terminate Employee';
      case StaffStatus.RESIGNED:
        return 'Process Resignation';
      case StaffStatus.RETIRED:
        return 'Process Retirement';
      default:
        return 'Process Exit';
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 bg-[var(--ff-bg-secondary)] rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-[var(--ff-border-light)]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--ff-border-light)]">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-full bg-opacity-10 ${getStatusColor()} bg-current`}>
              <UserMinus className={`h-5 w-5 ${getStatusColor()}`} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                {getStatusLabel()}
              </h2>
              <p className="text-sm text-[var(--ff-text-secondary)]">
                {staffName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
          >
            <X className="h-5 w-5 text-[var(--ff-text-secondary)]" />
          </button>
        </div>

        {/* Warning Banner */}
        <div className="mx-4 mt-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-200">
            <p className="font-medium">This action will mark the employee as no longer active.</p>
            <p className="mt-1 text-amber-300/80">
              Their records will be preserved but they will be excluded from active staff lists.
            </p>
          </div>
        </div>

        {/* Form */}
        <div className="p-4 space-y-4">
          {/* Exit Type */}
          <div>
            <label className={labelClasses}>Exit Type *</label>
            <Select
              value={exitType}
              onValueChange={(value) => setExitType(value as ExitType)}
            >
              <SelectTrigger className={selectTriggerClasses}>
                <SelectValue placeholder="Select exit type" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(EXIT_TYPE_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* End Date */}
          <div>
            <label className={labelClasses}>Last Working Day *</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={inputClasses}
            />
            {errors.endDate && (
              <p className="mt-1 text-sm text-red-500">{errors.endDate}</p>
            )}
          </div>

          {/* Exit Reason */}
          <div>
            <label className={labelClasses}>Reason for Leaving *</label>
            <textarea
              value={exitReason}
              onChange={(e) => setExitReason(e.target.value)}
              rows={4}
              placeholder="Please provide details about why the employee is leaving..."
              className={`${inputClasses} resize-none`}
            />
            {errors.exitReason && (
              <p className="mt-1 text-sm text-red-500">{errors.exitReason}</p>
            )}
            <p className="mt-1 text-xs text-[var(--ff-text-tertiary)]">
              This information is for internal HR records only.
            </p>
          </div>

          {/* Rehireable */}
          <div className="flex items-center gap-3 p-3 bg-[var(--ff-bg-tertiary)] rounded-lg">
            <input
              type="checkbox"
              id="isRehireable"
              checked={isRehireable}
              onChange={(e) => setIsRehireable(e.target.checked)}
              className="w-4 h-4 rounded border-[var(--ff-border-light)] text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="isRehireable" className="flex-1">
              <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                Eligible for Rehire
              </span>
              <p className="text-xs text-[var(--ff-text-secondary)]">
                Can this employee be considered for future positions?
              </p>
            </label>
          </div>

          {/* Summary */}
          <div className="p-3 bg-[var(--ff-bg-tertiary)] rounded-lg border border-[var(--ff-border-light)]">
            <h4 className="text-sm font-medium text-[var(--ff-text-primary)] mb-2">Summary</h4>
            <div className="space-y-1 text-sm text-[var(--ff-text-secondary)]">
              <div className="flex justify-between">
                <span>Employee:</span>
                <span className="font-medium text-[var(--ff-text-primary)]">{staffName}</span>
              </div>
              <div className="flex justify-between">
                <span>Exit Type:</span>
                <span className="font-medium text-[var(--ff-text-primary)]">
                  {EXIT_TYPE_LABELS[exitType]}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Last Day:</span>
                <span className="font-medium text-[var(--ff-text-primary)]">
                  {endDate ? new Date(endDate).toISOString().split('T')[0] : '-'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Rehireable:</span>
                <span className={`font-medium ${isRehireable ? 'text-green-400' : 'text-red-400'}`}>
                  {isRehireable ? 'Yes' : 'No'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-4 border-t border-[var(--ff-border-light)]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors flex items-center gap-2 ${
              targetStatus === StaffStatus.TERMINATED
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-orange-600 hover:bg-orange-700'
            } disabled:opacity-50`}
          >
            {isSubmitting ? (
              <>
                <span className="animate-spin">⏳</span>
                Processing...
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4" />
                Confirm Exit
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
