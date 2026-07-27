/**
 * Structural guard on the WhatsApp send-path import graph.
 *
 * whatsappDelivery.ts and waSendClient.ts used to import each other:
 * whatsappDelivery needed the provider-aware sender for its DM branch, and
 * waSendClient needed the raw WAHA sender that happened to live in
 * whatsappDelivery. The raw sender now lives in wahaDmClient.ts, which imports
 * nothing, so the cycle is gone.
 *
 * These assertions are on source text rather than behaviour on purpose — a
 * cycle is a property of the module graph, and nothing else in the suite would
 * notice it coming back.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..', '..');

function source(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

/**
 * Module specifiers of every static import/re-export in a file.
 *
 * Whitespace is collapsed first so a multi-line import clause — the normal
 * result of an import list growing and being reformatted — is still matched.
 * Without that, reintroducing the cycle via a wrapped import would silently
 * find nothing and every assertion below would pass while the cycle was back.
 */
function importSpecifiers(src: string): string[] {
  const flattened = src.replace(/\s+/g, ' ');
  return [...flattened.matchAll(/\b(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1] as string);
}

const WA_SEND_CLIENT = 'src/modules/communications/whatsapp/send/waSendClient.ts';
const WAHA_DM_CLIENT = 'src/modules/communications/whatsapp/send/wahaDmClient.ts';
const WHATSAPP_DELIVERY = 'src/modules/notifications/services/whatsappDelivery.ts';

describe('importSpecifiers', () => {
  it('finds single-line imports', () => {
    expect(importSpecifiers(`import { a } from './x';`)).toEqual(['./x']);
  });

  // The false-negative this guard exists to avoid: if a wrapped import were
  // missed, a reintroduced cycle would read as "no cycle".
  it('finds an import whose clause is wrapped across lines', () => {
    const src = [
      'import {',
      '  sendWhatsAppDM,',
      '  deliverWhatsApp,',
      "} from '@/modules/notifications/services/whatsappDelivery';",
    ].join('\n');

    expect(importSpecifiers(src)).toContain('@/modules/notifications/services/whatsappDelivery');
  });

  it('finds re-exports and type-only imports', () => {
    expect(importSpecifiers(`export type { A } from './types';`)).toContain('./types');
    expect(importSpecifiers(`import type { B } from './b';`)).toContain('./b');
  });

  it('returns nothing for a file with no imports', () => {
    expect(importSpecifiers('export const x = 1;\nexport function y() { return 2; }\n')).toEqual([]);
  });
});

describe('WhatsApp send-path import graph', () => {
  it('waSendClient no longer imports the notifications delivery service', () => {
    const specs = importSpecifiers(source(WA_SEND_CLIENT));
    expect(specs.some((s) => s.includes('whatsappDelivery'))).toBe(false);
  });

  // Belt and braces, immune to any parsing subtlety: the name must not appear
  // in that file at all. If a future change needs to mention it in a comment,
  // that should be a conscious decision made while looking at this test.
  it('waSendClient does not mention whatsappDelivery anywhere', () => {
    expect(source(WA_SEND_CLIENT)).not.toContain('whatsappDelivery');
  });

  it('both senders take the raw WAHA call from the shared module', () => {
    expect(importSpecifiers(source(WA_SEND_CLIENT)).some((s) => s.includes('wahaDmClient'))).toBe(true);
    expect(importSpecifiers(source(WHATSAPP_DELIVERY)).some((s) => s.includes('wahaDmClient'))).toBe(true);
  });

  // Dependency-free is what makes it safe for both sides to depend on: it can
  // never be dragged back into a cycle by one of its own imports.
  it('wahaDmClient imports nothing at all', () => {
    expect(importSpecifiers(source(WAHA_DM_CLIENT))).toEqual([]);
  });

  it('there is no cycle between the two senders', () => {
    const delivery = importSpecifiers(source(WHATSAPP_DELIVERY));
    const sendClient = importSpecifiers(source(WA_SEND_CLIENT));

    const deliveryReachesSendClient = delivery.some((s) => s.includes('waSendClient'));
    const sendClientReachesDelivery = sendClient.some((s) => s.includes('whatsappDelivery'));

    // whatsappDelivery still depends on waSendClient — that edge is Phase 3's
    // provider-aware DM routing and must stay. What must never come back is
    // the return edge that closed the loop.
    expect(deliveryReachesSendClient && sendClientReachesDelivery).toBe(false);
  });
});
