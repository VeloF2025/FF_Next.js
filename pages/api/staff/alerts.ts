/**
 * Staff Alerts API
 * GET /api/staff/alerts - Get upcoming birthdays, expiring documents, and compliance stats
 *
 * Query params:
 * - type: 'birthdays' | 'expiring' | 'compliance' | 'all' (default: 'all')
 * - days: number of days to look ahead (default: 30)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL || '');
const logger = createLogger('StaffAlertsAPI');

interface BirthdayAlert {
  id: string;
  name: string;
  email: string | null;
  dateOfBirth: string;
  department: string | null;
  position: string | null;
  daysUntil: number;
  age: number;
}

interface ExpiryAlert {
  id: string;
  staffId: string;
  staffName: string;
  documentType: string;
  documentName: string;
  expiryDate: string;
  daysUntil: number;
  severity: 'critical' | 'warning' | 'info';
}

interface ComplianceStats {
  totalStaff: number;
  withVerifiedId: number;
  withVerifiedPassport: number;
  withVerifiedLicense: number;
  withVerifiedBankDetails: number;
  withDob: number;
  missingDocuments: Array<{
    staffId: string;
    staffName: string;
    missingTypes: string[];
  }>;
  compliancePercentage: number;
}

interface AlertsResponse {
  birthdays?: BirthdayAlert[];
  expiring?: ExpiryAlert[];
  compliance?: ComplianceStats;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AlertsResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const type = (req.query.type as string) || 'all';
    const days = parseInt(req.query.days as string) || 30;

    const response: AlertsResponse = {};

    // Get birthdays
    if (type === 'all' || type === 'birthdays') {
      response.birthdays = await getUpcomingBirthdays(days);
    }

    // Get expiring documents
    if (type === 'all' || type === 'expiring') {
      response.expiring = await getExpiringDocuments(days);
    }

    // Get compliance stats
    if (type === 'all' || type === 'compliance') {
      response.compliance = await getComplianceStats();
    }

    logger.info('Staff alerts fetched', {
      type,
      days,
      birthdayCount: response.birthdays?.length,
      expiringCount: response.expiring?.length,
    });

    return res.status(200).json(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error('Failed to fetch staff alerts', { error: errorMessage, stack: errorStack });
    return res.status(500).json({ error: `Failed to fetch alerts: ${errorMessage}` });
  }
}

/**
 * Get upcoming birthdays within specified days
 */
async function getUpcomingBirthdays(days: number): Promise<BirthdayAlert[]> {
  // Ensure days is a proper integer
  const daysInt = Math.floor(days);

  // Query staff with DOB, calculating days until next birthday
  const results = await sql`
    WITH birthday_calc AS (
      SELECT
        id,
        name,
        email,
        date_of_birth,
        department,
        position,
        -- Calculate next birthday (this year or next year)
        CASE
          WHEN make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int,
                         EXTRACT(MONTH FROM date_of_birth)::int,
                         EXTRACT(DAY FROM date_of_birth)::int) >= CURRENT_DATE
          THEN make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int,
                         EXTRACT(MONTH FROM date_of_birth)::int,
                         EXTRACT(DAY FROM date_of_birth)::int)
          ELSE make_date((EXTRACT(YEAR FROM CURRENT_DATE) + 1)::int,
                         EXTRACT(MONTH FROM date_of_birth)::int,
                         EXTRACT(DAY FROM date_of_birth)::int)
        END AS next_birthday,
        EXTRACT(YEAR FROM age(date_of_birth))::int AS current_age
      FROM staff
      WHERE date_of_birth IS NOT NULL
        AND (status = 'active' OR is_active = true)
    )
    SELECT
      id,
      name,
      email,
      date_of_birth,
      department,
      position,
      (next_birthday - CURRENT_DATE) AS days_until,
      current_age +
        CASE WHEN next_birthday > make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int,
                                            EXTRACT(MONTH FROM date_of_birth)::int,
                                            EXTRACT(DAY FROM date_of_birth)::int)
             THEN 1 ELSE 0 END AS age_on_birthday
    FROM birthday_calc
    WHERE (next_birthday - CURRENT_DATE) BETWEEN 0 AND ${daysInt}::integer
    ORDER BY days_until ASC
  `;

  return results.map(r => ({
    id: r.id as string,
    name: r.name as string,
    email: r.email as string | null,
    dateOfBirth: r.date_of_birth as string,
    department: r.department as string | null,
    position: r.position as string | null,
    daysUntil: parseInt(r.days_until as string),
    age: parseInt(r.age_on_birthday as string),
  }));
}

/**
 * Get documents expiring within specified days
 */
async function getExpiringDocuments(days: number): Promise<ExpiryAlert[]> {
  const alerts: ExpiryAlert[] = [];

  // Ensure days is a proper integer
  const daysInt = Math.floor(days);

  // Check staff table for expiring documents
  const staffExpiry = await sql`
    SELECT
      id,
      name,
      drivers_license_expiry,
      passport_expiry,
      medical_certificate_expiry,
      police_clearance_expiry,
      work_permit_expiry
    FROM staff
    WHERE (status = 'active' OR is_active = true)
      AND (
        (drivers_license_expiry IS NOT NULL AND drivers_license_expiry <= CURRENT_DATE + ${daysInt}::integer)
        OR (passport_expiry IS NOT NULL AND passport_expiry <= CURRENT_DATE + ${daysInt}::integer)
        OR (medical_certificate_expiry IS NOT NULL AND medical_certificate_expiry <= CURRENT_DATE + ${daysInt}::integer)
        OR (police_clearance_expiry IS NOT NULL AND police_clearance_expiry <= CURRENT_DATE + ${daysInt}::integer)
        OR (work_permit_expiry IS NOT NULL AND work_permit_expiry <= CURRENT_DATE + ${daysInt}::integer)
      )
  `;

  for (const staff of staffExpiry) {
    const expiryFields = [
      { field: 'drivers_license_expiry', type: 'Driver\'s License', name: 'Driver\'s License' },
      { field: 'passport_expiry', type: 'Passport', name: 'Passport' },
      { field: 'medical_certificate_expiry', type: 'Medical Certificate', name: 'Medical Certificate' },
      { field: 'police_clearance_expiry', type: 'Police Clearance', name: 'Police Clearance' },
      { field: 'work_permit_expiry', type: 'Work Permit', name: 'Work Permit' },
    ];

    for (const { field, type, name } of expiryFields) {
      const expiryDate = staff[field] as string | null;
      if (expiryDate) {
        const daysUntil = Math.ceil(
          (new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        );

        if (daysUntil <= days) {
          let severity: 'critical' | 'warning' | 'info' = 'info';
          if (daysUntil < 0) severity = 'critical'; // Already expired
          else if (daysUntil <= 7) severity = 'critical';
          else if (daysUntil <= 30) severity = 'warning';

          alerts.push({
            id: `${staff.id}-${field}`,
            staffId: staff.id as string,
            staffName: staff.name as string,
            documentType: type,
            documentName: name,
            expiryDate,
            daysUntil,
            severity,
          });
        }
      }
    }
  }

  // Also check staff_documents table for expiry dates
  const docExpiry = await sql`
    SELECT
      sd.id,
      sd.staff_id,
      sd.document_type,
      sd.document_name,
      sd.expiry_date,
      s.name as staff_name
    FROM staff_documents sd
    JOIN staff s ON s.id = sd.staff_id
    WHERE sd.expiry_date IS NOT NULL
      AND sd.expiry_date <= CURRENT_DATE + ${daysInt}::integer
      AND sd.verification_status = 'verified'
      AND (s.status = 'active' OR s.is_active = true)
  `;

  for (const doc of docExpiry) {
    const daysUntil = Math.ceil(
      (new Date(doc.expiry_date as string).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );

    let severity: 'critical' | 'warning' | 'info' = 'info';
    if (daysUntil < 0) severity = 'critical';
    else if (daysUntil <= 7) severity = 'critical';
    else if (daysUntil <= 30) severity = 'warning';

    alerts.push({
      id: doc.id as string,
      staffId: doc.staff_id as string,
      staffName: doc.staff_name as string,
      documentType: doc.document_type as string,
      documentName: doc.document_name as string,
      expiryDate: doc.expiry_date as string,
      daysUntil,
      severity,
    });
  }

  // Sort by days until expiry (most urgent first)
  return alerts.sort((a, b) => a.daysUntil - b.daysUntil);
}

/**
 * Get compliance statistics
 */
async function getComplianceStats(): Promise<ComplianceStats> {
  // Get total active staff count
  const [countResult] = await sql`
    SELECT COUNT(*) as total FROM staff WHERE status = 'active' OR is_active = true
  `;
  const totalStaff = parseInt(countResult.total as string);

  // Get counts for various document types
  const [statsResult] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE sa_id_number IS NOT NULL) as with_id,
      COUNT(*) FILTER (WHERE passport_number IS NOT NULL) as with_passport,
      COUNT(*) FILTER (WHERE drivers_license_number IS NOT NULL) as with_license,
      COUNT(*) FILTER (WHERE bank_account_number IS NOT NULL) as with_bank,
      COUNT(*) FILTER (WHERE date_of_birth IS NOT NULL) as with_dob
    FROM staff
    WHERE status = 'active' OR is_active = true
  `;

  // Get verified document counts from staff_documents
  const [verifiedDocs] = await sql`
    SELECT
      COUNT(DISTINCT staff_id) FILTER (WHERE document_type = 'sa_id' AND verification_status = 'verified') as verified_id,
      COUNT(DISTINCT staff_id) FILTER (WHERE document_type = 'passport' AND verification_status = 'verified') as verified_passport,
      COUNT(DISTINCT staff_id) FILTER (WHERE document_type = 'drivers_license' AND verification_status = 'verified') as verified_license,
      COUNT(DISTINCT staff_id) FILTER (WHERE document_type IN ('bank_details', 'bank_statement') AND verification_status = 'verified') as verified_bank
    FROM staff_documents
  `;

  // Find staff missing key documents
  const missingDocs = await sql`
    SELECT
      s.id,
      s.name,
      CASE WHEN s.sa_id_number IS NULL THEN 'SA ID' END as missing_id,
      CASE WHEN s.bank_account_number IS NULL THEN 'Bank Details' END as missing_bank,
      CASE WHEN s.date_of_birth IS NULL THEN 'Date of Birth' END as missing_dob
    FROM staff s
    WHERE (s.status = 'active' OR s.is_active = true)
      AND (s.sa_id_number IS NULL OR s.bank_account_number IS NULL OR s.date_of_birth IS NULL)
    LIMIT 50
  `;

  const missingDocuments = missingDocs.map(row => {
    const missingTypes: string[] = [];
    if (row.missing_id) missingTypes.push(row.missing_id as string);
    if (row.missing_bank) missingTypes.push(row.missing_bank as string);
    if (row.missing_dob) missingTypes.push(row.missing_dob as string);
    return {
      staffId: row.id as string,
      staffName: row.name as string,
      missingTypes,
    };
  });

  // Calculate compliance percentage (staff with verified ID + bank details)
  const withVerifiedId = Math.max(
    parseInt(statsResult.with_id as string),
    parseInt(verifiedDocs.verified_id as string)
  );
  const withVerifiedBank = Math.max(
    parseInt(statsResult.with_bank as string),
    parseInt(verifiedDocs.verified_bank as string)
  );

  const compliancePercentage = totalStaff > 0
    ? Math.round(((withVerifiedId + withVerifiedBank) / (totalStaff * 2)) * 100)
    : 0;

  return {
    totalStaff,
    withVerifiedId,
    withVerifiedPassport: Math.max(
      parseInt(statsResult.with_passport as string),
      parseInt(verifiedDocs.verified_passport as string)
    ),
    withVerifiedLicense: Math.max(
      parseInt(statsResult.with_license as string),
      parseInt(verifiedDocs.verified_license as string)
    ),
    withVerifiedBankDetails: withVerifiedBank,
    withDob: parseInt(statsResult.with_dob as string),
    missingDocuments,
    compliancePercentage,
  };
}
