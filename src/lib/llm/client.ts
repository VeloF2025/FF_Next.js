/**
 * OpenAI Client Singleton
 *
 * Provides a lazily-initialised, shared OpenAI SDK instance.
 * Throws early with a clear message if OPENAI_API_KEY is absent
 * so misconfiguration surfaces at call-time rather than silently.
 *
 * // WORKING: singleton initialised on first call, reused thereafter
 */

import OpenAI from 'openai';

/** Cached instance — null until first call to getOpenAIClient(). */
let instance: OpenAI | null = null;

/**
 * Returns the shared OpenAI client, creating it on first use.
 *
 * @throws {Error} When OPENAI_API_KEY is not set in the environment.
 * @returns Configured OpenAI SDK instance.
 * @remarks OPENAI_BASE_URL is read once on first call and frozen in the singleton.
 * Tests that change process.env.OPENAI_BASE_URL after module import must call
 * vi.resetModules() and re-import to pick up the new value.
 */
export function getOpenAIClient(): OpenAI {
  if (!instance) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    instance = new OpenAI({
      apiKey,
      ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}),
    });
  }
  return instance;
}
