/**
 * PremiumLoginPage - High-tech login page with fiber background, glass card, and quotes
 * Features: FiberBackground, GlassCard aurora variant, VelocityInput/Button, motivational quotes
 */

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { Mail, Lock } from 'lucide-react';
import { FiberBackground } from './FiberBackground';
import { QuoteDisplay } from './QuoteDisplay';
import { BrandHeader } from './BrandHeader';
import { GlassCard } from '@/components/ui/GlassCard';
import { VelocityInput } from '@/components/ui/VelocityInput';
import { VelocityButton } from '@/components/ui/VelocityButton';
import { getRandomQuote, MotivationalQuote } from '@/data/motivational-quotes';

export function PremiumLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<MotivationalQuote | null>(null);
  const [mounted, setMounted] = useState(false);

  // Initialize quote on mount (client-side only for randomness)
  useEffect(() => {
    setMounted(true);
    setQuote(getRandomQuote());
  }, []);

  const handleSubmit = async (e: FormEvent) => {
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
        setError(data.message || 'Login failed');
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

  return (
    <>
      <Head>
        <title>Sign In | FibreFlow</title>
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
                {/* Brand header */}
                <div className="mb-8">
                  <BrandHeader />
                </div>

                {/* Error message */}
                {error && (
                  <div className="mb-6 p-4 bg-red-500/20 border border-red-500/40 rounded-lg">
                    <p className="text-red-200 text-sm text-center">{error}</p>
                  </div>
                )}

                {/* Login form */}
                <form onSubmit={handleSubmit} className="space-y-6">
                  <VelocityInput
                    label="Email Address"
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
                  />

                  <VelocityInput
                    label="Password"
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
                  />

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
                  Demo: admin@fibreflow.com
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
