#!/usr/bin/env tsx
/**
 * Import EXFO asset photos from a sequence mapping CSV.
 *
 * Dry-run by default. Pass --execute to upload files to VF Storage and update DB.
 *
 * Expected mapping columns are produced by the Jarvis EXFO sequence mapper:
 * machine_group, sequence_no, photo_role, exfo_serial_barcode, match_status,
 * asset_id, asset_number, original_filename, upload_filename, upload_local_path.
 */

import fs from 'fs/promises';
import path from 'path';
import { Pool } from 'pg';
import { VFStorageService } from '../../src/services/vfStorageAdapter';

type MappingRow = {
  machine_group: string;
  sequence_no: string;
  photo_role: 'label' | 'front' | 'back' | string;
  exfo_serial_barcode: string;
  match_status: string;
  asset_id: string;
  asset_number: string;
  asset_name: string;
  original_filename: string;
  upload_filename: string;
  upload_local_path: string;
  document_type: string;
  recommended_image_field: string;
};

type UploadResult = {
  success: boolean;
  filename: string;
  path: string;
  url: string;
  size: number;
};

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  const getValue = (name: string): string | undefined => {
    const prefix = `${name}=`;
    return process.argv.slice(2).find(arg => arg.startsWith(prefix))?.slice(prefix.length);
  };

  return {
    execute: args.has('--execute'),
    mapping: getValue('--mapping') || '/home/hein/.hermes/media_cache/exfo-assets/exfo_full_photo_upload_mapping.csv',
    storageUrl: getValue('--storage-url') || process.env.VF_STORAGE_URL,
  };
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

async function readMapping(filePath: string): Promise<MappingRow[]> {
  const content = await fs.readFile(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] || ''])) as MappingRow;
  });
}

function groupByAsset(rows: MappingRow[]): Map<string, MappingRow[]> {
  const grouped = new Map<string, MappingRow[]>();
  for (const row of rows) {
    if (!row.asset_id) continue;
    const current = grouped.get(row.asset_id) || [];
    current.push(row);
    grouped.set(row.asset_id, current);
  }
  return grouped;
}

function assertSafeMapping(rows: MappingRow[]) {
  const missingFiles = rows.filter(row => !row.upload_local_path);
  const unmatched = rows.filter(row => !row.asset_id);
  if (missingFiles.length > 0) {
    throw new Error(`Mapping contains ${missingFiles.length} rows without upload_local_path`);
  }
  return { unmatched };
}

async function uploadPhoto(storage: VFStorageService, row: MappingRow): Promise<UploadResult> {
  const buffer = await fs.readFile(row.upload_local_path);
  const fileName = `${row.asset_id}_${row.upload_filename || path.basename(row.upload_local_path)}`;
  return storage.uploadFile(buffer, 'assets', 'photos', fileName) as Promise<UploadResult>;
}

async function importRows(rows: MappingRow[], execute: boolean, storageUrl?: string) {
  const { unmatched } = assertSafeMapping(rows);
  const matchedRows = rows.filter(row => row.asset_id);
  const grouped = groupByAsset(matchedRows);

  console.log(`Rows in mapping: ${rows.length}`);
  console.log(`Matched photo rows: ${matchedRows.length}`);
  console.log(`Unmatched photo rows skipped until asset creation: ${unmatched.length}`);
  console.log(`Matched assets to update: ${grouped.size}`);

  if (!execute) {
    for (const [assetId, assetRows] of grouped) {
      console.log(`[dry-run] ${assetRows[0].asset_number} ${assetRows[0].exfo_serial_barcode}: ${assetRows.length} photos -> ${assetId}`);
    }
    for (const row of unmatched) {
      console.log(`[dry-run][unmatched] ${row.machine_group} ${row.exfo_serial_barcode}: seq ${row.sequence_no} ${row.original_filename}`);
    }
    console.log('Dry-run only. Re-run with --execute to upload and update DB.');
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for --execute');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const storage = new VFStorageService(storageUrl);

  try {
    for (const [assetId, assetRows] of grouped) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const assetResult = await client.query(
          'SELECT id, asset_number, serial_number, image_urls FROM assets WHERE id = $1 FOR UPDATE',
          [assetId]
        );
        if (assetResult.rowCount !== 1) {
          throw new Error(`Asset not found: ${assetId}`);
        }

        const asset = assetResult.rows[0];
        const expectedSerial = assetRows[0].exfo_serial_barcode;
        if (asset.serial_number && asset.serial_number !== expectedSerial) {
          throw new Error(`Serial mismatch for ${asset.asset_number}: DB=${asset.serial_number}, mapping=${expectedSerial}`);
        }

        const uploaded: Array<{ row: MappingRow; upload: UploadResult }> = [];
        for (const row of assetRows) {
          const importNote = `Imported from WhatsApp sequence ${row.sequence_no}; machine group ${row.machine_group}; original file ${row.original_filename}`;
          const existingDocument = await client.query(
            `SELECT file_name, file_path, file_url, COALESCE(file_size, 0) AS file_size
             FROM asset_documents
             WHERE asset_id = $1
               AND document_type = 'photo'
               AND document_number = $2
               AND notes = $3
               AND is_active = true
             LIMIT 1`,
            [assetId, expectedSerial, importNote]
          );

          if (existingDocument.rowCount === 1) {
            const existing = existingDocument.rows[0];
            uploaded.push({
              row,
              upload: {
                success: true,
                filename: existing.file_name,
                path: existing.file_path,
                url: existing.file_url,
                size: Number(existing.file_size) || 0,
              },
            });
            continue;
          }

          const upload = await uploadPhoto(storage, row);
          uploaded.push({ row, upload });
          await client.query(
            `INSERT INTO asset_documents (
              asset_id, document_type, document_name, document_number,
              file_name, file_path, file_url, file_size, mime_type,
              is_active, notes, uploaded_by, created_at, updated_at
            ) VALUES (
              $1, 'photo', $2, $3,
              $4, $5, $6, $7, 'image/jpeg',
              true, $8, 'system', NOW(), NOW()
            )`,
            [
              assetId,
              `EXFO ${row.photo_role} photo - ${expectedSerial}`,
              expectedSerial,
              upload.filename,
              upload.path,
              upload.url,
              upload.size,
              importNote,
            ]
          );
        }

        const labelUrl = uploaded.find(item => item.row.photo_role === 'label')?.upload.url || null;
        const frontUrl = uploaded.find(item => item.row.photo_role === 'front')?.upload.url || null;
        const allUrls = [
          ...new Set([
            ...((asset.image_urls as string[] | null) || []),
            ...uploaded.map(item => item.upload.url),
          ]),
        ];

        await client.query(
          `UPDATE assets SET
            barcode = COALESCE(NULLIF($2, ''), barcode),
            label_image_url = COALESCE($3, label_image_url),
            verification_image_url = COALESCE($3, verification_image_url),
            primary_image_url = COALESCE($4, primary_image_url),
            image_urls = $5::jsonb,
            vlm_extraction_data = COALESCE(vlm_extraction_data, '{}'::jsonb) || $6::jsonb,
            verification_status = CASE WHEN serial_number = $2 THEN 'verified' ELSE verification_status END,
            verified_at = CASE WHEN serial_number = $2 THEN COALESCE(verified_at, NOW()) ELSE verified_at END,
            updated_at = NOW()
          WHERE id = $1`,
          [
            assetId,
            expectedSerial,
            labelUrl,
            frontUrl,
            JSON.stringify(allUrls),
            JSON.stringify({ exfoImport: { serialBarcode: expectedSerial, importedAt: new Date().toISOString(), photoCount: uploaded.length } }),
          ]
        );

        await client.query('COMMIT');
        console.log(`Imported ${uploaded.length} photos for ${asset.asset_number} (${expectedSerial})`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

async function main() {
  const args = parseArgs();
  const rows = await readMapping(args.mapping);
  await importRows(rows, args.execute, args.storageUrl);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
