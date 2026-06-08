import { useState } from 'react';
import { X, Send } from 'lucide-react';
import { log } from '@/lib/logger';

const MODULE = 'AppealModal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmitted: (appealId: string) => void;
  drNumber: string;
  stepNumber: number;
  stepLabel: string;
  photoUrl: string | null;
  serialScanned?: string;
  serialExpected?: string;
  attemptNumber: number;
}

export function AppealModal({
  isOpen, onClose, onSubmitted,
  drNumber, stepNumber, stepLabel,
  photoUrl, serialScanned, serialExpected, attemptNumber,
}: Props) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleSubmit() {
    if (!text.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const photo = photoUrl?.startsWith('data:') ? photoUrl : `data:image/jpeg;base64,${photoUrl}`;
      const res = await fetch('/api/my/sitecam/appeal', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          drNumber,
          stepNumber,
          appealText: text.trim(),
          photoUrl: photo,
          serialScanned,
          serialExpected,
          attemptNumber,
        }),
      });
      const json = (await res.json()) as { data?: { appealId: string }; error?: string };
      if (!res.ok || !json.data?.appealId) {
        setError(json.error ?? 'Failed to submit appeal');
        return;
      }
      onSubmitted(json.data.appealId);
      setText('');
      onClose();
    } catch (err) {
      log.error('Appeal submit failed', { err: String(err) }, MODULE);
      setError('Network error — please try again');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 pb-6">
      <div className="w-full max-w-lg rounded-2xl border border-neutral-700 bg-neutral-900 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-neutral-100">
            Appeal Step {stepNumber}: {stepLabel}
          </h3>
          <button type="button" onClick={onClose} className="text-neutral-500 hover:text-neutral-300">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-xs text-neutral-500">
          Explain why this photo is correct. Your photo will be attached automatically.
        </p>

        {photoUrl && (
          <img
            src={photoUrl.startsWith('data:') ? photoUrl : `data:image/jpeg;base64,${photoUrl}`}
            alt="Step photo"
            className="h-36 w-full rounded-lg object-cover border border-neutral-700"
          />
        )}

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Describe why the photo is correct…"
          rows={3}
          className="w-full rounded-xl border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-sky-500"
        />

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-neutral-700 py-3 text-sm text-neutral-400 hover:bg-neutral-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!text.trim() || submitting}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-sky-600 py-3 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50 transition-colors"
          >
            <Send className="h-4 w-4" />
            {submitting ? 'Sending…' : 'Send Appeal'}
          </button>
        </div>
      </div>
    </div>
  );
}
