/**
 * DR Session List Component
 * Displays list of DRs with photos in a sidebar
 */

'use client';

import { Search, Camera, AlertTriangle, RefreshCw } from 'lucide-react';
import { useState, useMemo } from 'react';
import type { DRSession } from '../types';

interface DRSessionListProps {
    sessions: DRSession[];
    selectedDR: string | null;
    onSelect: (drNumber: string) => void;
    isLoading: boolean;
    error: string | null;
    onRefresh?: () => void;
}

export function DRSessionList({
    sessions,
    selectedDR,
    onSelect,
    isLoading,
    error,
    onRefresh,
}: DRSessionListProps) {
    const [searchTerm, setSearchTerm] = useState('');

    const filteredSessions = useMemo(() => {
        if (!searchTerm) return sessions;
        const term = searchTerm.toLowerCase();
        return sessions.filter(
            (s) =>
                s.dr_number.toLowerCase().includes(term) ||
                s.project.toLowerCase().includes(term)
        );
    }, [sessions, searchTerm]);

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'completed':
                return 'bg-green-500/20 text-green-400';
            case 'in_progress':
                return 'bg-blue-500/20 text-blue-400';
            case 'needs_review':
                return 'bg-yellow-500/20 text-yellow-400';
            default:
                return 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)]';
        }
    };

    return (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-md overflow-hidden h-full flex flex-col">
            {/* Header */}
            <div className="p-4 border-b bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)]">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                        DR Sessions
                    </h2>
                    {onRefresh && (
                        <button
                            onClick={onRefresh}
                            className="p-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
                            aria-label="Refresh sessions"
                        >
                            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                        </button>
                    )}
                </div>

                {/* Search */}
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
                    <input
                        type="text"
                        placeholder="Search DR number..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 text-sm border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                </div>

                <p className="text-sm text-[var(--ff-text-secondary)] mt-2">
                    {filteredSessions.length} of {sessions.length} DRs
                </p>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                    <div className="p-8 text-center">
                        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                        <p className="text-[var(--ff-text-tertiary)]">Loading sessions...</p>
                    </div>
                ) : error ? (
                    <div className="p-8 text-center">
                        <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-3" />
                        <p className="text-red-400 mb-4">{error}</p>
                        {onRefresh && (
                            <button
                                onClick={onRefresh}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                            >
                                Retry
                            </button>
                        )}
                    </div>
                ) : filteredSessions.length === 0 ? (
                    <div className="p-8 text-center">
                        <Camera className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-3" />
                        <p className="text-[var(--ff-text-secondary)]">
                            {sessions.length === 0 ? 'No DRs with photos found' : 'No matching DRs'}
                        </p>
                    </div>
                ) : (
                    <nav className="divide-y divide-[var(--ff-border-light)]">
                        {filteredSessions.map((session) => (
                            <button
                                key={session.dr_number}
                                onClick={() => onSelect(session.dr_number)}
                                className={`w-full text-left p-4 transition-all duration-200 hover:bg-[var(--ff-bg-hover)] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 ${selectedDR === session.dr_number
                                        ? 'bg-blue-500/20 border-l-4 border-blue-600'
                                        : ''
                                    }`}
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <span className="font-semibold text-[var(--ff-text-primary)]">
                                        {session.dr_number}
                                    </span>
                                    <span
                                        className={`text-xs px-2 py-1 rounded-full font-medium ${getStatusColor(
                                            session.status
                                        )}`}
                                    >
                                        {session.status.replace('_', ' ')}
                                    </span>
                                </div>
                                <p className="text-sm text-[var(--ff-text-secondary)]">{session.project}</p>
                                <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
                                    Step {session.current_step}/11 • {session.steps_completed} completed
                                </p>
                            </button>
                        ))}
                    </nav>
                )}
            </div>
        </div>
    );
}
