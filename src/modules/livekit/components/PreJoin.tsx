// Pre-join screen for LiveKit meetings
// Allows users to preview camera/mic before joining

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
    Video,
    VideoOff,
    Mic,
    MicOff,
    PhoneCall,
} from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';

interface PreJoinProps {
    roomName: string;
    onJoin: (token: string) => void;
}

export function PreJoin({ roomName, onJoin }: PreJoinProps) {
    const [name, setName] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [videoEnabled, setVideoEnabled] = useState(true);
    const [audioEnabled, setAudioEnabled] = useState(true);
    const [videoStream, setVideoStream] = useState<MediaStream | null>(null);

    // Request camera access for preview
    useEffect(() => {
        if (videoEnabled) {
            navigator.mediaDevices
                .getUserMedia({ video: true, audio: false })
                .then(setVideoStream)
                .catch(() => setVideoEnabled(false));
        } else {
            if (videoStream) {
                videoStream.getTracks().forEach(track => track.stop());
                setVideoStream(null);
            }
        }

        return () => {
            if (videoStream) {
                videoStream.getTracks().forEach(track => track.stop());
            }
        };
    }, [videoEnabled]);

    const handleJoin = async () => {
        if (!name.trim()) {
            setError('Please enter your name');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const response = await fetch('/api/livekit/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    roomName,
                    participantName: name,
                }),
            });

            const data = await response.json();

            if (data.success && data.token) {
                // Stop preview stream before joining
                if (videoStream) {
                    videoStream.getTracks().forEach(track => track.stop());
                }
                onJoin(data.token);
            } else {
                setError(data.error || 'Failed to join meeting');
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[var(--ff-bg-primary)] flex items-center justify-center p-4">
            <div className="bg-[var(--ff-bg-secondary)] rounded-2xl p-8 max-w-md w-full shadow-2xl">
                <h1 className="text-2xl font-bold text-white text-center mb-2">
                    Join Meeting
                </h1>
                <p className="text-[var(--ff-text-tertiary)] text-center mb-6">
                    Room: {roomName}
                </p>

                {/* Video preview */}
                <div className="relative aspect-video bg-[var(--ff-bg-tertiary)] rounded-xl mb-6 overflow-hidden">
                    {videoStream ? (
                        <video
                            autoPlay
                            muted
                            playsInline
                            className="w-full h-full object-cover"
                            ref={(el) => {
                                if (el) el.srcObject = videoStream;
                            }}
                        />
                    ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <VideoOff className="w-12 h-12 text-[var(--ff-text-tertiary)]" />
                        </div>
                    )}

                    {/* Media controls */}
                    <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex gap-2">
                        <button
                            onClick={() => setVideoEnabled(!videoEnabled)}
                            className={`p-3 rounded-full transition-colors ${videoEnabled
                                    ? 'bg-[var(--ff-bg-hover)] hover:bg-[var(--ff-bg-tertiary)] text-white'
                                    : 'bg-red-600 hover:bg-red-500 text-white'
                                }`}
                        >
                            {videoEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
                        </button>
                        <button
                            onClick={() => setAudioEnabled(!audioEnabled)}
                            className={`p-3 rounded-full transition-colors ${audioEnabled
                                    ? 'bg-[var(--ff-bg-hover)] hover:bg-[var(--ff-bg-tertiary)] text-white'
                                    : 'bg-red-600 hover:bg-red-500 text-white'
                                }`}
                        >
                            {audioEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                        </button>
                    </div>
                </div>

                {/* Name input */}
                <div className="mb-6">
                    <label className="block text-[var(--ff-text-secondary)] text-sm font-medium mb-2">
                        Your Name
                    </label>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Enter your name"
                        className="w-full px-4 py-3 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-white placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                    />
                </div>

                {/* Error message */}
                {error && (
                    <div className="mb-4 p-3 bg-red-500/20 border border-red-500 rounded-lg text-red-400 text-sm">
                        {error}
                    </div>
                )}

                {/* Join button */}
                <button
                    onClick={handleJoin}
                    disabled={isLoading}
                    className="w-full py-3 bg-green-600 hover:bg-green-500 disabled:bg-[var(--ff-bg-tertiary)] disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                    {isLoading ? (
                        <>
                            <InlineSpinner size="sm" />
                            Joining...
                        </>
                    ) : (
                        <>
                            <PhoneCall className="w-5 h-5" />
                            Join Meeting
                        </>
                    )}
                </button>
            </div>
        </div>
    );
}

export default PreJoin;
