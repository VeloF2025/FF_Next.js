/**
 * Worker Messenger
 * Sends messages to workers
 */

import type { WorkerMessage, WorkerResponse } from '../../../types';
import { MessageHandler } from './MessageHandler';

export class WorkerMessenger {
  private messageHandler: MessageHandler;

  constructor(messageHandler: MessageHandler) {
    this.messageHandler = messageHandler;
  }

  /**
   * Send message to worker
   */
  public sendMessage(
    worker: Worker,
    message: WorkerMessage,
    handler: (response: WorkerResponse) => void
  ): void {
    // Register handler for response
    this.messageHandler.registerHandler(message.id, handler);

    // Send message to worker
    worker.postMessage(message);
  }

  /**
   * Send message without expecting response
   */
  public sendMessageNoResponse(worker: Worker, message: WorkerMessage): void {
    worker.postMessage(message);
  }

  /**
   * Cancel message handler
   */
  public cancelMessage(messageId: string): void {
    this.messageHandler.unregisterHandler(messageId);
  }
}
