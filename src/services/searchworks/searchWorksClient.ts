/**
 * SearchWorks Verification Client
 *
 * Pluggable verification provider interface.
 * Current implementation: Mock client returning realistic CIPC data.
 * Swap for SearchWorks PLUS or CIPC direct API when credentials obtained.
 */

import { createLogger } from '@/lib/logger';
import type {
  SearchWorksCompanyResult,
  IdVerificationResult,
  IdPhotoResult,
  CriminalCheckResult,
  PepSanctionsResult,
} from '@/types/contractor-verification.types';

const logger = createLogger('searchWorksClient');

// ==================== PROVIDER INTERFACE ====================

export interface IVerificationProvider {
  searchCompany(registrationNumber: string): Promise<SearchWorksCompanyResult>;
  verifyId(idNumber: string): Promise<IdVerificationResult>;
  verifyIdPhoto(idNumber: string): Promise<IdPhotoResult>;
  criminalCheck(idNumber: string, fullName: string): Promise<CriminalCheckResult>;
  pepSanctionsCheck(idNumber: string, fullName: string): Promise<PepSanctionsResult>;
  testConnection(): Promise<{ success: boolean; message: string }>;
}

// ==================== MOCK CLIENT ====================

class MockVerificationClient implements IVerificationProvider {
  async searchCompany(registrationNumber: string): Promise<SearchWorksCompanyResult> {
    logger.info('Mock CIPC company search', { registrationNumber });
    await this.simulateDelay();

    return {
      companyName: 'MOCK COMPANY (PTY) LTD',
      registrationNumber,
      companyType: 'PRIVATE COMPANY (PTY) LTD',
      status: 'IN BUSINESS',
      registrationDate: '2016-10-05',
      taxNumber: '9000000000',
      financialYearEnd: 'February',
      principalDescription: 'TELECOMMUNICATIONS',
      registeredAddress: '123 Mock Street, Sandton, Gauteng, 2196',
      postalAddress: 'PO Box 12345, Sandton, 2146',
      activeDirectors: [
        {
          fullName: 'JOHN DOE',
          firstName: 'JOHN',
          surname: 'DOE',
          idNumber: '8501015800085',
          dateOfBirth: '1985-01-01',
          gender: 'MALE',
          age: 41,
          status: 'ACTIVE',
          type: 'DIRECTOR',
          appointmentDate: '2016-10-05',
          resignationDate: null,
          residentialAddress: '456 Director Lane, Sandton, 2196',
          postalAddress: null,
        },
      ],
      resignedDirectors: [],
      deceasedDirectors: [],
      sarsVerification: {
        tradingName: 'MOCK COMPANY',
        vatNumber: '4000000000',
        area: 'GAUTENG',
      },
    };
  }

  async verifyId(idNumber: string): Promise<IdVerificationResult> {
    logger.info('Mock ID verification', { idNumber: idNumber.substring(0, 6) + '***' });
    await this.simulateDelay();

    return {
      verified: true,
      idNumber,
      fullName: 'JOHN DOE',
      dateOfBirth: '1985-01-01',
      gender: 'MALE',
      deceased: false,
    };
  }

  async verifyIdPhoto(idNumber: string): Promise<IdPhotoResult> {
    logger.info('Mock ID photo verification', { idNumber: idNumber.substring(0, 6) + '***' });
    await this.simulateDelay();

    return {
      verified: true,
      idNumber,
      matchScore: 95.5,
      photoUrl: null,
    };
  }

  async criminalCheck(idNumber: string, fullName: string): Promise<CriminalCheckResult> {
    logger.info('Mock criminal record check', { fullName });
    await this.simulateDelay();

    return {
      clear: true,
      idNumber,
      fullName,
      checkDate: new Date().toISOString().split('T')[0],
      records: [],
    };
  }

  async pepSanctionsCheck(idNumber: string, fullName: string): Promise<PepSanctionsResult> {
    logger.info('Mock PEP/sanctions check', { fullName });
    await this.simulateDelay();

    return {
      clear: true,
      idNumber,
      fullName,
      pepMatch: false,
      sanctionsMatch: false,
      details: null,
    };
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    return { success: true, message: 'Mock client connected (no real API)' };
  }

  private simulateDelay(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 200));
  }
}

// ==================== REAL CLIENT PLACEHOLDER ====================

class SearchWorksClient implements IVerificationProvider {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: { baseUrl: string; apiKey: string }) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
  }

  private async request<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (response.status === 429) {
      throw new Error('SearchWorks rate limit exceeded');
    }
    if (response.status === 401) {
      throw new Error('SearchWorks authentication failed');
    }
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`SearchWorks API error ${response.status}: ${errorText}`);
    }

    return await response.json() as T;
  }

  async searchCompany(_registrationNumber: string): Promise<SearchWorksCompanyResult> {
    throw new Error('SearchWorks PLUS API not yet configured. Contact SearchWorks for API access.');
  }

  async verifyId(_idNumber: string): Promise<IdVerificationResult> {
    throw new Error('SearchWorks PLUS API not yet configured.');
  }

  async verifyIdPhoto(_idNumber: string): Promise<IdPhotoResult> {
    throw new Error('SearchWorks PLUS API not yet configured.');
  }

  async criminalCheck(_idNumber: string, _fullName: string): Promise<CriminalCheckResult> {
    throw new Error('SearchWorks PLUS API not yet configured.');
  }

  async pepSanctionsCheck(_idNumber: string, _fullName: string): Promise<PepSanctionsResult> {
    throw new Error('SearchWorks PLUS API not yet configured.');
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.request('/test', {});
      return { success: true, message: 'SearchWorks API connected' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: msg };
    }
  }
}

// ==================== FACTORY ====================

let clientInstance: IVerificationProvider | null = null;

export function createVerificationClient(): IVerificationProvider {
  if (clientInstance) return clientInstance;

  const apiKey = process.env.SEARCHWORKS_API_KEY;
  const baseUrl = process.env.SEARCHWORKS_BASE_URL;

  if (apiKey && baseUrl) {
    logger.info('Creating SearchWorks API client');
    clientInstance = new SearchWorksClient({ baseUrl, apiKey });
  } else {
    logger.info('No SearchWorks credentials - using mock client');
    clientInstance = new MockVerificationClient();
  }

  return clientInstance;
}

export { SearchWorksClient, MockVerificationClient };
