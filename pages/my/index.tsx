/**
 * /my — login screen.
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
 * "First time?" on this screen deep-links into the OTP onboarding page,
 * which uses /api/my/login/request-otp + verify-otp to set the PIN without
 * any admin-side bootstrapping.
 */

import React from 'react';
import { NextPage } from 'next';
import { useRouter } from 'next/router';
import Link from 'next/link';

import { ApiError, login } from '@/modules/attendance/portal/client/api';
import { useDeviceFingerprint } from '@/modules/attendance/portal/client/useDeviceFingerprint';
import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';

type Method = 'pin' | 'password';

const MyLoginPage: NextPage & { getLayout?: (page: React.ReactElement) => React.ReactElement } = () => {
  const router = useRouter();
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
      await router.push('/my/attendance');
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
    <MyPortalShell
      title="Sign in"
      showFooterNav={false}
      showHeader={false}
    >
      <div className="flex flex-col items-center pt-8 pb-6">
        <div className="w-20 h-20 rounded-2xl bg-white border border-gray-200 flex items-center justify-center shadow-lg p-2">
          <img
            src="/assets/vf/vf-logo.svg"
            alt="Velocity Fibre"
            className="w-full h-full object-contain"
          />
        </div>
        <h1 className="mt-4 text-2xl font-semibold">Velocity Fibre Attendance</h1>
        <p className="mt-1 text-sm text-gray-500">Clock in & out for your shift</p>
      </div>

      <div className="flex rounded-xl border border-gray-200 bg-white p-1 mb-5 shadow-sm">
        <button
          type="button"
          onClick={() => { setMethod('pin'); setCredential(''); setError(null); }}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
            method === 'pin' ? 'bg-blue-600 text-white' : 'text-gray-600'
          }`}
        >
          Phone + PIN
        </button>
        <button
          type="button"
          onClick={() => { setMethod('password'); setCredential(''); setError(null); }}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
            method === 'password' ? 'bg-blue-600 text-white' : 'text-gray-600'
          }`}
        >
          Email + password
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">
            {method === 'pin' ? 'Phone number' : 'Email address'}
          </span>
          <input
            type={method === 'pin' ? 'tel' : 'email'}
            autoComplete={method === 'pin' ? 'tel' : 'email'}
            inputMode={method === 'pin' ? 'tel' : 'email'}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder={method === 'pin' ? '082 123 4567' : 'you@company.co.za'}
            className="mt-1 w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none text-base"
            required
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-gray-700">
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
            className="mt-1 w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none text-base tracking-widest"
            required
          />
        </label>

        {error && (
          <div
            role="alert"
            className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800"
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-base shadow-sm"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      {method === 'pin' && (
        <div className="text-center mt-6">
          <Link
            href="/my/onboard"
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            First time? Set up your PIN
          </Link>
        </div>
      )}
    </MyPortalShell>
  );
};

// No AppLayout — full-screen portal.
MyLoginPage.getLayout = (page: React.ReactElement) => page;

export default MyLoginPage;
