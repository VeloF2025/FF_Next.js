import { api } from '@/lib/api';
import { NeonPoleData, NeonDropData, NeonFibreData } from '@/services/sow/types';
import { log } from '@/lib/logger';

export const sowApi = {
  /**
   * Initialize SOW tables for a project
   */
  async initializeTables(projectId: string) {
    const response = await fetch('/api/sow/initialize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ projectId }),
    });
    return response.json();
  },

  /**
   * Upload poles data (supports chunked uploads)
   */
  async uploadPoles(projectId: string, poles: NeonPoleData[]) {
    // For large datasets, split into chunks to avoid payload size limits
    const CHUNK_SIZE = 300; // Conservative chunk size for Vercel
    
    if (poles.length <= CHUNK_SIZE) {
      // Small dataset, upload directly
      return this._uploadPolesChunk(projectId, poles);
    }
    
    // Large dataset, upload in chunks
    log.debug('sowApi', { message: `Uploading ${poles.length} poles in chunks of ${CHUNK_SIZE}` });
    let totalInserted = 0;
    let totalUpdated = 0;
    const allErrors: any[] = [];
    
    for (let i = 0; i < poles.length; i += CHUNK_SIZE) {
      const chunk = poles.slice(i, i + CHUNK_SIZE);
      const chunkNumber = Math.floor(i / CHUNK_SIZE) + 1;
      const totalChunks = Math.ceil(poles.length / CHUNK_SIZE);

      log.debug('sowApi', { message: `Uploading chunk ${chunkNumber}/${totalChunks} (${chunk.length} poles)` });

      try {
        const result = await this._uploadPolesChunk(projectId, chunk);
        totalInserted += result.inserted || 0;
        totalUpdated += result.updated || 0;
        if (result.errors) {
          allErrors.push(...result.errors);
        }
      } catch (error) {
        log.error('sowApi', { error, message: `Chunk ${chunkNumber} failed` });
        throw new Error(`Failed at chunk ${chunkNumber}/${totalChunks}: ${error.message}`);
      }
      
      // Small delay between chunks
      if (i + CHUNK_SIZE < poles.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return {
      success: true,
      inserted: totalInserted,
      updated: totalUpdated,
      errors: allErrors,
      message: `Successfully uploaded ${poles.length} poles in ${Math.ceil(poles.length / CHUNK_SIZE)} chunks`
    };
  },

  /**
   * Upload a single chunk of poles data
   */
  async _uploadPolesChunk(projectId: string, poles: NeonPoleData[]) {
    const response = await fetch('/api/sow/poles', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ projectId, poles }),
    });

    // Check if response is OK and is JSON
    if (!response.ok) {
      const text = await response.text();
      log.error('sowApi', { message: 'Upload poles failed', status: response.status, text });
      throw new Error(`Upload failed: ${response.status} - ${text.substring(0, 100)}`);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      log.error('sowApi', { message: 'Non-JSON response', text: text.substring(0, 200) });
      throw new Error('Server returned non-JSON response');
    }

    return response.json();
  },

  /**
   * Get poles data
   */
  async getPoles(projectId: string) {
    const response = await fetch(`/api/sow/poles?projectId=${projectId}`);
    return response.json();
  },

  /**
   * Upload drops data (supports chunked uploads)
   */
  async uploadDrops(projectId: string, drops: NeonDropData[]) {
    // For large datasets, split into chunks to avoid payload size limits
    const CHUNK_SIZE = 250; // Conservative chunk size for Vercel
    
    if (drops.length <= CHUNK_SIZE) {
      // Small dataset, upload directly (clear existing first)
      return this._uploadDropsChunk(projectId, drops, true);
    }
    
    // Large dataset, upload in chunks
    log.debug('sowApi', { message: `Uploading ${drops.length} drops in chunks of ${CHUNK_SIZE}` });
    let totalInserted = 0;
    let totalUpdated = 0;
    const allErrors: any[] = [];
    
    for (let i = 0; i < drops.length; i += CHUNK_SIZE) {
      const chunk = drops.slice(i, i + CHUNK_SIZE);
      const chunkNumber = Math.floor(i / CHUNK_SIZE) + 1;
      const totalChunks = Math.ceil(drops.length / CHUNK_SIZE);

      log.debug('sowApi', { message: `Uploading chunk ${chunkNumber}/${totalChunks} (${chunk.length} drops)` });

      try {
        // Only clear existing data on first chunk
        const clearExisting = chunkNumber === 1;
        const result = await this._uploadDropsChunk(projectId, chunk, clearExisting);
        totalInserted += result.inserted || 0;
        totalUpdated += result.updated || 0;
        if (result.errors) {
          allErrors.push(...result.errors);
        }
      } catch (error) {
        log.error('sowApi', { error, message: `Chunk ${chunkNumber} failed` });
        throw new Error(`Failed at chunk ${chunkNumber}/${totalChunks}: ${error.message}`);
      }
      
      // Small delay between chunks to avoid overwhelming the serverless function
      if (i + CHUNK_SIZE < drops.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return {
      success: true,
      inserted: totalInserted,
      updated: totalUpdated,
      errors: allErrors,
      message: `Successfully uploaded ${drops.length} drops in ${Math.ceil(drops.length / CHUNK_SIZE)} chunks`
    };
  },

  /**
   * Upload a single chunk of drops data
   */
  async _uploadDropsChunk(projectId: string, drops: NeonDropData[], clearExisting = false) {
    const response = await fetch('/api/sow/drops', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ projectId, drops, clearExisting }),
    });

    // Check if response is OK and is JSON
    if (!response.ok) {
      const text = await response.text();
      log.error('sowApi', { message: 'Upload drops failed', status: response.status, text });
      throw new Error(`Upload failed: ${response.status} - ${text.substring(0, 100)}`);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      log.error('sowApi', { message: 'Non-JSON response', text: text.substring(0, 200) });
      throw new Error('Server returned non-JSON response');
    }

    return response.json();
  },

  /**
   * Get drops data
   */
  async getDrops(projectId: string) {
    const response = await fetch(`/api/sow/drops?projectId=${projectId}`);
    return response.json();
  },

  /**
   * Upload fibre data (supports chunked uploads)
   */
  async uploadFibre(projectId: string, fibres: NeonFibreData[]) {
    // For large datasets, split into chunks to avoid payload size limits
    const CHUNK_SIZE = 200; // Conservative chunk size for Vercel (fibre data can be larger)
    
    if (fibres.length <= CHUNK_SIZE) {
      // Small dataset, upload directly
      return this._uploadFibreChunk(projectId, fibres);
    }
    
    // Large dataset, upload in chunks
    log.debug('sowApi', { message: `Uploading ${fibres.length} fibre records in chunks of ${CHUNK_SIZE}` });
    let totalInserted = 0;
    let totalUpdated = 0;
    const allErrors: any[] = [];
    
    for (let i = 0; i < fibres.length; i += CHUNK_SIZE) {
      const chunk = fibres.slice(i, i + CHUNK_SIZE);
      const chunkNumber = Math.floor(i / CHUNK_SIZE) + 1;
      const totalChunks = Math.ceil(fibres.length / CHUNK_SIZE);

      log.debug('sowApi', { message: `Uploading chunk ${chunkNumber}/${totalChunks} (${chunk.length} fibre records)` });

      try {
        const result = await this._uploadFibreChunk(projectId, chunk);
        totalInserted += result.inserted || 0;
        totalUpdated += result.updated || 0;
        if (result.errors) {
          allErrors.push(...result.errors);
        }
      } catch (error) {
        log.error('sowApi', { error, message: `Chunk ${chunkNumber} failed` });
        throw new Error(`Failed at chunk ${chunkNumber}/${totalChunks}: ${error.message}`);
      }
      
      // Small delay between chunks
      if (i + CHUNK_SIZE < fibres.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return {
      success: true,
      inserted: totalInserted,
      updated: totalUpdated,
      errors: allErrors,
      message: `Successfully uploaded ${fibres.length} fibre records in ${Math.ceil(fibres.length / CHUNK_SIZE)} chunks`
    };
  },

  /**
   * Upload a single chunk of fibre data
   */
  async _uploadFibreChunk(projectId: string, fibres: NeonFibreData[]) {
    const response = await fetch('/api/sow/fibre', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ projectId, fibres }),
    });

    if (!response.ok) {
      const text = await response.text();
      log.error('sowApi', { message: 'Upload fibre failed', status: response.status, text });
      throw new Error(`Upload failed: ${response.status} - ${text.substring(0, 100)}`);
    }

    return response.json();
  },

  /**
   * Get fibre data
   */
  async getFibre(projectId: string) {
    const response = await fetch(`/api/sow/fibre?projectId=${projectId}`);
    return response.json();
  },

  /**
   * Get all SOW data for a project
   */
  async getProjectSOWData(projectId: string) {
    const response = await fetch(`/api/sow/project?projectId=${projectId}`);
    return response.json();
  },

  /**
   * Get SOW summary for projects
   */
  async getSOWSummary(projectIds?: string[]) {
    const params = projectIds ? `?projectIds=${projectIds.join(',')}` : '';
    const response = await fetch(`/api/sow/summary${params}`);
    return response.json();
  },

  /**
   * Check SOW service health
   */
  async checkHealth() {
    const response = await fetch('/api/sow/health');
    return response.json();
  },
};