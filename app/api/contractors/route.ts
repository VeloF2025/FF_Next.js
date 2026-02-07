/**
 * Contractors API Route - List and Create
 * GET  /api/contractors - List all contractors with optional filters
 * POST /api/contractors - Create new contractor
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { neon } from '@neondatabase/serverless';
import type { Contractor, ContractorFormData, ContractorFilter } from '@/types/contractor.core.types';

const sql = neon(process.env.DATABASE_URL || '');

// ==================== GET /api/contractors ====================

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // Parse filters from query params
    const filters: ContractorFilter = {
      searchTerm: searchParams.get('search') || undefined,
      status: searchParams.getAll('status') as any || undefined,
      complianceStatus: searchParams.getAll('complianceStatus') as any || undefined,
      businessType: searchParams.getAll('businessType') as any || undefined,
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
    // Multiple filters (build dynamic query)
    else {
      const conditions = [];
      const params: any = {};

      if (filters.searchTerm) {
        const searchTerm = `%${filters.searchTerm}%`;
        contractors = await sql`
          SELECT * FROM contractors
          WHERE (
            LOWER(company_name) LIKE LOWER(${searchTerm}) OR
            LOWER(contact_person) LIKE LOWER(${searchTerm}) OR
            LOWER(email) LIKE LOWER(${searchTerm})
          )
          ${filters.status && filters.status.length > 0 ? sql`AND status = ANY(${filters.status})` : sql``}
          ${filters.complianceStatus && filters.complianceStatus.length > 0 ? sql`AND compliance_status = ANY(${filters.complianceStatus})` : sql``}
          ORDER BY created_at DESC
        `;
      } else {
        contractors = await sql`
          SELECT * FROM contractors
          WHERE 1=1
          ${filters.status && filters.status.length > 0 ? sql`AND status = ANY(${filters.status})` : sql``}
          ${filters.complianceStatus && filters.complianceStatus.length > 0 ? sql`AND compliance_status = ANY(${filters.complianceStatus})` : sql``}
          ORDER BY created_at DESC
        `;
      }
    }

    // Map database fields to camelCase
    const mapped = contractors.map(mapDbToContractor);

    return NextResponse.json({ data: mapped });
  } catch (error) {
    console.error('Error fetching contractors:', error);
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

    const mapped = mapDbToContractor(contractor);

    // Revalidate the contractors page cache
    revalidatePath('/contractors');

    return NextResponse.json({ data: mapped }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating contractor:', error);

    // Handle unique constraint violations
    if (error.code === '23505') {
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
function mapDbToContractor(row: any): Contractor {
  return {
    id: row.id,

    // Company
    companyName: row.company_name,
    registrationNumber: row.registration_number,
    businessType: row.business_type,
    industryCategory: row.industry_category || '',
    yearsInBusiness: row.years_in_business,

    // Contact
    contactPerson: row.contact_person,
    email: row.email,
    phone: row.phone,
    alternatePhone: row.alternate_phone,

    // Address
    physicalAddress: row.physical_address,
    city: row.city,
    province: row.province,
    postalCode: row.postal_code,

    // Financial
    bankName: row.bank_name,
    accountNumber: row.account_number,
    branchCode: row.branch_code,

    // Status
    status: row.status,
    isActive: row.is_active,
    complianceStatus: row.compliance_status,

    // Professional
    specializations: row.specializations || [],
    certifications: row.certifications || [],

    // Metadata
    notes: row.notes,
    tags: row.tags || [],
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
