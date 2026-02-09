/**
 * DR Summary Page
 *
 * Landing page when clicking a DR from the list.
 * Shows consolidated information about the DR including:
 * - Timeline (installation, submission, review, feedback, activation)
 * - Team info (submitter, installer, OES team, reviewer)
 * - QA Status (photo coverage, decision, feedback)
 * - Photo preview
 * - Action buttons
 */

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { log } from '@/lib/logger';
import type { DRSummary, DRState } from '../types/summary.types';
import type { SerialVerificationResult } from '@/pages/api/activate/serial-verification';

interface DrSummaryPageProps {
  dropNumber: string;
  onStartQA: () => void;
  onViewPhotos: () => void;
  onBackToList: () => void;
}

const STATE_LABELS: Record<DRState, { label: string; color: string; icon: string }> = {
  installed: { label: 'Installed', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200', icon: '🔧' },
  activated: { label: 'Activated', color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200', icon: '⚡' },
  reviewed: { label: 'Reviewed', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200', icon: '✓' },
  reviewed_pass: { label: 'Reviewed, Passed', color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200', icon: '✅' },
  reviewed_fail: { label: 'Reviewed, Failed', color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200', icon: '❌' },
  reviewed_rework: { label: 'Reviewed, Rework', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200', icon: '🔄' },
  not_reviewed: { label: 'Not Reviewed', color: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200', icon: '⏳' },
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  try {
    const date = new Date(dateStr);
    // Standard YYYY-MM-DD format
    return date.toISOString().split('T')[0];
  } catch {
    return dateStr;
  }
}

export function DrSummaryPage({
  dropNumber,
  onStartQA,
  onViewPhotos,
  onBackToList,
}: DrSummaryPageProps) {
  const [summary, setSummary] = useState<DRSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verification, setVerification] = useState<SerialVerificationResult | null>(null);

  useEffect(() => {
    fetchSummary();
    fetchVerification();
  }, [dropNumber]);

  const fetchVerification = async () => {
    try {
      const response = await fetch(`/api/activate/serial-verification?dropNumber=${encodeURIComponent(dropNumber)}`);
      if (response.ok) {
        const result = await response.json();
        if (result.data) {
          setVerification(result.data);
        }
      }
    } catch {
      // Silent fail - badge just won't show
    }
  };

  const fetchSummary = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/activate/summary?dropNumber=${encodeURIComponent(dropNumber)}`);

      if (!response.ok) {
        throw new Error('Failed to fetch summary');
      }

      const result = await response.json();
      if (result.data) {
        setSummary(result.data);
      } else {
        setError('No data found for this DR');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load summary';
      setError(message);
      log.error('DrSummary', `Failed to load summary for ${dropNumber}: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Loading DR Summary...</p>
        </div>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="text-red-500 text-4xl mb-4">!</div>
          <p className="text-gray-600 dark:text-gray-400 mb-4">{error || 'DR not found'}</p>
          <button
            onClick={onBackToList}
            className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
          >
            Back to List
          </button>
        </div>
      </div>
    );
  }

  const stateInfo = STATE_LABELS[summary.currentState];
  const progressPercent = (summary.qaStatus.stepsComplete / summary.qaStatus.totalSteps) * 100;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{dropNumber}</h1>
          {summary.project && (
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Project: {summary.project}
            </span>
          )}
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${stateInfo.color}`}>
          {stateInfo.icon} {stateInfo.label}
        </span>
      </div>

      {/* Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Timeline Card */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-3 uppercase tracking-wide">
            Timeline
          </h3>
          <div className="space-y-2">
            <TimelineItem
              icon="📅"
              label="Installed"
              date={formatDate(summary.timeline.installationDate)}
              highlight={!!summary.timeline.installationDate}
            />
            <TimelineItem
              icon="✅"
              label="Reviewed"
              date={formatDate(summary.timeline.reviewedAt)}
              highlight={!!summary.timeline.reviewedAt}
            />
            <TimelineItem
              icon="💬"
              label="Feedback"
              date={formatDate(summary.timeline.feedbackSentAt)}
              highlight={!!summary.timeline.feedbackSentAt}
            />
            <TimelineItem
              icon="⚡"
              label="Activated"
              date={formatDate(summary.timeline.activationDate)}
              highlight={!!summary.timeline.activationDate}
            />
          </div>
        </div>

        {/* Team Card */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-3 uppercase tracking-wide">
            Team
          </h3>
          <div className="space-y-2">
            <TeamItem
              icon="📱"
              role="Activations Team"
              name={summary.team.submitter.name}
              detail={summary.team.submitter.phone ? `WA: ${summary.team.submitter.phone}` : undefined}
            />
            <TeamItem
              icon="🔧"
              role="Installation Team"
              name={summary.team.installer.name}
              detail={summary.team.installer.id ? `ID: ${summary.team.installer.id}` : 'From OneMap'}
            />
            <TeamItem icon="👥" role="OES Team" name={summary.team.oesTeam} />
            <TeamItem icon="🔍" role="Reviewer" name={summary.team.reviewer} />
          </div>
        </div>
      </div>

      {/* Subscriber Contact Card - Only show if we have contact info */}
      {(summary.subscriberContact?.oneMap || summary.subscriberContact?.qContact) && (
        <SubscriberContactCard subscriberContact={summary.subscriberContact} />
      )}

      {/* QA Status Card - Full Width */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            QA Status
          </h3>
          {verification && verification.overallStatus !== 'none' && (
            <SerialVerificationBadge
              status={verification.overallStatus}
              label={verification.badgeLabel}
              ontSources={verification.ontVerification.sourcesWithData}
              upsSources={verification.upsVerification.sourcesWithData}
            />
          )}
        </div>

        <div className="space-y-4">
          {/* Photo Progress */}
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600 dark:text-gray-400">Photo Steps</span>
              <span className="font-medium text-gray-900 dark:text-white">
                {summary.qaStatus.stepsComplete}/{summary.qaStatus.totalSteps}
              </span>
            </div>
            <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  progressPercent === 100
                    ? 'bg-green-500'
                    : progressPercent >= 70
                      ? 'bg-blue-500'
                      : 'bg-yellow-500'
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Equipment Serials */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <span className="text-xs text-gray-500 dark:text-gray-400">ONT Serial</span>
              <p className="text-sm font-mono text-gray-900 dark:text-white truncate">
                {summary.equipment.ontSerial || '-'}
              </p>
              {verification && verification.ontVerification.sourcesWithData > 1 && (
                <SerialSourceIndicator
                  sources={verification.ont}
                  verification={verification.ontVerification}
                />
              )}
            </div>
            <div>
              <span className="text-xs text-gray-500 dark:text-gray-400">UPS Serial</span>
              <p className="text-sm font-mono text-gray-900 dark:text-white truncate">
                {summary.equipment.upsSerial || '-'}
              </p>
              {verification && verification.upsVerification.sourcesWithData > 1 && (
                <SerialSourceIndicator
                  sources={verification.ups}
                  verification={verification.upsVerification}
                />
              )}
            </div>
          </div>

          {/* Decision */}
          {summary.qaStatus.decision && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 dark:text-gray-400">Decision:</span>
              <span
                className={`px-2 py-0.5 rounded text-sm font-medium ${
                  summary.qaStatus.decision === 'PASS'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                    : summary.qaStatus.decision === 'FAIL'
                      ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                      : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                }`}
              >
                {summary.qaStatus.decision === 'PASS'
                  ? '✓ PASS'
                  : summary.qaStatus.decision === 'FAIL'
                    ? '✗ FAIL'
                    : '↻ REWORK'}
              </span>
            </div>
          )}

          {/* Feedback Message */}
          {summary.qaStatus.feedbackMessage && (
            <div className="bg-gray-50 dark:bg-gray-900 rounded p-2">
              <span className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
                Feedback Message:
              </span>
              <p className="text-sm text-gray-700 dark:text-gray-300 italic">
                &ldquo;{summary.qaStatus.feedbackMessage}&rdquo;
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Photo Preview */}
      {summary.photoPreview.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Photos
            </h3>
            <button
              onClick={onViewPhotos}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              View All ({summary.qaStatus.stepsComplete})
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {summary.photoPreview.map((photo, idx) => (
              <div
                key={photo.filename}
                className="flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700 relative"
              >
                <img
                  src={photo.url}
                  alt={`Step ${photo.step}`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                <span className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs text-center py-0.5">
                  Step {photo.step}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-3 justify-center pt-4 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={onBackToList}
          className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
        >
          ← Back to List
        </button>
        <button
          onClick={onViewPhotos}
          className="px-4 py-2 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
        >
          📸 View Photos
        </button>
        <button
          onClick={onStartQA}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
        >
          {summary.currentState === 'reviewed' ? '🔄 Re-Review' : '🧙 Start QA Review'}
        </button>
      </div>
    </div>
  );
}

/**
 * Subscriber Contact Card
 * Shows contact info from 1Map (subscriber) and QContact (customer)
 * If contacts differ, shows both as Contact 1 and Contact 2
 */
function SubscriberContactCard({
  subscriberContact,
}: {
  subscriberContact: DRSummary['subscriberContact'];
}) {
  const { oneMap, qContact, contactsDiffer } = subscriberContact;
  const hasOneMap = oneMap && (oneMap.name || oneMap.phone);
  const hasQContact = qContact && (qContact.name || qContact.phone);

  // If contacts don't differ, show a single unified view
  if (!contactsDiffer && hasOneMap) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-3 uppercase tracking-wide">
          📞 Subscriber Contact
        </h3>
        <ContactDetails contact={oneMap} language={oneMap.language} />
      </div>
    );
  }

  // Show both contacts if they differ
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-gray-700">
      <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-3 uppercase tracking-wide">
        📞 Contacts
        {contactsDiffer && (
          <span className="ml-2 px-2 py-0.5 bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200 text-xs rounded">
            Different
          </span>
        )}
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {hasOneMap && (
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
            <span className="text-xs font-medium text-blue-600 dark:text-blue-400 block mb-2">
              Contact 1 (1Map Subscriber)
            </span>
            <ContactDetails contact={oneMap} language={oneMap.language} />
          </div>
        )}
        {hasQContact && (
          <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3">
            <span className="text-xs font-medium text-purple-600 dark:text-purple-400 block mb-2">
              Contact 2 (QContact Customer)
            </span>
            <ContactDetails contact={qContact} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Contact Details - displays name, phone, email
 */
function ContactDetails({
  contact,
  language,
}: {
  contact: { name: string | null; phone: string | null; email: string | null };
  language?: string | null;
}) {
  return (
    <div className="space-y-1.5">
      {contact.name && (
        <div className="flex items-center gap-2">
          <span className="text-gray-500 dark:text-gray-400">👤</span>
          <span className="text-sm text-gray-900 dark:text-white font-medium">{contact.name}</span>
        </div>
      )}
      {contact.phone && (
        <div className="flex items-center gap-2">
          <span className="text-gray-500 dark:text-gray-400">📱</span>
          <a
            href={`tel:${contact.phone}`}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline font-mono"
          >
            {contact.phone}
          </a>
        </div>
      )}
      {contact.email && (
        <div className="flex items-center gap-2">
          <span className="text-gray-500 dark:text-gray-400">✉️</span>
          <a
            href={`mailto:${contact.email}`}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            {contact.email}
          </a>
        </div>
      )}
      {language && (
        <div className="flex items-center gap-2">
          <span className="text-gray-500 dark:text-gray-400">🗣️</span>
          <span className="text-sm text-gray-600 dark:text-gray-300">{language}</span>
        </div>
      )}
    </div>
  );
}

function TimelineItem({
  icon,
  label,
  date,
  highlight = false,
}: {
  icon: string;
  label: string;
  date: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-base">{icon}</span>
      <span className="text-sm text-gray-600 dark:text-gray-400 w-20">{label}:</span>
      <span
        className={`text-sm ${
          highlight
            ? 'text-gray-900 dark:text-white font-medium'
            : 'text-gray-500 dark:text-gray-500'
        }`}
      >
        {date}
      </span>
    </div>
  );
}

function TeamItem({
  icon,
  role,
  name,
  detail,
}: {
  icon: string;
  role: string;
  name: string | null;
  detail?: string | null;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-base">{icon}</span>
      <span className="text-sm text-gray-600 dark:text-gray-400 w-20">{role}:</span>
      <span className="text-sm text-gray-900 dark:text-white truncate">
        {name || '-'}
        {detail && name && (
          <span className="text-gray-500 dark:text-gray-400 text-xs ml-1">({detail})</span>
        )}
      </span>
    </div>
  );
}

/**
 * Serial Source Indicator
 *
 * Shows which sources have data and whether they agree
 */
function SerialSourceIndicator({
  sources,
  verification,
}: {
  sources: {
    oes: string | null;
    offline: string | null;
    onemap: string | null;
    waPhoto: string | null;
    waPhotoConfidence: number | null;
  };
  verification: {
    sourcesWithData: number;
    sourcesAgreeing: number;
    allAgree: boolean;
    status: string;
  };
}) {
  const sourceList = [
    { key: 'oes', label: 'OES', value: sources.oes },
    { key: 'offline', label: 'Offline', value: sources.offline },
    { key: 'onemap', label: '1Map', value: sources.onemap },
    { key: 'waPhoto', label: 'WA', value: sources.waPhoto },
  ];

  return (
    <div className="flex items-center gap-1 mt-1">
      {sourceList.map((src) => (
        <span
          key={src.key}
          className={`
            inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-medium
            ${
              src.value
                ? verification.allAgree
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
                  : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300'
                : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600'
            }
          `}
          title={`${src.label}: ${src.value || 'No data'}`}
        >
          {src.label[0]}
        </span>
      ))}
      {verification.allAgree && verification.sourcesWithData >= 2 && (
        <span className="text-green-600 dark:text-green-400 text-[10px] ml-1">✓</span>
      )}
    </div>
  );
}

/**
 * Serial Verification Badge
 *
 * Displays verification status based on 4-way serial comparison:
 * - Gold: 4/4 sources agree (OES, Offline, 1Map, WA Photo)
 * - Silver: 3/4 sources agree
 * - Bronze: 2 sources agree
 * - Warning: Serial mismatch detected
 */
function SerialVerificationBadge({
  status,
  label,
  ontSources,
  upsSources,
}: {
  status: 'gold' | 'silver' | 'bronze' | 'warning' | 'none';
  label: string;
  ontSources: number;
  upsSources: number;
}) {
  const badgeStyles: Record<string, { bg: string; text: string; border: string; icon: string; glow?: string }> = {
    gold: {
      bg: 'bg-gradient-to-r from-yellow-400 to-amber-500',
      text: 'text-amber-900',
      border: 'border-yellow-500',
      icon: '🏆',
      glow: 'shadow-lg shadow-yellow-400/50',
    },
    silver: {
      bg: 'bg-gradient-to-r from-gray-300 to-gray-400',
      text: 'text-gray-800',
      border: 'border-gray-400',
      icon: '✓',
    },
    bronze: {
      bg: 'bg-gradient-to-r from-orange-300 to-orange-400',
      text: 'text-orange-900',
      border: 'border-orange-400',
      icon: '◉',
    },
    warning: {
      bg: 'bg-red-100 dark:bg-red-900/50',
      text: 'text-red-700 dark:text-red-300',
      border: 'border-red-400 dark:border-red-600',
      icon: '⚠️',
    },
    none: {
      bg: 'bg-gray-100 dark:bg-gray-700',
      text: 'text-gray-600 dark:text-gray-400',
      border: 'border-gray-300 dark:border-gray-600',
      icon: '',
    },
  };

  const style = badgeStyles[status];
  const totalSources = Math.max(ontSources, upsSources);

  return (
    <div
      className={`
        inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold
        border ${style.bg} ${style.text} ${style.border} ${style.glow || ''}
        transition-all duration-200 hover:scale-105
      `}
      title={`ONT: ${ontSources}/4 sources | UPS: ${upsSources}/4 sources`}
    >
      <span className="text-sm">{style.icon}</span>
      <span>{label}</span>
      {status === 'gold' && (
        <span className="ml-1 text-[10px] opacity-75">({totalSources}/4)</span>
      )}
    </div>
  );
}

export default DrSummaryPage;
