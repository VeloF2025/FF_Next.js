/**
 * Compliance Requirements Manager
 * Define and manage compliance requirements by business type
 */

import { ComplianceRequirements } from './types';

export class RequirementsManager {
  /**
   * Get compliance requirements based on business type
   */
  static getComplianceRequirements(businessType: string): ComplianceRequirements {
    const baseRequirements: ComplianceRequirements = {
      required: ['tax_clearance', 'registration'],
      optional: ['bee_certificate'],
      exemptions: [],
      specialRules: {}
    };

    switch (businessType?.toLowerCase()) {
      case 'public_company':
      case 'private_company':
        return {
          required: ['tax_clearance', 'registration', 'insurance', 'bee_certificate'],
          optional: ['contract'],
          exemptions: [],
          specialRules: {
            beeLevel: { min: 1, max: 8 },
            insuranceMinimum: 1000000,
            taxClearancePeriod: 12
          }
        };

      case 'close_corporation':
        return {
          required: ['tax_clearance', 'registration', 'insurance'],
          optional: ['bee_certificate', 'contract'],
          exemptions: [],
          specialRules: {
            insuranceMinimum: 500000,
            taxClearancePeriod: 12
          }
        };

      case 'sole_proprietor':
        return {
          required: ['tax_clearance'],
          optional: ['registration', 'insurance'],
          exemptions: ['bee_certificate'],
          specialRules: {
            taxClearancePeriod: 6,
            registrationOptional: true
          }
        };

      case 'partnership':
        return {
          required: ['tax_clearance', 'registration', 'insurance'],
          optional: ['bee_certificate', 'contract'],
          exemptions: [],
          specialRules: {
            insuranceMinimum: 750000,
            taxClearancePeriod: 12,
            partnershipAgreementRequired: true
          }
        };

      case 'trust':
        return {
          required: ['tax_clearance', 'registration'],
          optional: ['insurance', 'contract'],
          exemptions: ['bee_certificate'],
          specialRules: {
            trustDeedRequired: true,
            taxClearancePeriod: 12
          }
        };

      case 'foreign_company':
        return {
          required: ['tax_clearance', 'registration', 'insurance'],
          optional: ['bee_certificate', 'contract'],
          exemptions: [],
          specialRules: {
            foreignRegistrationRequired: true,
            workPermitsRequired: true,
            insuranceMinimum: 2000000,
            taxClearancePeriod: 6
          }
        };

      case 'non_profit':
        return {
          required: ['tax_clearance', 'registration'],
          optional: ['insurance'],
          exemptions: ['bee_certificate'],
          specialRules: {
            nonprofitCertificateRequired: true,
            taxExemptionStatus: true,
            taxClearancePeriod: 24
          }
        };

      case 'government':
      case 'municipality':
      case 'state_owned':
        return {
          required: ['registration'],
          optional: ['insurance'],
          exemptions: ['tax_clearance', 'bee_certificate'],
          specialRules: {
            governmentEntity: true,
            procurementCompliance: true,
            publicSectorRules: true
          }
        };

      default:
        return baseRequirements;
    }
  }

  /**
   * Get missing documents for a supplier
   */
  static getMissingDocuments(
    businessType: string,
    providedDocumentTypes: string[]
  ): string[] {
    const requirements = this.getComplianceRequirements(businessType);
    const providedSet = new Set(providedDocumentTypes);
    
    return requirements.required.filter(docType => !providedSet.has(docType));
  }

  /**
   * Check if document type is required for business type
   */
  static isDocumentRequired(businessType: string, documentType: string): boolean {
    const requirements = this.getComplianceRequirements(businessType);
    return requirements.required.includes(documentType);
  }

  /**
   * Check if document type is optional for business type
   */
  static isDocumentOptional(businessType: string, documentType: string): boolean {
    const requirements = this.getComplianceRequirements(businessType);
    return requirements.optional.includes(documentType);
  }

  /**
   * Check if document type is exempt for business type
   */
  static isDocumentExempt(businessType: string, documentType: string): boolean {
    const requirements = this.getComplianceRequirements(businessType);
    return requirements.exemptions?.includes(documentType) || false;
  }

  /**
   * Get special rules for business type
   */
  static getSpecialRules(businessType: string): Record<string, unknown> {
    const requirements = this.getComplianceRequirements(businessType);
    return requirements.specialRules || {};
  }

  /**
   * Validate compliance completeness
   */
  static validateComplianceCompleteness(
    businessType: string,
    providedDocumentTypes: string[]
  ): {
    isComplete: boolean;
    missingRequired: string[];
    recommendedOptional: string[];
    exemptDocuments: string[];
  } {
    const requirements = this.getComplianceRequirements(businessType);
    const providedSet = new Set(providedDocumentTypes);
    
    const missingRequired = requirements.required.filter(docType => !providedSet.has(docType));
    const recommendedOptional = requirements.optional.filter(docType => !providedSet.has(docType));
    const exemptDocuments = requirements.exemptions || [];
    
    return {
      isComplete: missingRequired.length === 0,
      missingRequired,
      recommendedOptional,
      exemptDocuments
    };
  }

  /**
   * Get all supported business types
   */
  static getSupportedBusinessTypes(): Array<{
    value: string;
    label: string;
    description: string;
  }> {
    return [
      {
        value: 'public_company',
        label: 'Public Company',
        description: 'Publicly traded company with shareholders'
      },
      {
        value: 'private_company',
        label: 'Private Company',
        description: 'Private limited company'
      },
      {
        value: 'close_corporation',
        label: 'Close Corporation (CC)',
        description: 'Close corporation with limited members'
      },
      {
        value: 'sole_proprietor',
        label: 'Sole Proprietor',
        description: 'Individual business owner'
      },
      {
        value: 'partnership',
        label: 'Partnership',
        description: 'Business partnership between individuals/entities'
      },
      {
        value: 'trust',
        label: 'Trust',
        description: 'Business trust entity'
      },
      {
        value: 'foreign_company',
        label: 'Foreign Company',
        description: 'Company registered outside South Africa'
      },
      {
        value: 'non_profit',
        label: 'Non-Profit Organization (NPO)',
        description: 'Non-profit organization or NGO'
      },
      {
        value: 'government',
        label: 'Government Entity',
        description: 'Government department or agency'
      },
      {
        value: 'municipality',
        label: 'Municipality',
        description: 'Local government municipality'
      },
      {
        value: 'state_owned',
        label: 'State-Owned Enterprise',
        description: 'State-owned enterprise or parastate'
      }
    ];
  }
}