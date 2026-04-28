/**
 * /my login screen.
 *
 * Two flows behind one form:
 *   - Phone + 6-digit PIN (field staff)
 *   - Email + password     (office staff clocking in via the same portal)
 *
 * Errors from the API surface are intentionally flat: the server returns a
 * single "Invalid credentials" message for unknown/wrong/locked/inactive
 * accounts (enumeration-oracle closure from PR #1374). We show that message
 * verbatim — no "account locked" hints, no "no such user". Staff who are
 * legitimately locked out will ask their supervisor.
 *
 * Extracted from pages/my/index.tsx in PR 2 of PRD-040 so /my can render
 * either this login screen (no session) or the hub tile grid (signed in)
 * from the same route.
 */

import React from 'react';
import Link from 'next/link';

import { ApiError, login } from './api';
import { useDeviceFingerprint } from './useDeviceFingerprint';
import { MyPortalShell } from './MyPortalShell';

type Method = 'pin' | 'password';

export function MyLoginScreen() {
  const deviceFingerprint = useDeviceFingerprint();

  const [method, setMethod] = React.useState<Method>('pin');
  const [identifier, setIdentifier] = React.useState('');
  const [credential, setCredential] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    const trimmedIdentifier = identifier.trim();
    if (!trimmedIdentifier || !credential) {
      setError(method === 'pin' ? 'Enter your phone number and PIN' : 'Enter your email and password');
      return;
    }
    if (method === 'pin' && !/^\d{6}$/.test(credential)) {
      setError('PIN must be exactly 6 digits');
      return;
    }

    setSubmitting(true);
    try {
      await login({
        method,
        identifier: trimmedIdentifier,
        credential,
        deviceFingerprint: deviceFingerprint ?? undefined,
      });
      // Hard navigate to /my so the page remounts and re-fetches the
      // session. router.replace('/my') is a no-op here (we're already
      // at /my), so React would never re-run the session-fetch effect
      // and the user would stay on the login screen.
      window.location.assign('/my');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || 'Invalid credentials');
      } else {
        setError('Something went wrong. Please try again.');
      }
      setSubmitting(false);
    }
  };

  return (
    <MyPortalShell title="Sign in" showFooterNav={false} showHeader={false}>
      <div className="flex flex-col items-center pt-8 pb-6">
        <div className="w-20 h-20 rounded-2xl bg-white border border-neutral-800 flex items-center justify-center shadow-lg p-2">
          <img
            src="/assets/vf/vf-logo.svg"
            alt="Velocity Fibre"
            className="w-full h-full object-contain"
          />
        </div>
        <h1 className="mt-4 text-2xl font-semibold text-neutral-100">Velocity Fibre Staff</h1>
        <p className="mt-1 text-sm text-neutral-400">Sign in to access your hub</p>
      </div>

      <div className="flex rounded-xl border border-neutral-800 bg-neutral-900 p-1 mb-5">
        <button
          type="button"
          onClick={() => { setMethod('pin'); setCredential(''); setError(null); }}
          className={`flex-1 min-h-[48px] py-2 text-sm font-medium rounded-lg transition-colors ${
            method === 'pin' ? 'bg-blue-600 text-white' : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          Phone + PIN
        </button>
        <button
          type="button"
          onClick={() => { setMethod('password'); setCredential(''); setError(null); }}
          className={`flex-1 min-h-[48px] py-2 text-sm font-medium rounded-lg transition-colors ${
            method === 'password' ? 'bg-blue-600 text-white' : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          Email + password
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-neutral-300">
            {method === 'pin' ? 'Phone number' : 'Email address'}
          </span>
          <input
            type={method === 'pin' ? 'tel' : 'email'}
            autoComplete={method === 'pin' ? 'tel' : 'email'}
            inputMode={method === 'pin' ? 'tel' : 'email'}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder={method === 'pin' ? '082 123 4567' : 'you@company.co.za'}
            className="mt-1 w-full px-4 py-3 rounded-xl border border-neutral-700 bg-neutral-900 text-neutral-100 placeholder:text-neutral-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 outline-none text-base"
            required
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-neutral-300">
            {method === 'pin' ? '6-digit PIN' : 'Password'}
          </span>
          <input
            type="password"
            autoComplete={method === 'pin' ? 'one-time-code' : 'current-password'}
            inputMode={method === 'pin' ? 'numeric' : 'text'}
            maxLength={method === 'pin' ? 6 : undefined}
            pattern={method === 'pin' ? '\\d{6}' : undefined}
            value={credential}
            onChange={(e) => setCredential(e.target.value)}
            placeholder={method === 'pin' ? '••••••' : '••••••••'}
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
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      {/*
        Onboarding link is shown on BOTH tabs. New staff often try the email
        tab with their main FibreFlow password, hit the unified "Invalid
        credentials" error (no enumeration oracle, by design), and have no
        idea credentials must be created via the PIN/OTP flow first. The
        link is the only first-time path — the verify-otp endpoint is what
        creates the row in attendance_credentials. Phrasing differs per tab
        because office staff thinking in "email + password" terms shouldn't
        be told to "set up a PIN" when the underlying truth is "set up your
        portal sign-in for the first time".
      */}
      <div className="text-center mt-4">
        <Link
          href="/my/onboard"
          className="inline-flex items-center justify-center min-h-[48px] px-3 text-sm font-medium text-blue-400 hover:text-blue-300"
        >
          {method === 'pin'
            ? 'First time? Set up your PIN'
            : "First time? You'll need to set up your account via WhatsApp first"}
        </Link>
      </div>
    </MyPortalShell>
  );
}
