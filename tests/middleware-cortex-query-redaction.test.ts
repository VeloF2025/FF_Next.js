/** Direct production-middleware proof for Cortex OAuth query privacy. */
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { middleware } from '../middleware';

interface ApiRequestLog {
  message: string;
  method: string;
  path: string;
  query?: Record<string, string>;
}

async function captureMiddlewareOutput(url: string): Promise<string> {
  const chunks: string[] = [];
  const realWrite = process.stdout.write;
  process.stdout.write = function capture(chunk: Uint8Array | string, ...args: unknown[]) {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return realWrite.call(process.stdout, chunk, ...args as []);
  } as typeof process.stdout.write;
  try {
    await middleware(new NextRequest(url));
  } finally {
    process.stdout.write = realWrite;
  }
  return chunks.join('');
}

function apiRequestLog(output: string): ApiRequestLog {
  const entry = output
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as ApiRequestLog)
    .find(({ message }) => message === 'API Request');
  expect(entry).toBeDefined();
  return entry!;
}

const QUERY = new URLSearchParams({
  state: 'oauth-state-value',
  code: 'oauth-code-value',
  redirect_uri: 'https://client.invalid/callback',
  client_id: 'oauth-client-id',
  authorization: 'Bearer bearer-like-query-value',
});

describe('middleware remote-MCP query logging', () => {
  it('omits every query name and value for the exact route and all child paths', async () => {
    for (const path of [
      '/api/cortex-remote-mcp',
      '/api/cortex-remote-mcp/authorize',
      '/api/cortex-remote-mcp/.well-known/oauth-authorization-server',
      // ff-remote-mcp runs the same OAuth 2.1 flow on the same public, unauthenticated
      // basis, so it needs the identical treatment. It was omitted here once already.
      '/api/ff-remote-mcp',
      '/api/ff-remote-mcp/authorize',
      '/api/ff-remote-mcp/.well-known/oauth-authorization-server',
    ]) {
      const entry = apiRequestLog(
        await captureMiddlewareOutput(`https://app.fibreflow.app${path}?${QUERY}`),
      );
      const serialized = JSON.stringify(entry);

      expect(entry).not.toHaveProperty('query');
      for (const forbidden of QUERY.values()) {
        expect(serialized, `${path} leaked ${forbidden}`).not.toContain(forbidden);
      }
      for (const name of QUERY.keys()) {
        if (!path.includes(name)) {
          expect(serialized, `${path} leaked query name ${name}`).not.toContain(name);
        }
      }
      expect(entry).toMatchObject({ method: 'GET', path });
    }
  });

  it('suppresses only the MCP routes themselves, not name-prefixed siblings', async () => {
    // The suppression matches the exact path or a `/`-delimited child. Dropping that
    // trailing-slash requirement would silently hide the query of any future route whose
    // name merely STARTS with an MCP prefix — removing it from the audit log without
    // anyone asking. These siblings must keep logging normally.
    for (const path of ['/api/cortex-remote-mcp-admin/list', '/api/ff-remote-mcp-admin/list']) {
      const entry = apiRequestLog(
        await captureMiddlewareOutput(`https://app.fibreflow.app${path}?project=visible-project`),
      );
      expect(entry.query, `${path} should still log its query`).toEqual({
        project: 'visible-project',
      });
    }
  });

  it('preserves existing query visibility and secret redaction on unrelated APIs', async () => {
    const query = new URLSearchParams({
      project: 'visible-project',
      secret: 'hidden-cron-secret',
      vlmkey: 'hidden-vlm-secret',
    });
    const entry = apiRequestLog(
      await captureMiddlewareOutput(`https://app.fibreflow.app/api/projects?${query}`),
    );

    expect(entry.query).toEqual({
      project: 'visible-project',
      secret: '[redacted]',
      vlmkey: '[redacted]',
    });
    expect(JSON.stringify(entry)).not.toMatch(/hidden-cron-secret|hidden-vlm-secret/);
  });
});
