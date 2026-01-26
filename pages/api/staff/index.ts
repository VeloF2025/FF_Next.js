import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { logCreate, logUpdate, logDelete } from '@/lib/db-logger';
import { getSql } from '@/lib/neon-sql';
import { withAuth } from '@/lib/auth';

// Create a new SQL instance for each request to avoid connection issues
const getSqlInstance = () => getSql();

export default withAuth(withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  const sql = getSqlInstance();
  // CORS handled by withErrorHandler
  
  try {
    switch (req.method) {
      case 'GET': {
        // Get all staff or single staff member by ID
        const { id, search, department, status, position } = req.query;
        
        if (id) {
          // Get single staff member with all fields aliased for frontend
          const staff = await sql`
            SELECT
              s.*,
              CONCAT(s.first_name, ' ', s.last_name) as name,
              CONCAT(s.first_name, ' ', s.last_name) as full_name,
              -- Identity documents
              s.sa_id_number as "saIdNumber",
              s.id_number as "idNumber",
              s.passport_number as "passportNumber",
              s.passport_country as "passportCountry",
              s.passport_expiry as "passportExpiry",
              s.work_permit_number as "workPermitNumber",
              s.work_permit_expiry as "workPermitExpiry",
              -- Photos
              s.id_photo_url as "idPhotoUrl",
              s.profile_photo_url as "profilePhotoUrl",
              s.photo_match_score as "photoMatchScore",
              s.photo_verified_at as "photoVerifiedAt",
              -- Bank details
              s.bank_name as "bankName",
              s.bank_account_number as "bankAccountNumber",
              s.bank_branch_code as "bankBranchCode",
              s.bank_account_type as "bankAccountType",
              s.bank_account_holder as "bankAccountHolder",
              s.bank_details_verified_at as "bankDetailsVerifiedAt",
              -- Contact
              s.whatsapp_id as "whatsappId",
              s.alternate_phone as "alternativePhone",
              s.emergency_contact->>'name' as "emergencyContactName",
              s.emergency_contact->>'phone' as "emergencyContactPhone",
              s.emergency_contact_relationship as "emergencyContactRelationship",
              -- Next of kin
              s.next_of_kin_name as "nextOfKinName",
              s.next_of_kin_phone as "nextOfKinPhone",
              s.next_of_kin_relationship as "nextOfKinRelationship",
              s.next_of_kin_address as "nextOfKinAddress",
              -- Address
              s.state as "province",
              s.postal_code as "postalCode",
              -- Employment
              s.experience_years as "experienceYears",
              s.max_project_count as "maxProjectCount",
              s.current_project_count as "currentProjectCount",
              s.working_hours as "workingHours",
              s.weekly_hours as "weeklyHours",
              s.available_weekends as "availableWeekends",
              s.available_nights as "availableNights",
              s.time_zone as "timeZone",
              s.contract_type as "contractType",
              s.reports_to as "reportsTo",
              s.notice_period_days as "noticePeriodDays",
              -- Compensation
              s.hourly_rate as "hourlyRate",
              s.salary as "salaryAmount",
              s.salary_grade as "salaryGrade",
              -- SA Compliance
              s.uif_status as "uifStatus",
              s.uif_number as "uifNumber",
              s.coida_status as "coidaStatus",
              s.tax_status as "taxStatus",
              s.tax_number as "taxNumber",
              s.probation_status as "probationStatus",
              s.probation_end_date as "probationEndDate",
              s.probation_extended as "probationExtended",
              s.probation_extension_reason as "probationExtensionReason",
              s.notice_period as "noticePeriod",
              -- Exit
              s.exit_type as "exitType",
              s.exit_reason as "exitReason",
              s.is_rehireable as "isRehireable",
              -- Dates
              s.join_date as "startDate"
            FROM staff s
            WHERE s.id = ${id as string}
          `;
          
          const staffRows = staff as any[];
          if (staffRows.length === 0) {
            return res.status(404).json({ 
              success: false, 
              data: null, 
              message: 'Staff member not found' 
            });
          }
          
          res.status(200).json({ success: true, data: staffRows[0] });
        } else {
          // Build query with filters using parameterized queries
          let staff;

          if (search && department && status && position) {
            const searchTerm = `%${search}%`;
            const positionTerm = `%${position}%`;
            staff = await sql`
              SELECT
                s.*,
                CONCAT(s.first_name, ' ', s.last_name) as name,
                CONCAT(s.first_name, ' ', s.last_name) as full_name
              FROM staff s
              WHERE (
                LOWER(CONCAT(s.first_name, ' ', s.last_name)) LIKE LOWER(${searchTerm}) OR
                LOWER(s.first_name) LIKE LOWER(${searchTerm}) OR
                LOWER(s.last_name) LIKE LOWER(${searchTerm}) OR
                LOWER(s.email) LIKE LOWER(${searchTerm}) OR
                LOWER(s.employee_id) LIKE LOWER(${searchTerm})
              ) AND s.department = ${department} AND s.status = ${status} AND LOWER(s.position) LIKE LOWER(${positionTerm})
              ORDER BY s.created_at DESC NULLS LAST
            `;
          } else if (search && department && status) {
            const searchTerm = `%${search}%`;
            staff = await sql`
              SELECT
                s.*,
                CONCAT(s.first_name, ' ', s.last_name) as name,
                CONCAT(s.first_name, ' ', s.last_name) as full_name
              FROM staff s
              WHERE (
                LOWER(CONCAT(s.first_name, ' ', s.last_name)) LIKE LOWER(${searchTerm}) OR
                LOWER(s.first_name) LIKE LOWER(${searchTerm}) OR
                LOWER(s.last_name) LIKE LOWER(${searchTerm}) OR
                LOWER(s.email) LIKE LOWER(${searchTerm}) OR
                LOWER(s.employee_id) LIKE LOWER(${searchTerm})
              ) AND s.department = ${department} AND s.status = ${status}
              ORDER BY s.created_at DESC NULLS LAST
            `;
          } else if (search && department) {
            const searchTerm = `%${search}%`;
            staff = await sql`
              SELECT
                s.*,
                CONCAT(s.first_name, ' ', s.last_name) as name,
                CONCAT(s.first_name, ' ', s.last_name) as full_name
              FROM staff s
              WHERE (
                LOWER(CONCAT(s.first_name, ' ', s.last_name)) LIKE LOWER(${searchTerm}) OR
                LOWER(s.first_name) LIKE LOWER(${searchTerm}) OR
                LOWER(s.last_name) LIKE LOWER(${searchTerm}) OR
                LOWER(s.email) LIKE LOWER(${searchTerm}) OR
                LOWER(s.employee_id) LIKE LOWER(${searchTerm})
              ) AND s.department = ${department}
              ORDER BY s.created_at DESC NULLS LAST
            `;
          } else if (search) {
            const searchTerm = `%${search}%`;
            staff = await sql`
              SELECT
                s.*,
                CONCAT(s.first_name, ' ', s.last_name) as name,
                CONCAT(s.first_name, ' ', s.last_name) as full_name
              FROM staff s
              WHERE (
                LOWER(CONCAT(s.first_name, ' ', s.last_name)) LIKE LOWER(${searchTerm}) OR
                LOWER(s.first_name) LIKE LOWER(${searchTerm}) OR
                LOWER(s.last_name) LIKE LOWER(${searchTerm}) OR
                LOWER(s.email) LIKE LOWER(${searchTerm}) OR
                LOWER(s.employee_id) LIKE LOWER(${searchTerm})
              )
              ORDER BY s.created_at DESC NULLS LAST
            `;
          } else if (department && status && position) {
            const positionTerm = `%${position}%`;
            staff = await sql`
              SELECT
                s.*,
                CONCAT(s.first_name, ' ', s.last_name) as name,
                CONCAT(s.first_name, ' ', s.last_name) as full_name
              FROM staff s
              WHERE s.department = ${department} AND s.status = ${status} AND LOWER(s.position) LIKE LOWER(${positionTerm})
              ORDER BY s.created_at DESC NULLS LAST
            `;
          } else if (department && status) {
            staff = await sql`
              SELECT
                s.*,
                CONCAT(s.first_name, ' ', s.last_name) as name,
                CONCAT(s.first_name, ' ', s.last_name) as full_name
              FROM staff s
              WHERE s.department = ${department} AND s.status = ${status}
              ORDER BY s.created_at DESC NULLS LAST
            `;
          } else if (department) {
            staff = await sql`
              SELECT
                s.*,
                CONCAT(s.first_name, ' ', s.last_name) as name,
                CONCAT(s.first_name, ' ', s.last_name) as full_name
              FROM staff s
              WHERE s.department = ${department}
              ORDER BY s.created_at DESC NULLS LAST
            `;
          } else if (status) {
            staff = await sql`
              SELECT
                s.*,
                CONCAT(s.first_name, ' ', s.last_name) as name,
                CONCAT(s.first_name, ' ', s.last_name) as full_name
              FROM staff s
              WHERE s.status = ${status}
              ORDER BY s.created_at DESC NULLS LAST
            `;
          } else if (position) {
            const positionTerm = `%${position}%`;
            staff = await sql`
              SELECT
                s.*,
                CONCAT(s.first_name, ' ', s.last_name) as name,
                CONCAT(s.first_name, ' ', s.last_name) as full_name
              FROM staff s
              WHERE LOWER(s.position) LIKE LOWER(${positionTerm})
              ORDER BY s.created_at DESC NULLS LAST
            `;
          } else {
            // Simple query without any parameters when none are provided
            staff = await sql`
              SELECT
                s.*,
                CONCAT(s.first_name, ' ', s.last_name) as name,
                CONCAT(s.first_name, ' ', s.last_name) as full_name
              FROM staff s
              ORDER BY s.created_at DESC NULLS LAST
            `;
          }
          
          // Return empty array if no staff, not an error
          const staffRows = staff as any[];
          res.status(200).json({
            success: true,
            data: staffRows || [],
            message: staffRows.length === 0 ? 'No staff members found' : undefined
          });
        }
        break;
      }

      case 'POST': {
        // Create new staff member
        const staffData = req.body;

        try {
          // Extract first and last name from name field or use separate fields
          const name = staffData.name || '';
          const firstName = staffData.first_name || staffData.firstName || name.split(' ')[0] || '';
          const lastName = staffData.last_name || staffData.lastName || name.split(' ').slice(1).join(' ') || '';

          const newStaff = await sql`
            INSERT INTO staff (
              employee_id, first_name, last_name, email, phone,
              department, position, join_date, status, whatsapp_id
            )
            VALUES (
              ${staffData.employee_id || staffData.employeeId || `EMP-${Date.now()}`},
              ${firstName},
              ${lastName},
              ${staffData.email},
              ${staffData.phone || null},
              ${staffData.department || 'General'},
              ${staffData.position || 'Staff'},
              ${staffData.join_date || staffData.startDate || new Date().toISOString()},
              ${staffData.status || 'ACTIVE'},
              ${staffData.whatsappId || staffData.whatsapp_id || null}
            )
            RETURNING *, CONCAT(first_name, ' ', last_name) as name, CONCAT(first_name, ' ', last_name) as full_name,
              sa_id_number as "saIdNumber", passport_number as "passportNumber",
              passport_country as "passportCountry", passport_expiry as "passportExpiry",
              whatsapp_id as "whatsappId"
          `;

          // Log successful staff creation
          const newStaffRows = newStaff as any[];
          if (newStaffRows[0]) {
            logCreate('staff', newStaffRows[0].id, {
              employee_id: newStaffRows[0].employee_id,
              name: newStaffRows[0].full_name,
              email: newStaffRows[0].email,
              department: newStaffRows[0].department
            });
          }

          res.status(201).json({ success: true, data: newStaffRows[0] });
        } catch (error: any) {
          // Handle database constraint violations with user-friendly messages
          if (error.message?.includes('staff_email_unique')) {
            return res.status(409).json({
              success: false,
              data: null,
              message: `A staff member with email "${staffData.email}" already exists. Please use a different email address.`,
              code: 'DUPLICATE_EMAIL'
            });
          }
          if (error.message?.includes('staff_employee_id_unique')) {
            return res.status(409).json({
              success: false,
              data: null,
              message: `Employee ID "${staffData.employee_id}" is already in use. Please use a different employee ID.`,
              code: 'DUPLICATE_EMPLOYEE_ID'
            });
          }
          if (error.message?.includes('duplicate key value')) {
            return res.status(409).json({
              success: false,
              data: null,
              message: 'This staff member already exists. Please check the email and employee ID.',
              code: 'DUPLICATE_ENTRY'
            });
          }

          // Re-throw other errors to be handled by the error handler
          throw error;
        }
        break;
      }

      case 'PUT': {
        // Update staff member
        if (!req.query.id) {
          return res.status(400).json({ success: false, error: 'Staff ID required' });
        }
        const updates = req.body;

        // Handle name field updates - extract first and last name
        const name = updates.name || '';
        const firstName = updates.first_name || updates.firstName || name.split(' ')[0] || '';
        const lastName = updates.last_name || updates.lastName || name.split(' ').slice(1).join(' ') || '';

        // Check if this is an exit/termination update
        const isExitUpdate = updates.exitType || updates.exit_type;
        const exitType = updates.exitType || updates.exit_type || null;
        const exitReason = updates.exitReason || updates.exit_reason || null;
        const endDate = updates.endDate || updates.end_date || null;

        // Helper function to get field value allowing explicit null/empty to clear
        const getFieldValue = (camelCase: string, snakeCase?: string) => {
          const value = updates[camelCase] ?? updates[snakeCase || ''];
          return value !== undefined ? (value || null) : undefined;
        };

        // Helper function for UUID fields - empty string should become null
        const getUuidFieldValue = (camelCase: string, snakeCase?: string) => {
          const value = updates[camelCase] ?? updates[snakeCase || ''];
          if (value === undefined) return undefined;
          if (!value || value === '') return null; // Empty string -> null for UUID fields
          return value;
        };

        // Helper function for date fields - empty string should become null
        const getDateFieldValue = (camelCase: string, snakeCase?: string) => {
          const value = updates[camelCase] ?? updates[snakeCase || ''];
          if (value === undefined) return undefined;
          if (!value || value === '') return null; // Empty string -> null for date fields
          return value;
        };

        // Personal info fields
        const alternatePhone = getFieldValue('alternativePhone', 'alternate_phone');
        const whatsappId = getFieldValue('whatsappId', 'whatsapp_id');

        // Address fields
        const address = getFieldValue('address');
        const city = getFieldValue('city');
        const state = updates.province ?? updates.state ?? undefined; // province maps to state column
        const postalCode = getFieldValue('postalCode', 'postal_code');

        // Employment fields
        const level = getFieldValue('level');
        const reportsTo = getUuidFieldValue('reportsTo', 'reports_to');
        const experienceYears = updates.experienceYears ?? updates.experience_years ?? undefined;
        const contractType = getFieldValue('contractType', 'contract_type') || getFieldValue('saContractType');
        const maxProjectCount = updates.maxProjectCount ?? updates.max_project_count ?? undefined;
        const workingHours = getFieldValue('workingHours', 'working_hours');
        const weeklyHours = updates.weeklyHours ?? updates.weekly_hours ?? undefined;
        const availableWeekends = updates.availableWeekends ?? updates.available_weekends ?? undefined;
        const availableNights = updates.availableNights ?? updates.available_nights ?? undefined;
        const timeZone = getFieldValue('timeZone', 'time_zone');
        const noticePeriodDays = updates.noticePeriodDays ?? updates.notice_period_days ?? undefined;

        // Compensation fields
        const salary = updates.salaryAmount ?? updates.salary ?? undefined;
        const hourlyRate = updates.hourlyRate ?? updates.hourly_rate ?? undefined;
        const salaryGrade = getFieldValue('salaryGrade', 'salary_grade');

        // Skills (JSONB)
        const skills = updates.skills !== undefined ? (Array.isArray(updates.skills) ? JSON.stringify(updates.skills) : updates.skills) : undefined;
        const specializations = updates.specializations !== undefined ? (Array.isArray(updates.specializations) ? JSON.stringify(updates.specializations) : updates.specializations) : undefined;

        // Notes
        const notes = getFieldValue('notes');
        const bio = getFieldValue('bio');

        // Identity document fields
        const saIdNumber = getFieldValue('saIdNumber', 'sa_id_number');
        const idNumber = getFieldValue('idNumber', 'id_number');
        const passportNumber = getFieldValue('passportNumber', 'passport_number');
        const passportCountry = getFieldValue('passportCountry', 'passport_country');
        const passportExpiry = getDateFieldValue('passportExpiry', 'passport_expiry');
        const workPermitNumber = getFieldValue('workPermitNumber', 'work_permit_number');
        const workPermitExpiry = getDateFieldValue('workPermitExpiry', 'work_permit_expiry');

        // Emergency contact fields (stored in JSONB emergency_contact column)
        const emergencyContactName = getFieldValue('emergencyContactName', 'emergency_contact_name');
        const emergencyContactPhone = getFieldValue('emergencyContactPhone', 'emergency_contact_phone');
        const emergencyContactRelationship = getFieldValue('emergencyContactRelationship', 'emergency_contact_relationship');
        // Build emergency_contact JSONB if any field is provided
        const hasEmergencyContactUpdate = emergencyContactName !== undefined || emergencyContactPhone !== undefined;
        const emergencyContactJson = hasEmergencyContactUpdate ? JSON.stringify({
          name: emergencyContactName || null,
          phone: emergencyContactPhone || null
        }) : undefined;

        // Next of kin fields
        const nextOfKinName = getFieldValue('nextOfKinName', 'next_of_kin_name');
        const nextOfKinPhone = getFieldValue('nextOfKinPhone', 'next_of_kin_phone');
        const nextOfKinRelationship = getFieldValue('nextOfKinRelationship', 'next_of_kin_relationship');
        const nextOfKinAddress = getFieldValue('nextOfKinAddress', 'next_of_kin_address');

        // Bank details fields
        const bankName = getFieldValue('bankName', 'bank_name');
        const bankAccountNumber = getFieldValue('bankAccountNumber', 'bank_account_number');
        const bankBranchCode = getFieldValue('bankBranchCode', 'bank_branch_code');
        const bankAccountType = getFieldValue('bankAccountType', 'bank_account_type');

        // SA Compliance fields
        const uifStatus = getFieldValue('uifStatus', 'uif_status');
        const uifNumber = getFieldValue('uifNumber', 'uif_number');
        const coidaStatus = getFieldValue('coidaStatus', 'coida_status');
        const taxStatus = getFieldValue('taxStatus', 'tax_status');
        const taxNumber = getFieldValue('taxNumber', 'tax_number');
        const probationStatus = getFieldValue('probationStatus', 'probation_status');
        const probationEndDate = getDateFieldValue('probationEndDate', 'probation_end_date');
        const probationExtended = updates.probationExtended ?? updates.probation_extended ?? undefined;
        const probationExtensionReason = getFieldValue('probationExtensionReason', 'probation_extension_reason');
        const noticePeriod = getFieldValue('noticePeriod', 'notice_period');

        // Exit fields
        const isRehireable = updates.isRehireable ?? updates.is_rehireable ?? null;
        const exitProcessedBy = updates.exitProcessedBy || updates.exit_processed_by || null;

        // Build comprehensive UPDATE query
        const updatedStaff = await sql`
          UPDATE staff
          SET
              -- Personal info
              first_name = COALESCE(${firstName || null}, first_name),
              last_name = COALESCE(${lastName || null}, last_name),
              email = COALESCE(${updates.email}, email),
              phone = COALESCE(${updates.phone}, phone),
              alternate_phone = CASE WHEN ${alternatePhone !== undefined} THEN ${alternatePhone} ELSE alternate_phone END,
              whatsapp_id = CASE WHEN ${whatsappId !== undefined} THEN ${whatsappId} ELSE whatsapp_id END,

              -- Address
              address = CASE WHEN ${address !== undefined} THEN ${address} ELSE address END,
              city = CASE WHEN ${city !== undefined} THEN ${city} ELSE city END,
              state = CASE WHEN ${state !== undefined} THEN ${state} ELSE state END,
              postal_code = CASE WHEN ${postalCode !== undefined} THEN ${postalCode} ELSE postal_code END,

              -- Employment
              position = COALESCE(${updates.position}, position),
              department = COALESCE(${updates.department}, department),
              status = COALESCE(${updates.status}, status),
              level = CASE WHEN ${level !== undefined} THEN ${level} ELSE level END,
              reports_to = CASE WHEN ${reportsTo !== undefined} THEN ${reportsTo}::uuid ELSE reports_to END,
              experience_years = CASE WHEN ${experienceYears !== undefined} THEN ${experienceYears} ELSE experience_years END,
              contract_type = CASE WHEN ${contractType !== undefined} THEN ${contractType} ELSE contract_type END,
              max_project_count = CASE WHEN ${maxProjectCount !== undefined} THEN ${maxProjectCount} ELSE max_project_count END,
              working_hours = CASE WHEN ${workingHours !== undefined} THEN ${workingHours} ELSE working_hours END,
              weekly_hours = CASE WHEN ${weeklyHours !== undefined} THEN ${weeklyHours} ELSE weekly_hours END,
              available_weekends = CASE WHEN ${availableWeekends !== undefined} THEN ${availableWeekends} ELSE available_weekends END,
              available_nights = CASE WHEN ${availableNights !== undefined} THEN ${availableNights} ELSE available_nights END,
              time_zone = CASE WHEN ${timeZone !== undefined} THEN ${timeZone} ELSE time_zone END,
              notice_period_days = CASE WHEN ${noticePeriodDays !== undefined} THEN ${noticePeriodDays} ELSE notice_period_days END,

              -- Dates
              join_date = COALESCE(${updates.join_date || updates.startDate}, join_date),
              end_date = COALESCE(${endDate}, end_date),

              -- Compensation
              salary = CASE WHEN ${salary !== undefined} THEN ${salary} ELSE salary END,
              hourly_rate = CASE WHEN ${hourlyRate !== undefined} THEN ${hourlyRate} ELSE hourly_rate END,
              salary_grade = CASE WHEN ${salaryGrade !== undefined} THEN ${salaryGrade} ELSE salary_grade END,

              -- Skills (JSONB)
              skills = CASE WHEN ${skills !== undefined} THEN ${skills}::jsonb ELSE skills END,
              specializations = CASE WHEN ${specializations !== undefined} THEN ${specializations}::jsonb ELSE specializations END,

              -- Notes
              notes = CASE WHEN ${notes !== undefined} THEN ${notes} ELSE notes END,
              bio = CASE WHEN ${bio !== undefined} THEN ${bio} ELSE bio END,

              -- Identity documents
              sa_id_number = CASE WHEN ${saIdNumber !== undefined} THEN ${saIdNumber} ELSE sa_id_number END,
              id_number = CASE WHEN ${idNumber !== undefined} THEN ${idNumber} ELSE id_number END,
              passport_number = CASE WHEN ${passportNumber !== undefined} THEN ${passportNumber} ELSE passport_number END,
              passport_country = CASE WHEN ${passportCountry !== undefined} THEN ${passportCountry} ELSE passport_country END,
              passport_expiry = CASE WHEN ${passportExpiry !== undefined} THEN ${passportExpiry}::date ELSE passport_expiry END,
              work_permit_number = CASE WHEN ${workPermitNumber !== undefined} THEN ${workPermitNumber} ELSE work_permit_number END,
              work_permit_expiry = CASE WHEN ${workPermitExpiry !== undefined} THEN ${workPermitExpiry}::date ELSE work_permit_expiry END,

              -- Emergency contact (JSONB for name/phone, separate column for relationship)
              emergency_contact = CASE WHEN ${emergencyContactJson !== undefined} THEN ${emergencyContactJson}::jsonb ELSE emergency_contact END,
              emergency_contact_relationship = CASE WHEN ${emergencyContactRelationship !== undefined} THEN ${emergencyContactRelationship} ELSE emergency_contact_relationship END,

              -- Next of kin
              next_of_kin_name = CASE WHEN ${nextOfKinName !== undefined} THEN ${nextOfKinName} ELSE next_of_kin_name END,
              next_of_kin_phone = CASE WHEN ${nextOfKinPhone !== undefined} THEN ${nextOfKinPhone} ELSE next_of_kin_phone END,
              next_of_kin_relationship = CASE WHEN ${nextOfKinRelationship !== undefined} THEN ${nextOfKinRelationship} ELSE next_of_kin_relationship END,
              next_of_kin_address = CASE WHEN ${nextOfKinAddress !== undefined} THEN ${nextOfKinAddress} ELSE next_of_kin_address END,

              -- Bank details
              bank_name = CASE WHEN ${bankName !== undefined} THEN ${bankName} ELSE bank_name END,
              bank_account_number = CASE WHEN ${bankAccountNumber !== undefined} THEN ${bankAccountNumber} ELSE bank_account_number END,
              bank_branch_code = CASE WHEN ${bankBranchCode !== undefined} THEN ${bankBranchCode} ELSE bank_branch_code END,
              bank_account_type = CASE WHEN ${bankAccountType !== undefined} THEN ${bankAccountType} ELSE bank_account_type END,

              -- SA Compliance
              uif_status = CASE WHEN ${uifStatus !== undefined} THEN ${uifStatus} ELSE uif_status END,
              uif_number = CASE WHEN ${uifNumber !== undefined} THEN ${uifNumber} ELSE uif_number END,
              coida_status = CASE WHEN ${coidaStatus !== undefined} THEN ${coidaStatus} ELSE coida_status END,
              tax_status = CASE WHEN ${taxStatus !== undefined} THEN ${taxStatus} ELSE tax_status END,
              tax_number = CASE WHEN ${taxNumber !== undefined} THEN ${taxNumber} ELSE tax_number END,
              probation_status = CASE WHEN ${probationStatus !== undefined} THEN ${probationStatus} ELSE probation_status END,
              probation_end_date = CASE WHEN ${probationEndDate !== undefined} THEN ${probationEndDate}::date ELSE probation_end_date END,
              probation_extended = CASE WHEN ${probationExtended !== undefined} THEN ${probationExtended} ELSE probation_extended END,
              probation_extension_reason = CASE WHEN ${probationExtensionReason !== undefined} THEN ${probationExtensionReason} ELSE probation_extension_reason END,
              notice_period = CASE WHEN ${noticePeriod !== undefined} THEN ${noticePeriod} ELSE notice_period END,

              -- Exit fields
              exit_type = COALESCE(${exitType}, exit_type),
              exit_reason = COALESCE(${exitReason}, exit_reason),
              is_rehireable = COALESCE(${isRehireable}, is_rehireable),
              exit_processed_by = COALESCE(${exitProcessedBy}, exit_processed_by),
              exit_processed_date = CASE WHEN ${isExitUpdate} THEN NOW() ELSE exit_processed_date END,

              updated_at = NOW()
          WHERE id = ${req.query.id as string}
          RETURNING *,
            CONCAT(first_name, ' ', last_name) as name,
            CONCAT(first_name, ' ', last_name) as full_name,
            sa_id_number as "saIdNumber",
            passport_number as "passportNumber",
            passport_country as "passportCountry",
            passport_expiry as "passportExpiry",
            whatsapp_id as "whatsappId",
            alternate_phone as "alternativePhone",
            experience_years as "experienceYears",
            max_project_count as "maxProjectCount",
            working_hours as "workingHours",
            weekly_hours as "weeklyHours",
            available_weekends as "availableWeekends",
            available_nights as "availableNights",
            time_zone as "timeZone",
            contract_type as "contractType",
            hourly_rate as "hourlyRate",
            salary_grade as "salaryGrade",
            notice_period_days as "noticePeriodDays",
            emergency_contact->>'name' as "emergencyContactName",
            emergency_contact->>'phone' as "emergencyContactPhone",
            emergency_contact_relationship as "emergencyContactRelationship",
            next_of_kin_name as "nextOfKinName",
            next_of_kin_phone as "nextOfKinPhone",
            next_of_kin_relationship as "nextOfKinRelationship",
            next_of_kin_address as "nextOfKinAddress",
            bank_name as "bankName",
            bank_account_number as "bankAccountNumber",
            bank_branch_code as "bankBranchCode",
            bank_account_type as "bankAccountType",
            uif_status as "uifStatus",
            uif_number as "uifNumber",
            coida_status as "coidaStatus",
            tax_status as "taxStatus",
            tax_number as "taxNumber",
            probation_status as "probationStatus",
            probation_end_date as "probationEndDate",
            probation_extended as "probationExtended",
            probation_extension_reason as "probationExtensionReason",
            notice_period as "noticePeriod",
            work_permit_number as "workPermitNumber",
            work_permit_expiry as "workPermitExpiry",
            id_number as "idNumber",
            reports_to as "reportsTo",
            state as "province",
            postal_code as "postalCode",
            salary as "salaryAmount"
        `;

        const updatedStaffRows = updatedStaff as any[];
        if (updatedStaffRows.length === 0) {
          return res.status(404).json({
            success: false,
            error: 'Staff member not found'
          });
        }

        // Log successful staff update
        if (updatedStaffRows[0]) {
          const logData: Record<string, any> = {
            updated_fields: Object.keys(updates),
            name: updatedStaffRows[0].full_name
          };

          // Add exit-specific logging if this was an exit update
          if (isExitUpdate) {
            logData.exit_type = exitType;
            logData.exit_status = updates.status;
          }

          logUpdate('staff', req.query.id as string, logData);
        }

        res.status(200).json({ success: true, data: updatedStaffRows[0] });
        break;
      }

      case 'DELETE': {
        // Delete staff member
        if (!req.query.id) {
          return res.status(400).json({ success: false, error: 'Staff ID required' });
        }
        await sql`DELETE FROM staff WHERE id = ${req.query.id as string}`;
        
        // Log successful staff deletion
        logDelete('staff', req.query.id as string);
        
        res.status(200).json({ success: true, message: 'Staff member deleted successfully' });
        break;
      }

      default:
        res.status(405).json({ success: false, error: 'Method not allowed' });
    }
  } catch (error: any) {
    console.error('API Error:', error);
    
    // Handle specific database errors
    if (error.code === '23505') { // Unique constraint violation
      if (error.constraint === 'staff_employee_id_unique') {
        return res.status(409).json({
          success: false,
          error: 'Employee ID already exists. Please use a different employee ID.'
        });
      }
      if (error.constraint === 'staff_email_unique') {
        return res.status(409).json({
          success: false,
          error: 'Email address already exists. Please use a different email address.'
        });
      }
      return res.status(409).json({
        success: false,
        error: 'Duplicate entry. This record already exists.'
      });
    }
    
    res.status(500).json({ success: false, error: error.message || 'Internal server error' });
  }
}));
