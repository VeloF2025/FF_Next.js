/**
 * Forgot Password Page
 * Premium-styled page matching sign-in UI/UX
 * Initiates password reset flow
 */

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { Mail, ArrowLeft, CheckCircle } from 'lucide-react';
import { FiberBackground, BrandHeader, QuoteDisplay } from '@/components/auth/premium';
import { GlassCard } from '@/components/ui/GlassCard';
import { VelocityInput } from '@/components/ui/VelocityInput';
import { VelocityButton } from '@/components/ui/VelocityButton';
import { getRandomQuote, MotivationalQuote } from '@/data/motivational-quotes';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [quote, setQuote] = useState<MotivationalQuote | null>(null);
  const [mounted, setMounted] = useState(false);

  // Initialize quote on mount (client-side only for randomness)
  useEffect(() => {
    setMounted(true);
    setQuote(getRandomQuote());
  }, []);

  // Pre-fill email from query param if provided
  useEffect(() => {
    if (router.query.email && typeof router.query.email === 'string') {
      setEmail(router.query.email);
    }
  }, [router.query.email]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error?.message || 'An error occurred');
        return;
      }

      // Always show success (API doesn't reveal if email exists)
      setSubmitted(true);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const renderForm = () => (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          Email Address
        </label>
        <VelocityInput
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          variant="neon-green"
          icon={<Mail className="w-5 h-5" />}
          iconPosition="left"
          placeholder="you@company.com"
          autoComplete="email"
          disabled={loading}
          disableFloating
        />
      </div>

      <p className="text-sm text-slate-400">
        Enter the email address associated with your account and we&apos;ll send you
        a link to reset your password.
      </p>

      <VelocityButton
        type="submit"
        variant="aurora"
        size="lg"
        fullWidth
        loading={loading}
        loadingText="Sending..."
        className="mt-8"
      >
        Send Reset Link
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
          Check Your Email
        </h3>
        <p className="text-slate-400">
          If an account exists for <span className="text-emerald-400">{email}</span>,
          you&apos;ll receive a password reset link shortly.
        </p>
      </div>

      <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg text-left">
        <p className="text-sm text-blue-200">
          <strong>Didn&apos;t receive the email?</strong>
        </p>
        <ul className="mt-2 text-sm text-slate-400 list-disc list-inside space-y-1">
          <li>Check your spam/junk folder</li>
          <li>Make sure you entered the correct email</li>
          <li>Wait a few minutes and try again</li>
        </ul>
      </div>

      <VelocityButton
        type="button"
        variant="ghost"
        size="lg"
        fullWidth
        onClick={() => {
          setSubmitted(false);
          setEmail('');
        }}
      >
        Try Another Email
      </VelocityButton>
    </div>
  );

  return (
    <>
      <Head>
        <title>Forgot Password | FibreFlow</title>
        <meta name="description" content="Reset your FibreFlow password" />
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
                {/* Back to sign in */}
                <Link
                  href="/sign-in"
                  className="flex items-center gap-2 text-slate-400 hover:text-slate-200 transition-colors mb-6"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span className="text-sm">Back to Sign In</span>
                </Link>

                {/* Brand header */}
                <div className="mb-8">
                  <BrandHeader subtitle="Reset Password" />
                </div>

                {/* Error message */}
                {error && (
                  <div className="mb-6 p-4 bg-red-500/20 border border-red-500/40 rounded-lg">
                    <p className="text-red-200 text-sm text-center">{error}</p>
                  </div>
                )}

                {/* Form or success message */}
                {submitted ? renderSuccess() : renderForm()}

                {/* Mobile quote - visible only on smaller screens */}
                <div className="lg:hidden mt-8 pt-8 border-t border-white/10">
                  {mounted && quote && (
                    <div className="text-center">
                      <p className="text-sm italic text-slate-300 mb-2">
                        &quot;{quote.text}&quot;
                      </p>
                      <p className="text-xs text-slate-500">
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
