/**
 * Error class for the VLM photo categorization pipeline.
 *
 * Lives in its own file (rather than next to `categorizePhotos`) to break the
 * circular import between `categorizationVlmService` and `categorizationVlmClient`.
 * `categorizationVlmService` continues to re-export it so existing consumers
 * keep a stable import path.
 */

export class CategorizationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'CategorizationError';
  }
}
