// scripts/vlm-bench/vlmCall.ts
import * as fs from 'fs';
import { VLM_CHAT_ENDPOINT, VLM_MODELS_ENDPOINT } from '@/lib/vlm';
import type { VlmRequest } from './types';

/** Returns true if the VLM is reachable and a model is loaded. */
export async function vlmHealthy(): Promise<boolean> {
  try {
    const res = await fetch(VLM_MODELS_ENDPOINT, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const body = await res.json();
    return Array.isArray(body?.data) && body.data.length > 0;
  } catch {
    return false;
  }
}

/** Calls the VLM; returns the assistant text. Throws on transport/HTTP error. */
export async function vlmComplete(req: VlmRequest, timeoutMs = 60000): Promise<string> {
  const res = await fetch(VLM_CHAT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`VLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const body = await res.json();
  return body?.choices?.[0]?.message?.content ?? '';
}

/** Reads an image file and returns a data: URL for embedding in a request. */
export function fileToDataUrl(absPath: string): string {
  const b64 = fs.readFileSync(absPath).toString('base64');
  return `data:image/jpeg;base64,${b64}`;
}
