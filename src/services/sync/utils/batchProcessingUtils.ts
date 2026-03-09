/**
 * Batch Processing Utilities
 * Functions for batch processing and retry logic
 */

/**
 * Batch processing and retry utilities
 */
export class BatchProcessingUtils {
  /**
   * Batch process array items
   */
  static async batchProcess<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    batchSize: number = 10,
    delayMs: number = 100
  ): Promise<R[]> {
    const results: R[] = [];
    
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchPromises = batch.map((item, batchIndex) => 
        processor(item, i + batchIndex)
      );
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Add delay between batches to prevent overwhelming the system
      if (i + batchSize < items.length && delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    return results;
  }

  /**
   * Retry operation with exponential backoff
   */
  static async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelayMs: number = 1000
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt === maxRetries) {
          throw lastError;
        }
        
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError!;
  }

  /**
   * Process items with concurrency limit
   */
  static async processWithConcurrency<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    concurrencyLimit: number = 5
  ): Promise<R[]> {
    const results: R[] = [];
    const executing: Promise<void>[] = [];

    for (let i = 0; i < items.length; i++) {
      const promise = processor(items[i]!, i).then(result => {
        results[i] = result;
      });

      executing.push(promise);

      if (executing.length >= concurrencyLimit) {
        await Promise.race(executing);
        // Remove completed promises
        executing.splice(0, executing.length);
        executing.push(...executing.filter(p => p !== promise));
      }
    }

    await Promise.all(executing);
    return results;
  }

  /**
   * Retry with linear backoff
   */
  static async retryWithLinearBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delayMs: number = 1000
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt === maxRetries) {
          throw lastError;
        }
        
        const delay = delayMs * (attempt + 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError!;
  }

  /**
   * Process with timeout
   */
  static async processWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      operation(),
      new Promise<T>((_, reject) => 
        setTimeout(() => reject(new Error('Operation timed out')), timeoutMs)
      )
    ]);
  }

  /**
   * Batch process with results tracking
   */
  static async batchProcessWithTracking<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    batchSize: number = 10,
    delayMs: number = 100,
    onProgress?: (completed: number, total: number, results: R[]) => void
  ): Promise<{ 
    results: R[]; 
    errors: Array<{ index: number; error: Error }> 
  }> {
    const results: R[] = [];
    const errors: Array<{ index: number; error: Error }> = [];
    
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchPromises = batch.map(async (item, batchIndex) => {
        const globalIndex = i + batchIndex;
        try {
          const result = await processor(item, globalIndex);
          return { index: globalIndex, result, error: null };
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          return { index: globalIndex, result: null, error: err };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      
      // Process batch results
      batchResults.forEach(({ index, result, error }) => {
        if (error) {
          errors.push({ index, error });
        } else {
          results[index] = result as R;
        }
      });
      
      // Report progress
      if (onProgress) {
        const completed = Math.min(i + batchSize, items.length);
        onProgress(completed, items.length, results);
      }
      
      // Add delay between batches
      if (i + batchSize < items.length && delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    return { results, errors };
  }

  /**
   * Parallel map with error handling
   */
  static async parallelMap<T, R>(
    items: T[],
    mapper: (item: T, index: number) => Promise<R>,
    options: {
      concurrency?: number;
      continueOnError?: boolean;
      timeout?: number;
    } = {}
  ): Promise<Array<{ result?: R; error?: Error; index: number }>> {
    const { concurrency = 10, continueOnError = true, timeout } = options;
    const results: Array<{ result?: R; error?: Error; index: number }> = [];
    const semaphore = new Array(concurrency).fill(0);

    const processItem = async (item: T, index: number): Promise<void> => {
      try {
        let result: R;
        
        if (timeout) {
          result = await this.processWithTimeout(() => mapper(item, index), timeout);
        } else {
          result = await mapper(item, index);
        }
        
        results[index] = { result, index };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        results[index] = { error: err, index };
        
        if (!continueOnError) {
          throw err;
        }
      }
    };

    // Process items with concurrency control
    const promises = items.map(async (item, index) => {
      // Wait for available slot
      await new Promise<void>((resolve) => {
        const checkSlot = () => {
          const availableIndex = semaphore.findIndex(slot => slot === 0);
          if (availableIndex !== -1) {
            semaphore[availableIndex] = 1;
            resolve();
          } else {
            setTimeout(checkSlot, 10);
          }
        };
        checkSlot();
      });

      try {
        await processItem(item, index);
      } finally {
        // Release slot
        const usedIndex = semaphore.findIndex(slot => slot === 1);
        if (usedIndex !== -1) {
          semaphore[usedIndex] = 0;
        }
      }
    });

    await Promise.all(promises);
    return results;
  }
}