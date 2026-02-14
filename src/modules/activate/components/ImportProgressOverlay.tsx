'use client';

import React from 'react';
import { Loader2, Database, CloudCog, CheckCircle, FileSpreadsheet } from 'lucide-react';

export type ImportPhase = 'parsing' | 'uploading' | 'processing' | 'syncing' | 'complete';

interface ImportProgressOverlayProps {
  isVisible: boolean;
  phase: ImportPhase;
  title?: string;
  recordCount?: number;
  showDatabaseSync?: boolean;
  showQFieldSync?: boolean;
}

const phaseConfig: Record<ImportPhase, {
  message: string;
  icon: React.ReactNode;
  color: string;
}> = {
  parsing: {
    message: 'Parsing Excel file...',
    icon: <FileSpreadsheet className="w-8 h-8" />,
    color: 'text-blue-500',
  },
  uploading: {
    message: 'Uploading data...',
    icon: <Loader2 className="w-8 h-8 animate-spin" />,
    color: 'text-blue-500',
  },
  processing: {
    message: 'Processing records...',
    icon: <Database className="w-8 h-8" />,
    color: 'text-purple-500',
  },
  syncing: {
    message: 'Syncing to database...',
    icon: <CloudCog className="w-8 h-8" />,
    color: 'text-indigo-500',
  },
  complete: {
    message: 'Import complete!',
    icon: <CheckCircle className="w-8 h-8" />,
    color: 'text-green-500',
  },
};

export function ImportProgressOverlay({
  isVisible,
  phase,
  title,
  recordCount,
  showDatabaseSync = true,
  showQFieldSync = false,
}: ImportProgressOverlayProps) {
  if (!isVisible) return null;

  const config = phaseConfig[phase];
  const isComplete = phase === 'complete';

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-card rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4 transform transition-all">
        {/* Header */}
        <div className="text-center mb-6">
          <h3 className="text-xl font-semibold text-foreground">
            {title || 'Importing Data'}
          </h3>
          {recordCount && (
            <p className="text-sm text-muted-foreground mt-1">
              {recordCount.toLocaleString()} records
            </p>
          )}
        </div>

        {/* Main Spinner */}
        <div className="flex flex-col items-center justify-center py-8">
          <div className={`${config.color} mb-4 relative`}>
            {!isComplete && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-16 h-16 border-4 border-current border-t-transparent rounded-full animate-spin opacity-30" />
              </div>
            )}
            <div className="relative z-10">
              {config.icon}
            </div>
          </div>
          <p className={`text-lg font-medium ${config.color}`}>
            {config.message}
          </p>
        </div>

        {/* Progress Steps */}
        {!isComplete && (
          <div className="space-y-3 mt-4">
            {/* Step 1: Parse */}
            <ProgressStep
              label="Parse Excel"
              isActive={phase === 'parsing'}
              isComplete={['uploading', 'processing', 'syncing', 'complete'].includes(phase)}
            />

            {/* Step 2: Database */}
            {showDatabaseSync && (
              <ProgressStep
                label="Upload to FibreFlow"
                icon={<Database className="w-4 h-4" />}
                isActive={phase === 'uploading' || phase === 'processing'}
                isComplete={['syncing', 'complete'].includes(phase)}
              />
            )}

            {/* Step 3: QField (optional) */}
            {showQFieldSync && (
              <ProgressStep
                label="Sync to QField"
                icon={<CloudCog className="w-4 h-4" />}
                isActive={phase === 'syncing'}
                isComplete={phase === 'complete'}
              />
            )}
          </div>
        )}

        {/* Pulsing indicator */}
        {!isComplete && (
          <div className="flex justify-center mt-6 gap-1">
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        )}
      </div>
    </div>
  );
}

interface ProgressStepProps {
  label: string;
  icon?: React.ReactNode;
  isActive: boolean;
  isComplete: boolean;
}

function ProgressStep({ label, icon, isActive, isComplete }: ProgressStepProps) {
  return (
    <div className={`flex items-center gap-3 px-4 py-2 rounded-lg transition-all ${
      isActive
        ? 'bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800'
        : isComplete
          ? 'bg-green-50 dark:bg-green-900/20'
          : 'bg-secondary/30'
    }`}>
      {/* Status indicator */}
      <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
        isComplete
          ? 'bg-green-500 text-white'
          : isActive
            ? 'bg-blue-500 text-white'
            : 'bg-muted'
      }`}>
        {isComplete ? (
          <CheckCircle className="w-4 h-4" />
        ) : isActive ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <div className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500" />
        )}
      </div>

      {/* Icon */}
      {icon && (
        <span className={isComplete ? 'text-green-600 dark:text-green-400' : isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'}>
          {icon}
        </span>
      )}

      {/* Label */}
      <span className={`text-sm font-medium ${
        isComplete
          ? 'text-green-700 dark:text-green-300'
          : isActive
            ? 'text-blue-700 dark:text-blue-300'
            : 'text-muted-foreground'
      }`}>
        {label}
      </span>
    </div>
  );
}
