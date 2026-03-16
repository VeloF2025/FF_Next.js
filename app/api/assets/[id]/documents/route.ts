/**
 * Asset Documents API Route
 * GET  /api/assets/[id]/documents - List documents for an asset
 * POST /api/assets/[id]/documents - Upload a document
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDbConnection } from '@/modules/assets/utils/db';
import { v4 as uuidv4 } from 'uuid';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// ==================== GET /api/assets/[id]/documents ====================

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id: assetId } = await params;
    const sql = getDbConnection();

    const documents = await sql`
      SELECT
        id,
        asset_id as "assetId",
        maintenance_id as "maintenanceId",
        document_type as "documentType",
        document_name as "documentName",
        document_number as "documentNumber",
        file_name as "fileName",
        file_path as "filePath",
        file_url as "fileUrl",
        file_size as "fileSize",
        mime_type as "mimeType",
        issue_date as "issueDate",
        expiry_date as "expiryDate",
        issuing_authority as "issuingAuthority",
        issuer_contact as "issuerContact",
        is_active as "isActive",
        notes,
        uploaded_by as "uploadedBy",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM asset_documents
      WHERE asset_id = ${assetId}
        AND is_active = true
      ORDER BY created_at DESC
    `;

    return NextResponse.json({ data: documents });
  } catch (error) {
    console.error('Error fetching documents:', error);
    return NextResponse.json(
      { error: 'Failed to fetch documents' },
      { status: 500 }
    );
  }
}

// ==================== POST /api/assets/[id]/documents ====================

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { id: assetId } = await params;
    const sql = getDbConnection();

    // Check if asset exists
    const [asset] = await sql`SELECT id FROM assets WHERE id = ${assetId}`;
    if (!asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    const body = await req.json();
    const {
      documentType,
      documentName,
      documentNumber,
      fileName,
      filePath,
      fileUrl,
      fileSize,
      mimeType,
      issueDate,
      expiryDate,
      issuingAuthority,
      issuerContact,
      notes,
      maintenanceId,
    } = body;

    // Validate required fields
    if (!documentType || !documentName || !fileUrl) {
      return NextResponse.json(
        { error: 'documentType, documentName, and fileUrl are required' },
        { status: 400 }
      );
    }

    const id = uuidv4();
    const [user, unauth] = await requireAuth(req);
    if (unauth) return unauth;

    const uploadedBy = user.id;

    const [document] = await sql`
      INSERT INTO asset_documents (
        id,
        asset_id,
        maintenance_id,
        document_type,
        document_name,
        document_number,
        file_name,
        file_path,
        file_url,
        file_size,
        mime_type,
        issue_date,
        expiry_date,
        issuing_authority,
        issuer_contact,
        is_active,
        notes,
        uploaded_by,
        created_at,
        updated_at
      ) VALUES (
        ${id},
        ${assetId},
        ${maintenanceId || null},
        ${documentType},
        ${documentName},
        ${documentNumber || null},
        ${fileName || null},
        ${filePath || null},
        ${fileUrl},
        ${fileSize || null},
        ${mimeType || null},
        ${issueDate ? new Date(issueDate) : null},
        ${expiryDate ? new Date(expiryDate) : null},
        ${issuingAuthority || null},
        ${issuerContact || null},
        true,
        ${notes || null},
        ${uploadedBy},
        NOW(),
        NOW()
      )
      RETURNING
        id,
        asset_id as "assetId",
        document_type as "documentType",
        document_name as "documentName",
        file_url as "fileUrl",
        created_at as "createdAt"
    `;

    return NextResponse.json({ data: document }, { status: 201 });
  } catch (error) {
    console.error('Error creating document:', error);
    return NextResponse.json(
      { error: 'Failed to create document' },
      { status: 500 }
    );
  }
}
