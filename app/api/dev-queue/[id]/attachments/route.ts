import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/lib/auth-mock';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

// Storage API URL (VF Server)
const VF_STORAGE_URL = process.env.VF_STORAGE_URL || 'http://100.96.203.105:8091';

interface RouteParams {
  params: { id: string };
}

// GET - List attachments for an item
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const itemId = params.id;

    const attachments = await sql`
      SELECT * FROM wishlist_attachments
      WHERE item_id = ${itemId}
      ORDER BY created_at DESC
    `;

    return NextResponse.json({ success: true, data: attachments });
  } catch (error: any) {
    console.error('Get attachments error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message },
      { status: 500 }
    );
  }
}

// POST - Add attachment (URL or file upload)
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const itemId = params.id;
    const userId = auth.userId;
    const userName = auth.user?.name || 'User';

    const contentType = req.headers.get('content-type') || '';

    // Handle URL attachment
    if (contentType.includes('application/json')) {
      const body = await req.json();
      const { url, type = 'url' } = body;

      if (!url) {
        return NextResponse.json({ error: 'URL is required' }, { status: 400 });
      }

      const [attachment] = await sql`
        INSERT INTO wishlist_attachments (item_id, type, url, uploaded_by, uploaded_by_name)
        VALUES (${itemId}, ${type}, ${url}, ${userId}, ${userName})
        RETURNING *
      `;

      return NextResponse.json({ success: true, data: attachment }, { status: 201 });
    }

    // Handle file upload
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File;

      if (!file) {
        return NextResponse.json({ error: 'File is required' }, { status: 400 });
      }

      // Upload to storage API - endpoint is /upload/:type/:category
      const uploadFormData = new FormData();
      uploadFormData.append('file', file);

      const uploadResponse = await fetch(`${VF_STORAGE_URL}/upload/devQueue/${itemId}`, {
        method: 'POST',
        body: uploadFormData,
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('Storage upload failed:', errorText);
        return NextResponse.json(
          { error: 'Failed to upload file to storage' },
          { status: 500 }
        );
      }

      const uploadResult = await uploadResponse.json();
      const fileUrl = uploadResult.url || uploadResult.path;

      // Determine type based on mime type
      const mimeType = file.type;
      let attachmentType = 'file';
      if (mimeType.startsWith('image/')) {
        attachmentType = 'image';
      }

      const [attachment] = await sql`
        INSERT INTO wishlist_attachments (
          item_id, type, url, filename, file_size, mime_type, uploaded_by, uploaded_by_name
        )
        VALUES (
          ${itemId}, ${attachmentType}, ${fileUrl}, ${file.name}, ${file.size}, ${mimeType}, ${userId}, ${userName}
        )
        RETURNING *
      `;

      return NextResponse.json({ success: true, data: attachment }, { status: 201 });
    }

    return NextResponse.json({ error: 'Invalid content type' }, { status: 400 });
  } catch (error: any) {
    console.error('Add attachment error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message },
      { status: 500 }
    );
  }
}

// DELETE - Remove attachment
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const attachmentId = searchParams.get('attachmentId');

    if (!attachmentId) {
      return NextResponse.json({ error: 'Attachment ID is required' }, { status: 400 });
    }

    await sql`
      DELETE FROM wishlist_attachments
      WHERE id = ${attachmentId} AND item_id = ${params.id}
    `;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete attachment error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message },
      { status: 500 }
    );
  }
}
