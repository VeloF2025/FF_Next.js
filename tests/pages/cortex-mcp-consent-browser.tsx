import { cleanup, render, waitFor } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { HeadManagerContext } from 'next/dist/shared/lib/head-manager-context.shared-runtime';
import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime';
import type { NextRouter } from 'next/router';

import { AuthProvider } from '@/contexts/AuthContext';
import CortexMcpAuthorizePage from '../../pages/cortex/mcp/authorize';

export const STATE_ID = 'pZJqcS1uZH4fXo0WmXtYyRA7d2NcQk5g';
export const ROUTE = `/cortex/mcp/authorize?state_id=${STATE_ID}`;
export const CALLBACK = 'https://claude.ai/api/mcp/auth_callback?code=ctxc_abc';
export const ATTACKER_CONTEXT = {
  clientId: 'attacker-client',
  clientName: 'Claude',
  redirectUri: 'https://evil.example/cb',
  scopes: ['cortex.read'],
};
const originalFetch = globalThis.fetch;
const originalLocation = Object.getOwnPropertyDescriptor(window, 'location');
const mountedHeads = new Set<React.ReactNode>();

export interface StubResponse {
  status: number;
  body?: unknown;
}
type ContextResponse = StubResponse | Error | Promise<StubResponse>;
interface RecordedRequest {
  url: string;
  method: string;
  json?: unknown;
}
interface RenderOptions {
  route?: string;
  routerReady?: boolean;
  deferAuth?: boolean;
  authResponse: StubResponse;
  contextResponse?: ContextResponse;
  contextResponses?: ContextResponse[];
  consentResponse?: StubResponse | Error;
}

export const authenticatedLewResponse: StubResponse = {
  status: 200,
  body: {
    success: true,
    data: {
      user: {
        id: 'staff-lew',
        email: 'lew@velocityfibre.co.za',
        name: 'Lew Demo',
        firstName: 'Lew',
        lastName: 'Demo',
        role: 'admin',
        permissions: ['cortex.review'],
        profilePicture: null,
        isImpersonation: false,
      },
    },
  },
};
export const FAILURE_RESPONSES: ReadonlyArray<
  readonly [string, StubResponse | Error]
> = [
  ['API rejection', { status: 502, body: { error: { message: 'Consent refused' } } }],
  ['missing redirectUrl', { status: 200, body: { data: {} } }],
  ['network failure', new Error('offline')],
];

function responseFrom(stub: StubResponse): Response {
  return new Response(stub.body === undefined ? null : JSON.stringify(stub.body), {
    status: stub.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function routeParts(route: string): { pathname: string; query: NextRouter['query'] } {
  const url = new URL(route, 'https://dev.fibreflow.app');
  return { pathname: url.pathname, query: Object.fromEntries(url.searchParams.entries()) };
}
function destinationText(destination: Parameters<NextRouter['replace']>[0]): string {
  return typeof destination === 'string' ? destination : destination.pathname ?? '/';
}
type HeadElement = React.ReactElement<{
  children?: React.ReactNode;
  content?: string;
  name?: string;
}>;
function updateHead(elements: HeadElement[]): void {
  document.title = '';
  document.head.querySelectorAll('meta').forEach((meta) => meta.remove());
  elements.forEach((element) => {
    if (element.type === 'title') document.title = String(element.props.children ?? '');
    if (element.type === 'meta' && element.props.name) {
      const meta = document.createElement('meta');
      meta.name = element.props.name;
      meta.content = element.props.content ?? '';
      document.head.append(meta);
    }
  });
}

export class ConsentBrowser {
  readonly requests: RecordedRequest[] = [];
  readonly internalPaths: string[] = [];
  readonly router: NextRouter;
  private readonly targetRoute: string;
  private readonly authResponse: StubResponse;
  private readonly contextResponses: ContextResponse[];
  private readonly consentResponse?: StubResponse | Error;
  private authResolver: ((response: Response) => void) | null = null;
  private authPromise: Promise<Response> | null = null;
  private rerenderPage: (() => void) | null = null;
  private externalHref: string | null = null;

  constructor(options: RenderOptions) {
    this.targetRoute = options.route ?? ROUTE;
    this.authResponse = options.authResponse;
    this.contextResponses = options.contextResponses ?? [
      options.contextResponse ?? {
        status: 200,
        body: { data: ATTACKER_CONTEXT },
      },
    ];
    this.consentResponse = options.consentResponse;
    if (options.deferAuth) {
      this.authPromise = new Promise((resolve) => {
        this.authResolver = resolve;
      });
    }
    const initial = routeParts(this.targetRoute);
    const isReady = options.routerReady ?? true;
    this.router = {
      basePath: '',
      route: initial.pathname,
      pathname: initial.pathname,
      query: isReady ? initial.query : {},
      asPath: isReady ? this.targetRoute : initial.pathname,
      isLocaleDomain: false,
      isFallback: false,
      isReady,
      isPreview: false,
      push: async (destination) => this.navigate(destination),
      replace: async (destination) => this.navigate(destination),
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

  readonly fetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const json = typeof init?.body === 'string'
      ? JSON.parse(init.body) as unknown
      : undefined;
    this.requests.push({ url, method: init?.method ?? 'GET', json });
    if (url === '/api/auth/me') {
      return this.authPromise ?? responseFrom(this.authResponse);
    }
    if (url === '/api/cortex/mcp-consent-context') {
      const pending = this.contextResponses.shift();
      if (!pending) throw new Error('No context response remains');
      if (pending instanceof Error) throw pending;
      return responseFrom(await pending);
    }
    if (url === '/api/cortex/mcp-consent') {
      if (this.consentResponse instanceof Error) throw this.consentResponse;
      if (this.consentResponse) return responseFrom(this.consentResponse);
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  page(): React.ReactElement {
    return (
      <HeadManagerContext.Provider value={{ mountedInstances: mountedHeads, updateHead }}>
        <RouterContext.Provider value={this.router}>
          <AuthProvider>
            <CortexMcpAuthorizePage />
          </AuthProvider>
        </RouterContext.Provider>
      </HeadManagerContext.Provider>
    );
  }
  attach(result: RenderResult): void {
    this.rerenderPage = () => result.rerender(this.page());
  }
  hydrateRouter(): void {
    const hydrated = routeParts(this.targetRoute);
    this.router.query = hydrated.query;
    this.router.asPath = this.targetRoute;
    this.router.isReady = true;
    this.rerenderPage?.();
  }
  changeRoute(route: string): void {
    const changed = routeParts(route);
    this.router.query = changed.query;
    this.router.asPath = route;
    this.rerenderPage?.();
  }
  releaseAuth(): void {
    this.authResolver?.(responseFrom(this.authResponse));
    this.authResolver = null;
  }
  async waitForPath(pathname: string): Promise<void> {
    await waitFor(() => {
      const current = this.internalPaths.at(-1) ?? '/';
      const actual = new URL(current, 'https://dev.fibreflow.app').pathname;
      if (actual !== pathname) throw new Error(`Expected ${pathname}, received ${actual}`);
    });
  }
  returnUrl(): string | null {
    const current = this.internalPaths.at(-1);
    return current
      ? new URL(current, 'https://dev.fibreflow.app').searchParams.get('returnUrl')
      : null;
  }
  recordedRequests(url: string): Array<Omit<RecordedRequest, 'url'>> {
    return this.requests
      .filter((request) => request.url === url)
      .map(({ method, json }) => ({ method, json }));
  }
  externalLocation(): string | null {
    return this.externalHref;
  }
  install(): void {
    globalThis.fetch = this.fetch;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        href: `https://dev.fibreflow.app${this.targetRoute}`,
        origin: 'https://dev.fibreflow.app',
        pathname: routeParts(this.targetRoute).pathname,
        search: new URL(this.targetRoute, 'https://dev.fibreflow.app').search,
        hash: '',
        assign: (url: string) => {
          this.externalHref = url;
        },
      },
    });
  }
  private async navigate(
    destination: Parameters<NextRouter['replace']>[0],
  ): Promise<boolean> {
    this.internalPaths.push(destinationText(destination));
    return true;
  }
}

export function renderConsentPage(options: RenderOptions): ConsentBrowser {
  const browser = new ConsentBrowser(options);
  browser.install();
  const result = render(browser.page());
  browser.attach(result);
  return browser;
}
export function resetConsentBrowser(): void {
  cleanup();
  globalThis.fetch = originalFetch;
  if (originalLocation) Object.defineProperty(window, 'location', originalLocation);
  document.head.innerHTML = '';
  mountedHeads.clear();
}
