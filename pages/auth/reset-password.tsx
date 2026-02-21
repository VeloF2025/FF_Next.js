/**
 * Reset Password Page
 * Premium-styled page matching sign-in UI/UX
 * Validates token and allows user to set new password
 */

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { Lock, ArrowLeft, CheckCircle, AlertCircle } from 'lucide-react';
import { FiberBackground, BrandHeader, QuoteDisplay } from '@/components/auth/premium';
import { GlassCard } from '@/components/ui/GlassCard';
import { VelocityInput } from '@/components/ui/VelocityInput';
import { VelocityButton } from '@/components/ui/VelocityButton';
import { getRandomQuote, MotivationalQuote } from '@/data/motivational-quotes';

type PageState = 'loading' | 'form' | 'success' | 'error';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [pageState, setPageState] = useState<PageState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<MotivationalQuote | null>(null);
  const [mounted, setMounted] = useState(false);

  // Get token and email from URL
  const token = router.query.token as string | undefined;
  const email = router.query.email as string | undefined;

  // Initialize quote on mount
  useEffect(() => {
    setMounted(true);
    setQuote(getRandomQuote());
  }, []);

  // Validate that we have required params
  useEffect(() => {
    if (!router.isReady) return;

    if (!token || !email) {
      setPageState('error');
      setError('Invalid reset link. Please request a new password reset.');
    } else {
      setPageState('form');
    }
  }, [router.isReady, token, email]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Client-side validation
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          email,
          password,
          confirmPassword,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error?.message || 'Failed to reset password');
        return;
      }

      // Success!
      setPageState('success');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const renderForm = () => (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
        <p className="text-sm text-blue-200">
          <CheckCircle className="w-4 h-4 inline mr-1" aria-hidden="true" />
          Create a new password for your account
        </p>
      </div>

      <div>
        <label htmlFor="reset-new-password" className="block text-sm font-medium text-slate-300 mb-2">
          New Password
        </label>
        <VelocityInput
          id="reset-new-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          variant="neon-green"
          icon={<Lock className="w-5 h-5" />}
          iconPosition="left"
          showPasswordReveal
          placeholder="Create a strong password"
          autoComplete="new-password"
          disabled={loading}
          disableFloating
        />
        {/* text-slate-400 (7:1) — text-slate-500 would fail WCAG 1.4.3 on dark bg */}
        <p className="mt-1 text-xs text-slate-400">
          Min 8 characters with uppercase, lowercase, number, and special character
        </p>
      </div>

      <div>
        <label htmlFor="reset-confirm-password" className="block text-sm font-medium text-slate-300 mb-2">
          Confirm Password
        </label>
        <VelocityInput
          id="reset-confirm-password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          variant="neon-green"
          icon={<Lock className="w-5 h-5" />}
          iconPosition="left"
          showPasswordReveal
          placeholder="Confirm your password"
          autoComplete="new-password"
          disabled={loading}
          disableFloating
        />
      </div>

      <VelocityButton
        type="submit"
        variant="aurora"
        size="lg"
        fullWidth
        loading={loading}
        loadingText="Resetting..."
        className="mt-8"
      >
        Reset Password
      </VelocityButton>
    </form>
  );

  const renderSuccess = () => (
    <div className="text-center space-y-6">
      <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto">
        <CheckCircle className="w-8 h-8 text-emerald-400" />
      </div>

      <div>
        <h3 className="text-xl font-semibold text-slate-200 mb-2">
          Password Reset Complete
        </h3>
        <p className="text-slate-400">
          Your password has been successfully reset. You can now sign in with
          your new password.
        </p>
      </div>

      <VelocityButton
        type="button"
        variant="aurora"
        size="lg"
        fullWidth
        onClick={() => router.push('/sign-in')}
      >
        Sign In
      </VelocityButton>
    </div>
  );

  const renderError = () => (
    <div className="text-center space-y-6">
      <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto">
        <AlertCircle className="w-8 h-8 text-red-400" />
      </div>

      <div>
        <h3 className="text-xl font-semibold text-slate-200 mb-2">
          Invalid Reset Link
        </h3>
        <p className="text-slate-400">
          {error || 'This password reset link is invalid or has expired.'}
        </p>
      </div>

      <div className="space-y-3">
        <VelocityButton
          type="button"
          variant="aurora"
          size="lg"
          fullWidth
          onClick={() => router.push('/auth/forgot-password')}
        >
          Request New Reset Link
        </VelocityButton>

        <VelocityButton
          type="button"
          variant="ghost"
          size="lg"
          fullWidth
          onClick={() => router.push('/sign-in')}
        >
          Back to Sign In
        </VelocityButton>
      </div>
    </div>
  );

  const renderLoading = () => (
    <div className="text-center py-8">
      <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full mx-auto mb-4" />
      <p className="text-slate-400">Validating reset link...</p>
    </div>
  );

  const renderContent = () => {
    switch (pageState) {
      case 'loading':
        return renderLoading();
      case 'success':
        return renderSuccess();
      case 'error':
        return renderError();
      case 'form':
      default:
        return renderForm();
    }
  };

  return (
    <>
      <Head>
        <title>Reset Password | FibreFlow</title>
        <meta name="description" content="Set your new FibreFlow password" />
      </Head>

      {/* Full-screen container */}
      <div className="min-h-screen relative overflow-hidden">
        {/* Animated fiber background */}
        <FiberBackground />

        {/* Content layer */}
        <div className="relative z-10 min-h-screen flex items-center justify-center p-4 lg:p-8">
          {/* Two-column layout for desktop */}
          <div className="w-full max-w-6xl flex flex-col lg:flex-row items-center justify-center gap-8 lg:gap-16">
            {/* Quote section - hidden on mobile, visible on lg+ */}
            <div className="hidden lg:flex lg:flex-1 items-center justify-center px-8">
              {mounted && quote && <QuoteDisplay quote={quote} />}
            </div>

            {/* Card section */}
            <div className="w-full max-w-md lg:max-w-lg">
              <GlassCard
                variant="aurora"
                blur="heavy"
                elevation={4}
                rounded="2xl"
                padding="xl"
                className="relative"
              >
                {/* Back to sign in (only show on form state) */}
                {pageState === 'form' && (
                  <Link
                    href="/sign-in"
                    className="flex items-center gap-2 text-slate-400 hover:text-slate-200 transition-colors mb-6"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span className="text-sm">Back to Sign In</span>
                  </Link>
                )}

                {/* Brand header */}
                <div className="mb-8">
                  <BrandHeader
                    subtitle={pageState === 'success' ? 'Success' : 'New Password'}
                  />
                </div>

                {/* Error message (for form validation errors) */}
                {error && pageState === 'form' && (
                  <div className="mb-6 p-4 bg-red-500/20 border border-red-500/40 rounded-lg" role="alert" aria-live="polite">
                    <p className="text-red-200 text-sm text-center">{error}</p>
                  </div>
                )}

                {/* Content based on state */}
                {renderContent()}

                {/* Mobile quote - visible only on smaller screens */}
                <div className="lg:hidden mt-8 pt-8 border-t border-white/10">
                  {mounted && quote && (
                    <div className="text-center">
                      <p className="text-sm italic text-slate-300 mb-2">
                        &quot;{quote.text}&quot;
                      </p>
                      <p className="text-xs text-slate-400">
                        — {quote.author}
                      </p>
                    </div>
                  )}
                </div>
              </GlassCard>
            </div>
          </div>
        </div>

        {/* Bottom gradient fade */}
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-slate-900/80 to-transparent pointer-events-none" />
      </div>
    </>
  );
}
