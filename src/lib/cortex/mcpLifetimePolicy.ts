export const CORTEX_MCP_LIFETIMES = ['30d', '90d', '1y', 'never'] as const;
export type CortexMcpLifetime = (typeof CORTEX_MCP_LIFETIMES)[number];

export const CORTEX_MCP_LIFETIME_DAYS: Record<CortexMcpLifetime, number | null> = {
  '30d': 30,
  '90d': 90,
  '1y': 365,
  never: null,
};

export function isCortexMcpLifetime(value: unknown): value is CortexMcpLifetime {
  return typeof value === 'string'
    && (CORTEX_MCP_LIFETIMES as readonly string[]).includes(value);
}
