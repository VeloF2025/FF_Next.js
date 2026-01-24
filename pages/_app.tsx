import '../styles/globals.css';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import ErrorBoundary from '@/components/ErrorBoundary';
import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { reportWebVitals } from '@/lib/performance';
import { initErrorTracking } from '@/lib/errorTracking';
import { VersionChecker } from '@/components/VersionChecker';
// Install global 401 interceptor early - this import sets up the fetch interceptor
import '@/lib/authErrorHandler';

// Export for Next.js Web Vitals
export { reportWebVitals };

function MyApp({ Component, pageProps }: AppProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 2,
            staleTime: 5 * 60 * 1000,
          },
        },
      })
  );

  // Initialize error tracking on mount
  useEffect(() => {
    initErrorTracking({
      enabled: process.env.NODE_ENV === 'production',
      sampleRate: 1.0, // Track 100% of errors
    });
  }, []);

  return (
    <ErrorBoundary>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <VersionChecker />
      <AuthProvider>
        <ThemeProvider enableSystemTheme={false}>
          <QueryClientProvider client={queryClient}>
            <Component {...pageProps} />
            <Toaster
              position="top-right"
              toastOptions={{
                duration: 4000,
                style: {
                  background: '#1e2128',
                  color: '#e5e7eb',
                  padding: '16px',
                  borderRadius: '8px',
                  border: '1px solid #374151',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)',
                },
                success: {
                  duration: 3000,
                  iconTheme: {
                    primary: '#10b981',
                    secondary: '#1e2128',
                  },
                  style: {
                    background: '#064e3b',
                    color: '#a7f3d0',
                    border: '1px solid #059669',
                  },
                },
                error: {
                  duration: 5000,
                  iconTheme: {
                    primary: '#ef4444',
                    secondary: '#1e2128',
                  },
                  style: {
                    background: '#7f1d1d',
                    color: '#fecaca',
                    border: '1px solid #dc2626',
                  },
                },
              }}
            />
          </QueryClientProvider>
        </ThemeProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default MyApp;