/**
 * /my/onboard — first-time PIN setup via OTP-over-WhatsApp.
 *
 * Two-step form:
 *   1. Enter phone → POST /api/my/login/request-otp
 *      (always returns 200 regardless of whether the phone is registered;
 *       this UI must likewise never reveal that — success text is the same
 *       in both cases.)
 *   2. Enter OTP + chosen 6-digit PIN → POST /api/my/login/verify-otp
 *      → on success, a session cookie is issued and we redirect to
 *      /my/attendance.
 *
 * If verify-otp returns `sessionIssued: false` (rare — the PIN commit
 * succeeded but issueSession subsequently failed, see PR #1379 hardening),
 * we show a success message and send the user back to the login page so
 * they can sign in with the PIN they just set.
 */

import React from 'react';
import { NextPage } from 'next';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import {
  ApiError,
  requestOtp,
  verifyOtp,
} from '@/modules/attendance/portal/client/api';
import { useDeviceFingerprint } from '@/modules/attendance/portal/client/useDeviceFingerprint';
import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';

type Step = 'phone' | 'verify' | 'done_pin_only';

const MyOnboardPage: NextPage & { getLayout?: (page: React.ReactElement) => React.ReactElement } = () => {
  const router = useRouter();
  const deviceFingerprint = useDeviceFingerprint();

  const [step, setStep] = React.useState<Step>('phone');
  const [phone, setPhone] = React.useState('');
  const [otp, setOtp] = React.useState('');
  const [newPin, setNewPin] = React.useState('');
  const [confirmPin, setConfirmPin] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<string | null>(null);

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setInfo(null);

    const trimmed = phone.trim();
    if (!trimmed) {
      setError('Enter your phone number');
      return;
    }

    setSubmitting(true);
    try {
      await requestOtp(trimmed);
      setStep('verify');
      setInfo('If your phone is registered, you will receive a 6-digit code on WhatsApp.');
    } catch (err) {
      // request-otp is designed to always 200 from the server; any non-OK
      // response is plumbing. Deliberately do NOT surface `err.message` —
      // that would forward whatever the server sent (rate-limit text, DB
      // error code, etc.) and partially re-open the enumeration oracle
      // PR #1374 closed. Keep it generic and route the user to a retry.
      if (err instanceof ApiError && err.code === 'NETWORK_ERROR') {
        setError('Could not reach the server. Check your connection.');
      } else {
        setError('Could not send the code. Please try again in a moment.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
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
      setError('Those PINs don\u2019t match. Try again.');
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
        await router.push('/my/attendance');
        return;
      }

      // Rare: PIN saved, session not issued. Send them to login with a note.
      setStep('done_pin_only');
      setInfo(null);
    } catch (err) {
      // Verify-otp returns unified 401 for all auth-fail paths (unknown
      // phone, bad OTP, expired, exhausted, locked). Mapping 401 to a
      // generic message here keeps the oracle closed; the server log has
      // the real reason for ops. Only distinguish network failures, which
      // are safe to surface because they are client-observable anyway.
      if (err instanceof ApiError && err.code === 'NETWORK_ERROR') {
        setError('Could not reach the server. Check your connection.');
      } else if (err instanceof ApiError && err.status === 400) {
        // 400 is user-fixable (malformed OTP/PIN) — the server's message
        // is safe here.
        setError(err.message);
      } else {
        setError('That code didn\u2019t match. Please try again or request a new code.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MyPortalShell title="Set up your PIN" showFooterNav={false} showHeader={false}>
      <div className="pt-6 pb-2">
        <Link
          href="/my"
          className="inline-flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to sign in
        </Link>
      </div>

      <div className="flex flex-col items-center mb-6">
        <div className="w-16 h-16 rounded-2xl bg-white border border-neutral-800 flex items-center justify-center shadow-lg p-2">
          <img
            src="/assets/vf/vf-logo.svg"
            alt="Velocity Fibre"
            className="w-full h-full object-contain"
          />
        </div>
        <h1 className="mt-3 text-2xl font-semibold text-neutral-100">Set up your PIN</h1>
        <p className="mt-1 text-sm text-neutral-400 text-center">
          {step === 'phone'
            ? 'We will send a 6-digit code to the phone we have on file.'
            : step === 'verify'
              ? 'Enter the code from WhatsApp and pick a 6-digit PIN you will remember.'
              : 'All set.'}
        </p>
      </div>

      {info && (
        <div className="rounded-lg bg-blue-950/50 border border-blue-800 px-3 py-2 text-sm text-blue-200 mb-4">
          {info}
        </div>
      )}

      {step === 'phone' && (
        <form onSubmit={handleRequestOtp} className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-neutral-300">Phone number</span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="082 123 4567"
              className="mt-1 w-full px-4 py-3 rounded-xl border border-neutral-700 bg-neutral-900 text-neutral-100 placeholder:text-neutral-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 outline-none text-base"
              required
            />
          </label>

          {error && (
            <div
              role="alert"
              className="rounded-lg bg-red-950/50 border border-red-800 px-3 py-2 text-sm text-red-200"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-base shadow-lg shadow-blue-600/20"
          >
            {submitting ? 'Sending code…' : 'Send verification code'}
          </button>
        </form>
      )}

      {step === 'verify' && (
        <form onSubmit={handleVerifyOtp} className="space-y-4">
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
              className="mt-1 w-full px-4 py-3 rounded-xl border border-neutral-700 bg-neutral-900 text-neutral-100 placeholder:text-neutral-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 outline-none text-base tracking-widest text-center"
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
              className="mt-1 w-full px-4 py-3 rounded-xl border border-neutral-700 bg-neutral-900 text-neutral-100 placeholder:text-neutral-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 outline-none text-base tracking-widest"
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
              className="mt-1 w-full px-4 py-3 rounded-xl border border-neutral-700 bg-neutral-900 text-neutral-100 placeholder:text-neutral-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 outline-none text-base tracking-widest"
              required
            />
          </label>

          {error && (
            <div
              role="alert"
              className="rounded-lg bg-red-950/50 border border-red-800 px-3 py-2 text-sm text-red-200"
            >
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
            onClick={() => { setStep('phone'); setOtp(''); setNewPin(''); setConfirmPin(''); }}
            className="w-full py-2 text-sm text-neutral-400 hover:text-neutral-200"
          >
            Use a different phone number
          </button>
        </form>
      )}

      {step === 'done_pin_only' && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-emerald-950/40 border border-emerald-800 p-5 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-900/60 text-emerald-300 flex items-center justify-center mb-3 text-2xl">
              ✓
            </div>
            <h2 className="text-lg font-semibold text-emerald-200">PIN saved</h2>
            <p className="mt-1 text-sm text-emerald-300">
              Your PIN is set up. Sign in with your phone number and new PIN.
            </p>
          </div>
          <Link
            href="/my"
            className="block text-center py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-lg shadow-blue-600/20"
          >
            Go to sign in
          </Link>
        </div>
      )}
    </MyPortalShell>
  );
};

MyOnboardPage.getLayout = (page: React.ReactElement) => page;

export default MyOnboardPage;
