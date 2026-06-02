import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useRouter } from 'next/router';
import { MapPin } from 'lucide-react';
import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import type { AttendanceProfile } from '@/modules/attendance/portal/client/api';
import { log } from '@/lib/logger';
import type { SiteInfo } from '../hooks/useSiteCamCapture';

const MODULE = 'SiteCamEntry';

interface Props {
  profile: AttendanceProfile;
}

export function SiteCamEntry({ profile }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [siteInfo, setSiteInfo] = useState<SiteInfo | null>(null);

  const handleFind = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    setSiteInfo(null);

    try {
      const res = await fetch(`/api/sitecam/site/${encodeURIComponent(trimmed)}`, {
        credentials: 'include',
      });

      if (res.status === 404) {
        setError('No site found for that DR / pole number.');
        return;
      }

      if (!res.ok) {
        setError('Something went wrong. Please try again.');
        log.error('Site lookup failed', { status: res.status }, MODULE);
        return;
      }

      const json = (await res.json()) as { data: SiteInfo };
      setSiteInfo(json.data);
    } catch (err) {
      setError('Could not reach the server. Check your connection.');
      log.error('Site lookup network error', { err: String(err) }, MODULE);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void handleFind();
  };

  const handleStart = () => {
    if (!siteInfo) return;
    void router.push('/my/sitecam/' + encodeURIComponent(siteInfo.siteId));
  };

  return (
    <MyPortalShell
      title="SiteCam"
      staffName={profile.name}
      staffPhotoUrl={profile.profilePhotoUrl}
      showFooterNav={false}
    >
      <div className="space-y-6 pt-2">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">Find a Site</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Enter the DR number or pole number to begin capture.
          </p>
        </div>

        {/* Search input */}
        <div className="space-y-2">
          <label htmlFor="site-query" className="text-sm font-medium text-neutral-300">
            DR / Pole Number
          </label>
          <div className="flex gap-2">
            <input
              id="site-query"
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              placeholder="e.g. DR-12345"
              className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 text-neutral-100 placeholder-neutral-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
            <button
              type="button"
              onClick={() => void handleFind()}
              disabled={loading || !query.trim()}
              className="rounded-lg bg-sky-600 px-5 py-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50 active:bg-sky-700"
            >
              {loading ? 'Finding…' : 'Find'}
            </button>
          </div>
        </div>

        {/* Error state */}
        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Site confirmation card */}
        {siteInfo && (
          <div className="rounded-xl border border-neutral-700 bg-neutral-900 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800">
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  siteInfo.jobType === 'activations'
                    ? 'bg-sky-900/60 text-sky-300'
                    : 'bg-amber-900/60 text-amber-300'
                }`}
              >
                {siteInfo.jobType === 'activations' ? 'Activation' : 'Civil'}
              </span>
              <span className="text-sm font-mono font-medium text-neutral-200">
                {siteInfo.siteId}
              </span>
            </div>

            <div className="px-4 py-3 space-y-2">
              {siteInfo.customerName && (
                <div className="text-sm font-medium text-neutral-100">
                  {siteInfo.customerName}
                </div>
              )}
              {siteInfo.address && (
                <div className="flex items-start gap-2 text-sm text-neutral-400">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" />
                  <span>{siteInfo.address}</span>
                </div>
              )}
              {siteInfo.projectName && (
                <div className="text-xs text-neutral-500">{siteInfo.projectName}</div>
              )}
            </div>

            <div className="px-4 pb-4">
              <button
                type="button"
                onClick={handleStart}
                className="w-full rounded-lg bg-sky-600 py-3 text-sm font-semibold text-white hover:bg-sky-500 active:bg-sky-700"
              >
                Start Capture
              </button>
            </div>
          </div>
        )}
      </div>
    </MyPortalShell>
  );
}
