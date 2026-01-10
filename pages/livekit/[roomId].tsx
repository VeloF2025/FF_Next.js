// LiveKit Meeting Page
// Dynamic route for joining a specific meeting room

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';

// Dynamic import to avoid SSR issues with LiveKit
const MeetingRoom = dynamic(
    () => import('@/modules/livekit/components/MeetingRoom'),
    { ssr: false }
);

const PreJoin = dynamic(
    () => import('@/modules/livekit/components/PreJoin'),
    { ssr: false }
);

export default function LiveKitMeetingPage() {
    const router = useRouter();
    const { roomId } = router.query;
    const [token, setToken] = useState<string | null>(null);
    const [serverUrl, setServerUrl] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        // Get server URL from environment
        fetch('/api/livekit/config')
            .then(res => res.json())
            .then(data => {
                setServerUrl(data.serverUrl);
                setIsLoading(false);
            })
            .catch(() => {
                // Fallback - will need to be configured
                setServerUrl(process.env.NEXT_PUBLIC_LIVEKIT_URL || '');
                setIsLoading(false);
            });
    }, []);

    const handleJoin = (newToken: string) => {
        setToken(newToken);
    };

    const handleDisconnect = () => {
        setToken(null);
        router.push('/meetings');
    };

    if (!roomId || typeof roomId !== 'string') {
        return (
            <div className="min-h-screen bg-[var(--ff-bg-primary)] flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-[var(--ff-text-primary)] animate-spin" />
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="min-h-screen bg-[var(--ff-bg-primary)] flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="w-8 h-8 text-[var(--ff-text-primary)] animate-spin mx-auto mb-4" />
                    <p className="text-[var(--ff-text-secondary)]">Loading meeting...</p>
                </div>
            </div>
        );
    }

    // Show pre-join screen if no token yet
    if (!token) {
        return <PreJoin roomName={roomId} onJoin={handleJoin} />;
    }

    // Show meeting room
    return (
        <MeetingRoom
            roomName={roomId}
            token={token}
            serverUrl={serverUrl}
            onDisconnect={handleDisconnect}
        />
    );
}

// Prevent static generation
export const getServerSideProps = async () => {
    return { props: {} };
};
