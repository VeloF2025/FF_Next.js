// Recordings Page - View, play, and manage LiveKit recordings
'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
    Play,
    Pause,
    Download,
    Trash2,
    Video,
    Calendar,
    Clock,
    HardDrive,
    ChevronLeft,
    X,
    RefreshCw,
} from 'lucide-react';

interface Recording {
    id: string;
    filename: string;
    roomName: string;
    createdAt: string;
    size: number;
    duration?: number;
    url: string;
}

export default function RecordingsPage() {
    const [recordings, setRecordings] = useState<Recording[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedRecording, setSelectedRecording] = useState<Recording | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);

    const fetchRecordings = async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await fetch('/api/livekit/recordings');
            const data = await response.json();

            if (response.ok) {
                setRecordings(data.recordings || []);
            } else {
                setError(data.error || 'Failed to load recordings');
            }
        } catch (err: any) {
            setError(err.message || 'Failed to load recordings');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchRecordings();
    }, []);

    const handleDelete = async (recording: Recording) => {
        if (!confirm(`Delete recording "${recording.roomName}"? This cannot be undone.`)) {
            return;
        }

        try {
            setDeleting(recording.id);
            const response = await fetch(`/api/livekit/recordings?filename=${recording.filename}`, {
                method: 'DELETE',
            });

            if (response.ok) {
                setRecordings(prev => prev.filter(r => r.id !== recording.id));
                if (selectedRecording?.id === recording.id) {
                    setSelectedRecording(null);
                }
            } else {
                const data = await response.json();
                alert(data.error || 'Failed to delete recording');
            }
        } catch (err: any) {
            alert(err.message || 'Failed to delete recording');
        } finally {
            setDeleting(null);
        }
    };

    const handleDownload = (recording: Recording) => {
        const link = document.createElement('a');
        link.href = recording.url;
        link.download = recording.filename;
        link.click();
    };

    const formatDuration = (seconds?: number) => {
        if (!seconds) return '--:--';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const formatSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    return (
        <div className="min-h-screen bg-[var(--ff-bg-tertiary)]">
            {/* Header */}
            <header className="bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)] px-6 py-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link
                            href="/meetings"
                            className="flex items-center gap-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
                        >
                            <ChevronLeft className="w-5 h-5" />
                            Back to Meetings
                        </Link>
                        <div className="h-6 w-px bg-[var(--ff-border-light)]" />
                        <h1 className="text-xl font-semibold text-[var(--ff-text-primary)] flex items-center gap-2">
                            <Video className="w-6 h-6 text-blue-600" />
                            Recordings
                        </h1>
                    </div>
                    <button
                        onClick={fetchRecordings}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-bg-hover)] rounded-lg text-[var(--ff-text-primary)] transition-colors"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                </div>
            </header>

            <div className="max-w-7xl mx-auto px-6 py-8">
                {/* Error State */}
                {error && (
                    <div className="bg-red-500/20 border border-red-500/50 text-red-400 px-4 py-3 rounded-lg mb-6">
                        {error}
                    </div>
                )}

                {/* Loading State */}
                {loading && (
                    <div className="flex items-center justify-center py-12">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    </div>
                )}

                {/* Empty State */}
                {!loading && recordings.length === 0 && (
                    <div className="text-center py-12 bg-[var(--ff-bg-secondary)] rounded-xl border border-[var(--ff-border-light)]">
                        <Video className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-2">No recordings yet</h3>
                        <p className="text-[var(--ff-text-secondary)] mb-4">Start a meeting and click "Start Recording" to create your first recording.</p>
                        <Link
                            href="/meetings"
                            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                        >
                            Go to Meetings
                        </Link>
                    </div>
                )}

                {/* Recordings Grid */}
                {!loading && recordings.length > 0 && (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {recordings.map((recording) => (
                            <div
                                key={recording.id}
                                className="bg-[var(--ff-bg-secondary)] rounded-xl border border-[var(--ff-border-light)] overflow-hidden hover:shadow-lg transition-shadow"
                            >
                                {/* Video Preview */}
                                <div
                                    className="relative aspect-video bg-gray-900 cursor-pointer group"
                                    onClick={() => setSelectedRecording(recording)}
                                >
                                    <video
                                        src={recording.url}
                                        className="w-full h-full object-cover"
                                        preload="metadata"
                                    />
                                    <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                        <div className="w-16 h-16 bg-white/90 rounded-full flex items-center justify-center">
                                            <Play className="w-8 h-8 text-gray-900 ml-1" />
                                        </div>
                                    </div>
                                    {recording.duration && (
                                        <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                                            {formatDuration(recording.duration)}
                                        </div>
                                    )}
                                </div>

                                {/* Info */}
                                <div className="p-4">
                                    <h3 className="font-medium text-[var(--ff-text-primary)] truncate mb-2">
                                        {recording.roomName}
                                    </h3>
                                    <div className="flex flex-wrap gap-3 text-sm text-[var(--ff-text-secondary)] mb-4">
                                        <span className="flex items-center gap-1">
                                            <Calendar className="w-4 h-4" />
                                            {formatDate(recording.createdAt)}
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <HardDrive className="w-4 h-4" />
                                            {formatSize(recording.size)}
                                        </span>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setSelectedRecording(recording)}
                                            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                                        >
                                            <Play className="w-4 h-4" />
                                            Play
                                        </button>
                                        <button
                                            onClick={() => handleDownload(recording)}
                                            className="px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] rounded-lg hover:bg-[var(--ff-bg-hover)] transition-colors"
                                            title="Download"
                                        >
                                            <Download className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(recording)}
                                            disabled={deleting === recording.id}
                                            className="px-3 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors disabled:opacity-50"
                                            title="Delete"
                                        >
                                            {deleting === recording.id ? (
                                                <RefreshCw className="w-4 h-4 animate-spin" />
                                            ) : (
                                                <Trash2 className="w-4 h-4" />
                                            )}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Video Player Modal */}
                {selectedRecording && (
                    <div
                        className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
                        onClick={() => setSelectedRecording(null)}
                    >
                        <div
                            className="bg-[var(--ff-bg-secondary)] rounded-xl overflow-hidden max-w-4xl w-full max-h-[90vh] flex flex-col"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Modal Header */}
                            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--ff-border-light)]">
                                <h3 className="font-medium text-[var(--ff-text-primary)]">
                                    {selectedRecording.roomName}
                                </h3>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handleDownload(selectedRecording)}
                                        className="flex items-center gap-2 px-3 py-1.5 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] rounded-lg hover:bg-[var(--ff-bg-hover)] transition-colors text-sm"
                                    >
                                        <Download className="w-4 h-4" />
                                        Download
                                    </button>
                                    <button
                                        onClick={() => setSelectedRecording(null)}
                                        className="p-1.5 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] rounded-lg hover:bg-[var(--ff-bg-hover)]"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>

                            {/* Video Player */}
                            <div className="flex-1 bg-black">
                                <video
                                    ref={videoRef}
                                    src={selectedRecording.url}
                                    className="w-full h-full max-h-[70vh]"
                                    controls
                                    autoPlay
                                />
                            </div>

                            {/* Modal Footer */}
                            <div className="px-4 py-3 border-t border-[var(--ff-border-light)] flex items-center justify-between text-sm text-[var(--ff-text-secondary)]">
                                <span className="flex items-center gap-1">
                                    <Calendar className="w-4 h-4" />
                                    {formatDate(selectedRecording.createdAt)}
                                </span>
                                <span className="flex items-center gap-4">
                                    {selectedRecording.duration && (
                                        <span className="flex items-center gap-1">
                                            <Clock className="w-4 h-4" />
                                            {formatDuration(selectedRecording.duration)}
                                        </span>
                                    )}
                                    <span className="flex items-center gap-1">
                                        <HardDrive className="w-4 h-4" />
                                        {formatSize(selectedRecording.size)}
                                    </span>
                                </span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
