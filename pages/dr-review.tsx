/**
 * DR Photo Review Page
 * AI-powered fiber installation photo evaluation
 */

import { useState, useEffect } from 'react';
import type { ReactElement } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import toast from 'react-hot-toast';
import { Camera } from 'lucide-react';

import { DRSessionList } from '@/modules/dr-photo-review/components/DRSessionList';
import { DRPhotoGallery } from '@/modules/dr-photo-review/components/DRPhotoGallery';
import { DREvaluationPanel } from '@/modules/dr-photo-review/components/DREvaluationPanel';
import { VLMStatusIndicator } from '@/modules/dr-photo-review/components/VLMStatusIndicator';
import { useDRSessions } from '@/modules/dr-photo-review/hooks/useDRSessions';
import { useDREvaluation } from '@/modules/dr-photo-review/hooks/useDREvaluation';

function DRReviewPage() {
    const router = useRouter();
    const [selectedDR, setSelectedDR] = useState<string | null>(null);

    const { sessions, isLoading: sessionsLoading, error: sessionsError, refresh: refreshSessions } = useDRSessions();
    const {
        photos,
        evaluation,
        vlmStatus,
        isLoadingPhotos,
        isEvaluating,
        error: evalError,
        fetchPhotos,
        evaluateAll,
        checkVLMStatus,
        clear,
    } = useDREvaluation();

    // Check VLM status on mount
    useEffect(() => {
        checkVLMStatus();
    }, [checkVLMStatus]);

    // Restore selected DR from URL
    useEffect(() => {
        if (!router.isReady) return;

        const drNumber = router.query.dr as string;
        if (drNumber && drNumber !== selectedDR) {
            setSelectedDR(drNumber);
        }
    }, [router.isReady, router.query.dr, selectedDR]);

    // Fetch photos when DR is selected
    useEffect(() => {
        if (selectedDR) {
            fetchPhotos(selectedDR);
        } else {
            clear();
        }
    }, [selectedDR, fetchPhotos, clear]);

    // Update URL when DR is selected
    useEffect(() => {
        if (!router.isReady) return;

        const currentDR = router.query.dr as string;
        if (currentDR !== selectedDR) {
            if (selectedDR) {
                router.replace(
                    { pathname: router.pathname, query: { dr: selectedDR } },
                    undefined,
                    { shallow: true }
                );
            } else if (currentDR) {
                router.replace({ pathname: router.pathname }, undefined, { shallow: true });
            }
        }
    }, [selectedDR, router]);

    const handleSelectDR = (drNumber: string) => {
        setSelectedDR(drNumber);
    };

    const handleEvaluate = async () => {
        if (!selectedDR) return;

        try {
            await evaluateAll(selectedDR);
            toast.success('AI evaluation completed! 🤖');
        } catch (err) {
            toast.error('Evaluation failed');
        }
    };

    return (
        <>
            <Head>
                <title>DR Photo Review | FibreFlow</title>
                <meta name="description" content="AI-powered fiber installation photo evaluation" />
            </Head>

            <div className="min-h-screen bg-[var(--ff-bg-tertiary)]">
                {/* Header */}
                <header className="bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)] px-6 py-4">
                    <div className="max-w-[1800px] mx-auto flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Camera className="w-8 h-8 text-blue-600" />
                            <div>
                                <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">
                                    DR Photo Review
                                </h1>
                                <p className="text-sm text-[var(--ff-text-secondary)]">
                                    AI-powered fiber installation verification
                                </p>
                            </div>
                        </div>
                        <VLMStatusIndicator status={vlmStatus} />
                    </div>
                </header>

                {/* Main Content */}
                <main className="p-6">
                    <div className="max-w-[1800px] mx-auto">
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-180px)]">
                            {/* Left Sidebar - Session List */}
                            <aside className="lg:col-span-3 h-full">
                                <DRSessionList
                                    sessions={sessions}
                                    selectedDR={selectedDR}
                                    onSelect={handleSelectDR}
                                    isLoading={sessionsLoading}
                                    error={sessionsError}
                                    onRefresh={refreshSessions}
                                />
                            </aside>

                            {/* Center - Photo Gallery */}
                            <section className="lg:col-span-6 h-full overflow-y-auto">
                                <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md p-6 h-full border border-[var(--ff-border-light)]">
                                    {selectedDR ? (
                                        <>
                                            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
                                                Photos - {selectedDR}
                                            </h2>
                                            <DRPhotoGallery
                                                steps={photos}
                                                drNumber={selectedDR}
                                                isLoading={isLoadingPhotos}
                                            />
                                        </>
                                    ) : (
                                        <div className="flex items-center justify-center h-full">
                                            <div className="text-center">
                                                <Camera className="w-16 h-16 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
                                                <h3 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-2">
                                                    Select a DR
                                                </h3>
                                                <p className="text-[var(--ff-text-secondary)]">
                                                    Choose a DR from the list to view photos and run AI evaluation
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </section>

                            {/* Right Sidebar - Evaluation Panel */}
                            <aside className="lg:col-span-3 h-full overflow-y-auto">
                                {selectedDR && (
                                    <DREvaluationPanel
                                        drNumber={selectedDR}
                                        evaluation={evaluation}
                                        isEvaluating={isEvaluating}
                                        onEvaluate={handleEvaluate}
                                        error={evalError || undefined}
                                    />
                                )}
                            </aside>
                        </div>
                    </div>
                </main>
            </div>
        </>
    );
}

// Disable AppLayout for this page (standalone layout)
DRReviewPage.getLayout = function getLayout(page: ReactElement) {
    return page;
};

export default DRReviewPage;
