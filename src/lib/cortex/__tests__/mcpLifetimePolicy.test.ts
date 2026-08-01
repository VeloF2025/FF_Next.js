import { describe, expect, it } from 'vitest';
import {
  CORTEX_MCP_LIFETIMES,
  CORTEX_MCP_LIFETIME_DAYS,
  isCortexMcpLifetime,
} from '../mcpLifetimePolicy';

describe('Cortex MCP manual lifetime policy', () => {
  it('admits exactly the four approved values', () => {
    expect(CORTEX_MCP_LIFETIMES).toEqual(['30d', '90d', '1y', 'never']);
    for (const value of CORTEX_MCP_LIFETIMES) {
      expect(isCortexMcpLifetime(value)).toBe(true);
    }
  });

  it.each([undefined, null, 365, '', 'forever', 'Never', '1 year'])(
    'rejects an unrecognized lifetime: %s',
    (value) => expect(isCortexMcpLifetime(value)).toBe(false),
  );

  it('maps never to no expiry duration', () => {
    expect(CORTEX_MCP_LIFETIME_DAYS).toEqual({
      '30d': 30,
      '90d': 90,
      '1y': 365,
      never: null,
    });
  });
});
