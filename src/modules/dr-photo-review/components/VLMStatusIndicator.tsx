/**
 * VLM Status Indicator Component
 * Shows the status of the AI service
 */

'use client';

import { Cpu, Check, X } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import type { VLMStatus } from '../types';

interface VLMStatusIndicatorProps {
    status: VLMStatus | null;
    isLoading?: boolean;
}

export function VLMStatusIndicator({ status, isLoading }: VLMStatusIndicatorProps) {
    if (isLoading) {
        return (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--ff-bg-tertiary)] rounded-full">
                <InlineSpinner size="sm" />
                <span className="text-sm text-[var(--ff-text-tertiary)]">Checking AI...</span>
            </div>
        );
    }

    if (!status) {
        return (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--ff-bg-tertiary)] rounded-full">
                <Cpu className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                <span className="text-sm text-[var(--ff-text-tertiary)]">AI Status Unknown</span>
            </div>
        );
    }

    return (
        <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${status.online
                    ? 'bg-green-500/20'
                    : 'bg-red-500/20'
                }`}
        >
            {status.online ? (
                <Check className="w-4 h-4 text-green-400" />
            ) : (
                <X className="w-4 h-4 text-red-400" />
            )}
            <span
                className={`text-sm font-medium ${status.online
                        ? 'text-green-400'
                        : 'text-red-400'
                    }`}
            >
                {status.online ? 'AI Online' : 'AI Offline'}
            </span>
            {status.model && (
                <span className="text-xs text-[var(--ff-text-tertiary)]">
                    ({status.model})
                </span>
            )}
        </div>
    );
}
