/**
 * Contractor Verification Service
 * Orchestrates company verification, director matching, and individual checks
 */

import { neon } from '@/lib/db-neon';
import { createLogger } from '@/lib/logger';
import { createVerificationClient, type IVerificationProvider } from '@/services/searchworks/searchWorksClient';
import { validateSaId } from '@/lib/saIdValidation';
import type {
  VerificationStatus,
  VerificationType,
  VerificationBundle,
  ContractorDirector,
  ContractorVerification,
  VerifyContractorResponse,
  VerificationCheck,
  SearchWorksDirector,
} from '@/types/contractor-verification.types';

const sql = neon(process.env.DATABASE_URL || '');
const logger = createLogger('contractorVerificationService');

class ContractorVerificationService {
  private client: IVerificationProvider;

  constructor() {
    this.client = createVerificationClient();
  }

  // ==================== COMPANY VERIFICATION ====================

  async verifyCompany(
    contractorId: string,
    bundle: VerificationBundle,
    verifiedBy: string
  ): Promise<VerifyContractorResponse> {
    logger.info('Starting company verification', { contractorId, bundle });

    // 1. Get contractor details
    const [contractor] = await sql`
      SELECT id, company_name, registration_number FROM contractors WHERE id = ${contractorId}
    `;
    if (!contractor) throw new Error(`Contractor ${contractorId} not found`);

    // 2. Get entered directors
    const directors = await this.getDirectors(contractorId);

    // 3. Validate all director IDs locally (free)
    for (const director of directors) {
      if (director.idType === 'sa_id' && director.idNumber) {
        const idResult = validateSaId(director.idNumber);
        await sql`
          UPDATE contractor_directors
          SET id_valid = ${idResult.isValid},
              id_date_of_birth = ${idResult.dateOfBirth},
              id_gender = ${idResult.gender},
              id_citizenship = ${idResult.citizenship},
              updated_at = NOW()
          WHERE id = ${director.id}
        `;
      }
    }

    // 4. CIPC company lookup
    let companyResult = null;
    const checks: VerificationCheck[] = [];
    let overallStatus: VerificationStatus = 'pending';

    try {
      companyResult = await this.client.searchCompany(contractor.registration_number);

      // Record the verification
      await this.recordVerification({
        contractorId,
        directorId: null,
        verificationType: 'cipc_company',
        status: 'passed',
        inputData: { registrationNumber: contractor.registration_number },
        resultData: companyResult as unknown as Record<string, unknown>,
        apiCostCents: 1770,
        apiProvider: 'searchworks',
        verifiedBy,
      });

      // 5. Run checks
      checks.push({
        field: 'Company Status',
        status: companyResult.status === 'IN BUSINESS' ? 'passed' : 'failed',
        expected: 'IN BUSINESS',
        actual: companyResult.status,
        message: companyResult.status === 'IN BUSINESS'
          ? 'Company is active'
          : `Company status: ${companyResult.status}`,
      });

      checks.push({
        field: 'Registration Number',
        status: companyResult.registrationNumber === contractor.registration_number ? 'passed' : 'failed',
        expected: contractor.registration_number,
        actual: companyResult.registrationNumber,
        message: companyResult.registrationNumber === contractor.registration_number
          ? 'Registration number matches'
          : 'Registration number mismatch',
      });

      const nameMatch = companyResult.companyName.toUpperCase().includes(
        contractor.company_name.toUpperCase().split(' ')[0]
      );
      checks.push({
        field: 'Company Name',
        status: nameMatch ? 'passed' : 'warning',
        expected: contractor.company_name,
        actual: companyResult.companyName,
        message: nameMatch ? 'Company name matches' : 'Company name partial match - verify manually',
      });

      // 6. Cross-reference directors
      const directorMatches = this.matchDirectors(directors, companyResult.activeDirectors);

      // Update director records with CIPC match info
      for (const match of directorMatches) {
        if (match.cipcMatch) {
          const dir = directors.find(d => d.idNumber === match.enteredId);
          if (dir) {
            await sql`
              UPDATE contractor_directors
              SET cipc_matched = true,
                  cipc_director_status = ${match.cipcMatch.status},
                  cipc_appointment_date = ${match.cipcMatch.appointmentDate},
                  updated_at = NOW()
              WHERE id = ${dir.id}
            `;
          }
        }
      }

      const allMatched = directorMatches.every(m => m.matchType !== 'no_match');
      const anyFailed = checks.some(c => c.status === 'failed');
      const anyWarning = checks.some(c => c.status === 'warning') || !allMatched;

      if (anyFailed) {
        overallStatus = 'failed';
      } else if (anyWarning) {
        overallStatus = 'warning';
      } else {
        overallStatus = 'passed';
      }

      // Update contractor record
      await sql`
        UPDATE contractors
        SET cipc_verified = ${overallStatus === 'passed'},
            cipc_verified_at = NOW(),
            cipc_company_status = ${companyResult.status},
            verification_bundle = ${bundle},
            updated_at = NOW()
        WHERE id = ${contractorId}
      `;

      return {
        contractorId,
        companyVerification: {
          status: overallStatus,
          companyResult,
          checks,
          directorMatches,
        },
        individualChecks: await this.getVerifications(contractorId),
        overallStatus,
        totalCostCents: 1770,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Company verification failed', { contractorId, error: msg });

      await this.recordVerification({
        contractorId,
        directorId: null,
        verificationType: 'cipc_company',
        status: 'error',
        inputData: { registrationNumber: contractor.registration_number },
        resultData: { error: msg },
        apiCostCents: 0,
        apiProvider: 'searchworks',
        verifiedBy,
      });

      return {
        contractorId,
        companyVerification: {
          status: 'error',
          companyResult: null,
          checks: [{ field: 'API Call', status: 'error', expected: null, actual: null, message: msg }],
          directorMatches: [],
        },
        individualChecks: [],
        overallStatus: 'error',
        totalCostCents: 0,
      };
    }
  }

  // ==================== INDIVIDUAL CHECKS ====================

  async verifyIndividual(
    contractorId: string,
    directorId: string,
    checkType: VerificationType,
    verifiedBy: string
  ): Promise<ContractorVerification> {
    logger.info('Starting individual check', { contractorId, directorId, checkType });

    const director = await this.getDirectorById(directorId);
    if (!director) throw new Error(`Director ${directorId} not found`);

    const costMap: Record<string, number> = {
      id_verification: 510,
      id_photo: 2955,
      criminal_record: 37460,
      pep_sanctions: 2810,
    };

    try {
      let resultData: Record<string, unknown> = {};
      let status: VerificationStatus = 'pending';

      switch (checkType) {
        case 'id_verification': {
          const result = await this.client.verifyId(director.idNumber);
          resultData = result as unknown as Record<string, unknown>;
          status = result.verified ? 'passed' : 'failed';
          break;
        }
        case 'id_photo': {
          const result = await this.client.verifyIdPhoto(director.idNumber);
          resultData = result as unknown as Record<string, unknown>;
          status = result.verified ? 'passed' : 'failed';
          await sql`
            UPDATE contractor_directors
            SET id_photo_verified = ${result.verified}, id_photo_verified_date = NOW(), updated_at = NOW()
            WHERE id = ${directorId}
          `;
          break;
        }
        case 'criminal_record': {
          const result = await this.client.criminalCheck(director.idNumber, director.fullName);
          resultData = result as unknown as Record<string, unknown>;
          status = result.clear ? 'passed' : 'failed';
          await sql`
            UPDATE contractor_directors
            SET criminal_check_status = ${status}, criminal_check_date = NOW(),
                criminal_check_clear = ${result.clear}, updated_at = NOW()
            WHERE id = ${directorId}
          `;
          break;
        }
        case 'pep_sanctions': {
          const result = await this.client.pepSanctionsCheck(director.idNumber, director.fullName);
          resultData = result as unknown as Record<string, unknown>;
          status = result.clear ? 'passed' : 'failed';
          await sql`
            UPDATE contractor_directors
            SET pep_sanctions_clear = ${result.clear}, pep_sanctions_date = NOW(), updated_at = NOW()
            WHERE id = ${directorId}
          `;
          break;
        }
        default:
          throw new Error(`Unsupported check type: ${checkType}`);
      }

      return await this.recordVerification({
        contractorId,
        directorId,
        verificationType: checkType,
        status,
        inputData: { idNumber: director.idNumber, fullName: director.fullName },
        resultData,
        apiCostCents: costMap[checkType] || 0,
        apiProvider: 'searchworks',
        verifiedBy,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Individual check failed', { directorId, checkType, error: msg });

      return await this.recordVerification({
        contractorId,
        directorId,
        verificationType: checkType,
        status: 'error',
        inputData: { idNumber: director.idNumber, fullName: director.fullName },
        resultData: { error: msg },
        apiCostCents: 0,
        apiProvider: 'searchworks',
        verifiedBy,
      });
    }
  }

  // ==================== DIRECTORS CRUD ====================

  async getDirectors(contractorId: string): Promise<ContractorDirector[]> {
    const rows = await sql`
      SELECT * FROM contractor_directors
      WHERE contractor_id = ${contractorId}
      ORDER BY is_primary DESC, created_at ASC
    `;
    return rows.map(this.mapDirector);
  }

  async getDirectorById(directorId: string): Promise<ContractorDirector | null> {
    const [row] = await sql`SELECT * FROM contractor_directors WHERE id = ${directorId}`;
    return row ? this.mapDirector(row) : null;
  }

  async saveDirector(
    contractorId: string,
    data: { fullName: string; idNumber: string; idType?: string; role: string; isPrimary: boolean }
  ): Promise<ContractorDirector> {
    // Validate SA ID if applicable
    let idValid: boolean | null = null;
    let idDob: string | null = null;
    let idGender: string | null = null;
    let idCitizenship: string | null = null;

    if (data.idType !== 'passport' && data.idType !== 'other' && data.idNumber) {
      const validation = validateSaId(data.idNumber);
      idValid = validation.isValid;
      idDob = validation.dateOfBirth;
      idGender = validation.gender;
      idCitizenship = validation.citizenship;
    }

    const [row] = await sql`
      INSERT INTO contractor_directors (
        contractor_id, full_name, id_number, id_type, id_valid,
        id_date_of_birth, id_gender, id_citizenship, is_primary, role
      ) VALUES (
        ${contractorId}, ${data.fullName}, ${data.idNumber}, ${data.idType || 'sa_id'},
        ${idValid}, ${idDob}, ${idGender}, ${idCitizenship}, ${data.isPrimary}, ${data.role}
      )
      RETURNING *
    `;

    return this.mapDirector(row);
  }

  async updateDirector(
    directorId: string,
    data: { fullName?: string; idNumber?: string; idType?: string; role?: string; isPrimary?: boolean }
  ): Promise<ContractorDirector> {
    const [existing] = await sql`SELECT * FROM contractor_directors WHERE id = ${directorId}`;
    if (!existing) throw new Error(`Director ${directorId} not found`);

    const fullName = data.fullName ?? existing.full_name;
    const idNumber = data.idNumber ?? existing.id_number;
    const idType = data.idType ?? existing.id_type;
    const role = data.role ?? existing.role;
    const isPrimary = data.isPrimary ?? existing.is_primary;

    // Re-validate ID if changed
    let idValid = existing.id_valid;
    let idDob = existing.id_date_of_birth;
    let idGender = existing.id_gender;
    let idCitizenship = existing.id_citizenship;

    if (data.idNumber && data.idNumber !== existing.id_number) {
      if (idType !== 'passport' && idType !== 'other') {
        const validation = validateSaId(data.idNumber);
        idValid = validation.isValid;
        idDob = validation.dateOfBirth;
        idGender = validation.gender;
        idCitizenship = validation.citizenship;
      }
    }

    const [row] = await sql`
      UPDATE contractor_directors
      SET full_name = ${fullName}, id_number = ${idNumber}, id_type = ${idType},
          id_valid = ${idValid}, id_date_of_birth = ${idDob}, id_gender = ${idGender},
          id_citizenship = ${idCitizenship}, role = ${role}, is_primary = ${isPrimary},
          updated_at = NOW()
      WHERE id = ${directorId}
      RETURNING *
    `;

    return this.mapDirector(row);
  }

  async deleteDirector(directorId: string): Promise<void> {
    await sql`DELETE FROM contractor_directors WHERE id = ${directorId}`;
  }

  // ==================== VERIFICATION RESULTS ====================

  async getVerificationResults(contractorId: string): Promise<VerifyContractorResponse> {
    const verifications = await this.getVerifications(contractorId);

    // Find the latest CIPC company verification
    const cipcVerification = verifications.find(v => v.verificationType === 'cipc_company');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const companyResult = cipcVerification?.resultData as any;

    // Determine overall status
    let overallStatus: VerificationStatus = 'pending';
    if (cipcVerification) {
      overallStatus = cipcVerification.status;
    }

    // Rebuild checks from stored data
    const checks: VerificationCheck[] = [];
    if (companyResult && !companyResult.error) {
      checks.push({
        field: 'Company Status',
        status: companyResult.status === 'IN BUSINESS' ? 'passed' : 'failed',
        expected: 'IN BUSINESS',
        actual: companyResult.status,
        message: companyResult.status === 'IN BUSINESS' ? 'Company is active' : `Company status: ${companyResult.status}`,
      });
    }

    const totalCostCents = verifications.reduce((sum, v) => sum + (v.apiCostCents || 0), 0);

    return {
      contractorId,
      companyVerification: {
        status: cipcVerification?.status || 'pending',
        companyResult: companyResult?.error ? null : companyResult || null,
        checks,
        directorMatches: [],
      },
      individualChecks: verifications.filter(v => v.verificationType !== 'cipc_company'),
      overallStatus,
      totalCostCents,
    };
  }

  // ==================== PRIVATE HELPERS ====================

  private async getVerifications(contractorId: string): Promise<ContractorVerification[]> {
    const rows = await sql`
      SELECT * FROM contractor_verifications
      WHERE contractor_id = ${contractorId}
      ORDER BY created_at DESC
    `;
    return rows.map(this.mapVerification);
  }

  private async recordVerification(data: {
    contractorId: string;
    directorId: string | null;
    verificationType: VerificationType;
    status: VerificationStatus;
    inputData: Record<string, unknown>;
    resultData: Record<string, unknown>;
    apiCostCents: number;
    apiProvider: string;
    verifiedBy: string;
  }): Promise<ContractorVerification> {
    const [row] = await sql`
      INSERT INTO contractor_verifications (
        contractor_id, director_id, verification_type, status,
        input_data, result_data, api_cost_cents, api_provider, verified_by
      ) VALUES (
        ${data.contractorId}, ${data.directorId}, ${data.verificationType}, ${data.status},
        ${JSON.stringify(data.inputData)}, ${JSON.stringify(data.resultData)},
        ${data.apiCostCents}, ${data.apiProvider}, ${data.verifiedBy}
      )
      RETURNING *
    `;
    return this.mapVerification(row);
  }

  private matchDirectors(
    entered: ContractorDirector[],
    cipcDirectors: SearchWorksDirector[]
  ): Array<{ enteredName: string; enteredId: string; cipcMatch: SearchWorksDirector | null; matchType: 'id_exact' | 'name_fuzzy' | 'no_match' }> {
    return entered.map(dir => {
      // First try exact ID match
      const idMatch = cipcDirectors.find(
        c => c.idNumber && dir.idNumber && c.idNumber === dir.idNumber
      );
      if (idMatch) {
        return { enteredName: dir.fullName, enteredId: dir.idNumber, cipcMatch: idMatch, matchType: 'id_exact' as const };
      }

      // Fallback: fuzzy name match (surname match)
      const surname = dir.fullName.toUpperCase().split(' ').pop() || '';
      const nameMatch = cipcDirectors.find(
        c => c.surname.toUpperCase() === surname || c.fullName.toUpperCase().includes(surname)
      );
      if (nameMatch) {
        return { enteredName: dir.fullName, enteredId: dir.idNumber, cipcMatch: nameMatch, matchType: 'name_fuzzy' as const };
      }

      return { enteredName: dir.fullName, enteredId: dir.idNumber, cipcMatch: null, matchType: 'no_match' as const };
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapDirector(row: any): ContractorDirector {
    return {
      id: row.id,
      contractorId: row.contractor_id,
      fullName: row.full_name,
      idNumber: row.id_number,
      idType: row.id_type || 'sa_id',
      idValid: row.id_valid,
      idDateOfBirth: row.id_date_of_birth ? String(row.id_date_of_birth) : null,
      idGender: row.id_gender,
      idCitizenship: row.id_citizenship,
      cipcMatched: row.cipc_matched,
      cipcDirectorStatus: row.cipc_director_status,
      cipcAppointmentDate: row.cipc_appointment_date ? String(row.cipc_appointment_date) : null,
      criminalCheckStatus: row.criminal_check_status,
      criminalCheckDate: row.criminal_check_date ? new Date(row.criminal_check_date).toISOString() : null,
      criminalCheckClear: row.criminal_check_clear,
      idPhotoVerified: row.id_photo_verified,
      idPhotoVerifiedDate: row.id_photo_verified_date ? new Date(row.id_photo_verified_date).toISOString() : null,
      pepSanctionsClear: row.pep_sanctions_clear,
      pepSanctionsDate: row.pep_sanctions_date ? new Date(row.pep_sanctions_date).toISOString() : null,
      isPrimary: row.is_primary,
      role: row.role || 'director',
      notes: row.notes,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapVerification(row: any): ContractorVerification {
    return {
      id: row.id,
      contractorId: row.contractor_id,
      directorId: row.director_id,
      verificationType: row.verification_type,
      status: row.status,
      inputData: row.input_data,
      resultData: row.result_data,
      apiCostCents: row.api_cost_cents,
      apiProvider: row.api_provider,
      apiRequestId: row.api_request_id,
      verifiedBy: row.verified_by,
      expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}

export const contractorVerificationService = new ContractorVerificationService();
