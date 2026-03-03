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
 */
export function getOpenAIClient(): OpenAI {
  if (!instance) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    instance = new OpenAI({ apiKey });
  }
  return instance;
}
