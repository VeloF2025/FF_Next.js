import { render } from '@testing-library/react';

export interface StubResponse {
  status: number;
  body?: unknown;
}

export interface RecordedRequest {
  method: string;
  path: string;
  json?: unknown;
}

export type StubMap = Record<string, StubResponse | StubResponse[]>;

const originalFetch = globalThis.fetch;

export class NetworkBoundary {
  private readonly queues = new Map<string, StubResponse[]>();
  private readonly requests: RecordedRequest[] = [];

  constructor(stubs: StubMap) {
    Object.entries(stubs).forEach(([key, value]) => {
      this.queues.set(key, Array.isArray(value) ? [...value] : [value]);
    });
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const rawUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const path = new URL(rawUrl, 'https://app.fibreflow.app').pathname;
    const method = init?.method ?? 'GET';
    const json = typeof init?.body === 'string'
      ? JSON.parse(init.body) as unknown
      : undefined;
    this.requests.push({
      method,
      path,
      ...(json === undefined ? {} : { json }),
    });

    const key = `${method} ${path}`;
    const queue = this.queues.get(key);
    const stub = queue?.shift();
    if (!stub) throw new Error(`Unexpected request: ${key}`);

    return new Response(
      stub.body === undefined ? null : JSON.stringify(stub.body),
      {
        status: stub.status,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  };

  recordedRequests(): RecordedRequest[] {
    return [...this.requests];
  }
}

export function listResponse(tokens: unknown[]): StubResponse {
  return { status: 200, body: { data: { tokens } } };
}

export function renderWithNetwork(
  ui: React.ReactElement,
  stubs: StubMap,
): NetworkBoundary {
  const network = new NetworkBoundary(stubs);
  globalThis.fetch = network.fetch;
  render(ui);
  return network;
}

export function resetNetwork(): void {
  globalThis.fetch = originalFetch;
}
