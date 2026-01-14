/**
 * Foto Review Page
 * AI-powered photo evaluation for installation drops
 */

import { useState, useMemo, useEffect } from 'react';
import type { ReactElement } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import toast from 'react-hot-toast';
import { Camera, AlertTriangle, CheckCircle2, Clock, Send } from 'lucide-react';
import {
  PhotoGallery,
  EvaluationPanel,
  EvaluationResults,
  FilterControls,
  type FilterOptions,
} from '@/modules/photo-review/components';
import { usePhotos } from '@/modules/photo-review/hooks/usePhotos';
import { useFotoEvaluation } from '@/modules/photo-review/hooks/useFotoEvaluation';
import type { DropRecord } from '@/modules/photo-review/types';
import { formatRelativeTime, isWithin24Hours } from '@/modules/photo-review/utils/timeUtils';

function FotoReviewPage() {
  const router = useRouter();
  const [selectedDR, setSelectedDR] = useState<DropRecord | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<FilterOptions>({
    project: 'all',
    startDate: '',
    endDate: '',
    status: 'all',
  });

  const { photos, isLoading, error, refresh } = usePhotos();
  const {
    evaluation,
    isEvaluating,
    error: evalError,
    evaluate,
    fetchEvaluation,
    sendFeedback,
    isSendingFeedback,
    feedbackError,
  } = useFotoEvaluation();

  // Extract unique projects for filter dropdown
  const projects = useMemo(() => {
    const uniqueProjects = new Set(photos.map((dr) => dr.project));
    return Array.from(uniqueProjects).sort();
  }, [photos]);

  // Filter photos based on current filters and search query
  const filteredPhotos = useMemo(() => {
    return photos.filter((dr) => {
      // Search query filter (by DR number)
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toUpperCase();
        if (!dr.dr_number.toUpperCase().includes(query)) {
          return false;
        }
      }

      // Project filter
      if (filters.project !== 'all' && dr.project !== filters.project) {
        return false;
      }

      // Date range filter
      if (filters.startDate && dr.date) {
        const drDate = new Date(dr.date);
        const startDate = new Date(filters.startDate);
        if (drDate < startDate) {
          return false;
        }
      }

      if (filters.endDate && dr.date) {
        const drDate = new Date(dr.date);
        const endDate = new Date(filters.endDate);
        // Set end date to end of day for inclusive filtering
        endDate.setHours(23, 59, 59, 999);
        if (drDate > endDate) {
          return false;
        }
      }

      // Status filter
      if (filters.status === 'evaluated' && !dr.evaluated) {
        return false;
      }
      if (filters.status === 'pending' && dr.evaluated) {
        return false;
      }

      return true;
    });
  }, [photos, filters, searchQuery]);

  const handleClearFilters = () => {
    setFilters({
      project: 'all',
      startDate: '',
      endDate: '',
      status: 'all',
    });
  };

  // Restore selected DR from URL on page load
  useEffect(() => {
    if (!router.isReady || !photos.length) return;

    const drNumber = router.query?.dr as string | undefined;
    if (drNumber && !selectedDR) {
      const dr = photos.find((p) => p.dr_number === drNumber);
      if (dr) {
        setSelectedDR(dr);
        // Fetch existing evaluation if available
        if (dr.evaluated) {
          fetchEvaluation(dr.dr_number);
        }
      }
    }
  }, [router.isReady, router.query?.dr, photos, selectedDR, fetchEvaluation]);

  // Update URL when DR is selected
  useEffect(() => {
    if (!router.isReady) return;

    const currentDR = router.query?.dr as string | undefined;
    const newDR = selectedDR?.dr_number;

    // Only update if different to avoid infinite loops
    if (currentDR !== newDR) {
      if (newDR) {
        router.replace(
          {
            pathname: router.pathname,
            query: { ...router.query, dr: newDR },
          },
          undefined,
          { shallow: true }
        );
      } else if (currentDR) {
        // Remove dr param if no DR selected
        const { dr, ...restQuery } = router.query;
        router.replace(
          {
            pathname: router.pathname,
            query: restQuery,
          },
          undefined,
          { shallow: true }
        );
      }
    }
  }, [selectedDR, router]);

  // Auto-fetch evaluation when DR is selected
  const handleSelectDR = async (dr: DropRecord) => {
    setSelectedDR(dr);

    // Fetch existing evaluation if available
    if (dr.evaluated) {
      await fetchEvaluation(dr.dr_number);
    }
  };

  // Handle AI evaluation
  const handleEvaluate = async () => {
    if (!selectedDR) return;

    try {
      await evaluate(selectedDR.dr_number);
      toast.success('AI evaluation completed successfully! 🤖');
    } catch (err) {
      toast.error(`Evaluation failed: ${evalError || 'Unknown error'}`);
    }
  };

  // Handle send feedback
  const handleSendFeedback = async () => {
    if (!selectedDR) return;

    try {
      await sendFeedback(selectedDR.dr_number);
      toast.success('Feedback sent successfully via WhatsApp! 📲');
    } catch (err) {
      toast.error(`Failed to send feedback: ${feedbackError || 'Unknown error'}`);
    }
  };

  return (
    <>
      <Head>
        <title>Photo Review | FibreFlow</title>
        <meta name="description" content="AI-powered installation photo evaluation" />
      </Head>

      <div className="min-h-screen bg-[var(--ff-bg-tertiary)] p-6">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <Camera className="w-8 h-8 text-blue-600" />
              <h1 className="text-3xl font-bold text-[var(--ff-text-primary)]">Photo Review</h1>
            </div>
            <p className="text-[var(--ff-text-secondary)]">AI-powered installation photo evaluation</p>
          </div>

          {/* Main Content */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Sidebar - DR List */}
            <aside className="lg:col-span-1" aria-label="Drop records list">
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md overflow-hidden border border-[var(--ff-border-light)]">
                <div className="p-4 border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
                  <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Drop Records</h2>
                  <p className="text-sm text-[var(--ff-text-secondary)] mt-1" aria-live="polite" aria-atomic="true">
                    {filteredPhotos.length} of {photos.length} DRs
                  </p>
                </div>

                {/* Search Box */}
                <div className="px-4 pt-2 pb-4">
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search by DR number..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-10 py-2 border border-[var(--ff-border-light)] rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] text-sm"
                    />
                    <svg
                      className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2 top-1/2 transform -translate-y-1/2 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)] p-1"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>

                {/* Filter Controls */}
                <FilterControls
                  projects={projects}
                  filters={filters}
                  onFilterChange={setFilters}
                  onClearFilters={handleClearFilters}
                />

                {isLoading ? (
                  <div className="p-8 text-center" role="status" aria-live="polite">
                    <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" aria-hidden="true" />
                    <p className="text-[var(--ff-text-secondary)]">Loading drops...</p>
                  </div>
                ) : error ? (
                  <div className="p-8 text-center" role="alert" aria-live="assertive">
                    <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-3" aria-hidden="true" />
                    <p className="text-red-400 mb-4">{error}</p>
                    <button
                      onClick={refresh}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                      aria-label="Retry loading drop records"
                    >
                      Retry
                    </button>
                  </div>
                ) : filteredPhotos.length === 0 ? (
                  <div className="p-8 text-center">
                    <Camera className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-3" aria-hidden="true" />
                    <p className="text-[var(--ff-text-secondary)]">
                      {photos.length === 0
                        ? 'No DRs with photos found'
                        : 'No DRs match the selected filters'}
                    </p>
                    {photos.length > 0 && (
                      <button
                        onClick={handleClearFilters}
                        className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                        aria-label="Clear all filters"
                      >
                        Clear Filters
                      </button>
                    )}
                  </div>
                ) : (
                  <nav
                    className="divide-y divide-[var(--ff-border-light)] max-h-[600px] overflow-y-auto scroll-smooth"
                    role="navigation"
                    aria-label="Drop record selection"
                  >
                    {filteredPhotos.map((dr) => {
                      const isNew = dr.evaluated && isWithin24Hours(dr.evaluation_date);
                      const relativeTime = formatRelativeTime(dr.evaluation_date);

                      return (
                        <button
                          key={dr.dr_number}
                          onClick={() => handleSelectDR(dr)}
                          className={`w-full text-left p-4 transition-all duration-200 hover:bg-[var(--ff-bg-hover)] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 ${selectedDR?.dr_number === dr.dr_number
                            ? 'bg-blue-500/20 border-l-4 border-blue-600 shadow-sm'
                            : dr.evaluated
                              ? 'bg-green-500/10 hover:border-l-4 hover:border-green-500'
                              : 'hover:border-l-4 hover:border-[var(--ff-border-light)]'
                            }`}
                          aria-label={`Select drop record ${dr.dr_number}, ${dr.project}, ${dr.photos.length} photos${dr.evaluated ? `, evaluated ${relativeTime}` : ', pending evaluation'}${dr.feedback_sent ? ', feedback sent' : ''}`}
                          aria-current={selectedDR?.dr_number === dr.dr_number ? 'true' : undefined}
                        >
                          {/* Header Row */}
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-semibold text-[var(--ff-text-primary)]">{dr.dr_number}</span>
                            {dr.evaluated ? (
                              <div className="flex items-center gap-1.5">
                                {isNew && (
                                  <span className="text-xs bg-blue-500 text-white px-2 py-0.5 rounded-full font-medium animate-pulse">
                                    NEW
                                  </span>
                                )}
                                <CheckCircle2 className="w-4 h-4 text-green-400" />
                              </div>
                            ) : (
                              <Clock className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                            )}
                          </div>

                          {/* Project Name */}
                          <p className="text-sm text-[var(--ff-text-secondary)] font-medium mb-1">{dr.project}</p>

                          {/* Status Row */}
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-[var(--ff-text-tertiary)]">
                              {dr.photos.length} photo{dr.photos.length !== 1 ? 's' : ''}
                            </span>

                            {dr.evaluated ? (
                              <div className="flex items-center gap-2">
                                <span className="text-green-400 font-medium">
                                  {relativeTime}
                                </span>
                                {dr.feedback_sent && (
                                  <span className="flex items-center gap-1 text-blue-400">
                                    <Send className="w-3 h-3" />
                                    <span>Sent</span>
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-[var(--ff-text-tertiary)]">Pending</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </nav>
                )}
              </div>
            </aside>

            {/* Main Area - Photo Gallery & Evaluation */}
            <main className="lg:col-span-2 space-y-6" aria-label="Photo review content">
              {selectedDR ? (
                <>
                  {/* Photo Gallery */}
                  <section className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md p-6 border border-[var(--ff-border-light)]" aria-labelledby="photo-gallery-heading">
                    <h3 id="photo-gallery-heading" className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
                      Photos - {selectedDR.dr_number}
                    </h3>
                    <PhotoGallery photos={selectedDR.photos} dr_number={selectedDR.dr_number} />
                  </section>

                  {/* Evaluation Panel */}
                  <section aria-labelledby="evaluation-heading" aria-live="polite" aria-atomic="false">
                    <EvaluationPanel
                      drop={selectedDR}
                      evaluation={evaluation}
                      isEvaluating={isEvaluating}
                      onEvaluate={async (drNumber) => {
                        await evaluate(drNumber);
                      }}
                      onSendFeedback={async (drNumber, message) => {
                        await sendFeedback(drNumber, message, selectedDR.project);
                      }}
                    />
                  </section>

                  {/* Error Messages */}
                  {evalError && (
                    <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4" role="alert" aria-live="assertive">
                      <p className="text-red-400 text-sm font-medium">{evalError}</p>
                    </div>
                  )}

                  {feedbackError && (
                    <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4" role="alert" aria-live="assertive">
                      <p className="text-red-400 text-sm font-medium">{feedbackError}</p>
                    </div>
                  )}

                  {/* Detailed Results */}
                  {evaluation && (
                    <section aria-labelledby="detailed-results-heading">
                      <EvaluationResults evaluation={evaluation} />
                    </section>
                  )}
                </>
              ) : (
                <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md p-12 text-center border border-[var(--ff-border-light)]" role="status">
                  <Camera className="w-16 h-16 text-[var(--ff-text-tertiary)] mx-auto mb-4" aria-hidden="true" />
                  <h3 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-2">Select a Drop Record</h3>
                  <p className="text-[var(--ff-text-secondary)]">
                    Choose a DR from the list to view photos and run AI evaluation
                  </p>
                </div>
              )}
            </main>
          </div>
        </div>
      </div>
    </>
  );
}

// Disable AppLayout for this page (no sidebar/menu)
FotoReviewPage.getLayout = function getLayout(page: ReactElement) {
  return page;
};

export default FotoReviewPage;
