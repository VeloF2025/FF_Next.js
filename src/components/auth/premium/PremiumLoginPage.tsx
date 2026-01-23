/**
 * PremiumLoginPage - High-tech login page with fiber background, glass card, and quotes
 * Features: FiberBackground, GlassCard aurora variant, VelocityInput/Button, motivational quotes
 * Supports: Multi-step flow for first-time users and returning users
 */

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { Mail, Lock, ArrowLeft, Check, User } from 'lucide-react';
import { FiberBackground } from './FiberBackground';
import { QuoteDisplay } from './QuoteDisplay';
import { BrandHeader } from './BrandHeader';
import { GlassCard } from '@/components/ui/GlassCard';
import { VelocityInput } from '@/components/ui/VelocityInput';
import { VelocityButton } from '@/components/ui/VelocityButton';
import { getRandomQuote, MotivationalQuote } from '@/data/motivational-quotes';

type AuthStep = 'email' | 'password' | 'setup-password';
type EmailStatus = 'STAFF_NOT_FOUND' | 'FIRST_TIME_USER' | 'PASSWORD_REQUIRED' | 'PASSWORD_SETUP_REQUIRED' | 'USER_DISABLED';

interface StaffInfo {
  id: string;
  firstName: string;
  lastName: string;
  position?: string;
  department?: string;
}

export function PremiumLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<AuthStep>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staffInfo, setStaffInfo] = useState<StaffInfo | null>(null);
  const [welcomeMessage, setWelcomeMessage] = useState<string>('');
  const [quote, setQuote] = useState<MotivationalQuote | null>(null);
  const [mounted, setMounted] = useState(false);

  // Initialize quote on mount (client-side only for randomness)
  useEffect(() => {
    setMounted(true);
    setQuote(getRandomQuote());
  }, []);

  const handleEmailSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!data.success) {
        setError(data.error?.message || 'An error occurred');
        return;
      }

      const status: EmailStatus = data.data.status;
      setWelcomeMessage(data.data.message);
      setStaffInfo(data.data.staff || null);

      switch (status) {
        case 'STAFF_NOT_FOUND':
          setError('This email is not registered in the system. Please contact your administrator.');
          break;
        case 'USER_DISABLED':
          setError('Your account has been disabled. Please contact your administrator.');
          break;
        case 'FIRST_TIME_USER':
        case 'PASSWORD_SETUP_REQUIRED':
          setStep('setup-password');
          break;
        case 'PASSWORD_REQUIRED':
          setStep('password');
          break;
        default:
          setError('Unknown status. Please try again.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error?.message || 'Login failed');
        return;
      }

      // Redirect to dashboard on success
      const returnUrl = (router.query.returnUrl as string) || '/';
      router.push(returnUrl);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSetupPasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/setup-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, confirmPassword }),
        credentials: 'include',
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error?.message || 'Password setup failed');
        return;
      }

      // Redirect to dashboard on success (auto-logged in)
      const returnUrl = (router.query.returnUrl as string) || '/';
      router.push(returnUrl);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setStep('email');
    setPassword('');
    setConfirmPassword('');
    setError(null);
    setStaffInfo(null);
    setWelcomeMessage('');
  };

  const renderStepIndicator = () => {
    if (step === 'email') return null;

    return (
      <button
        type="button"
        onClick={handleBack}
        className="flex items-center gap-2 text-slate-400 hover:text-slate-200 transition-colors mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        <span className="text-sm">Back to email</span>
      </button>
    );
  };

  const renderWelcomeBanner = () => {
    if (!staffInfo || step === 'email') return null;

    return (
      <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-500/20 rounded-full flex items-center justify-center">
            <User className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <p className="text-emerald-200 font-medium">
              {staffInfo.firstName} {staffInfo.lastName}
            </p>
            {staffInfo.position && (
              <p className="text-sm text-slate-400">
                {staffInfo.position}
                {staffInfo.department && ` • ${staffInfo.department}`}
              </p>
            )}
          </div>
        </div>
        {welcomeMessage && (
          <p className="mt-3 text-sm text-slate-300">{welcomeMessage}</p>
        )}
      </div>
    );
  };

  const renderEmailStep = () => (
    <form onSubmit={handleEmailSubmit} className="space-y-5">
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

      <VelocityButton
        type="submit"
        variant="aurora"
        size="lg"
        fullWidth
        loading={loading}
        loadingText="Checking..."
        className="mt-8"
      >
        Continue
      </VelocityButton>
    </form>
  );

  const renderPasswordStep = () => (
    <form onSubmit={handlePasswordSubmit} className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          Password
        </label>
        <VelocityInput
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          variant="neon-green"
          icon={<Lock className="w-5 h-5" />}
          iconPosition="left"
          showPasswordReveal
          placeholder="Enter your password"
          autoComplete="current-password"
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
        loadingText="Signing in..."
        className="mt-8"
      >
        Sign In
      </VelocityButton>
    </form>
  );

  const renderSetupPasswordStep = () => (
    <form onSubmit={handleSetupPasswordSubmit} className="space-y-5">
      <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
        <p className="text-sm text-blue-200">
          {step === 'setup-password' && (
            <>
              <Check className="w-4 h-4 inline mr-1" />
              Set up your password to access FibreFlow
            </>
          )}
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          Create Password
        </label>
        <VelocityInput
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
        <p className="mt-1 text-xs text-slate-500">
          Min 8 characters with uppercase, lowercase, number, and special character
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          Confirm Password
        </label>
        <VelocityInput
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
        loadingText="Setting up..."
        className="mt-8"
      >
        Set Password & Sign In
      </VelocityButton>
    </form>
  );

  const renderCurrentStep = () => {
    switch (step) {
      case 'email':
        return renderEmailStep();
      case 'password':
        return renderPasswordStep();
      case 'setup-password':
        return renderSetupPasswordStep();
      default:
        return renderEmailStep();
    }
  };

  const getStepTitle = () => {
    switch (step) {
      case 'email':
        return 'Sign In';
      case 'password':
        return 'Welcome Back';
      case 'setup-password':
        return 'Get Started';
      default:
        return 'Sign In';
    }
  };

  return (
    <>
      <Head>
        <title>{getStepTitle()} | FibreFlow</title>
        <meta name="description" content="Sign in to your FibreFlow account" />
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

            {/* Login card section */}
            <div className="w-full max-w-md lg:max-w-lg">
              <GlassCard
                variant="aurora"
                blur="heavy"
                elevation={4}
                rounded="2xl"
                padding="xl"
                className="relative"
              >
                {/* Back button for non-email steps */}
                {renderStepIndicator()}

                {/* Brand header */}
                <div className="mb-8">
                  <BrandHeader subtitle={getStepTitle()} />
                </div>

                {/* Welcome banner for known users */}
                {renderWelcomeBanner()}

                {/* Error message */}
                {error && (
                  <div className="mb-6 p-4 bg-red-500/20 border border-red-500/40 rounded-lg">
                    <p className="text-red-200 text-sm text-center">{error}</p>
                  </div>
                )}

                {/* Current step form */}
                {renderCurrentStep()}

                {/* Footer hint */}
                <div className="mt-8 text-center">
                  <p className="text-sm text-slate-400">
                    Having trouble signing in?{' '}
                    <span className="text-emerald-400 cursor-pointer hover:text-emerald-300 transition-colors">
                      Contact support
                    </span>
                  </p>
                </div>

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

              {/* Dev hint - can be removed in production */}
              <div className="mt-4 text-center">
                <p className="text-xs text-slate-500">
                  Use your staff email to sign in
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom gradient fade */}
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-slate-900/80 to-transparent pointer-events-none" />
      </div>
    </>
  );
}
