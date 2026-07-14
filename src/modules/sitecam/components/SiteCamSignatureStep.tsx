import { useState } from 'react';
import { Loader2, PenTool } from 'lucide-react';
import { SignaturePad } from '@/modules/field-stock-pwa/components/SignaturePad';
import { log } from '@/lib/logger';
import { SIGNOFF_CONSENT_TEXT, canSubmitSignoff } from '../lib/signoff';
import { buildSignoffImage } from '../lib/buildSignoffImage';

const MODULE = 'SiteCamSignatureStep';

interface Props {
  /**
   * Called with the composited sign-off image (name + consent + signature).
   * Flows through the wizard's normal capture pipeline as this step's photo.
   */
  onSigned: (file: File) => void;
}

/**
 * Customer sign-off for SiteCam step 10 — the customer types their name, ticks
 * the consent box, and signs on-screen. On confirm the three are composited
 * into one image and handed to `onSigned`.
 */
export function SiteCamSignatureStep({ onSigned }: Props) {
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canConfirm = canSubmitSignoff({ name, consent, signatureDataUrl }) && !building;

  const handleConfirm = async () => {
    if (!signatureDataUrl) return;
    setBuilding(true);
    setError(null);
    try {
      const file = await buildSignoffImage({
        name,
        consentText: SIGNOFF_CONSENT_TEXT,
        signatureDataUrl,
      });
      onSigned(file);
    } catch (err) {
      log.error('Build sign-off image failed', { err: String(err) }, MODULE);
      setError('Could not save the signature. Please try again.');
      setBuilding(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="signoff-name" className="mb-1 block text-sm font-medium text-neutral-300">
          Customer name
        </label>
        <input
          id="signoff-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          placeholder="Full name of the person signing"
          className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-sky-500 focus:outline-none"
        />
      </div>

      <SignaturePad
        value={signatureDataUrl}
        onChange={setSignatureDataUrl}
        label="Customer signature"
        hint="Ask the customer to sign above"
      />

      <label className="flex items-start gap-2.5 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-3">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-sky-600"
        />
        <span className="text-sm text-neutral-300">{SIGNOFF_CONSENT_TEXT}</span>
      </label>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/50 px-3 py-2.5 text-sm text-red-300">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={() => void handleConfirm()}
        disabled={!canConfirm}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 py-3 text-sm font-semibold text-white hover:bg-sky-500 active:bg-sky-700 disabled:opacity-50"
      >
        {building ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            Saving…
          </>
        ) : (
          <>
            <PenTool className="h-5 w-5" />
            Confirm sign-off
          </>
        )}
      </button>
    </div>
  );
}
