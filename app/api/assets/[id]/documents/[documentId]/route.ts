/**
 * Individual Asset Document API Route
 * DELETE /api/assets/[id]/documents/[documentId] - Soft delete a document
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDbConnection } from '@/modules/assets/utils/db';

interface RouteParams {
  params: Promise<{ id: string; documentId: string }>;
}

// ==================== DELETE /api/assets/[id]/documents/[documentId] ====================

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const { id: assetId, documentId } = await params;
    const sql = getDbConnection();

    // Verify document belongs to this asset
    const [doc] = await sql`
      SELECT id, file_path as "filePath"
      FROM asset_documents
      WHERE id = ${documentId}
        AND asset_id = ${assetId}
        AND is_active = true
    `;

    if (!doc) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    // Soft delete - set is_active to false
    await sql`
      UPDATE asset_documents
      SET is_active = false, updated_at = NOW()
      WHERE id = ${documentId}
    `;

    return NextResponse.json({ success: true, message: 'Document deleted' });
  } catch (error) {
    console.error('Error deleting document:', error);
    return NextResponse.json(
      { error: 'Failed to delete document' },
      { status: 500 }
    );
  }
}
