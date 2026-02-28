/**
 * Anthropic Client Singleton
 *
 * Provides a lazily-initialised, shared Anthropic SDK instance.
 * Throws early with a clear message if ANTHROPIC_API_KEY is absent
 * so misconfiguration surfaces at call-time rather than silently.
 *
 * // WORKING: singleton initialised on first call, reused thereafter
 */

import Anthropic from '@anthropic-ai/sdk';

/** Cached instance — null until first call to getAnthropicClient(). */
let instance: Anthropic | null = null;

/**
 * Returns the shared Anthropic client, creating it on first use.
 *
 * @throws {Error} When ANTHROPIC_API_KEY is not set in the environment.
 * @returns Configured Anthropic SDK instance.
 */
export function getAnthropicClient(): Anthropic {
  if (!instance) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }
    instance = new Anthropic({ apiKey });
  }
  return instance;
}
