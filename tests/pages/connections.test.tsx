/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime';
import type { NextRouter } from 'next/router';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@/contexts/AuthContext');

import CortexConnectionsPage from '../../pages/connections/cortex';
import FibreFlowConnectionsPage from '../../pages/connections/fibreflow';
import { getServerSideProps } from '../../pages/connections';
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

function response(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

class ConnectionsNetwork {
  private readonly user: ApiUser;
  private readonly canReview: boolean;

  constructor(canReview: boolean) {
    this.canReview = canReview;
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
      return response(200, { success: true, data: { user: this.user } });
    }
    if (url.pathname === '/api/admin/permissions/me') {
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

function routerAt(pathname: string): NextRouter {
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
    push: async () => true,
    replace: async () => true,
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

function renderPage(
  page: React.ReactElement,
  pathname: string,
  canReview: boolean,
) {
  const network = new ConnectionsNetwork(canReview);
  globalThis.fetch = network.fetch;
  installMatchMedia();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <RouterContext.Provider value={routerAt(pathname)}>
      <PathnameContext.Provider value={pathname}>
        <AuthProvider>
          <ThemeProvider enableSystemTheme={false}>
            <QueryClientProvider client={queryClient}>
              {page}
            </QueryClientProvider>
          </ThemeProvider>
        </AuthProvider>
      </PathnameContext.Provider>
    </RouterContext.Provider>,
  );
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalMatchMedia) {
    Object.defineProperty(window, 'matchMedia', originalMatchMedia);
  } else {
    Reflect.deleteProperty(window, 'matchMedia');
  }
  localStorage.clear();
});

describe('Connections pages', () => {
  it('redirects the module root to FibreFlow connections', async () => {
    await expect(getServerSideProps()).resolves.toEqual({
      redirect: {
        destination: '/connections/fibreflow',
        permanent: false,
      },
    });
  });

  it('renders FibreFlow Operations on its own page', async () => {
    renderPage(
      <FibreFlowConnectionsPage />,
      '/connections/fibreflow',
      false,
    );

    expect(await screen.findByRole('heading', { name: 'FibreFlow Operations' }))
      .toBeInTheDocument();
  });

  it('shows Cortex connection content to an authorized user', async () => {
    renderPage(<CortexConnectionsPage />, '/connections/cortex', true);

    expect(await screen.findByRole('heading', { name: 'Cortex Knowledge' }))
      .toBeInTheDocument();
  });

  it('shows the real access-denied surface without Cortex content when denied', async () => {
    renderPage(<CortexConnectionsPage />, '/connections/cortex', false);

    expect(await screen.findByRole('heading', { name: 'Access Denied' }))
      .toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Cortex Knowledge' }))
      .not.toBeInTheDocument();
  });
});
