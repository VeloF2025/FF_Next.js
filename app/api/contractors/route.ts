/**
 * Contractors API Route - List and Create
 * GET  /api/contractors - List all contractors with optional filters
 * POST /api/contractors - Create new contractor
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { neon } from '@neondatabase/serverless';
import type { Contractor, ContractorFormData, ContractorFilter } from '@/types/contractor.core.types';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL || '');

// ==================== GET /api/contractors ====================

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // Parse filters from query params
    const filters: ContractorFilter = {
      searchTerm: searchParams.get('search') || undefined,
      status: searchParams.getAll('status') as ContractorFilter['status'] || undefined,
      complianceStatus: searchParams.getAll('complianceStatus') as ContractorFilter['complianceStatus'] || undefined,
      businessType: searchParams.getAll('businessType') as ContractorFilter['businessType'] || undefined,
      province: searchParams.getAll('province') || undefined,
    };

    let contractors;

    // Simple query if no filters
    if (!filters.searchTerm && !filters.status && !filters.complianceStatus && !filters.businessType && !filters.province) {
      contractors = await sql`
        SELECT * FROM contractors
        ORDER BY created_at DESC
      `;
    }
    // Search filter
    else if (filters.searchTerm && !filters.status) {
      const searchTerm = `%${filters.searchTerm}%`;
      contractors = await sql`
        SELECT * FROM contractors
        WHERE (
          LOWER(company_name) LIKE LOWER(${searchTerm}) OR
          LOWER(contact_person) LIKE LOWER(${searchTerm}) OR
          LOWER(email) LIKE LOWER(${searchTerm}) OR
          LOWER(registration_number) LIKE LOWER(${searchTerm})
        )
        ORDER BY created_at DESC
      `;
    }
    // Status filter
    else if (filters.status && filters.status.length > 0) {
      contractors = await sql`
        SELECT * FROM contractors
        WHERE status = ANY(${filters.status})
        ORDER BY created_at DESC
      `;
    }
    // Multiple filters — explicit branches to avoid conditional SQL fragments (Neon rule)
    else {
      const hasStatus = filters.status && filters.status.length > 0;
      const hasCompliance = filters.complianceStatus && filters.complianceStatus.length > 0;

      if (filters.searchTerm) {
        const searchTerm = `%${filters.searchTerm}%`;
        if (hasStatus && hasCompliance) {
          contractors = await sql`
            SELECT * FROM contractors
            WHERE (
              LOWER(company_name) LIKE LOWER(${searchTerm}) OR
              LOWER(contact_person) LIKE LOWER(${searchTerm}) OR
              LOWER(email) LIKE LOWER(${searchTerm})
            )
            AND status = ANY(${filters.status!})
            AND compliance_status = ANY(${filters.complianceStatus!})
            ORDER BY created_at DESC
          `;
        } else if (hasStatus) {
          contractors = await sql`
            SELECT * FROM contractors
            WHERE (
              LOWER(company_name) LIKE LOWER(${searchTerm}) OR
              LOWER(contact_person) LIKE LOWER(${searchTerm}) OR
              LOWER(email) LIKE LOWER(${searchTerm})
            )
            AND status = ANY(${filters.status!})
            ORDER BY created_at DESC
          `;
        } else if (hasCompliance) {
          contractors = await sql`
            SELECT * FROM contractors
            WHERE (
              LOWER(company_name) LIKE LOWER(${searchTerm}) OR
              LOWER(contact_person) LIKE LOWER(${searchTerm}) OR
              LOWER(email) LIKE LOWER(${searchTerm})
            )
            AND compliance_status = ANY(${filters.complianceStatus!})
            ORDER BY created_at DESC
          `;
        } else {
          contractors = await sql`
            SELECT * FROM contractors
            WHERE (
              LOWER(company_name) LIKE LOWER(${searchTerm}) OR
              LOWER(contact_person) LIKE LOWER(${searchTerm}) OR
              LOWER(email) LIKE LOWER(${searchTerm})
            )
            ORDER BY created_at DESC
          `;
        }
      } else if (hasStatus && hasCompliance) {
        contractors = await sql`
          SELECT * FROM contractors
          WHERE status = ANY(${filters.status!})
            AND compliance_status = ANY(${filters.complianceStatus!})
          ORDER BY created_at DESC
        `;
      } else if (hasStatus) {
        contractors = await sql`
          SELECT * FROM contractors
          WHERE status = ANY(${filters.status!})
          ORDER BY created_at DESC
        `;
      } else {
        contractors = await sql`
          SELECT * FROM contractors
          WHERE compliance_status = ANY(${filters.complianceStatus!})
          ORDER BY created_at DESC
        `;
      }
    }

    // Map database fields to camelCase
    const mapped = contractors.map(mapDbToContractor);

    return NextResponse.json({ data: mapped });
  } catch (error) {
    log.error('Error fetching contractors', { error }, 'ContractorsAPI');
    return NextResponse.json(
      { error: 'Failed to fetch contractors' },
      { status: 500 }
    );
  }
}

// ==================== POST /api/contractors ====================

export async function POST(req: NextRequest) {
  try {
    const body: ContractorFormData = await req.json();

    // Validate required fields
    if (!body.companyName || !body.registrationNumber || !body.businessType ||
        !body.contactPerson || !body.email || !body.phone) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Insert new contractor
    const [contractor] = await sql`
      INSERT INTO contractors (
        company_name,
        registration_number,
        business_type,
        industry_category,
        years_in_business,
        contact_person,
        email,
        phone,
        alternate_phone,
        physical_address,
        city,
        province,
        postal_code,
        bank_name,
        account_number,
        branch_code,
        status,
        is_active,
        compliance_status,
        specializations,
        certifications,
        notes,
        tags
      ) VALUES (
        ${body.companyName},
        ${body.registrationNumber},
        ${body.businessType},
        ${body.industryCategory || ''},
        ${body.yearsInBusiness || null},
        ${body.contactPerson},
        ${body.email},
        ${body.phone},
        ${body.alternatePhone || null},
        ${body.physicalAddress || null},
        ${body.city || null},
        ${body.province || null},
        ${body.postalCode || null},
        ${body.bankName || null},
        ${body.accountNumber || null},
        ${body.branchCode || null},
        ${body.status || 'pending'},
        ${body.isActive !== undefined ? body.isActive : true},
        ${body.complianceStatus || 'pending'},
        ${body.specializations || []},
        ${body.certifications || []},
        ${body.notes || null},
        ${body.tags || []}
      )
      RETURNING *
    `;

    const mapped = mapDbToContractor(contractor as DbRow);

    // Revalidate the contractors page cache
    revalidatePath('/contractors');

    return NextResponse.json({ data: mapped }, { status: 201 });
  } catch (error) {
    log.error('Error creating contractor', { error }, 'ContractorsAPI');

    // Handle unique constraint violations
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === '23505') {
      return NextResponse.json(
        { error: 'Contractor with this registration number or email already exists' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create contractor' },
      { status: 500 }
    );
  }
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Map database row (snake_case) to Contractor interface (camelCase)
 */
/** Database row type from Neon SQL result */
type DbRow = { [key: string]: string | number | boolean | string[] | null | undefined };

function mapDbToContractor(row: DbRow): Contractor {
  return {
    id: row.id as string,

    // Company
    companyName: row.company_name as string,
    registrationNumber: row.registration_number as string,
    businessType: row.business_type as import('@/types/contractor.core.types').BusinessType,
    industryCategory: (row.industry_category as string) || '',
    yearsInBusiness: row.years_in_business as number | undefined,

    // Contact
    contactPerson: row.contact_person as string,
    email: row.email as string,
    phone: row.phone as string,
    alternatePhone: row.alternate_phone as string | undefined,

    // Address
    physicalAddress: row.physical_address as string | undefined,
    city: row.city as string | undefined,
    province: row.province as string | undefined,
    postalCode: row.postal_code as string | undefined,

    // Financial
    bankName: row.bank_name as string | undefined,
    accountNumber: row.account_number as string | undefined,
    branchCode: row.branch_code as string | undefined,

    // Status
    status: row.status as import('@/types/contractor.core.types').ContractorStatus,
    isActive: row.is_active as boolean,
    complianceStatus: row.compliance_status as import('@/types/contractor.core.types').ComplianceStatus,

    // Professional
    specializations: (row.specializations as string[]) || [],
    certifications: (row.certifications as string[]) || [],

    // Metadata
    notes: row.notes as string | undefined,
    tags: (row.tags as string[]) || [],
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}
