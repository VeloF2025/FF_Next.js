/**
 * Global Auth Error Handler
 *
 * Handles 401 errors by redirecting to sign-in page with return URL.
 * Sets up a global fetch interceptor when imported.
 */

import toast from 'react-hot-toast';

let isRedirecting = false;
let interceptorInstalled = false;

/**
 * Handle authentication error (401) by showing a message and redirecting to sign-in
 * @param options - Optional configuration
 */
export function handleAuthError(options?: {
  showToast?: boolean;
  message?: string;
}) {
  // Prevent multiple redirects
  if (isRedirecting) return;

  if (typeof window === 'undefined') return;

  const currentPath = window.location.pathname + window.location.search;

  // Don't redirect if already on sign-in or auth pages
  if (currentPath.startsWith('/sign-in') || currentPath.startsWith('/auth/')) {
    return;
  }

  isRedirecting = true;

  // Show toast notification - use a gentle notification for timed logout, not error
  if (options?.showToast !== false) {
    toast(options?.message || 'Session timed out. Redirecting to sign in...', {
      duration: 3000,
      id: 'auth-error', // Prevent duplicate toasts
      icon: '⏱️',
      style: {
        background: '#374151', // gray-700
        color: '#f9fafb', // gray-50
        borderRadius: '8px',
      },
    });
  }

  // Small delay to allow toast to be seen
  setTimeout(() => {
    window.location.href = `/sign-in?returnUrl=${encodeURIComponent(currentPath)}`;
  }, 500);
}

/**
 * Wrapper for fetch that handles 401 errors automatically
 */
export async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const response = await fetch(input, {
    ...init,
    credentials: 'include', // Always include credentials
  });

  if (response.status === 401) {
    handleAuthError();
    // Return the response anyway so the caller can handle it if needed
  }

  return response;
}

/**
 * Check if a response is a 401 and handle it
 * Use this after any fetch call to handle auth errors
 */
export function checkAuthResponse(response: Response): boolean {
  if (response.status === 401) {
    handleAuthError();
    return true;
  }
  return false;
}

/**
 * Reset the redirect flag (useful for testing)
 */
export function resetAuthErrorHandler() {
  isRedirecting = false;
}

/**
 * Install the global fetch interceptor
 * Safe to call multiple times - only installs once
 */
export function installAuthInterceptor() {
  if (typeof window === 'undefined' || interceptorInstalled) return;

  interceptorInstalled = true;
  const originalFetch = window.fetch;

  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    // Handle 401 responses globally (except for auth endpoints)
    if (response.status === 401) {
      const url = typeof args[0] === 'string' ? args[0] : args[0] instanceof Request ? args[0].url : '';
      // Don't redirect for auth check endpoints (they're expected to return 401 when not logged in)
      if (!url.includes('/api/auth/me') && !url.includes('/api/auth/check-email')) {
        handleAuthError();
      }
    }

    return response;
  };
}

// Auto-install when this module is imported on the client side
if (typeof window !== 'undefined') {
  installAuthInterceptor();
}
