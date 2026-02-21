/**
 * PremiumLoginPage - High-tech login page with fiber background, glass card, and quotes
 * Features: FiberBackground, GlassCard aurora variant, VelocityInput/Button, motivational quotes
 * Supports: Multi-step flow for first-time users and returning users
 */

import { useState, useEffect, FormEvent, useRef } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { Mail, Lock, ArrowLeft, Check, User } from 'lucide-react';
import { FiberBackground } from './FiberBackground';
import { QuoteDisplay } from './QuoteDisplay';
import { BrandHeader } from './BrandHeader';
import { GlassCard } from '@/components/ui/GlassCard';
import { VelocityInput } from '@/components/ui/VelocityInput';
import { VelocityButton } from '@/components/ui/VelocityButton';
import { getRandomQuote, MotivationalQuote } from '@/data/motivational-quotes';
import { useAuth } from '@/contexts/AuthContext';

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
  const { signInWithEmail, refreshUser } = useAuth();
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

  // Refs to read actual DOM values (for browser autofill)
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Initialize quote on mount (client-side only for randomness)
  useEffect(() => {
    setMounted(true);
    setQuote(getRandomQuote());
  }, []);


  const handleEmailSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Get email from DOM (handles browser autofill that bypasses React onChange)
    const actualEmail = emailRef.current?.value || email;
    if (actualEmail !== email) {
      setEmail(actualEmail);
    }

    try {
      const res = await fetch('/api/auth/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: actualEmail }),
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

    // Get password from DOM (handles browser autofill that bypasses React onChange)
    const actualPassword = passwordRef.current?.value || password;
    if (actualPassword !== password) {
      setPassword(actualPassword);
    }

    // Validate: password shouldn't be exactly the email (Chrome autofill bug with multi-step forms)
    // Only check exact match - passwords CAN contain @ symbols legitimately
    if (actualPassword === email) {
      setError('Please enter your password, not your email address. If Chrome autofilled incorrectly, please clear and re-enter your password.');
      setPassword('');
      if (passwordRef.current) {
        passwordRef.current.value = '';
        passwordRef.current.focus();
      }
      setLoading(false);
      return;
    }

    try {
      // Use AuthContext to login - this properly updates auth state
      await signInWithEmail(email, actualPassword);

      // Redirect to dashboard on success (AuthContext is now updated)
      const returnUrl = (router.query.returnUrl as string) || '/';
      router.push(returnUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
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

      // Refresh AuthContext to pick up the new session
      await refreshUser();

      // Redirect to dashboard on success (AuthContext is now updated)
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
        aria-label="Go back to email step"
        className="flex items-center gap-2 text-slate-400 hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-slate-900 rounded-md transition-colors mb-6"
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
            <User className="w-5 h-5 text-emerald-400" aria-hidden="true" />
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
    <form onSubmit={handleEmailSubmit} className="space-y-5" autoComplete="on">
      <div>
        <label htmlFor="username" className="block text-sm font-medium text-slate-300 mb-2">
          Email Address
        </label>
        <VelocityInput
          key="email-input"
          ref={emailRef}
          type="email"
          name="username"
          id="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          variant="neon-green"
          icon={<Mail className="w-5 h-5" />}
          iconPosition="left"
          placeholder="Enter Your Email Address"
          autoComplete="username"
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
    <form onSubmit={handlePasswordSubmit} className="space-y-5" autoComplete="on">
      {/* Hidden pre-filled username field - Critical for Chrome password manager in multi-step forms
          Per Chromium docs: include username field (prefilled), hidden with CSS on password page
          This lets password managers detect which account is being logged into */}
      <input
        type="email"
        name="username"
        autoComplete="username"
        value={email}
        readOnly
        tabIndex={-1}
        aria-hidden="true"
        style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px' }}
      />
      <div>
        <label htmlFor="current-password" className="block text-sm font-medium text-slate-300 mb-2">
          Password
        </label>
        <input
          ref={passwordRef}
          type="password"
          name="password"
          id="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          placeholder="Enter Your Password"
          autoComplete="current-password"
          disabled={loading}
          className="w-full px-4 py-3 bg-slate-800/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
        />
      </div>

      <div className="flex justify-end">
        <Link
          href={`/auth/forgot-password?email=${encodeURIComponent(email)}`}
          className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-slate-900 rounded"
        >
          Forgot Password?
        </Link>
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
              <Check className="w-4 h-4 inline mr-1" aria-hidden="true" />
              Set up your password to access FibreFlow
            </>
          )}
        </p>
      </div>

      <div>
        <label htmlFor="setup-password" className="block text-sm font-medium text-slate-300 mb-2">
          Create Password
        </label>
        <VelocityInput
          type="password"
          name="new-password"
          id="setup-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          variant="neon-green"
          icon={<Lock className="w-5 h-5" />}
          iconPosition="left"
          showPasswordReveal
          placeholder="Create A Strong Password"
          autoComplete="new-password"
          disabled={loading}
          disableFloating
        />
        <p className="mt-1 text-xs text-slate-400">
          Min 8 characters with uppercase, lowercase, number, and special character
        </p>
      </div>

      <div>
        <label htmlFor="setup-confirm-password" className="block text-sm font-medium text-slate-300 mb-2">
          Confirm Password
        </label>
        <VelocityInput
          type="password"
          name="confirm-password"
          id="setup-confirm-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          variant="neon-green"
          icon={<Lock className="w-5 h-5" />}
          iconPosition="left"
          showPasswordReveal
          placeholder="Confirm Your Password"
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
                  <div 
                    className="mb-6 p-4 bg-red-500/20 border border-red-500/40 rounded-lg" 
                    role="alert" 
                    aria-live="polite"
                  >
                    <p className="text-red-200 text-sm text-center">{error}</p>
                  </div>
                )}

                {/* Current step form */}
                {renderCurrentStep()}

                {/* Footer hint */}
                <div className="mt-8 text-center">
                  <p className="text-sm text-slate-400">
                    Having trouble signing in?{' '}
                    <button
                      type="button"
                      onClick={() => window.location.href = 'mailto:support@fibreflow.co.za'}
                      className="text-emerald-400 hover:text-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-slate-900 rounded transition-colors underline-offset-2 hover:underline"
                    >
                      Contact support
                    </button>
                  </p>
                </div>

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

              {/* Footer status */}
              <div className="mt-4 text-center space-y-1">
                <p className="text-xs text-slate-400">
                  © 2026 FibreFlow. All rights reserved.
                </p>
                <div className="flex items-center justify-center gap-3 text-xs text-slate-400">
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                    System Online
                  </span>
                  <span className="text-slate-600">•</span>
                  <span className="flex items-center gap-1">
                    <svg className="w-3 h-3 text-emerald-500" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                      <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                    </svg>
                    Secure Connection
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
