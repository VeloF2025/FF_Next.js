/**
 * UnifiedReviewCard Component
 *
 * Main component for unified DR photo review with 8 tabs:
 * 1. Summary - DR overview with timeline, team, and status (landing tab)
 * 2. QA Wizard - 5-phase guided workflow (Prerequisites → Photo Review → Data Validation → Final Decision → Feedback)
 * 3. Photos - Photo gallery with step grouping
 * 4. AI Categorization - VLM photo categorization results
 * 5. Activity - Review history, comments, and activity timeline
 * 6. Maintenance - WhatsApp maintenance messages and photos (if any)
 * 7. Feedback - Generate and send WhatsApp feedback
 * 8. Manual QA - Legacy 10-step checklist (for reference)
 *
 * NOTE: ONT Barcode and UPS Serial are NOT photo steps - they are scanned
 * barcodes stored directly in ont_serial_scanned and ups_serial_scanned fields.
 *
 * Following FibreFlow UI/UX patterns with TailwindCSS
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useUnifiedReview } from '../hooks/useUnifiedReview';
import { STEP_LABELS } from '../types/unified.types';
import type { UnifiedReview } from '../types/unified.types';
import { PhotoGalleryUnified } from './PhotoGalleryUnified';
import { WAPhotosGallery, type WAPhoto } from './WAPhotosGallery';
import { AICategorizationTab } from './AICategorizationTab';
import { ActivityTab } from './ActivityTab';
import { QaWizardContainer } from './wizard/QaWizardContainer';
import { DrSummaryPage } from './DrSummaryPage';
import { MaintenanceTab } from '@/modules/maintenance/components/MaintenanceTab';
import { ChevronDown, ChevronRight, RefreshCw, MapPin, MessageCircle, Wrench } from 'lucide-react';
import { log } from '@/lib/logger';

interface UnifiedReviewCardProps {
  dropNumber: string;
  onBackToList?: () => void;
}

type TabKey = 'summary' | 'wizard' | 'photos' | 'feedback' | 'activity' | 'maintenance' | 'qa' | 'categorization';

export function UnifiedReviewCard({ dropNumber, onBackToList }: UnifiedReviewCardProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>('summary');
  const {
    review,
    isLoading,
    error,
    updateStep,
    markIncorrect,
    generateFeedback,
    sendFeedback,
    refresh,
  } = useUnifiedReview({ dropNumber });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400 mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading review...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6">
        <h3 className="text-red-800 dark:text-red-200 font-semibold mb-2">Error Loading Review</h3>
        <p className="text-red-600 dark:text-red-400">{error.message}</p>
        <button
          onClick={refresh}
          className="mt-4 px-4 py-2 bg-red-600 dark:bg-red-500 text-white rounded-lg hover:bg-red-700 dark:hover:bg-red-600 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!review) {
    return (
      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6">
        <p className="text-yellow-800 dark:text-yellow-200">Review not found for {dropNumber}</p>
      </div>
    );
  }

  const tabs = [
    { key: 'summary' as const, label: 'Summary', icon: '📋' },
    { key: 'wizard' as const, label: 'QA Wizard', icon: '🧙' },
    { key: 'photos' as const, label: `Photos (${review.photo_count})`, icon: '📸' },
    { key: 'categorization' as const, label: 'AI Categorization', icon: '🏷️' },
    { key: 'activity' as const, label: 'Activity', icon: '📜' },
    { key: 'maintenance' as const, label: 'Maintenance', icon: '🔧' },
    { key: 'feedback' as const, label: 'Feedback', icon: '💬' },
    { key: 'qa' as const, label: 'Manual QA', icon: '✅' },
  ];

  const handleBackToList = () => {
    if (onBackToList) {
      onBackToList();
    } else {
      router.push('/activate');
    }
  };

  const handleQAWizardComplete = () => {
    // Refresh data and switch to summary tab to show updated state
    refresh();
    setActiveTab('summary');
  };

  return (
    <div className="bg-card rounded-lg shadow-lg dark:shadow-gray-900/50">
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">{dropNumber}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Project: {review.project || 'N/A'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {review.locked_by && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200">
                🔒 Locked by {review.locked_by}
              </span>
            )}
            {review.feedback_sent && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200">
                ✓ Feedback Sent
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <nav className="flex -mb-px" role="tablist" aria-label="DR review sections">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={activeTab === tab.key}
              aria-controls={`tabpanel-${tab.key}`}
              id={`tab-${tab.key}`}
              onClick={() => setActiveTab(tab.key)}
              className={`
                px-6 py-4 text-sm font-medium border-b-2 transition-colors
                ${
                  activeTab === tab.key
                    ? 'border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-muted-foreground hover:text-gray-900 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600'
                }
              `}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div
        className="p-6"
        role="tabpanel"
        id={`tabpanel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
      >
        {activeTab === 'summary' && (
          <DrSummaryPage
            dropNumber={dropNumber}
            onStartQA={() => setActiveTab('wizard')}
            onViewPhotos={() => setActiveTab('photos')}
            onBackToList={handleBackToList}
          />
        )}
        {activeTab === 'wizard' && (
          <QaWizardContainer
            dropNumber={dropNumber}
            onPhaseChange={(phase) => {
              // Could log phase changes or update parent state
            }}
            onComplete={handleQAWizardComplete}
          />
        )}
        {activeTab === 'photos' && <PhotosTab review={review} onRefresh={refresh} />}
        {activeTab === 'feedback' && <FeedbackTab review={review} generateFeedback={generateFeedback} sendFeedback={sendFeedback} />}
        {activeTab === 'activity' && <ActivityTab dropNumber={dropNumber} feedbackSentAt={review.feedback_sent_at} />}
        {activeTab === 'maintenance' && <MaintenanceTab dropNumber={dropNumber} />}
        {activeTab === 'qa' && <ManualQATab review={review} updateStep={updateStep} markIncorrect={markIncorrect} />}
        {activeTab === 'categorization' && (
          <AICategorizationTab
            dropNumber={dropNumber}
            photoCount={review.photo_count || 0}
            onCategorizationApproved={refresh}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Tab 1: Manual QA
 * 10-step checklist with incorrect marking
 */
interface ManualQATabProps {
  review: UnifiedReview;
  updateStep: (step: number, value: boolean) => Promise<void>;
  markIncorrect: (steps: number[], comments: Record<number, string>) => Promise<void>;
}

function ManualQATab({ review, updateStep, markIncorrect }: ManualQATabProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [incorrectSteps, setIncorrectSteps] = useState<Set<number>>(
    new Set(review.incorrect_steps.map(s => parseInt(s)))
  );
  const [comments, setComments] = useState<Record<number, string>>(
    review.incorrect_comments || {}
  );

  const handleStepToggle = async (step: number, currentValue: boolean) => {
    setIsUpdating(true);
    try {
      await updateStep(step, !currentValue);
    } catch (error) {
      log.error('Failed to update step', error, 'UnifiedReviewCard.ManualQATab');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleIncorrectToggle = (step: number) => {
    const newIncorrectSteps = new Set(incorrectSteps);
    if (newIncorrectSteps.has(step)) {
      newIncorrectSteps.delete(step);
      const newComments = { ...comments };
      delete newComments[step];
      setComments(newComments);
    } else {
      newIncorrectSteps.add(step);
    }
    setIncorrectSteps(newIncorrectSteps);
  };

  const handleCommentChange = (step: number, comment: string) => {
    setComments({ ...comments, [step]: comment });
  };

  const handleSaveIncorrect = async () => {
    setIsUpdating(true);
    try {
      await markIncorrect(Array.from(incorrectSteps), comments);
    } catch (error) {
      log.error('Failed to mark incorrect', error, 'UnifiedReviewCard.ManualQATab');
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">10-Step Quality Checklist</h3>
        <p className="text-sm text-muted-foreground">
          Completed: {Object.values(getStepValues(review)).filter(Boolean).length}/10
        </p>
      </div>

      {/* Step Checklist */}
      <div className="space-y-3">
        {Object.entries(STEP_LABELS).map(([stepNum, label]) => {
          const step = parseInt(stepNum);
          const stepValue = getStepValue(review, step);
          const isIncorrect = incorrectSteps.has(step);

          return (
            <div key={step} className="border border-border rounded-lg p-4 bg-background/50">
              <div className="flex items-start gap-4">
                {/* Step Checkbox */}
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    checked={stepValue}
                    onChange={() => handleStepToggle(step, stepValue)}
                    disabled={isUpdating}
                    className="h-5 w-5 rounded border-border text-blue-600 focus:ring-blue-500 dark:bg-gray-700"
                  />
                </div>

                {/* Step Label */}
                <div className="flex-1">
                  <label className="text-sm font-medium text-foreground">
                    Step {step}: {label}
                  </label>

                  {/* Incorrect Marker */}
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isIncorrect}
                      onChange={() => handleIncorrectToggle(step)}
                      className="h-4 w-4 rounded border-border text-red-600 focus:ring-red-500 dark:bg-gray-700"
                    />
                    <span className="text-sm text-muted-foreground">Mark as incorrect</span>
                  </div>

                  {/* Comment Field */}
                  {isIncorrect && (
                    <div className="mt-3">
                      <textarea
                        value={comments[step] || ''}
                        onChange={(e) => handleCommentChange(step, e.target.value)}
                        placeholder="Enter reason for marking this step as incorrect..."
                        rows={2}
                        className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-card text-foreground placeholder-gray-500 dark:placeholder-gray-400"
                      />
                    </div>
                  )}
                </div>

                {/* Status Badge */}
                <div>
                  {stepValue ? (
                    <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200">
                      ✓ Pass
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-secondary text-foreground">
                      Pending
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Save Incorrect Button */}
      {incorrectSteps.size > 0 && (
        <div className="flex justify-end">
          <button
            onClick={handleSaveIncorrect}
            disabled={isUpdating}
            className="px-6 py-2 bg-red-600 dark:bg-red-500 text-white rounded-lg hover:bg-red-700 dark:hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isUpdating ? 'Saving...' : `Save ${incorrectSteps.size} Incorrect Step${incorrectSteps.size > 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Tab 2: Photos
 * Unified photo gallery with three expandable sections:
 * - Installation (OneMap photos)
 * - Group (WA serial photos from activation groups)
 * - Maintenance (WA photos from maintenance groups)
 */
interface PhotosTabProps {
  review: UnifiedReview;
  onRefresh?: () => void;
}

interface MaintenancePhoto {
  id: string;
  original_filename: string | null;
  mime_type: string;
  sharepoint_url: string | null;
  upload_status: string;
  photo_index: number;
  created_at: string;
}

function PhotosTab({ review, onRefresh }: PhotosTabProps) {
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Expanded sections state - all expanded by default
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['installation', 'group', 'maintenance'])
  );

  // WA Group photos state
  const [waPhotos, setWaPhotos] = useState<WAPhoto[]>([]);
  const [waPhotosLoading, setWaPhotosLoading] = useState(true);

  // Maintenance photos state
  const [maintenancePhotos, setMaintenancePhotos] = useState<MaintenancePhoto[]>([]);
  const [maintenanceLoading, setMaintenanceLoading] = useState(true);

  // Convert photos_metadata to Photo[] format for PhotoGalleryUnified
  const installationPhotos = (review.photos_metadata || []).map((photo: any) => ({
    filename: photo.filename,
    step: photo.step || 0,
    url: photo.url,
    size: photo.size,
    modified: photo.modified,
  }));

  // Fetch WA Group photos
  useEffect(() => {
    async function fetchWAPhotos() {
      setWaPhotosLoading(true);
      try {
        const response = await fetch(`/api/activate/wa-photos?dropNumber=${review.drop_number}`);
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data?.photos) {
            setWaPhotos(data.data.photos);
          }
        }
      } catch {
        // Silent fail - photos just won't show
      } finally {
        setWaPhotosLoading(false);
      }
    }
    fetchWAPhotos();
  }, [review.drop_number]);

  // Fetch Maintenance photos
  useEffect(() => {
    async function fetchMaintenancePhotos() {
      setMaintenanceLoading(true);
      try {
        const response = await fetch(`/api/maintenance/wa-messages?drop_number=${review.drop_number}`);
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data?.photos) {
            setMaintenancePhotos(data.data.photos);
          }
        }
      } catch {
        // Silent fail
      } finally {
        setMaintenanceLoading(false);
      }
    }
    fetchMaintenancePhotos();
  }, [review.drop_number]);

  // Check data completeness
  const hasPhotos = installationPhotos.length > 0;
  const hasOntSerial = !!review.ont_serial_scanned;
  const hasUpsSerial = !!review.ups_serial_scanned;
  const isDataIncomplete = !hasPhotos || (!hasOntSerial && !hasUpsSerial);

  const toggleSection = (section: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedSections(newExpanded);
  };

  const handleFetchPhotos = async () => {
    setIsFetching(true);
    setFetchError(null);

    try {
      const response = await fetch('/api/activate/ensure-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dropNumber: review.drop_number, force: true }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'Failed to fetch data');
      }

      onRefresh?.();
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : 'Failed to fetch data');
    } finally {
      setIsFetching(false);
    }
  };

  // Section configurations
  type SectionColor = 'green' | 'blue' | 'orange';
  const sections: Array<{
    id: string;
    label: string;
    icon: typeof MapPin;
    color: SectionColor;
    count: number;
    loading: boolean;
  }> = [
    {
      id: 'installation',
      label: 'Installation',
      icon: MapPin,
      color: 'green',
      count: installationPhotos.length,
      loading: false,
    },
    {
      id: 'group',
      label: 'Group',
      icon: MessageCircle,
      color: 'blue',
      count: waPhotos.length,
      loading: waPhotosLoading,
    },
    {
      id: 'maintenance',
      label: 'Maintenance',
      icon: Wrench,
      color: 'orange',
      count: maintenancePhotos.length,
      loading: maintenanceLoading,
    },
  ];

  const colorClasses: Record<SectionColor, { bg: string; text: string; border: string }> = {
    green: {
      bg: 'bg-green-100 dark:bg-green-900/30',
      text: 'text-green-800 dark:text-green-200',
      border: 'border-green-200 dark:border-green-800',
    },
    blue: {
      bg: 'bg-blue-100 dark:bg-blue-900/30',
      text: 'text-blue-800 dark:text-blue-200',
      border: 'border-blue-200 dark:border-blue-800',
    },
    orange: {
      bg: 'bg-orange-100 dark:bg-orange-900/30',
      text: 'text-orange-800 dark:text-orange-200',
      border: 'border-orange-200 dark:border-orange-800',
    },
  };

  return (
    <div className="space-y-4">
      {/* Data Incomplete Warning Banner */}
      {isDataIncomplete && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl">⚠️</span>
            <div className="flex-1">
              <h4 className="font-semibold text-amber-800 dark:text-amber-200 mb-1">
                Data Incomplete
              </h4>
              <p className="text-sm text-amber-700 dark:text-amber-300 mb-3">
                {!hasPhotos && 'No installation photos loaded. '}
                {!hasOntSerial && !hasUpsSerial && 'No serial numbers synced. '}
                Data may still be syncing from OneMap.
              </p>
              <button
                onClick={handleFetchPhotos}
                disabled={isFetching}
                className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 font-medium"
              >
                {isFetching ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Refreshing from OneMap...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    <span>Refresh Data from OneMap</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Serial Numbers from OneMap */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-background/50 rounded-lg border border-border">
        <div>
          <label className="block text-xs font-medium text-muted-foreground tracking-wide mb-1">
            ONT Barcode
          </label>
          <p className={`text-lg font-mono font-semibold ${hasOntSerial ? 'text-foreground' : 'text-gray-400 dark:text-muted-foreground'}`}>
            {review.ont_serial_scanned || '— not synced'}
          </p>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground tracking-wide mb-1">
            UPS Serial
          </label>
          <p className={`text-lg font-mono font-semibold ${hasUpsSerial ? 'text-foreground' : 'text-gray-400 dark:text-muted-foreground'}`}>
            {review.ups_serial_scanned || '— not synced'}
          </p>
        </div>
      </div>

      {/* Error Message */}
      {fetchError && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
          <p className="text-red-600 dark:text-red-400 text-sm">{fetchError}</p>
        </div>
      )}

      {/* Photo Sections */}
      <div className="space-y-3">
        {sections.map((section) => {
          const isExpanded = expandedSections.has(section.id);
          const colors = colorClasses[section.color];
          const Icon = section.icon;

          return (
            <div
              key={section.id}
              className={`border rounded-lg bg-card overflow-hidden ${colors.border}`}
            >
              {/* Section Header */}
              <button
                onClick={() => toggleSection(section.id)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-accent transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className={`flex items-center justify-center w-8 h-8 rounded-full ${colors.bg}`}>
                    <Icon className={`h-4 w-4 ${colors.text}`} />
                  </span>
                  <div className="text-left">
                    <h4 className="font-medium text-foreground">
                      {section.label} Photos
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      {section.loading ? (
                        'Loading...'
                      ) : (
                        `${section.count} photo${section.count !== 1 ? 's' : ''}`
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {section.count > 0 && (
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors.bg} ${colors.text}`}>
                      {section.count}
                    </span>
                  )}
                  {isExpanded ? (
                    <ChevronDown className="h-5 w-5 text-gray-400" />
                  ) : (
                    <ChevronRight className="h-5 w-5 text-gray-400" />
                  )}
                </div>
              </button>

              {/* Section Content */}
              {isExpanded && (
                <div className="border-t border-border p-4">
                  {section.id === 'installation' && (
                    <>
                      {/* Refresh button for installation */}
                      <div className="flex items-center justify-between mb-4">
                        <div className="text-sm text-muted-foreground">
                          {installationPhotos.length > 0
                            ? `Source: ${review.photo_source || 'OneMap'}`
                            : 'No photos loaded yet'}
                        </div>
                        <button
                          onClick={handleFetchPhotos}
                          disabled={isFetching}
                          className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center gap-2"
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
                          Refresh
                        </button>
                      </div>
                      <PhotoGalleryUnified
                        photos={installationPhotos}
                        source={review.photo_source as any}
                        groupByStep={true}
                      />
                    </>
                  )}

                  {section.id === 'group' && (
                    <>
                      {waPhotosLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <RefreshCw className="h-6 w-6 text-blue-500 animate-spin" />
                        </div>
                      ) : (
                        <WAPhotosGallery
                          photos={waPhotos}
                          emptyMessage="No group photos received yet. Photos sent with DR submissions will appear here."
                          showVlmInfo={true}
                        />
                      )}
                    </>
                  )}

                  {section.id === 'maintenance' && (
                    <>
                      {maintenanceLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <RefreshCw className="h-6 w-6 text-orange-500 animate-spin" />
                        </div>
                      ) : maintenancePhotos.length === 0 ? (
                        <div className="text-center py-8 bg-background/50 rounded-lg">
                          <Wrench className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                          <p className="text-muted-foreground">
                            No maintenance photos for this DR
                          </p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                          {maintenancePhotos.map((photo) => (
                            <div
                              key={photo.id}
                              className="bg-card border border-border rounded-lg overflow-hidden"
                            >
                              {photo.sharepoint_url ? (
                                <a
                                  href={photo.sharepoint_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block aspect-square bg-background relative group"
                                >
                                  <div className="absolute inset-0 flex items-center justify-center">
                                    <Wrench className="h-8 w-8 text-gray-400" />
                                  </div>
                                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                    <span className="text-white text-sm">View in SharePoint</span>
                                  </div>
                                </a>
                              ) : (
                                <div className="aspect-square bg-background flex items-center justify-center">
                                  <div className="text-center">
                                    <Wrench className="h-8 w-8 text-gray-400 mx-auto mb-1" />
                                    <span className="text-xs text-muted-foreground">
                                      {photo.upload_status === 'pending' && 'Pending'}
                                      {photo.upload_status === 'uploading' && 'Uploading...'}
                                      {photo.upload_status === 'failed' && 'Failed'}
                                    </span>
                                  </div>
                                </div>
                              )}
                              <div className="px-3 py-2 text-xs text-muted-foreground">
                                <div className="truncate">
                                  {photo.original_filename || `Photo ${photo.photo_index}`}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Tab 4: Feedback
 * Generate and send WhatsApp feedback
 */
interface FeedbackTabProps {
  review: UnifiedReview;
  generateFeedback: () => string;
  sendFeedback: (message: string) => Promise<void>;
}

function FeedbackTab({ review, generateFeedback, sendFeedback }: FeedbackTabProps) {
  const [message, setMessage] = useState(review.feedback_message || '');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [justSent, setJustSent] = useState(false);

  const handleGenerateFeedback = () => {
    const generated = generateFeedback();
    setMessage(generated);
  };

  const handleSendFeedback = async () => {
    if (!message.trim()) return;

    setIsSending(true);
    setSendError(null);
    try {
      await sendFeedback(message);
      setJustSent(true);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to send feedback';
      setSendError(msg);
      log.error('Failed to send feedback', error, 'UnifiedReviewCard.FeedbackTab');
    } finally {
      setIsSending(false);
    }
  };

  const alreadySent = review.feedback_sent;

  return (
    <div className="space-y-6">
      {/* Generate Button */}
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-foreground">WhatsApp Feedback</h3>
        <button
          onClick={handleGenerateFeedback}
          className="px-4 py-2 bg-purple-600 dark:bg-purple-500 text-white rounded-lg hover:bg-purple-700 dark:hover:bg-purple-600 transition-colors flex items-center gap-2"
        >
          <span>✨</span>
          Generate Auto-Feedback
        </button>
      </div>

      {/* Previously sent notice */}
      {alreadySent && !justSent && (
        <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg text-sm text-yellow-800 dark:text-yellow-200">
          Feedback was previously sent
          {review.feedback_sent_at && (
            <span> on {new Date(review.feedback_sent_at).toLocaleString()}</span>
          )}. You can edit the message below and resend.
        </div>
      )}

      {/* Just sent confirmation */}
      {justSent && (
        <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-800 dark:text-green-200">
          Feedback sent successfully.
        </div>
      )}

      {/* Message Editor */}
      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-2">
          Feedback Message
        </label>
        <textarea
          value={message}
          onChange={(e) => { setMessage(e.target.value); setJustSent(false); }}
          rows={10}
          placeholder="Enter feedback message or click 'Generate Auto-Feedback' to create one automatically..."
          className="w-full px-4 py-3 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-card text-foreground placeholder-gray-500 dark:placeholder-gray-400"
        />
      </div>

      {/* Error display */}
      {sendError && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400">
          {sendError}
        </div>
      )}

      {/* Send Button */}
      <div className="flex justify-end gap-3">
        <button
          onClick={handleSendFeedback}
          disabled={isSending || !message.trim()}
          className="px-6 py-2 bg-green-600 dark:bg-green-500 text-white rounded-lg hover:bg-green-700 dark:hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {isSending ? (
            <>
              <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              Sending...
            </>
          ) : alreadySent ? (
            <>
              <span>🔄</span>
              Resend Feedback
            </>
          ) : (
            <>
              <span>📤</span>
              Send to WhatsApp
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * Helper: Get step value from review object
 * NOTE: Steps 8, 9, 10 are now Final Installation, Green Lights, Signature
 * (ONT Barcode and UPS Serial are NOT photo steps)
 */
function getStepValue(review: UnifiedReview, step: number): boolean {
  const stepFields: Record<number, keyof UnifiedReview> = {
    1: 'step_01_house_photo',
    2: 'step_02_cable_from_pole',
    3: 'step_03_entry_outside',
    4: 'step_04_entry_inside',
    5: 'step_05_wall',
    6: 'step_06_ont_back',
    7: 'step_07_power_meter',
    8: 'step_08_final_installation',
    9: 'step_09_green_lights',
    10: 'step_10_signature',
  };

  return review[stepFields[step]] as boolean || false;
}

/**
 * Helper: Get all step values from review object
 */
function getStepValues(review: UnifiedReview): Record<number, boolean> {
  const values: Record<number, boolean> = {};
  for (let i = 1; i <= 10; i++) {
    values[i] = getStepValue(review, i);
  }
  return values;
}

