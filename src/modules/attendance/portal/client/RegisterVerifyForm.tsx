/**
 * Step-2 OTP + PIN verify form for /my/register — extracted from pages/my/register.tsx
 * to keep the page component under 200 lines.
 */
import React from 'react';

import { ApiError, verifyOtp } from '@/modules/attendance/portal/client/api';
import { useDeviceFingerprint } from '@/modules/attendance/portal/client/useDeviceFingerprint';

interface Props {
  phone: string;
  onSuccess: () => void;
  onPinOnly: () => void;
  onBack: () => void;
}

export function RegisterVerifyForm({ phone, onSuccess, onPinOnly, onBack }: Props) {
  const deviceFingerprint = useDeviceFingerprint();
  const [otp, setOtp] = React.useState('');
  const [newPin, setNewPin] = React.useState('');
  const [confirmPin, setConfirmPin] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (!/^\d{6}$/.test(otp)) {
      setError('Enter the 6-digit code from WhatsApp');
      return;
    }
    if (!/^\d{6}$/.test(newPin)) {
      setError('PIN must be exactly 6 digits');
      return;
    }
    if (newPin !== confirmPin) {
      setError('Those PINs don’t match. Try again.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await verifyOtp({
        phone: phone.trim(),
        otp,
        newPin,
        deviceFingerprint: deviceFingerprint ?? undefined,
      });

      if (result.sessionIssued) {
        onSuccess();
        return;
      }
      onPinOnly();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NETWORK_ERROR') {
        setError('Could not reach the server. Check your connection.');
      } else if (err instanceof ApiError && err.status === 400) {
        setError(err.message);
      } else {
        setError('That code didn’t match. Please try again or request a new code.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'mt-1 w-full px-4 py-3 rounded-xl border border-neutral-700 bg-neutral-900 text-neutral-100 placeholder:text-neutral-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 outline-none text-base';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium text-neutral-300">Verification code</span>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          pattern="\d{6}"
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="123456"
          className={`${inputClass} tracking-widest text-center`}
          required
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-neutral-300">Create a 6-digit PIN</span>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={6}
          pattern="\d{6}"
          value={newPin}
          onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          className={`${inputClass} tracking-widest`}
          required
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-neutral-300">Confirm PIN</span>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={6}
          pattern="\d{6}"
          value={confirmPin}
          onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          className={`${inputClass} tracking-widest`}
          required
        />
      </label>

      {error && (
        <div role="alert" className="rounded-lg bg-red-950/50 border border-red-800 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-base shadow-lg shadow-blue-600/20"
      >
        {submitting ? 'Verifying…' : 'Set PIN & sign in'}
      </button>

      <button
        type="button"
        onClick={() => { onBack(); }}
        className="w-full py-2 text-sm text-neutral-400 hover:text-neutral-200"
      >
        Go back and edit details
      </button>
    </form>
  );
}
