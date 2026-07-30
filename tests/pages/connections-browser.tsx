import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import {
  AppRouterContext,
  type AppRouterInstance,
} from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime';
import type { NextRouter } from 'next/router';

import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';

interface ApiUser {
  id: string;
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  role: string;
  permissions: string[];
  profilePicture: null;
  isImpersonation: boolean;
}

const originalFetch = globalThis.fetch;
const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');

function response(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function destinationText(destination: Parameters<NextRouter['replace']>[0]): string {
  return typeof destination === 'string' ? destination : destination.pathname ?? '/';
}

class ConnectionsNetwork {
  private readonly user: ApiUser;

  constructor(
    private readonly canReview: boolean,
    private readonly authenticated: boolean,
    private readonly permissionStatus: number,
  ) {
    this.user = {
      id: 'staff-lew',
      email: 'lew@velocityfibre.co.za',
      name: 'Lew Demo',
      firstName: 'Lew',
      lastName: 'Demo',
      role: 'admin',
      permissions: [],
      profilePicture: null,
      isImpersonation: false,
    };
  }

  readonly fetch: typeof fetch = async (input) => {
    const rawUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const url = new URL(rawUrl, 'https://app.fibreflow.app');

    if (url.pathname === '/api/auth/me') {
      if (!this.authenticated) {
        return response(401, {
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        });
      }
      return response(200, { success: true, data: { user: this.user } });
    }
    if (url.pathname === '/api/admin/permissions/me') {
      if (this.permissionStatus !== 200) {
        return response(this.permissionStatus, {
          error: { code: 'PERMISSION_CHECK_ERROR' },
        });
      }
      return response(200, {
        data: [{
          permissionKey: 'cortex.review',
          canView: this.canReview,
          canCreate: false,
          canEdit: false,
          canDelete: false,
        }],
      });
    }
    if (url.pathname === '/api/me/mcp-tokens') {
      return response(200, { data: { tokens: [] } });
    }
    if (url.pathname === '/api/cortex-review') {
      return response(200, { data: [] });
    }
    if (url.pathname === '/api/user-sidebar-preferences') {
      return response(200, {
        success: true,
        data: { main_section_items: [] },
      });
    }
    if (url.pathname === '/api/notifications/unread-count') {
      return response(200, { data: 0 });
    }
    if (url.pathname === '/api/notifications') {
      return response(200, { data: [] });
    }
    if (url.pathname === '/api/chat/access') {
      return response(200, { dataAccess: false });
    }
    if (url.pathname === '/api/tracking/page-visit') {
      return response(204);
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  };
}

function routerAt(pathname: string, internalPaths: string[]): NextRouter {
  const navigate = async (
    destination: Parameters<NextRouter['replace']>[0],
  ): Promise<boolean> => {
    internalPaths.push(destinationText(destination));
    return true;
  };
  return {
    basePath: '',
    route: pathname,
    pathname,
    query: {},
    asPath: pathname,
    isLocaleDomain: false,
    isFallback: false,
    isReady: true,
    isPreview: false,
    push: navigate,
    replace: navigate,
    reload: () => undefined,
    back: () => undefined,
    forward: () => undefined,
    prefetch: async () => undefined,
    beforePopState: () => undefined,
    events: {
      on: () => undefined,
      off: () => undefined,
      emit: () => undefined,
    },
  };
}

const appRouter: AppRouterInstance = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
};

function installMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

export function renderConnectionsPage(
  page: React.ReactElement,
  pathname: string,
  canReview: boolean,
  options: {
    authenticated?: boolean;
    permissionStatus?: number;
  } = {},
) {
  const network = new ConnectionsNetwork(
    canReview,
    options.authenticated ?? true,
    options.permissionStatus ?? 200,
  );
  globalThis.fetch = network.fetch;
  installMatchMedia();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const internalPaths: string[] = [];

  const result = render(
    <AppRouterContext.Provider value={appRouter}>
      <RouterContext.Provider value={routerAt(pathname, internalPaths)}>
        <PathnameContext.Provider value={pathname}>
          <AuthProvider>
            <ThemeProvider enableSystemTheme={false}>
              <QueryClientProvider client={queryClient}>
                {page}
              </QueryClientProvider>
            </ThemeProvider>
          </AuthProvider>
        </PathnameContext.Provider>
      </RouterContext.Provider>
    </AppRouterContext.Provider>,
  );
  return Object.assign(result, { internalPaths });
}

export function resetConnectionsBrowser(): void {
  globalThis.fetch = originalFetch;
  if (originalMatchMedia) {
    Object.defineProperty(window, 'matchMedia', originalMatchMedia);
  } else {
    Reflect.deleteProperty(window, 'matchMedia');
  }
  localStorage.clear();
}
