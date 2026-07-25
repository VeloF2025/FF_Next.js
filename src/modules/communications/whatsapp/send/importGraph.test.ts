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

/** Module specifiers of every static import/re-export in a file. */
function importSpecifiers(src: string): string[] {
  return [...src.matchAll(/(?:^|\n)\s*(?:import|export)[^'"\n]*from\s*['"]([^'"]+)['"]/g)].map((m) => m[1] as string);
}

const WA_SEND_CLIENT = 'src/modules/communications/whatsapp/send/waSendClient.ts';
const WAHA_DM_CLIENT = 'src/modules/communications/whatsapp/send/wahaDmClient.ts';
const WHATSAPP_DELIVERY = 'src/modules/notifications/services/whatsappDelivery.ts';

describe('WhatsApp send-path import graph', () => {
  it('waSendClient no longer imports the notifications delivery service', () => {
    const specs = importSpecifiers(source(WA_SEND_CLIENT));
    expect(specs.some((s) => s.includes('whatsappDelivery'))).toBe(false);
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
