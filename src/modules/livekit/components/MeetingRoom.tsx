// LiveKit Meeting Room Component
// Video conference UI using @livekit/components-react

'use client';

import { useState } from 'react';
import {
    LiveKitRoom,
    VideoConference,
    RoomAudioRenderer,
    useParticipants,
} from '@livekit/components-react';
import '@livekit/components-styles';
import {
    Users,
    Circle,
    Square,
    Link2,
    Share2,
    Check,
} from 'lucide-react';
import { log } from '@/lib/logger';

interface MeetingRoomProps {
    roomName: string;
    token: string;
    serverUrl: string;
    onDisconnect?: () => void;
}

export function MeetingRoom({ roomName, token, serverUrl, onDisconnect }: MeetingRoomProps) {
    const [isRecording, setIsRecording] = useState(false);
    const [egressId, setEgressId] = useState<string | null>(null);
    const [recordingError, setRecordingError] = useState<string | null>(null);
    const [showInviteModal, setShowInviteModal] = useState(false);
    const [copied, setCopied] = useState(false);

    // Get the meeting URL
    const getMeetingUrl = () => {
        if (typeof window !== 'undefined') {
            return window.location.href;
        }
        return '';
    };

    const handleCopyLink = async () => {
        const url = getMeetingUrl();
        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (error) {
            log.error('MeetingRoom', { action: 'copyLink', error });
        }
    };

    const handleShare = async () => {
        const url = getMeetingUrl();
        if (navigator.share) {
            try {
                await navigator.share({
                    title: `Join my FibreFlow meeting`,
                    text: `Join my video meeting: ${roomName}`,
                    url: url,
                });
            } catch (error) {
                // User cancelled or share failed
                log.debug('MeetingRoom', { action: 'share', message: 'Share cancelled or failed' });
            }
        } else {
            // Fallback: show modal with copy option
            setShowInviteModal(true);
        }
    };

    const handleStartRecording = async () => {
        try {
            setRecordingError(null);
            const response = await fetch('/api/livekit/recording', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomName, action: 'start' }),
            });
            const data = await response.json();

            if (data.success) {
                setIsRecording(true);
                setEgressId(data.egressId);
            } else {
                setRecordingError(data.error);
            }
        } catch (error: unknown) {
            setRecordingError(error instanceof Error ? error.message : String(error));
        }
    };

    const handleStopRecording = async () => {
        if (!egressId) return;

        try {
            setRecordingError(null);
            const response = await fetch('/api/livekit/recording', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomName, action: 'stop', egressId }),
            });
            const data = await response.json();

            if (data.success) {
                setIsRecording(false);
                setEgressId(null);
            } else {
                setRecordingError(data.error);
            }
        } catch (error: unknown) {
            setRecordingError(error instanceof Error ? error.message : String(error));
        }
    };

    return (
        <div className="h-screen w-full bg-[var(--ff-bg-primary)]">
            <LiveKitRoom
                token={token}
                serverUrl={serverUrl}
                connect={true}
                onDisconnected={onDisconnect}
                data-lk-theme="default"
                style={{ height: '100%' }}
            >
                {/* Main video area */}
                <div className="flex flex-col h-full">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-2 bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)]">
                        <div className="flex items-center gap-3">
                            <h2 className="text-white font-semibold">{roomName}</h2>
                            {isRecording && (
                                <span className="flex items-center gap-1 text-red-500 text-sm animate-pulse">
                                    <Circle className="w-3 h-3 fill-current" />
                                    Recording
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            {/* Invite Button */}
                            <button
                                onClick={handleShare}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-green-600 hover:bg-green-700 text-white transition-colors"
                            >
                                <Share2 className="w-4 h-4" />
                                Invite
                            </button>
                            {/* Copy Link Button */}
                            <button
                                onClick={handleCopyLink}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${copied
                                        ? 'bg-green-600 text-white'
                                        : 'bg-[var(--ff-bg-hover)] hover:bg-[var(--ff-bg-tertiary)] text-white'
                                    }`}
                            >
                                {copied ? (
                                    <>
                                        <Check className="w-4 h-4" />
                                        Copied!
                                    </>
                                ) : (
                                    <>
                                        <Link2 className="w-4 h-4" />
                                        Copy Link
                                    </>
                                )}
                            </button>
                            {/* Recording Button */}
                            <button
                                onClick={isRecording ? handleStopRecording : handleStartRecording}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${isRecording
                                    ? 'bg-red-600 hover:bg-red-700 text-white'
                                    : 'bg-[var(--ff-bg-hover)] hover:bg-[var(--ff-bg-tertiary)] text-white'
                                    }`}
                            >
                                {isRecording ? (
                                    <>
                                        <Square className="w-4 h-4" />
                                        Stop Recording
                                    </>
                                ) : (
                                    <>
                                        <Circle className="w-4 h-4 text-red-500" />
                                        Start Recording
                                    </>
                                )}
                            </button>
                            <ParticipantCount />
                        </div>
                    </div>

                    {/* Video conference */}
                    <div className="flex-1 relative">
                        <VideoConference />
                    </div>

                    {/* Recording error */}
                    {recordingError && (
                        <div className="absolute top-16 left-1/2 transform -translate-x-1/2 bg-red-600 text-white px-4 py-2 rounded-lg text-sm">
                            {recordingError}
                        </div>
                    )}

                    {/* Audio renderer */}
                    <RoomAudioRenderer />
                </div>
            </LiveKitRoom>

            {/* Invite Modal (fallback for browsers without Web Share API) */}
            {showInviteModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-[var(--ff-bg-secondary)] rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
                        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Invite to Meeting</h3>
                        <p className="text-[var(--ff-text-secondary)] mb-4">Share this link with others to invite them to the meeting:</p>
                        <div className="flex items-center gap-2 mb-4">
                            <input
                                type="text"
                                readOnly
                                value={getMeetingUrl()}
                                className="flex-1 px-3 py-2 border border-[var(--ff-border-light)] rounded-lg text-sm bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]"
                            />
                            <button
                                onClick={handleCopyLink}
                                className={`px-4 py-2 rounded-lg font-medium transition-colors ${copied
                                        ? 'bg-green-600 text-white'
                                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                                    }`}
                            >
                                {copied ? 'Copied!' : 'Copy'}
                            </button>
                        </div>
                        <button
                            onClick={() => setShowInviteModal(false)}
                            className="w-full py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] text-sm"
                        >
                            Close
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// Participant count component
function ParticipantCount() {
    const participants = useParticipants();

    return (
        <div className="flex items-center gap-1 text-[var(--ff-text-tertiary)] text-sm">
            <Users className="w-4 h-4" />
            <span>{participants.length}</span>
        </div>
    );
}

export default MeetingRoom;
