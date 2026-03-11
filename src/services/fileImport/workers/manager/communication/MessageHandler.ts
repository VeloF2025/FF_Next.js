/**
 * Message Handler
 * Routes messages from workers to appropriate handlers
 */

import type { WorkerResponse } from '../../../types';

export class MessageHandler {
  private handlers: Map<string, (response: WorkerResponse) => void> = new Map();

  /**
   * Register handler for message ID
   */
  public registerHandler(id: string, handler: (response: WorkerResponse) => void): void {
    this.handlers.set(id, handler);
  }

  /**
   * Unregister handler for message ID
   */
  public unregisterHandler(id: string): void {
    this.handlers.delete(id);
  }

  /**
   * Handle incoming message from worker
   */
  public handleMessage(event: MessageEvent<WorkerResponse>): void {
    const response = event.data;
    const handler = this.handlers.get(response.id);

    if (handler) {
      handler(response);
    }
  }

  /**
   * Clear all handlers
   */
  public clearHandlers(): void {
    this.handlers.clear();
  }

  /**
   * Get number of registered handlers
   */
  public getHandlerCount(): number {
    return this.handlers.size;
  }

  /**
   * Check if handler exists for ID
   */
  public hasHandler(id: string): boolean {
    return this.handlers.has(id);
  }
}
