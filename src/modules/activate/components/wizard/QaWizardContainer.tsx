/**
 * QA Wizard Container
 *
 * Main component for the 5-phase QA Wizard workflow.
 * Handles navigation between phases and state management.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { log } from '@/lib/logger';
import type { QaWizardPhase, QaWizardState, QaDecision, Photo } from '../../types/unified.types';
import { PrerequisitesPhase } from './PrerequisitesPhase';
import { PhotoReviewPhase } from './PhotoReviewPhase';
import { DataValidationPhase } from './DataValidationPhase';
import { FinalDecisionPhase } from './FinalDecisionPhase';
import { FeedbackPhase } from './FeedbackPhase';
import { WizardProgressOverlay, type Sync1MapPhase } from './WizardProgressOverlay';

interface QaWizardContainerProps {
  dropNumber: string;
  onPhaseChange?: (phase: QaWizardPhase) => void;
  onComplete?: () => void;
}

const PHASE_LABELS: Record<QaWizardPhase, string> = {
  prerequisites: 'Prerequisites',
  photo_review: 'Photo Review',
  data_validation: 'Data Validation',
  final_decision: 'Final Decision',
  feedback: 'Feedback',
  completed: 'Completed',
};

// Shorter labels for compact step indicator
const PHASE_SHORT_LABELS: Record<QaWizardPhase, string> = {
  prerequisites: 'Prereq',
  photo_review: 'Photos',
  data_validation: 'Validate',
  final_decision: 'Decision',
  feedback: 'Feedback',
  completed: 'Done',
};

const PHASE_ORDER: QaWizardPhase[] = [
  'prerequisites',
  'photo_review',
  'data_validation',
  'final_decision',
  'feedback',
];

const initialState: QaWizardState = {
  phase: 'prerequisites',
  prerequisites: {
    passed: false,
    checked: false,
    failures: [],
    photosAvailable: false,
    photoCount: 0,
    ontSerialPresent: false,
    ontSerial: null,
    upsSerialPresent: false,
    upsSerial: null,
  },
  photoReview: {
    completed: false,
    stepsCovered: [],
    stepsMissing: [],
    totalPhotos: 0,
    categorizedPhotos: 0,
  },
  dataValidation: {
    completed: false,
    powerMeter: {
      status: 'pending',
      value: null,
      inRange: false,
    },
    serialValidation: {
      status: 'pending',
      onemapSerial: null,
      step6Serial: null,
      step9Serial: null,
      step9DrNumber: null,
      ontMatch: false,
      drMatch: false,
    },
  },
  finalDecision: {
    decision: null,
    reasons: [],
    internalNotes: null,
    technicianFeedback: null,
    notes: null,
    decidedAt: null,
    decidedBy: null,
  },
  feedback: {
    sent: false,
    sentAt: null,
    message: null,
  },
};

// Initial decision data structure for passing to FinalDecisionPhase
interface InitialDecisionData {
  decision: 'PASS' | 'FAIL' | 'REWORK_NEEDED' | null;
  internalNotes: string | null;
  technicianFeedback: string | null;
  issueClassification: {
    issueType: 'ai_error' | 'photo_quality' | 'real_issue' | 'no_issue' | null;
    correctValue: string;
    createTicket: boolean;
    ticketType: 'maintenance' | 'qa' | null;
    ticketDescription: string;
  } | null;
}

export function QaWizardContainer({
  dropNumber,
  onPhaseChange,
  onComplete,
}: QaWizardContainerProps) {
  const [state, setState] = useState<QaWizardState>(initialState);
  const [loading, setLoading] = useState(false);
  const [dataStatus, setDataStatus] = useState<string | null>(null); // Loading message for data fetch
  const [error, setError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [project, setProject] = useState<string | null>(null);
  const [syncPhase, setSyncPhase] = useState<Sync1MapPhase | null>(null);
  // Initial decision data from draft save (for Phase 4)
  const [initialDecisionData, setInitialDecisionData] = useState<InitialDecisionData | null>(null);

  // Load initial state from API
  useEffect(() => {
    loadWizardState();
  }, [dropNumber]);

  const loadWizardState = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSyncPhase('fetching');
    setDataStatus('Syncing from 1Map...');

    try {
      // STEP 0: Ensure data is complete before checking prerequisites
      // This fetches from OneMap if photos/serials are missing
      const ensureResponse = await fetch('/api/activate/ensure-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dropNumber }),
      });

      if (ensureResponse.ok) {
        const ensureData = await ensureResponse.json();
        const ensureResult = ensureData.data;

        if (ensureResult.refreshed) {
          setDataStatus(`Refreshed: ${ensureResult.photoCount} photos loaded`);
          log.info('QaWizard', `Data refreshed for ${dropNumber}`, ensureResult);
        } else if (ensureResult.status === 'partial') {
          setDataStatus('Partial data available - some items may be missing');
          log.warn('QaWizard', `Partial data for ${dropNumber}`, ensureResult);
        }
      }

      setSyncPhase('checking');
      setDataStatus('Checking prerequisites...');

      // STEP 1: Check prerequisites
      const prereqResponse = await fetch(
        `/api/activate/validate-prerequisites?dropNumber=${encodeURIComponent(dropNumber)}`
      );

      if (prereqResponse.ok) {
        const prereqData = await prereqResponse.json();
        const result = prereqData.data;

        // Store project name for feedback phase
        if (result.project) {
          setProject(result.project);
        }

        setState((prev) => ({
          ...prev,
          phase: result.canProceed ? 'photo_review' : 'prerequisites',
          prerequisites: {
            passed: result.prerequisites.passed,
            checked: true,
            failures: result.prerequisites.failures || [],
            photosAvailable: result.photosCheck.exists,
            photoCount: result.photosCheck.count,
            ontSerialPresent: result.serialsFromOneMap.ontSerial !== null,
            ontSerial: result.serialsFromOneMap.ontSerial,
            upsSerialPresent: result.serialsFromOneMap.upsSerial !== null,
            upsSerial: result.serialsFromOneMap.upsSerial,
          },
        }));
      }

      // Fetch photos for the drop (POST with body, force refresh to get step mappings)
      setSyncPhase('loading_photos');
      setDataStatus('Loading photos...');
      try {
        const photosResponse = await fetch('/api/activate/fetch-photos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dropNumber, force: true }),
        });
        if (photosResponse.ok) {
          const photosData = await photosResponse.json();
          if (photosData.data?.photos) {
            const fetchedPhotos = photosData.data.photos as Photo[];
            setPhotos(fetchedPhotos);

            // Calculate step coverage from photos
            const stepCounts = new Map<number, number>();
            fetchedPhotos.forEach((photo: Photo) => {
              if (photo.step && photo.step >= 1 && photo.step <= 10) {
                stepCounts.set(photo.step, (stepCounts.get(photo.step) || 0) + 1);
              }
            });

            const stepsCovered: number[] = [];
            const stepsMissing: number[] = [];
            for (let i = 1; i <= 10; i++) {
              if (stepCounts.has(i) && (stepCounts.get(i) || 0) > 0) {
                stepsCovered.push(i);
              } else {
                stepsMissing.push(i);
              }
            }

            setState((prev) => ({
              ...prev,
              photoReview: {
                ...prev.photoReview,
                totalPhotos: fetchedPhotos.length,
                categorizedPhotos: fetchedPhotos.filter((p: Photo) => p.step !== null).length,
                stepsCovered,
                stepsMissing,
              },
            }));
          }
        }
      } catch {
        log.warn('QaWizard', `Could not fetch photos for ${dropNumber}`);
      }

      // Check for existing decision (including drafts)
      const decisionResponse = await fetch(
        `/api/activate/final-decision?dropNumber=${encodeURIComponent(dropNumber)}`
      );

      if (decisionResponse.ok) {
        const decisionData = await decisionResponse.json();
        const result = decisionData.data;

        if (result.decision) {
          // Determine phase based on draft status
          const isDraft = result.isDraft || false;
          const targetPhase = isDraft ? 'final_decision' : (result.phase || 'feedback');

          setState((prev) => ({
            ...prev,
            phase: targetPhase,
            finalDecision: {
              decision: result.decision as QaDecision,
              reasons: result.reasons || [],
              notes: result.notes,
              decidedAt: result.decidedAt,
              decidedBy: result.decidedBy,
            },
          }));

          // Store initial decision data for FinalDecisionPhase (draft recovery)
          if (isDraft || result.decision) {
            setInitialDecisionData({
              decision: result.decision,
              internalNotes: result.internalNotes || null,
              technicianFeedback: result.technicianFeedback || null,
              issueClassification: result.issueClassification || null,
            });
            log.info('QaWizard', `Loaded ${isDraft ? 'draft' : 'existing'} decision for ${dropNumber}`, {
              decision: result.decision,
              isDraft,
            });
          }
        }
      }
    // Brief complete animation
      setSyncPhase('complete');
      await new Promise(resolve => setTimeout(resolve, 600));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load wizard state';
      setError(message);
      log.error('QaWizard', `Failed to load state for ${dropNumber}: ${message}`);
    } finally {
      setLoading(false);
      setSyncPhase(null);
      setDataStatus(null);
    }
  }, [dropNumber]);

  const goToPhase = (phase: QaWizardPhase) => {
    setState((prev) => ({ ...prev, phase }));
    onPhaseChange?.(phase);
  };

  const goToNextPhase = () => {
    const currentIndex = PHASE_ORDER.indexOf(state.phase);
    const nextPhase = PHASE_ORDER[currentIndex + 1];
    if (currentIndex < PHASE_ORDER.length - 1 && nextPhase) {
      goToPhase(nextPhase);
    }
  };

  const goToPreviousPhase = () => {
    const currentIndex = PHASE_ORDER.indexOf(state.phase);
    const prevPhase = PHASE_ORDER[currentIndex - 1];
    if (currentIndex > 0 && prevPhase) {
      goToPhase(prevPhase);
    }
  };

  const handlePrerequisitesComplete = (passed: boolean) => {
    if (passed) {
      goToNextPhase();
    }
  };

  const handlePhotoReviewComplete = (
    categorizedPhotos: Photo[],
    stepsCovered: number[],
    stepsMissing: number[]
  ) => {
    // Update photos state with categorized results
    setPhotos(categorizedPhotos);
    setState((prev) => ({
      ...prev,
      photoReview: {
        ...prev.photoReview,
        completed: true,
        totalPhotos: categorizedPhotos.length,
        categorizedPhotos: categorizedPhotos.length,
        stepsCovered,
        stepsMissing,
      },
    }));
    goToNextPhase();
  };

  const handleDataValidationComplete = (data: QaWizardState['dataValidation']) => {
    setState((prev) => ({
      ...prev,
      dataValidation: { ...data, completed: true },
    }));
    goToNextPhase();
  };

  const handleFinalDecision = (
    decision: QaDecision,
    reasons: string[],
    internalNotes: string | null,
    technicianFeedback: string | null
  ) => {
    setState((prev) => ({
      ...prev,
      finalDecision: {
        decision,
        reasons: reasons as QaWizardState['finalDecision']['reasons'],
        internalNotes,
        technicianFeedback,
        notes: internalNotes, // backward compat
        decidedAt: new Date().toISOString(),
        decidedBy: null,
      },
    }));
    goToNextPhase();
  };

  const handleFeedbackSent = () => {
    setState((prev) => ({
      ...prev,
      phase: 'completed',
      feedback: {
        sent: true,
        sentAt: new Date().toISOString(),
        message: null,
      },
    }));
    onComplete?.();
  };

  // Render compact phase indicator with labels under circles
  const renderPhaseIndicator = () => {
    const currentIndex = PHASE_ORDER.indexOf(state.phase);

    return (
      <div className="flex items-start justify-between px-2">
        {PHASE_ORDER.map((phase, index) => {
          const isActive = phase === state.phase;
          const isComplete = index < currentIndex;
          const isClickable = index <= currentIndex + 1;

          return (
            <React.Fragment key={phase}>
              {/* Step with circle and label */}
              <div className="flex flex-col items-center min-w-[40px] sm:min-w-[60px]">
                <button
                  onClick={() => isClickable && goToPhase(phase)}
                  disabled={!isClickable}
                  title={PHASE_LABELS[phase]}
                  className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-blue-600 text-white ring-2 ring-blue-300 ring-offset-1 dark:ring-offset-gray-800'
                      : isComplete
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                  } ${isClickable ? 'cursor-pointer hover:scale-110' : 'cursor-not-allowed opacity-50'}`}
                >
                  {isComplete ? '✓' : index + 1}
                </button>
                {/* Label under circle - hidden on mobile */}
                <span
                  className={`mt-1 text-xs leading-tight text-center transition-colors hidden sm:block ${
                    isActive
                      ? 'font-semibold text-blue-600 dark:text-blue-400'
                      : isComplete
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-gray-400 dark:text-gray-500'
                  }`}
                >
                  {PHASE_SHORT_LABELS[phase]}
                </span>
              </div>
              {/* Connector line */}
              {index < PHASE_ORDER.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mt-3.5 mx-1 ${
                    index < currentIndex
                      ? 'bg-green-500'
                      : 'bg-gray-300 dark:bg-gray-500'
                  }`}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  // Render current phase label (simplified - just the full name on left)
  const renderPhaseHeader = () => (
    <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100 dark:border-gray-700">
      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {PHASE_LABELS[state.phase]}
      </h3>
      <span className="text-xs text-gray-400 dark:text-gray-500">
        {PHASE_ORDER.indexOf(state.phase) + 1}/{PHASE_ORDER.length}
      </span>
    </div>
  );

  // Render loading state
  if (loading) {
    return (
      <div className="p-6 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4" />
        <p className="text-gray-600 dark:text-gray-400">
          {dataStatus || 'Loading QA Wizard...'}
        </p>
      </div>
    );
  }

  // Render error state
  if (error) {
    return (
      <div className="p-6 text-center">
        <div className="text-red-500 mb-4">Error: {error}</div>
        <button
          onClick={loadWizardState}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    );
  }

  // Render current phase content
  const renderPhaseContent = () => {
    switch (state.phase) {
      case 'prerequisites':
        return (
          <PrerequisitesPhase
            dropNumber={dropNumber}
            state={state.prerequisites}
            onComplete={handlePrerequisitesComplete}
            onRefresh={loadWizardState}
          />
        );

      case 'photo_review':
        return (
          <PhotoReviewPhase
            dropNumber={dropNumber}
            photoCount={state.prerequisites.photoCount}
            onComplete={handlePhotoReviewComplete}
            onBack={goToPreviousPhase}
            onSkipToDecision={() => goToPhase('final_decision')}
          />
        );

      case 'data_validation':
        return (
          <DataValidationPhase
            dropNumber={dropNumber}
            state={state.dataValidation}
            onemapOntSerial={state.prerequisites.ontSerial}
            onComplete={handleDataValidationComplete}
            onBack={goToPreviousPhase}
          />
        );

      case 'final_decision':
        return (
          <FinalDecisionPhase
            dropNumber={dropNumber}
            wizardState={state}
            photos={photos}
            initialData={initialDecisionData || undefined}
            onComplete={handleFinalDecision}
            onBack={goToPreviousPhase}
          />
        );

      case 'feedback':
        return (
          <FeedbackPhase
            dropNumber={dropNumber}
            project={project || undefined}
            wizardState={state}
            onComplete={handleFeedbackSent}
            onBack={goToPreviousPhase}
          />
        );

      case 'completed':
        return (
          <div className="p-6 text-center">
            <div className="text-green-500 text-5xl mb-4">✓</div>
            <h4 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              Review Complete
            </h4>
            <p className="text-gray-600 dark:text-gray-400">
              {dropNumber} has been reviewed and feedback sent.
            </p>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm">
      {/* 1Map Sync Progress Overlay */}
      <WizardProgressOverlay
        isVisible={syncPhase !== null}
        operationType="sync_1map"
        phase={syncPhase || 'fetching'}
        dropNumber={dropNumber}
        photoCount={state.prerequisites.photoCount || undefined}
      />

      {/* Compact phase indicator */}
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        {renderPhaseIndicator()}
        {renderPhaseHeader()}
      </div>

      {/* Phase content */}
      <div className="p-3">{renderPhaseContent()}</div>
    </div>
  );
}
