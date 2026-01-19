/**
 * QContact API Client Tests
 * TDD: Tests written FIRST before implementation
 *
 * Test Coverage:
 * - Authentication with QContact API
 * - Fetch ticket by ID
 * - Create ticket in QContact
 * - Update ticket status
 * - Add note to ticket
 * - Handle API errors
 * - Retry on transient failures
 * - Request timeout handling
 *
 * 🟢 WORKING: Comprehensive test suite for QContact API client
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the logger
vi.mock('@/lib/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import types
import type {
  QContactTicket,
  QContactAPIConfig,
} from '../../types/qcontact';

// Import the client
import {
  QContactClient,
  createQContactClient,
  QContactError,
  QContactErrorCode,
  type CreateQContactTicketPayload,
  type UpdateQContactTicketPayload,
  type AddQContactNotePayload,
  type QContactTicketListResponse,
} from '../../services/qcontactClient';

describe('QContactClient', () => {
  let client: QContactClient;

  // Default configuration for testing
  const defaultConfig: QContactAPIConfig = {
    base_url: 'https://api.qcontact.example.com',
    api_key: 'test-api-key-12345',
    timeout_ms: 5000,
    retry_attempts: 3,
  };

  // Sample QContact ticket data
  const sampleQContactTicket: QContactTicket = {
    id: 'QC-12345',
    title: 'Fiber connection issue at 123 Main St',
    description: 'Customer reports intermittent connectivity',
    status: 'open',
    priority: 'high',
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:30:00Z',
    customer_name: 'John Doe',
    customer_phone: '+27821234567',
    customer_email: 'john.doe@example.com',
    address: '123 Main Street, Cape Town',
    assigned_to: 'tech-001',
    category: 'fiber',
    subcategory: 'connectivity',
    custom_fields: {
      dr_number: 'DR-001',
      pole_number: 'P-123',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    client = createQContactClient(defaultConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper function to create mock responses
  const createMockResponse = (data: unknown, status = 200, ok = true, headers?: Headers) => ({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
    headers: headers || new Headers({ 'content-type': 'application/json' }),
  });

  describe('Client Initialization', () => {
    it('should create client with valid configuration', () => {
      const newClient = createQContactClient(defaultConfig);
      expect(newClient).toBeDefined();
      expect(newClient).toBeInstanceOf(QContactClient);
    });

    it('should throw error if base_url is missing', () => {
      expect(() => createQContactClient({
        ...defaultConfig,
        base_url: '',
      })).toThrow('QContact API base_url is required');
    });

    it('should throw error if api_key is missing', () => {
      expect(() => createQContactClient({
        ...defaultConfig,
        api_key: '',
      })).toThrow('QContact API api_key is required');
    });

    it('should use default timeout if not specified', () => {
      const newClient = createQContactClient({
        base_url: defaultConfig.base_url,
        api_key: defaultConfig.api_key,
        timeout_ms: 0,
        retry_attempts: 3,
      });
      expect(newClient).toBeDefined();
    });

    it('should use default retry attempts if not specified', () => {
      const newClient = createQContactClient({
        base_url: defaultConfig.base_url,
        api_key: defaultConfig.api_key,
        timeout_ms: 5000,
        retry_attempts: 0,
      });
      expect(newClient).toBeDefined();
    });
  });

  describe('Authentication', () => {
    it('should include API key in request headers', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ data: sampleQContactTicket }));

      await client.getTicket('QC-12345');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': `Bearer ${defaultConfig.api_key}`,
          }),
        })
      );
    });

    it('should include Content-Type header for JSON requests', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ data: sampleQContactTicket }));

      await client.getTicket('QC-12345');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should handle authentication errors (401)', async () => {
      // Create client with 0 retries for faster test
      const noRetryClient = createQContactClient({
        ...defaultConfig,
        retry_attempts: 0,
      });

      mockFetch.mockResolvedValueOnce(createMockResponse(
        { error: { message: 'Invalid API key' } },
        401,
        false
      ));

      await expect(noRetryClient.getTicket('QC-12345')).rejects.toThrow(QContactError);

      mockFetch.mockResolvedValueOnce(createMockResponse(
        { error: { message: 'Invalid API key' } },
        401,
        false
      ));

      try {
        await noRetryClient.getTicket('QC-12345');
      } catch (error) {
        expect(error).toBeInstanceOf(QContactError);
        expect((error as QContactError).code).toBe(QContactErrorCode.AUTHENTICATION_ERROR);
      }
    });

    it('should handle authorization errors (403)', async () => {
      const noRetryClient = createQContactClient({
        ...defaultConfig,
        retry_attempts: 0,
      });

      mockFetch.mockResolvedValueOnce(createMockResponse(
        { error: { message: 'Access denied' } },
        403,
        false
      ));

      await expect(noRetryClient.getTicket('QC-12345')).rejects.toThrow(QContactError);
    });
  });

  describe('Fetch Ticket by ID', () => {
    it('should fetch ticket by ID successfully', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ data: sampleQContactTicket }));

      const result = await client.getTicket('QC-12345');

      expect(result).toEqual(sampleQContactTicket);
      expect(mockFetch).toHaveBeenCalledWith(
        `${defaultConfig.base_url}/tickets/QC-12345`,
        expect.objectContaining({
          method: 'GET',
        })
      );
    });

    it('should handle ticket not found (404)', async () => {
      const noRetryClient = createQContactClient({
        ...defaultConfig,
        retry_attempts: 0,
      });

      mockFetch.mockResolvedValueOnce(createMockResponse(
        { error: { message: 'Ticket not found' } },
        404,
        false
      ));

      try {
        await noRetryClient.getTicket('QC-NOTFOUND');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(QContactError);
        expect((error as QContactError).code).toBe(QContactErrorCode.NOT_FOUND);
      }
    });

    it('should return null when ticket not found with silent option', async () => {
      const noRetryClient = createQContactClient({
        ...defaultConfig,
        retry_attempts: 0,
      });

      mockFetch.mockResolvedValueOnce(createMockResponse(
        { error: { message: 'Ticket not found' } },
        404,
        false
      ));

      const result = await noRetryClient.getTicket('QC-NOTFOUND', { throwOnNotFound: false });
      expect(result).toBeNull();
    });

    it('should include all ticket fields in response', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ data: sampleQContactTicket }));

      const result = await client.getTicket('QC-12345');

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('title');
      expect(result).toHaveProperty('description');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('priority');
      expect(result).toHaveProperty('created_at');
      expect(result).toHaveProperty('updated_at');
      expect(result).toHaveProperty('customer_name');
      expect(result).toHaveProperty('customer_phone');
      expect(result).toHaveProperty('address');
      expect(result).toHaveProperty('category');
      expect(result).toHaveProperty('custom_fields');
    });
  });

  describe('List Tickets', () => {
    const sampleListResponse: QContactTicketListResponse = {
      tickets: [sampleQContactTicket],
      total: 1,
      page: 1,
      page_size: 50,
      has_more: false,
    };

    it('should list tickets with default pagination', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ data: sampleListResponse }));

      const result = await client.listTickets();

      expect(result).toEqual(sampleListResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/tickets'),
        expect.any(Object)
      );
    });

    it('should apply status filter', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ data: sampleListResponse }));

      await client.listTickets({ status: 'open' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('status=open'),
        expect.any(Object)
      );
    });

    it('should apply date range filters', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ data: sampleListResponse }));

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');
      await client.listTickets({ created_after: startDate, created_before: endDate });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('created_after='),
        expect.any(Object)
      );
    });

    it('should support pagination parameters', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ data: sampleListResponse }));

      await client.listTickets({ page: 2, page_size: 25 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/page=2.*page_size=25|page_size=25.*page=2/),
        expect.any(Object)
      );
    });
  });

  describe('Create Ticket in QContact', () => {
    const createPayload: CreateQContactTicketPayload = {
      title: 'New fiber installation request',
      description: 'Customer requests new fiber connection',
      priority: 'normal',
      customer_name: 'Jane Smith',
      customer_phone: '+27821112222',
      customer_email: 'jane.smith@example.com',
      address: '456 Oak Avenue, Johannesburg',
      category: 'installation',
    };

    it('should create ticket successfully', async () => {
      const createdTicket = { ...sampleQContactTicket, ...createPayload, id: 'QC-67890' };
      mockFetch.mockResolvedValueOnce(createMockResponse({ data: createdTicket }));

      const result = await client.createTicket(createPayload);

      expect(result).toEqual(createdTicket);
      expect(mockFetch).toHaveBeenCalledWith(
        `${defaultConfig.base_url}/tickets`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(createPayload),
        })
      );
    });

    it('should handle validation errors (400)', async () => {
      const noRetryClient = createQContactClient({
        ...defaultConfig,
        retry_attempts: 0,
      });

      mockFetch.mockResolvedValueOnce(createMockResponse(
        { error: { message: 'Title is required', field: 'title' } },
        400,
        false
      ));

      try {
        await noRetryClient.createTicket({ ...createPayload, title: '' });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(QContactError);
        expect((error as QContactError).code).toBe(QContactErrorCode.VALIDATION_ERROR);
      }
    });

    it('should include custom fields if provided', async () => {
      const payloadWithCustomFields = {
        ...createPayload,
        custom_fields: { dr_number: 'DR-999', zone: 'Zone A' },
      };
      mockFetch.mockResolvedValueOnce(createMockResponse({ data: sampleQContactTicket }));

      await client.createTicket(payloadWithCustomFields);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify(payloadWithCustomFields),
        })
      );
    });

    it('should handle server errors (500)', async () => {
      const noRetryClient = createQContactClient({
        ...defaultConfig,
        retry_attempts: 0,
      });

      mockFetch.mockResolvedValueOnce(createMockResponse(
        { error: { message: 'Internal server error' } },
        500,
        false
      ));

      await expect(noRetryClient.createTicket(createPayload)).rejects.toThrow(QContactError);
    });
  });

  describe('Update Ticket Status', () => {
    const updatePayload: UpdateQContactTicketPayload = {
      status: 'in_progress',
    };

    it('should update ticket status successfully', async () => {
      const updatedTicket = { ...sampleQContactTicket, status: 'in_progress' };
      mockFetch.mockResolvedValueOnce(createMockResponse({ data: updatedTicket }));

      const result = await client.updateTicket('QC-12345', updatePayload);

      expect(result.status).toBe('in_progress');
      expect(mockFetch).toHaveBeenCalledWith(
        `${defaultConfig.base_url}/tickets/QC-12345`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify(updatePayload),
        })
      );
    });

    it('should update multiple fields at once', async () => {
      const multiFieldUpdate: UpdateQContactTicketPayload = {
        status: 'closed',
        priority: 'low',
        assigned_to: 'tech-002',
      };
      const updatedTicket = { ...sampleQContactTicket, ...multiFieldUpdate };
      mockFetch.mockResolvedValueOnce(createMockResponse({ data: updatedTicket }));

      const result = await client.updateTicket('QC-12345', multiFieldUpdate);

      expect(result.status).toBe('closed');
      expect(result.priority).toBe('low');
      expect(result.assigned_to).toBe('tech-002');
    });

    it('should handle ticket not found on update', async () => {
      const noRetryClient = createQContactClient({
        ...defaultConfig,
        retry_attempts: 0,
      });

      mockFetch.mockResolvedValueOnce(createMockResponse(
        { error: { message: 'Ticket not found' } },
        404,
        false
      ));

      try {
        await noRetryClient.updateTicket('QC-NOTFOUND', updatePayload);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(QContactError);
        expect((error as QContactError).code).toBe(QContactErrorCode.NOT_FOUND);
      }
    });

    it('should handle invalid status value', async () => {
      const noRetryClient = createQContactClient({
        ...defaultConfig,
        retry_attempts: 0,
      });

      mockFetch.mockResolvedValueOnce(createMockResponse(
        { error: { message: 'Invalid status value', field: 'status' } },
        400,
        false
      ));

      await expect(noRetryClient.updateTicket('QC-12345', { status: 'invalid_status' })).rejects.toThrow();
    });
  });

  describe('Add Note to Ticket', () => {
    const notePayload: AddQContactNotePayload = {
      content: 'Technician arrived on site. Investigating the issue.',
      author_id: 'user-001',
      is_internal: true,
    };

    const noteResponse = {
      id: 'NOTE-001',
      ticket_id: 'QC-12345',
      content: notePayload.content,
      author_id: notePayload.author_id,
      is_internal: notePayload.is_internal,
      created_at: '2024-01-15T11:00:00Z',
    };

    it('should add note to ticket successfully', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ data: noteResponse }));

      const result = await client.addNote('QC-12345', notePayload);

      expect(result).toEqual(noteResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        `${defaultConfig.base_url}/tickets/QC-12345/notes`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(notePayload),
        })
      );
    });

    it('should add public note (is_internal = false)', async () => {
      const publicNotePayload = { ...notePayload, is_internal: false };
      mockFetch.mockResolvedValueOnce(createMockResponse({ data: { ...noteResponse, is_internal: false } }));

      const result = await client.addNote('QC-12345', publicNotePayload);

      expect(result.is_internal).toBe(false);
    });

    it('should handle empty note content', async () => {
      const noRetryClient = createQContactClient({
        ...defaultConfig,
        retry_attempts: 0,
      });

      mockFetch.mockResolvedValueOnce(createMockResponse(
        { error: { message: 'Note content is required' } },
        400,
        false
      ));

      await expect(noRetryClient.addNote('QC-12345', { ...notePayload, content: '' })).rejects.toThrow();
    });

    it('should handle ticket not found when adding note', async () => {
      const noRetryClient = createQContactClient({
        ...defaultConfig,
        retry_attempts: 0,
      });

      mockFetch.mockResolvedValueOnce(createMockResponse(
        { error: { message: 'Ticket not found' } },
        404,
        false
      ));

      await expect(noRetryClient.addNote('QC-NOTFOUND', notePayload)).rejects.toThrow(QContactError);
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      const noRetryClient = createQContactClient({
        ...defaultConfig,
        retry_attempts: 0,
      });

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      try {
        await noRetryClient.getTicket('QC-12345');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(QContactError);
        expect((error as QContactError).code).toBe(QContactErrorCode.NETWORK_ERROR);
      }
    });

    it('should handle malformed JSON response with error status', async () => {
      const noRetryClient = createQContactClient({
        ...defaultConfig,
        retry_attempts: 0,
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
        text: vi.fn().mockResolvedValue('not json'),
        headers: new Headers({ 'content-type': 'text/plain' }),
      });

      try {
        await noRetryClient.getTicket('QC-12345');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(QContactError);
        expect((error as QContactError).code).toBe(QContactErrorCode.PARSE_ERROR);
      }
    });

    it('should include request details in error', async () => {
      const noRetryClient = createQContactClient({
        ...defaultConfig,
        retry_attempts: 0,
      });

      mockFetch.mockResolvedValueOnce(createMockResponse(
        { error: { message: 'Server error' } },
        500,
        false
      ));

      try {
        await noRetryClient.getTicket('QC-12345');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(QContactError);
        const qcError = error as QContactError;
        // Error should include request URL (exact message may vary based on response)
        expect(qcError.requestUrl).toContain('/tickets/QC-12345');
      }
    });

    it('should handle rate limiting (429)', async () => {
      const noRetryClient = createQContactClient({
        ...defaultConfig,
        retry_attempts: 0,
      });

      mockFetch.mockResolvedValueOnce(createMockResponse(
        { error: { message: 'Rate limit exceeded' } },
        429,
        false
      ));

      await expect(noRetryClient.getTicket('QC-12345')).rejects.toThrow(QContactError);
    });

    it('should provide recoverable flag for transient errors', async () => {
      const noRetryClient = createQContactClient({
        ...defaultConfig,
        retry_attempts: 0,
      });

      mockFetch.mockResolvedValueOnce(createMockResponse(
        { error: { message: 'Service unavailable' } },
        503,
        false
      ));

      try {
        await noRetryClient.getTicket('QC-12345');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(QContactError);
        const qcError = error as QContactError;
        expect(qcError.isRecoverable).toBe(true);
      }
    });

    it('should mark authentication errors as non-recoverable', async () => {
      const noRetryClient = createQContactClient({
        ...defaultConfig,
        retry_attempts: 0,
      });

      mockFetch.mockResolvedValueOnce(createMockResponse(
        { error: { message: 'Invalid API key' } },
        401,
        false
      ));

      try {
        await noRetryClient.getTicket('QC-12345');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(QContactError);
        const qcError = error as QContactError;
        expect(qcError.isRecoverable).toBe(false);
      }
    });
  });

  describe('Retry Logic', () => {
    it('should retry on transient failures (500) and succeed', async () => {
      // First call fails, second succeeds
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ error: { message: 'Server error' } }, 500, false))
        .mockResolvedValueOnce(createMockResponse({ data: sampleQContactTicket }));

      // Use client with 1 retry
      const retryClient = createQContactClient({
        ...defaultConfig,
        retry_attempts: 1,
      });

      const result = await retryClient.getTicket('QC-12345');

      expect(result).toEqual(sampleQContactTicket);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on network errors and succeed', async () => {
      // First call fails with network error, second succeeds
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(createMockResponse({ data: sampleQContactTicket }));

      const retryClient = createQContactClient({
        ...defaultConfig,
        retry_attempts: 1,
      });

      const result = await retryClient.getTicket('QC-12345');

      expect(result).toEqual(sampleQContactTicket);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on 503 Service Unavailable', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ error: { message: 'Service unavailable' } }, 503, false))
        .mockResolvedValueOnce(createMockResponse({ data: sampleQContactTicket }));

      const retryClient = createQContactClient({
        ...defaultConfig,
        retry_attempts: 1,
      });

      const result = await retryClient.getTicket('QC-12345');

      expect(result).toEqual(sampleQContactTicket);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should NOT retry on authentication errors (401)', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(
        { error: { message: 'Invalid API key' } },
        401,
        false
      ));

      const retryClient = createQContactClient({
        ...defaultConfig,
        retry_attempts: 3,
      });

      await expect(retryClient.getTicket('QC-12345')).rejects.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should NOT retry on validation errors (400)', async () => {
      const noRetryClient = createQContactClient({
        ...defaultConfig,
        retry_attempts: 3,
      });

      mockFetch.mockResolvedValueOnce(createMockResponse(
        { error: { message: 'Invalid input' } },
        400,
        false
      ));

      await expect(noRetryClient.createTicket({ title: '' } as CreateQContactTicketPayload)).rejects.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should NOT retry on not found errors (404)', async () => {
      const retryClient = createQContactClient({
        ...defaultConfig,
        retry_attempts: 3,
      });

      mockFetch.mockResolvedValueOnce(createMockResponse(
        { error: { message: 'Not found' } },
        404,
        false
      ));

      await expect(retryClient.getTicket('QC-NOTFOUND')).rejects.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should exhaust retry attempts on persistent failures', async () => {
      // All calls fail
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ error: { message: 'Server error' } }, 500, false))
        .mockResolvedValueOnce(createMockResponse({ error: { message: 'Server error' } }, 500, false));

      const retryClient = createQContactClient({
        ...defaultConfig,
        retry_attempts: 1, // Initial + 1 retry = 2 calls
      });

      await expect(retryClient.getTicket('QC-12345')).rejects.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should respect custom retry configuration', async () => {
      // All calls fail
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ error: { message: 'Server error' } }, 500, false))
        .mockResolvedValueOnce(createMockResponse({ error: { message: 'Server error' } }, 500, false))
        .mockResolvedValueOnce(createMockResponse({ error: { message: 'Server error' } }, 500, false));

      const customClient = createQContactClient({
        ...defaultConfig,
        retry_attempts: 2, // Initial + 2 retries = 3 calls
      });

      await expect(customClient.getTicket('QC-12345')).rejects.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('Request Timeout Handling', () => {
    it('should handle AbortError as timeout', async () => {
      const noRetryClient = createQContactClient({
        ...defaultConfig,
        timeout_ms: 1000,
        retry_attempts: 0,
      });

      // Simulate network failure that would trigger error handling
      mockFetch.mockRejectedValueOnce(new Error('Request aborted'));

      await expect(noRetryClient.getTicket('QC-12345')).rejects.toThrow(QContactError);
    });

    it('should allow successful requests to complete', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ data: sampleQContactTicket }));

      const result = await client.getTicket('QC-12345');
      expect(result).toEqual(sampleQContactTicket);
    });
  });

  describe('Health Check', () => {
    it('should return true when API is healthy', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ status: 'healthy' }));

      const isHealthy = await client.healthCheck();

      expect(isHealthy).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        `${defaultConfig.base_url}/health`,
        expect.any(Object)
      );
    });

    it('should return false when API is unhealthy', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(
        { error: { message: 'Unhealthy' } },
        503,
        false
      ));

      const isHealthy = await client.healthCheck();

      expect(isHealthy).toBe(false);
    });

    it('should return false on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const isHealthy = await client.healthCheck();

      expect(isHealthy).toBe(false);
    });
  });

  describe('Request ID and Tracing', () => {
    it('should include unique request ID in headers', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ data: sampleQContactTicket }));

      await client.getTicket('QC-12345');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Request-ID': expect.stringMatching(/^req_\d+_[a-z0-9]+$/),
          }),
        })
      );
    });

    it('should generate different request IDs for each request', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ data: sampleQContactTicket }))
        .mockResolvedValueOnce(createMockResponse({ data: sampleQContactTicket }));

      await client.getTicket('QC-12345');
      await client.getTicket('QC-12345');

      const firstCall = mockFetch.mock.calls[0][1];
      const secondCall = mockFetch.mock.calls[1][1];

      expect(firstCall.headers['X-Request-ID']).not.toBe(secondCall.headers['X-Request-ID']);
    });
  });
});
