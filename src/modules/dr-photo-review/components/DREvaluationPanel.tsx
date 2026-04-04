/**
 * DR Evaluation Panel Component
 * Shows evaluation controls and results
 */

'use client';

import { Play, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import type { DREvaluationResult } from '../types';

interface DREvaluationPanelProps {
    drNumber: string;
    evaluation: DREvaluationResult | null;
    isEvaluating: boolean;
    onEvaluate: () => void;
    error?: string;
}

export function DREvaluationPanel({
    drNumber,
    evaluation,
    isEvaluating,
    onEvaluate,
    error,
}: DREvaluationPanelProps) {
    return (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)]">
                <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                    AI Evaluation
                </h3>
                <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
                    Powered by dr-verifier VLM model
                </p>
            </div>

            {/* Content */}
            <div className="p-4 space-y-4">
                {/* Evaluate Button */}
                <button
                    onClick={onEvaluate}
                    disabled={isEvaluating}
                    className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-all ${isEvaluating
                            ? 'bg-[var(--ff-bg-tertiary)] cursor-not-allowed'
                            : 'bg-blue-600 hover:bg-blue-700 text-white'
                        }`}
                >
                    {isEvaluating ? (
                        <>
                            <InlineSpinner size="sm" />
                            Evaluating...
                        </>
                    ) : (
                        <>
                            <Play className="w-5 h-5" />
                            Run AI Evaluation
                        </>
                    )}
                </button>

                {/* Error Message */}
                {error && (
                    <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg">
                        <div className="flex items-center gap-2 text-red-400">
                            <AlertTriangle className="w-5 h-5" />
                            <p className="text-sm font-medium">{error}</p>
                        </div>
                    </div>
                )}

                {/* Evaluation Results */}
                {evaluation && (
                    <div className="space-y-4">
                        {/* Overall Score */}
                        <div
                            className={`p-4 rounded-lg ${evaluation.overall_pass
                                    ? 'bg-green-500/20 border border-green-500/30'
                                    : 'bg-red-500/20 border border-red-500/30'
                                }`}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    {evaluation.overall_pass ? (
                                        <CheckCircle className="w-6 h-6 text-green-400" />
                                    ) : (
                                        <XCircle className="w-6 h-6 text-red-400" />
                                    )}
                                    <span
                                        className={`text-lg font-semibold ${evaluation.overall_pass
                                                ? 'text-green-400'
                                                : 'text-red-400'
                                            }`}
                                    >
                                        {evaluation.overall_pass ? 'PASSED' : 'FAILED'}
                                    </span>
                                </div>
                                <div className="text-right">
                                    <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                                        {evaluation.overall_score.toFixed(1)}/10
                                    </p>
                                    <p className="text-xs text-[var(--ff-text-tertiary)]">Overall Score</p>
                                </div>
                            </div>
                        </div>

                        {/* Summary */}
                        {evaluation.summary && (
                            <div className="p-3 bg-[var(--ff-bg-tertiary)] rounded-lg">
                                <p className="text-sm text-[var(--ff-text-secondary)]">{evaluation.summary}</p>
                            </div>
                        )}

                        {/* Step Results */}
                        {evaluation.evaluations && evaluation.evaluations.length > 0 && (
                            <div className="space-y-2">
                                <h4 className="text-sm font-medium text-[var(--ff-text-secondary)]">
                                    Step Results
                                </h4>
                                <div className="divide-y divide-[var(--ff-border-light)] border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
                                    {evaluation.evaluations.map((stepEval) => (
                                        <div
                                            key={stepEval.step_number}
                                            className="flex items-center justify-between p-3 bg-[var(--ff-bg-secondary)]"
                                        >
                                            <div className="flex items-center gap-2">
                                                {stepEval.pass ? (
                                                    <CheckCircle className="w-4 h-4 text-green-400" />
                                                ) : (
                                                    <XCircle className="w-4 h-4 text-red-400" />
                                                )}
                                                <span className="text-sm text-[var(--ff-text-secondary)]">
                                                    Step {stepEval.step_number}
                                                </span>
                                            </div>
                                            <span
                                                className={`text-sm font-medium ${stepEval.pass ? 'text-green-400' : 'text-red-400'
                                                    }`}
                                            >
                                                {stepEval.score}/10
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Timestamp */}
                        {evaluation.evaluated_at && (
                            <p className="text-xs text-[var(--ff-text-tertiary)] text-right">
                                Evaluated: {new Date(evaluation.evaluated_at).toLocaleString()}
                            </p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
