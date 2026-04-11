/**
 * DR Photo Gallery Component
 * Displays photos organized by verification step
 */

'use client';

import { useState } from 'react';
import { X, ChevronLeft, ChevronRight, AlertTriangle, CheckCircle, XCircle, Camera } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { DRStepPhoto } from '../types';

interface DRPhotoGalleryProps {
    steps: DRStepPhoto[];
    drNumber: string;
    isLoading: boolean;
}

export function DRPhotoGallery({ steps, drNumber, isLoading }: DRPhotoGalleryProps) {
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

    const openLightbox = (index: number) => setSelectedIndex(index);
    const closeLightbox = () => setSelectedIndex(null);

    const goNext = () => {
        if (selectedIndex !== null && selectedIndex < steps.length - 1) {
            setSelectedIndex(selectedIndex + 1);
        }
    };

    const goPrevious = () => {
        if (selectedIndex !== null && selectedIndex > 0) {
            setSelectedIndex(selectedIndex - 1);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') closeLightbox();
        if (e.key === 'ArrowRight') goNext();
        if (e.key === 'ArrowLeft') goPrevious();
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64 bg-[var(--ff-bg-tertiary)] rounded-lg">
                <div className="text-center">
                    <LoadingSpinner size="lg" label="Loading photos..." />
                </div>
            </div>
        );
    }

    if (steps.length === 0) {
        return (
            <div className="flex items-center justify-center h-64 bg-[var(--ff-bg-tertiary)] rounded-lg border-2 border-dashed border-[var(--ff-border-light)]">
                <div className="text-center">
                    <Camera className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-3" />
                    <p className="text-[var(--ff-text-secondary)] text-lg">No photos for {drNumber}</p>
                    <p className="text-[var(--ff-text-tertiary)] text-sm mt-2">Photos will appear once uploaded</p>
                </div>
            </div>
        );
    }

    return (
        <>
            {/* Photo Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {steps.map((step, index) => (
                    <button
                        key={`${step.step_number}-${step.filename}`}
                        onClick={() => openLightbox(index)}
                        className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer group transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${step.critical
                                ? 'ring-2 ring-orange-500'
                                : 'hover:ring-2 hover:ring-blue-400'
                            }`}
                    >
                        {/* Photo */}
                        <img
                            src={step.url}
                            alt={step.step_label}
                            className="absolute inset-0 w-full h-full object-cover"
                            loading="lazy"
                        />

                        {/* Critical Badge */}
                        {step.critical && (
                            <div className="absolute top-2 right-2 bg-orange-500 text-white text-xs px-2 py-0.5 rounded-full font-medium">
                                Critical
                            </div>
                        )}

                        {/* Evaluation Score Badge */}
                        {step.evaluation && (
                            <div
                                className={`absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${step.evaluation.pass
                                        ? 'bg-green-500 text-white'
                                        : 'bg-red-500 text-white'
                                    }`}
                            >
                                {step.evaluation.pass ? (
                                    <CheckCircle className="w-3 h-3" />
                                ) : (
                                    <XCircle className="w-3 h-3" />
                                )}
                                {step.evaluation.score}/10
                            </div>
                        )}

                        {/* Label Overlay */}
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3">
                            <p className="text-white text-sm font-medium">
                                Step {step.step_number}: {step.step_label}
                            </p>
                        </div>

                        {/* Hover Overlay */}
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <span className="text-white text-sm font-medium">Click to view</span>
                        </div>
                    </button>
                ))}
            </div>

            {/* Lightbox Modal */}
            {selectedIndex !== null && steps[selectedIndex] && (
                <div
                    className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm flex items-center justify-center"
                    onClick={closeLightbox}
                    onKeyDown={handleKeyDown}
                    tabIndex={0}
                    role="dialog"
                    aria-modal="true"
                >
                    {/* Close Button */}
                    <button
                        className="absolute top-4 right-4 z-10 text-white bg-black/50 hover:bg-black/70 rounded-full p-3 transition-all"
                        onClick={closeLightbox}
                        aria-label="Close"
                    >
                        <X size={28} />
                    </button>

                    {/* Navigation Buttons */}
                    {selectedIndex > 0 && (
                        <button
                            className="absolute left-4 top-1/2 -translate-y-1/2 z-10 text-white bg-black/50 hover:bg-black/70 rounded-full p-4 transition-all"
                            onClick={(e) => { e.stopPropagation(); goPrevious(); }}
                            aria-label="Previous"
                        >
                            <ChevronLeft size={32} />
                        </button>
                    )}
                    {selectedIndex < steps.length - 1 && (
                        <button
                            className="absolute right-4 top-1/2 -translate-y-1/2 z-10 text-white bg-black/50 hover:bg-black/70 rounded-full p-4 transition-all"
                            onClick={(e) => { e.stopPropagation(); goNext(); }}
                            aria-label="Next"
                        >
                            <ChevronRight size={32} />
                        </button>
                    )}

                    {/* Photo and Info */}
                    <div
                        className="relative max-w-5xl max-h-[90vh] w-full h-full flex flex-col items-center justify-center p-8"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <img
                            src={steps[selectedIndex].url}
                            alt={steps[selectedIndex].step_label}
                            className="max-w-full max-h-[70vh] object-contain"
                        />

                        <div className="mt-4 text-center text-white">
                            <p className="text-xl font-semibold">
                                Step {steps[selectedIndex].step_number}: {steps[selectedIndex].step_label}
                            </p>
                            <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">
                                {selectedIndex + 1} of {steps.length}
                            </p>

                            {/* Evaluation Info */}
                            {steps[selectedIndex]!.evaluation && (
                                <div className="mt-4 p-4 bg-[var(--ff-bg-secondary)] rounded-lg max-w-md mx-auto">
                                    <div className="flex items-center justify-center gap-2 mb-2">
                                        {steps[selectedIndex]!.evaluation.pass ? (
                                            <CheckCircle className="w-5 h-5 text-green-400" />
                                        ) : (
                                            <XCircle className="w-5 h-5 text-red-400" />
                                        )}
                                        <span className="font-semibold">
                                            Score: {steps[selectedIndex]!.evaluation.score}/10
                                        </span>
                                    </div>
                                    {(steps[selectedIndex]!.evaluation?.findings?.length ?? 0) > 0 && (
                                        <ul className="text-sm text-[var(--ff-text-tertiary)] text-left list-disc list-inside">
                                            {steps[selectedIndex]!.evaluation!.findings!.map((f, i) => (
                                                <li key={i}>{f}</li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
