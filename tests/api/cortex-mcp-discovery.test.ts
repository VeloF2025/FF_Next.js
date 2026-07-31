import { describe, expect, it } from 'vitest';

import nextConfig from '../../next.config';
import { buildResourceMetadata } from '../../pages/api/mcp/resource-metadata';

describe('Cortex MCP discovery', () => {
  it('keeps a dev connector on the dev authorization server', () => {
    expect(buildResourceMetadata({ host: 'dev.fibreflow.app' }, 'cortex')).toEqual({
      resource: 'https://dev.fibreflow.app/api/cortex-remote-mcp/mcp',
      authorization_servers: [
        'https://dev.fibreflow.app/api/cortex-remote-mcp',
      ],
      scopes_supported: ['cortex.read'],
      bearer_methods_supported: ['header'],
    });
  });

  it('publishes the standard protected-resource and authorization-server rewrites', async () => {
    const rewrites = await nextConfig.rewrites();

    expect(rewrites).toEqual(expect.arrayContaining([
      {
        source: '/.well-known/oauth-authorization-server/api/ff-remote-mcp',
        destination:
          '/api/ff-remote-mcp/.well-known/oauth-authorization-server/api/ff-remote-mcp',
      },
      {
        source: '/.well-known/oauth-protected-resource/api/cortex-remote-mcp/mcp',
        destination: '/api/mcp/resource-metadata?connector=cortex',
      },
      {
        source: '/.well-known/oauth-authorization-server/api/cortex-remote-mcp',
        destination:
          '/api/cortex-remote-mcp/.well-known/oauth-authorization-server/api/cortex-remote-mcp',
      },
    ]));
  });
});
