/**
 * /my self-registration helpers (Slice A). A self-registered field worker is a
 * normal staff row with account_status='pending' (existing lifecycle) and
 * source='self_registered'. Mirrors the INSERT in pages/api/my/stores/technicians.ts,
 * adding the captured columns (source, declared_project_id, id_number, selfie_url)
 * from migration 420. The reference route locks role to 'technician' and derives
 * department/position accordingly; this helper extends that pattern to 'casual'.
 */
import sharp from 'sharp';

import { sql } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { VFStorageService } from '@/services/vfStorageAdapter';

export interface SelfRegisteredWorkerInput {
  firstName: string;
  lastName: string;
  phone: string;
  role: 'technician' | 'casual';
  declaredProjectId: string;
  idNumber: string | null;
  selfieUrl: string | null;
}

/** INSERT a pending, self-registered field worker. Returns the new staff id. */
export async function createSelfRegisteredFieldWorker(
  input: SelfRegisteredWorkerInput,
): Promise<string> {
  const prefix = input.role === 'casual' ? 'CASL' : 'TECH';
  const employeeId = `${prefix}-${String(Date.now()).slice(-8)}`;
  // staff.email is NOT NULL UNIQUE but self-registered workers have no real email.
  // Synthetic `@phone.local` address, matching /api/field/users and stores/technicians.
  const resolvedEmail = `${input.phone}@phone.local`;
  const department = input.role === 'casual' ? 'Field (casual)' : 'Field Operations';
  const position = input.role === 'casual' ? 'Casual' : 'Technician';

  const rows = await sql<{ id: string }>`
    INSERT INTO staff (
      employee_id, first_name, last_name, email, phone, status,
      department, position, contract_type,
      role, account_status, source,
      declared_project_id, id_number, selfie_url
    ) VALUES (
      ${employeeId}, ${input.firstName.trim()}, ${input.lastName.trim()},
      ${resolvedEmail}, ${input.phone}, 'active',
      ${department}, ${position}, 'contractor',
      ${input.role}, 'pending', 'self_registered',
      ${input.declaredProjectId}, ${input.idNumber}, ${input.selfieUrl}
    )
    ON CONFLICT (email) DO NOTHING
    RETURNING id
  `;

  if (rows[0]?.id) return rows[0].id;

  // FIX 4: concurrent duplicate — INSERT was a no-op; fall back to SELECT
  const existing = await sql<{ id: string }>`
    SELECT id FROM staff WHERE email = ${resolvedEmail} LIMIT 1
  `;
  const id = existing[0]?.id;
  if (!id) throw new Error('createSelfRegisteredFieldWorker: insert returned no id and fallback select also found nothing');
  return id;
}

/**
 * Resize a base64 selfie and upload to VF Storage at registrations/<staffId>/selfie.jpg.
 * Returns the relative /storage/... URL. `base64` may be bare or a data URL.
 */
export async function storeRegistrationSelfie(params: {
  base64: string;
  staffId: string;
}): Promise<string> {
  const commaIdx = params.base64.indexOf(',');
  const raw = commaIdx >= 0 ? params.base64.slice(commaIdx + 1) : params.base64;
  const input = Buffer.from(raw, 'base64');
  if (input.length === 0) throw new Error('storeRegistrationSelfie: empty selfie buffer');

  const resized = await sharp(input)
    .rotate()
    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toBuffer();

  const storage = new VFStorageService();
  const result = await storage.uploadFile(resized, 'registrations', params.staffId, 'selfie.jpg');
  if (!result.success) {
    throw new Error('VF Storage upload reported non-success for registration selfie');
  }
  log.info('[my-register] selfie stored', { staffId: params.staffId, size: result.size });
  return result.url;
}
