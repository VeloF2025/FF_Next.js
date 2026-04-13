/**
 * Staff Import Parsers
 * Utility functions for parsing import data
 */

import { Skill } from '@/types/staff/enums.types';
import { SAContractType } from '@/types/staff/compliance.types';

/**
 * Map legacy contract type values to SA-compliant values
 */
const CONTRACT_TYPE_MAPPING: Record<string, SAContractType> = {
  // Full-time variations -> permanent
  'full-time': SAContractType.PERMANENT,
  'full_time': SAContractType.PERMANENT,
  'fulltime': SAContractType.PERMANENT,
  'full time': SAContractType.PERMANENT,
  'permanent': SAContractType.PERMANENT,
  'perm': SAContractType.PERMANENT,

  // Part-time variations
  'part-time': SAContractType.PART_TIME,
  'part_time': SAContractType.PART_TIME,
  'parttime': SAContractType.PART_TIME,
  'part time': SAContractType.PART_TIME,

  // Fixed term / contract
  'contract': SAContractType.FIXED_TERM,
  'fixed-term': SAContractType.FIXED_TERM,
  'fixed_term': SAContractType.FIXED_TERM,
  'fixedterm': SAContractType.FIXED_TERM,
  'fixed term': SAContractType.FIXED_TERM,
  'limited duration': SAContractType.FIXED_TERM,

  // Temporary
  'temp': SAContractType.TEMPORARY,
  'temporary': SAContractType.TEMPORARY,
  'casual': SAContractType.TEMPORARY,

  // Independent contractor / freelance
  'freelance': SAContractType.INDEPENDENT_CONTRACTOR,
  'freelancer': SAContractType.INDEPENDENT_CONTRACTOR,
  'contractor': SAContractType.INDEPENDENT_CONTRACTOR,
  'independent': SAContractType.INDEPENDENT_CONTRACTOR,
  'independent_contractor': SAContractType.INDEPENDENT_CONTRACTOR,
  'independent contractor': SAContractType.INDEPENDENT_CONTRACTOR,

  // Intern / Learner
  'intern': SAContractType.INTERN,
  'internship': SAContractType.INTERN,
  'learner': SAContractType.INTERN,
  'learnership': SAContractType.INTERN,
};

/**
 * Parse and normalize contract type from import value
 * Maps legacy values to SA-compliant SAContractType enum
 */
export function parseContractType(value: string | undefined): SAContractType {
  if (!value) return SAContractType.PERMANENT;

  const normalized = value.toLowerCase().trim();
  return CONTRACT_TYPE_MAPPING[normalized] || SAContractType.PERMANENT;
}

/**
 * Parse date from various formats
 */
export function parseDate(dateValue: unknown): Date | undefined {
  if (!dateValue) return undefined;
  
  // If already a Date object
  if (dateValue instanceof Date) {
    return dateValue;
  }
  
  // If it's a number (Excel serial date)
  if (typeof dateValue === 'number') {
    // Excel dates start from 1900-01-01
    const excelEpoch = new Date(1900, 0, 1);
    const msPerDay = 24 * 60 * 60 * 1000;
    return new Date(excelEpoch.getTime() + (dateValue - 2) * msPerDay);
  }
  
  // If it's a string
  if (typeof dateValue === 'string') {
    // Try parsing YYYY/MM/DD format (from your CSV)
    const yyyymmdd = dateValue.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (yyyymmdd && yyyymmdd[1] && yyyymmdd[2] && yyyymmdd[3]) {
      return new Date(parseInt(yyyymmdd[1]), parseInt(yyyymmdd[2]) - 1, parseInt(yyyymmdd[3]));
    }

    // Try parsing DD/MM/YYYY format
    const ddmmyyyy = dateValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (ddmmyyyy && ddmmyyyy[1] && ddmmyyyy[2] && ddmmyyyy[3]) {
      return new Date(parseInt(ddmmyyyy[3]), parseInt(ddmmyyyy[2]) - 1, parseInt(ddmmyyyy[1]));
    }

    // Try parsing YYYY-MM-DD format
    const yyyymmdd2 = dateValue.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (yyyymmdd2 && yyyymmdd2[1] && yyyymmdd2[2] && yyyymmdd2[3]) {
      return new Date(parseInt(yyyymmdd2[1]), parseInt(yyyymmdd2[2]) - 1, parseInt(yyyymmdd2[3]));
    }
    
    // Try standard date parsing
    const parsed = new Date(dateValue);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  
  return undefined;
}

/**
 * Parse enum value from string
 */
export function parseEnum<T>(value: string | undefined, enumValues: string[], defaultValue: T): T {
  if (!value) return defaultValue;
  
  const upperValue = value.toUpperCase().replace(/\s+/g, '_');
  
  for (const enumValue of enumValues) {
    if (enumValue.toUpperCase().replace(/\s+/g, '_') === upperValue) {
      return enumValue as T;
    }
  }
  
  return defaultValue;
}

/**
 * Parse skills from comma-separated string
 */
export function parseSkills(skillsString: string | undefined): Skill[] {
  if (!skillsString) return [];
  
  const skills: Skill[] = [];
  const skillsList = skillsString.split(',').map(s => s.trim());
  
  for (const skill of skillsList) {
    if (skill) {
      // Try to find matching skill enum value
      const matchingSkill = Object.values(Skill).find(
        enumSkill => enumSkill.toLowerCase().replace(/_/g, ' ') === skill.toLowerCase() ||
                     enumSkill.toLowerCase() === skill.toLowerCase()
      );
      
      if (matchingSkill) {
        skills.push(matchingSkill);
      }
    }
  }
  
  return skills;
}