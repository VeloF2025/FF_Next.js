/**
 * Final Decision Phase Component (Redesigned)
 *
 * Phase 4 of QA Wizard - Comprehensive decision-making with:
 * - Inline photo viewer for issues
 * - Issue categorization (AI Error, Photo Quality, Real Issue, No Issue)
 * - AI Learning feedback with correct value input
 * - Ticket creation integration (Maintenance/QA)
 * - Separate Internal Notes and Technician Feedback
 */

import React, { useState, useEffect } from 'react';
import { log } from '@/lib/logger';
import type {
  QaWizardState,
  QaDecision,
  FailReasonCode,
  Photo,
} from '../../types/unified.types';
import {
  evaluateAutoFail,
  getFailReasonDescription,
  getTechnicianIssues,
  getTechnicianIssueDescription,
  detectSwappedSerials,
  type DrValidationData,
  type TechnicianIssue,
} from '../../services/qaAutoFailService';

interface FinalDecisionPhaseProps {
  dropNumber: string;
  wizardState: QaWizardState;
  photos?: Photo[];
  onComplete: (
    decision: QaDecision,
    reasons: string[],
    internalNotes: string | null,
    technicianFeedback: string | null
  ) => void;
  onBack: () => void;
}

interface AutoFailResult {
  autoFail: boolean;
  reasons: FailReasonCode[];
  recommendation: QaDecision;
}

type IssueType = 'ai_error' | 'photo_quality' | 'real_issue' | 'no_issue' | null;
type TicketType = 'maintenance' | 'qa' | null;

interface IssueClassification {
  issueType: IssueType;
  correctValue: string;
  createTicket: boolean;
  ticketType: TicketType;
  ticketDescription: string;
}

export function FinalDecisionPhase({
  dropNumber,
  wizardState,
  photos = [],
  onComplete,
  onBack,
}: FinalDecisionPhaseProps) {
  const [decision, setDecision] = useState<QaDecision | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [autoFailResult, setAutoFailResult] = useState<AutoFailResult | null>(null);

  // Issue classification state
  const [issueClassification, setIssueClassification] = useState<IssueClassification>({
    issueType: null,
    correctValue: '',
    createTicket: false,
    ticketType: null,
    ticketDescription: '',
  });

  // Notes state
  const [internalNotes, setInternalNotes] = useState('');
  const [technicianFeedback, setTechnicianFeedback] = useState('');

  // Photo lightbox state
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);

  // Evaluate auto-fail on mount and when photos change
  useEffect(() => {
    evaluateDecision();
  }, [wizardState, photos]);

  const evaluateDecision = () => {
    // Map photos to the format expected by evaluateAutoFail
    const photosForValidation = photos.map((p) => ({
      filename: p.filename,
      step: p.step ?? null,
    }));

    const validationData: DrValidationData = {
      drNumber: dropNumber,
      photoCount: wizardState.photoReview.totalPhotos,
      photos: photosForValidation,
      ontSerial: wizardState.prerequisites.ontSerial,
      upsSerial: wizardState.prerequisites.upsSerial,
      powerMeterDbm: wizardState.dataValidation.powerMeter.value,
      vlmOntSerialStep6: wizardState.dataValidation.serialValidation.step6Serial,
      vlmOntSerialStep9: wizardState.dataValidation.serialValidation.step9Serial,
      vlmDrNumberStep9: wizardState.dataValidation.serialValidation.step9DrNumber,
    };

    const result = evaluateAutoFail(validationData);
    setAutoFailResult(result);

    if (!decision) {
      setDecision(result.recommendation);
    }
  };

  // Get photo by step number
  const getPhotoByStep = (step: number): Photo | undefined => {
    return photos.find((p) => p.step === step);
  };

  const handleSubmit = async () => {
    if (!decision) return;

    setLoading(true);

    // Build internal notes (for QA team only - NOT sent to technicians)
    const internalParts: string[] = [];

    if (issueClassification.issueType) {
      const typeLabels: Record<string, string> = {
        ai_error: 'AI/OCR Error',
        photo_quality: 'Photo Quality Issue',
        real_issue: 'Real Issue Found',
        no_issue: 'No Issue (False Positive)',
      };
      internalParts.push(`[${typeLabels[issueClassification.issueType]}]`);
    }

    if (issueClassification.correctValue) {
      internalParts.push(`Correct value: ${issueClassification.correctValue}`);
    }

    if (issueClassification.createTicket && issueClassification.ticketType) {
      internalParts.push(`Ticket: ${issueClassification.ticketType.toUpperCase()}`);
    }

    if (internalNotes) {
      internalParts.push(internalNotes);
    }

    const finalInternalNotes = internalParts.join(' | ') || null;
    const finalTechnicianFeedback = technicianFeedback || null;

    try {
      const response = await fetch('/api/activate/final-decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dropNumber,
          decision,
          notes: finalInternalNotes, // backward compat
          overrideReason: overrideReason || null,
          issueClassification,
          internalNotes: finalInternalNotes,
          technicianFeedback: finalTechnicianFeedback,
        }),
      });

      const data = await response.json();

      if (data.success) {
        log.info('FinalDecision', `Decision ${decision} submitted for ${dropNumber}`);

        // Auto-create ticket for swapped serials (CRITICAL issue)
        const swapCheck = detectSwappedSerials(
          wizardState.prerequisites.ontSerial,
          wizardState.prerequisites.upsSerial
        );
        if (swapCheck.swapped) {
          const ticketUid = await createSwapTicket(swapCheck.details);
          if (ticketUid) {
            log.info('FinalDecision', `Auto-created swap ticket ${ticketUid} for ${dropNumber}`);
          }
        }

        // Create additional ticket if requested by user
        if (issueClassification.createTicket && issueClassification.ticketType) {
          await createTicket();
        }

        onComplete(decision, data.data.reasons || [], finalInternalNotes, finalTechnicianFeedback);
      } else {
        throw new Error(data.error || 'Failed to save decision');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save decision';
      log.error('FinalDecision', `Error: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  const createTicket = async () => {
    try {
      const response = await fetch('/api/ticketing/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'manual' as const,
          title: `QA Issue: ${dropNumber}`,
          description: issueClassification.ticketDescription || `Issue found during QA review of ${dropNumber}`,
          ticket_type: issueClassification.ticketType || 'maintenance',
          priority: issueClassification.ticketType === 'maintenance' ? 'high' : 'normal',
          dr_number: dropNumber,
        }),
      });
      if (response.ok) {
        log.info('FinalDecision', `Ticket created for ${dropNumber}`);
      } else {
        const data = await response.json();
        log.warn('FinalDecision', `Failed to create ticket: ${data.error?.message || 'Unknown error'}`);
      }
    } catch (err) {
      log.error('FinalDecision', 'Failed to create ticket', err);
    }
  };

  /**
   * Create a ticket for swapped serials - CRITICAL issue
   * Auto-created when serials appear to be in wrong fields
   */
  const createSwapTicket = async (swapDetails: string) => {
    try {
      const response = await fetch('/api/ticketing/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'ont_swap' as const,
          title: `🔴 SWAPPED SERIALS: ${dropNumber}`,
          description: `${swapDetails}\n\nONT field: ${wizardState.prerequisites.ontSerial || 'N/A'}\nUPS field: ${wizardState.prerequisites.upsSerial || 'N/A'}\n\nTechnician needs to correct serial assignments in 1Map.`,
          ticket_type: 'ont_swap' as const,
          priority: 'high' as const,
          dr_number: dropNumber,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        log.info('FinalDecision', `Swap ticket ${data.data?.ticket_uid} created for ${dropNumber}`);
        return data.data?.ticket_uid;
      } else {
        const data = await response.json();
        log.warn('FinalDecision', `Failed to create swap ticket: ${data.error?.message || 'Unknown error'}`);
      }
    } catch (err) {
      log.error('FinalDecision', 'Failed to create swap ticket', err);
    }
    return null;
  };

  const isOverriding = Boolean(autoFailResult && decision !== autoFailResult.recommendation);
  const hasSerialMismatch = !wizardState.dataValidation.serialValidation.ontMatch;

  const getDecisionColor = (d: QaDecision) => {
    switch (d) {
      case 'PASS': return 'text-green-600 dark:text-green-400';
      case 'FAIL': return 'text-red-600 dark:text-red-400';
      case 'REWORK_NEEDED': return 'text-yellow-600 dark:text-yellow-400';
      default: return 'text-gray-600 dark:text-gray-400';
    }
  };

  const getStatusIcon = (passed: boolean) => (passed ? '✅' : '❌');

  // Photo thumbnail component
  const PhotoThumbnail = ({ photo, label }: { photo?: Photo; label: string }) => {
    if (!photo) return <span className="text-gray-400 text-xs">No photo</span>;

    return (
      <button
        type="button"
        onClick={() => setLightboxPhoto(photo.url)}
        className="relative group"
      >
        <img
          src={photo.url}
          alt={label}
          className="w-16 h-16 object-cover rounded border border-gray-300 dark:border-gray-600 hover:border-blue-500 transition-colors"
        />
        <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded">
          <span className="text-white text-xs">View</span>
        </span>
      </button>
    );
  };

  return (
    <div className="space-y-6">
      {/* Photo Lightbox */}
      {lightboxPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightboxPhoto(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh]">
            <img
              src={lightboxPhoto}
              alt="Full size"
              className="max-w-full max-h-[90vh] object-contain rounded-lg"
            />
            <button
              onClick={() => setLightboxPhoto(null)}
              className="absolute top-2 right-2 p-2 bg-white/20 rounded-full hover:bg-white/40"
            >
              <span className="text-white text-xl">×</span>
            </button>
          </div>
        </div>
      )}

      {/* Technician-Actionable Issues (shown prominently) */}
      {(() => {
        const swapCheck = detectSwappedSerials(
          wizardState.prerequisites.ontSerial,
          wizardState.prerequisites.upsSerial
        );
        const techIssues = getTechnicianIssues({
          ontSerial: wizardState.prerequisites.ontSerial,
          upsSerial: wizardState.prerequisites.upsSerial,
          photoCount: wizardState.photoReview.totalPhotos,
          missingSteps: wizardState.photoReview.stepsMissing,
          powerMeterDbm: wizardState.dataValidation.powerMeter.value,
        });

        if (swapCheck.swapped || techIssues.length > 0) {
          return (
            <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 border border-red-200 dark:border-red-800">
              <h4 className="font-medium text-red-700 dark:text-red-300 mb-3 flex items-center gap-2">
                <span>⚠️</span>
                Technician Issues (will be sent via WhatsApp)
              </h4>

              {/* Swapped serials - critical error */}
              {swapCheck.swapped && (
                <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/40 rounded-lg border border-red-300 dark:border-red-700">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-red-800 dark:text-red-200 font-semibold">
                      <span className="text-lg">🔴</span>
                      SERIALS SWAPPED
                    </div>
                    <span className="text-xs px-2 py-1 bg-red-200 dark:bg-red-800 rounded text-red-700 dark:text-red-200">
                      🎫 Auto-ticket on submit
                    </span>
                  </div>
                  <p className="text-sm text-red-700 dark:text-red-300 mt-1">{swapCheck.details}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-white/50 dark:bg-black/20 p-2 rounded">
                      <span className="text-gray-500">ONT field:</span>
                      <code className="ml-1 font-mono">{wizardState.prerequisites.ontSerial || 'N/A'}</code>
                    </div>
                    <div className="bg-white/50 dark:bg-black/20 p-2 rounded">
                      <span className="text-gray-500">UPS field:</span>
                      <code className="ml-1 font-mono">{wizardState.prerequisites.upsSerial || 'N/A'}</code>
                    </div>
                  </div>
                  <p className="text-xs text-red-600 dark:text-red-400 mt-2 italic">
                    A ticket will be automatically created to track resolution of this issue.
                  </p>
                </div>
              )}

              {/* Other technician issues */}
              {techIssues.filter(i => i.code !== 'SERIALS_SWAPPED').length > 0 && (
                <ul className="space-y-2">
                  {techIssues.filter(i => i.code !== 'SERIALS_SWAPPED').map((issue, idx) => (
                    <li key={idx} className="flex items-center gap-2 text-sm text-red-700 dark:text-red-300">
                      <span>{issue.severity === 'error' ? '❌' : '⚠️'}</span>
                      {getTechnicianIssueDescription(issue.code)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        }
        return null;
      })()}

      {/* Decision Summary with Photo Viewer */}
      <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
        <h4 className="font-medium text-gray-900 dark:text-white mb-4">
          Decision Summary
        </h4>

        <div className="space-y-4">
          {/* Passing checks - compact */}
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Prerequisites:</span>
              <span>{getStatusIcon(wizardState.prerequisites.passed)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Photo Coverage:</span>
              <span>{getStatusIcon(wizardState.photoReview.stepsMissing.length === 0)} {10 - wizardState.photoReview.stepsMissing.length}/10</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Power Meter:</span>
              <span>{getStatusIcon(wizardState.dataValidation.powerMeter.inRange)} {wizardState.dataValidation.powerMeter.value} dBm</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Serials Scanned:</span>
              <span>
                {(() => {
                  const swapped = detectSwappedSerials(
                    wizardState.prerequisites.ontSerial,
                    wizardState.prerequisites.upsSerial
                  ).swapped;
                  if (swapped) return '🔴 SWAPPED';
                  const ont = !!wizardState.prerequisites.ontSerial;
                  const ups = !!wizardState.prerequisites.upsSerial;
                  if (ont && ups) return '✅';
                  return '❌';
                })()}
              </span>
            </div>
          </div>

          {/* Internal QA: VLM Serial Comparison (collapsible, for QA team only) */}
          {hasSerialMismatch && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
                🔍 Internal QA: VLM Serial Comparison (click to expand)
              </summary>
              <div className="mt-2 p-4 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  This data is for internal QA/VLM improvement only. NOT sent to technicians.
                </p>
                <div className="grid grid-cols-3 gap-4">
                  {/* OneMap Serial */}
                  <div className="text-center">
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">OneMap Synced</div>
                    <div className="font-mono text-sm bg-white dark:bg-gray-900 p-2 rounded border border-gray-300 dark:border-gray-600">
                      {wizardState.dataValidation.serialValidation.onemapSerial || 'N/A'}
                    </div>
                  </div>

                  {/* Step 6 - ONT Back */}
                  <div className="text-center">
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">VLM Step 6</div>
                    <PhotoThumbnail photo={getPhotoByStep(6)} label="Step 6" />
                    <div className="font-mono text-sm bg-white dark:bg-gray-900 p-2 rounded border border-gray-300 dark:border-gray-600 mt-2">
                      {wizardState.dataValidation.serialValidation.step6Serial || 'N/A'}
                    </div>
                  </div>

                  {/* Step 9 - Green Lights */}
                  <div className="text-center">
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">VLM Step 9</div>
                    <PhotoThumbnail photo={getPhotoByStep(9)} label="Step 9" />
                    <div className="font-mono text-sm bg-white dark:bg-gray-900 p-2 rounded border border-gray-300 dark:border-gray-600 mt-2">
                      {wizardState.dataValidation.serialValidation.step9Serial || 'N/A'}
                    </div>
                  </div>
                </div>
              </div>
            </details>
          )}
        </div>
      </div>

      {/* Issue Classification */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
        <h4 className="font-medium text-gray-900 dark:text-white mb-3">
          What's the Issue?
        </h4>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
          {[
            { id: 'ai_error', icon: '🤖', label: 'AI Error', desc: 'OCR misread the photo', color: 'blue' },
            { id: 'photo_quality', icon: '📷', label: 'Photo Quality', desc: 'Blurry, angled, or dark', color: 'yellow' },
            { id: 'real_issue', icon: '⚠️', label: 'Real Issue', desc: 'Actual installation problem', color: 'red' },
            { id: 'no_issue', icon: '✅', label: 'No Issue', desc: 'False positive', color: 'green' },
          ].map((type) => (
            <button
              key={type.id}
              type="button"
              onClick={() => setIssueClassification((prev) => ({ ...prev, issueType: type.id as IssueType }))}
              className={`p-3 rounded-lg border text-left transition-all ${
                issueClassification.issueType === type.id
                  ? `border-${type.color}-500 bg-${type.color}-50 dark:bg-${type.color}-900/20 ring-2 ring-${type.color}-500/20`
                  : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'
              }`}
            >
              <div className="text-2xl mb-1">{type.icon}</div>
              <div className="font-medium text-sm">{type.label}</div>
              <div className="text-xs text-gray-500">{type.desc}</div>
            </button>
          ))}
        </div>

        {/* Contextual Actions based on Issue Type */}
        {issueClassification.issueType === 'ai_error' && (
          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 space-y-3">
            <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
              <span>🤖</span>
              <span className="font-medium">AI Learning Feedback</span>
            </div>
            <p className="text-sm text-blue-600 dark:text-blue-400">
              Provide the correct value to help improve AI accuracy:
            </p>
            <input
              type="text"
              value={issueClassification.correctValue}
              onChange={(e) => setIssueClassification((prev) => ({ ...prev, correctValue: e.target.value }))}
              placeholder="Enter the correct serial number..."
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600 font-mono"
            />
            <p className="text-xs text-blue-500 dark:text-blue-400">
              This value will be stored to improve future VLM extractions.
            </p>
          </div>
        )}

        {issueClassification.issueType === 'photo_quality' && (
          <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800 space-y-3">
            <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-300">
              <span>📷</span>
              <span className="font-medium">Photo Quality Issue</span>
            </div>
            <p className="text-sm text-yellow-600 dark:text-yellow-400">
              The photo quality prevented accurate extraction. Consider:
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIssueClassification((prev) => ({
                  ...prev,
                  createTicket: true,
                  ticketType: 'qa',
                  ticketDescription: `Re-photo needed for ${dropNumber} - photo quality issue`,
                }))}
                className="px-3 py-1.5 text-sm bg-yellow-100 dark:bg-yellow-800/50 rounded hover:bg-yellow-200"
              >
                Request Re-photo
              </button>
            </div>
          </div>
        )}

        {issueClassification.issueType === 'real_issue' && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800 space-y-3">
            <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
              <span>⚠️</span>
              <span className="font-medium">Create Ticket</span>
            </div>
            <p className="text-sm text-red-600 dark:text-red-400">
              This is a real installation issue that needs follow-up:
            </p>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => setIssueClassification((prev) => ({ ...prev, createTicket: true, ticketType: 'maintenance' }))}
                className={`px-4 py-2 rounded-lg border transition-colors ${
                  issueClassification.ticketType === 'maintenance'
                    ? 'border-red-500 bg-red-100 dark:bg-red-900/30 text-red-700'
                    : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'
                }`}
              >
                🔧 Maintenance Ticket
              </button>
              <button
                type="button"
                onClick={() => setIssueClassification((prev) => ({ ...prev, createTicket: true, ticketType: 'qa' }))}
                className={`px-4 py-2 rounded-lg border transition-colors ${
                  issueClassification.ticketType === 'qa'
                    ? 'border-orange-500 bg-orange-100 dark:bg-orange-900/30 text-orange-700'
                    : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'
                }`}
              >
                📋 QA Ticket
              </button>
            </div>
            {issueClassification.createTicket && (
              <textarea
                value={issueClassification.ticketDescription}
                onChange={(e) => setIssueClassification((prev) => ({ ...prev, ticketDescription: e.target.value }))}
                placeholder="Describe the issue for the ticket..."
                rows={2}
                className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600 text-sm"
              />
            )}
          </div>
        )}

        {issueClassification.issueType === 'no_issue' && (
          <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
              <span>✅</span>
              <span className="font-medium">False Positive - No actual issue</span>
            </div>
            <p className="text-sm text-green-600 dark:text-green-400 mt-1">
              The AI flagged this incorrectly. Installation is correct.
            </p>
          </div>
        )}
      </div>

      {/* Internal Notes & Technician Feedback */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Internal Notes */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <h4 className="font-medium text-gray-900 dark:text-white mb-2 flex items-center gap-2">
            <span>📝</span> Internal Notes
            <span className="text-xs text-gray-400 font-normal">(not shared)</span>
          </h4>
          <textarea
            value={internalNotes}
            onChange={(e) => setInternalNotes(e.target.value)}
            placeholder="Add internal notes for QA team records..."
            rows={3}
            className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm resize-none"
          />
        </div>

        {/* Technician Feedback */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <h4 className="font-medium text-gray-900 dark:text-white mb-2 flex items-center gap-2">
            <span>💬</span> Technician Feedback
            <span className="text-xs text-gray-400 font-normal">(sent via WhatsApp)</span>
          </h4>
          <textarea
            value={technicianFeedback}
            onChange={(e) => setTechnicianFeedback(e.target.value)}
            placeholder="Message for the field technician..."
            rows={3}
            className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm resize-none"
          />
        </div>
      </div>

      {/* Final Decision */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
        <h4 className="font-medium text-gray-900 dark:text-white mb-3">
          Final Decision
        </h4>

        <div className="flex gap-4 mb-4">
          {(['PASS', 'FAIL', 'REWORK_NEEDED'] as QaDecision[]).map((d) => (
            <label
              key={d}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-colors ${
                decision === d
                  ? d === 'PASS'
                    ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                    : d === 'FAIL'
                      ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                      : 'border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20'
                  : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'
              }`}
            >
              <input
                type="radio"
                name="decision"
                value={d}
                checked={decision === d}
                onChange={() => setDecision(d)}
                className="w-4 h-4 text-blue-600 focus:ring-blue-500"
              />
              <span className={`font-medium ${decision === d ? getDecisionColor(d) : 'text-gray-700 dark:text-gray-300'}`}>
                {d === 'REWORK_NEEDED' ? 'REWORK' : d}
              </span>
            </label>
          ))}
        </div>

        {/* Recommendation Banner */}
        {autoFailResult && (
          <div className={`p-3 rounded-lg mb-4 ${
            autoFailResult.recommendation === 'PASS'
              ? 'bg-green-50 dark:bg-green-900/10 text-green-700 dark:text-green-300'
              : autoFailResult.recommendation === 'FAIL'
                ? 'bg-red-50 dark:bg-red-900/10 text-red-700 dark:text-red-300'
                : 'bg-yellow-50 dark:bg-yellow-900/10 text-yellow-700 dark:text-yellow-300'
          }`}>
            <span className="text-sm">
              System Recommendation: <strong>{autoFailResult.recommendation}</strong>
              {autoFailResult.reasons.length > 0 && (
                <span className="ml-2 text-xs opacity-75">
                  ({autoFailResult.reasons.map(r => getFailReasonDescription(r)).join(', ')})
                </span>
              )}
            </span>
          </div>
        )}

        {/* Override reason */}
        {isOverriding && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Override Reason (required)
            </label>
            <input
              type="text"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="Why are you overriding the recommendation?"
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
            />
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex justify-between pt-4">
        <button
          onClick={onBack}
          className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
        >
          ← Back
        </button>
        <button
          onClick={handleSubmit}
          disabled={!decision || loading || (isOverriding && !overrideReason)}
          className={`px-6 py-2 rounded-lg font-medium ${
            !decision || loading || (isOverriding && !overrideReason)
              ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {loading ? 'Saving...' : 'Confirm & Send Feedback →'}
        </button>
      </div>
    </div>
  );
}
