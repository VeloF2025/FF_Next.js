/**
 * Onboarding Stage Card Component
 * Displays individual onboarding stage with status and actions
 */

'use client';

import React, { useState } from 'react';

export interface OnboardingStage {
  id: number;
  stageName: string;
  stageOrder: number;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  completionPercentage: number;
  requiredDocuments: string[];
  completedDocuments: string[];
  startedAt?: Date;
  completedAt?: Date;
  dueDate?: Date;
  notes?: string;
}

interface OnboardingStageCardProps {
  stage: OnboardingStage;
  onUpdateStage: (stageId: number, updates: {
    status?: 'pending' | 'in_progress' | 'completed' | 'skipped';
    completionPercentage?: number;
    notes?: string;
  }) => Promise<void>;
}

export function OnboardingStageCard({ stage, onUpdateStage }: OnboardingStageCardProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState(stage.notes || '');

  const getStatusConfig = () => {
    switch (stage.status) {
      case 'completed':
        return {
          bgColor: 'bg-green-50',
          borderColor: 'border-green-200',
          textColor: 'text-green-800',
          badgeColor: 'bg-green-100 text-green-800',
          icon: '✓',
          label: 'Completed',
        };
      case 'in_progress':
        return {
          bgColor: 'bg-blue-50',
          borderColor: 'border-blue-200',
          textColor: 'text-blue-800',
          badgeColor: 'bg-blue-100 text-blue-800',
          icon: '↻',
          label: 'In Progress',
        };
      case 'skipped':
        return {
          bgColor: 'bg-gray-50',
          borderColor: 'border-gray-200',
          textColor: 'text-gray-600',
          badgeColor: 'bg-gray-100 text-gray-600',
          icon: '⤳',
          label: 'Skipped',
        };
      default:
        return {
          bgColor: 'bg-yellow-50',
          borderColor: 'border-yellow-200',
          textColor: 'text-yellow-800',
          badgeColor: 'bg-yellow-100 text-yellow-800',
          icon: '○',
          label: 'Pending',
        };
    }
  };

  const handleStatusChange = async (newStatus: OnboardingStage['status']) => {
    setIsUpdating(true);
    try {
      await onUpdateStage(stage.id, { status: newStatus });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSaveNotes = async () => {
    setIsUpdating(true);
    try {
      await onUpdateStage(stage.id, { notes });
      setShowNotes(false);
    } finally {
      setIsUpdating(false);
    }
  };

  const config = getStatusConfig();
  const documentProgress = stage.requiredDocuments.length > 0
    ? Math.round((stage.completedDocuments.length / stage.requiredDocuments.length) * 100)
    : 100;

  return (
    <div className={`rounded-lg border ${config.borderColor} ${config.bgColor} p-4`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-2xl ${config.textColor}`}>{config.icon}</span>
            <h4 className="text-lg font-semibold text-gray-900">
              {stage.stageOrder}. {stage.stageName}
            </h4>
          </div>
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.badgeColor}`}>
            {config.label}
          </span>
        </div>
      </div>

      {/* Document Progress */}
      {stage.requiredDocuments.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-gray-600">Documents</span>
            <span className="text-sm font-medium text-gray-700">
              {stage.completedDocuments.length} / {stage.requiredDocuments.length}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${documentProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Timestamps */}
      <div className="text-xs text-gray-600 space-y-1 mb-3">
        {stage.startedAt && (
          <div>Started: {new Date(stage.startedAt).toISOString().split('T')[0]}</div>
        )}
        {stage.completedAt && (
          <div>Completed: {new Date(stage.completedAt).toISOString().split('T')[0]}</div>
        )}
        {stage.dueDate && !stage.completedAt && (
          <div>Due: {new Date(stage.dueDate).toISOString().split('T')[0]}</div>
        )}
      </div>

      {/* Notes Section */}
      {showNotes ? (
        <div className="mb-3">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded text-sm"
            rows={3}
            placeholder="Add notes..."
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleSaveNotes}
              disabled={isUpdating}
              className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={() => setShowNotes(false)}
              className="px-3 py-1 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        stage.notes && (
          <div className="mb-3 p-2 bg-white rounded text-sm text-gray-700">
            {stage.notes}
          </div>
        )
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {stage.status === 'pending' && (
          <button
            onClick={() => handleStatusChange('in_progress')}
            disabled={isUpdating}
            className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
          >
            Start Stage
          </button>
        )}
        {stage.status === 'in_progress' && (
          <button
            onClick={() => handleStatusChange('completed')}
            disabled={isUpdating}
            className="px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
          >
            Mark Complete
          </button>
        )}
        {stage.status !== 'skipped' && stage.status !== 'completed' && (
          <button
            onClick={() => handleStatusChange('skipped')}
            disabled={isUpdating}
            className="px-3 py-1.5 bg-gray-400 text-white text-sm rounded hover:bg-gray-500 disabled:opacity-50"
          >
            Skip
          </button>
        )}
        {!showNotes && (
          <button
            onClick={() => setShowNotes(true)}
            className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300"
          >
            {stage.notes ? 'Edit Notes' : 'Add Notes'}
          </button>
        )}
      </div>
    </div>
  );
}
