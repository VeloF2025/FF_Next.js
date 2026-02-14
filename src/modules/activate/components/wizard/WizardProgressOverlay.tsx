'use client';

import React from 'react';
import { Loader2, MapPin, Camera, Brain, CheckCircle, Database, Sparkles } from 'lucide-react';

export type WizardOperationType = 'sync_1map' | 'categorization';

export type Sync1MapPhase = 'fetching' | 'loading_photos' | 'checking' | 'complete';
export type CategorizationPhase = 'analyzing' | 'processing' | 'saving' | 'complete';

interface WizardProgressOverlayProps {
  isVisible: boolean;
  operationType: WizardOperationType;
  phase: Sync1MapPhase | CategorizationPhase;
  dropNumber?: string;
  photoCount?: number;
}

const sync1MapConfig: Record<Sync1MapPhase, {
  message: string;
  icon: React.ReactNode;
  color: string;
}> = {
  fetching: {
    message: 'Syncing from 1Map...',
    icon: <MapPin className="w-8 h-8" />,
    color: 'text-blue-500',
  },
  loading_photos: {
    message: 'Loading photos...',
    icon: <Camera className="w-8 h-8" />,
    color: 'text-purple-500',
  },
  checking: {
    message: 'Checking prerequisites...',
    icon: <Database className="w-8 h-8" />,
    color: 'text-indigo-500',
  },
  complete: {
    message: 'Data loaded!',
    icon: <CheckCircle className="w-8 h-8" />,
    color: 'text-green-500',
  },
};

const categorizationConfig: Record<CategorizationPhase, {
  message: string;
  icon: React.ReactNode;
  color: string;
}> = {
  analyzing: {
    message: 'Analyzing photos with AI...',
    icon: <Brain className="w-8 h-8" />,
    color: 'text-purple-500',
  },
  processing: {
    message: 'Categorizing photos...',
    icon: <Sparkles className="w-8 h-8" />,
    color: 'text-indigo-500',
  },
  saving: {
    message: 'Saving results...',
    icon: <Database className="w-8 h-8" />,
    color: 'text-blue-500',
  },
  complete: {
    message: 'Categorization complete!',
    icon: <CheckCircle className="w-8 h-8" />,
    color: 'text-green-500',
  },
};

export function WizardProgressOverlay({
  isVisible,
  operationType,
  phase,
  dropNumber,
  photoCount,
}: WizardProgressOverlayProps) {
  if (!isVisible) return null;

  const config = operationType === 'sync_1map'
    ? sync1MapConfig[phase as Sync1MapPhase]
    : categorizationConfig[phase as CategorizationPhase];

  const isComplete = phase === 'complete';
  const title = operationType === 'sync_1map' ? 'Syncing from 1Map' : 'AI Photo Categorization';

  const steps = operationType === 'sync_1map'
    ? [
        { id: 'fetching', label: 'Fetch from 1Map' },
        { id: 'loading_photos', label: 'Load Photos' },
        { id: 'checking', label: 'Check Prerequisites' },
      ]
    : [
        { id: 'analyzing', label: 'Analyze Photos' },
        { id: 'processing', label: 'Categorize with AI' },
        { id: 'saving', label: 'Save Results' },
      ];

  const currentStepIndex = steps.findIndex(s => s.id === phase);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-card rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4 transform transition-all">
        {/* Header */}
        <div className="text-center mb-6">
          <h3 className="text-xl font-semibold text-foreground">
            {title}
          </h3>
          {dropNumber && (
            <p className="text-sm text-muted-foreground mt-1">
              {dropNumber}
              {photoCount ? ` • ${photoCount} photos` : ''}
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
            {steps.map((step, index) => (
              <ProgressStep
                key={step.id}
                label={step.label}
                isActive={step.id === phase}
                isComplete={index < currentStepIndex || phase === 'complete'}
              />
            ))}
          </div>
        )}

        {/* Pulsing indicator */}
        {!isComplete && (
          <div className="flex justify-center mt-6 gap-1">
            <div className="w-2 h-2 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-2 h-2 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        )}
      </div>
    </div>
  );
}

interface ProgressStepProps {
  label: string;
  isActive: boolean;
  isComplete: boolean;
}

function ProgressStep({ label, isActive, isComplete }: ProgressStepProps) {
  return (
    <div className={`flex items-center gap-3 px-4 py-2 rounded-lg transition-all ${
      isActive
        ? 'bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-800'
        : isComplete
          ? 'bg-green-50 dark:bg-green-900/20'
          : 'bg-secondary/30'
    }`}>
      {/* Status indicator */}
      <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
        isComplete
          ? 'bg-green-500 text-white'
          : isActive
            ? 'bg-purple-500 text-white'
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

      {/* Label */}
      <span className={`text-sm font-medium ${
        isComplete
          ? 'text-green-700 dark:text-green-300'
          : isActive
            ? 'text-purple-700 dark:text-purple-300'
            : 'text-muted-foreground'
      }`}>
        {label}
      </span>
    </div>
  );
}
