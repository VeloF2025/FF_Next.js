import { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import formidable from 'formidable';
import * as XLSX from 'xlsx';
import fs from 'fs';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

// Configure formidable to handle file uploads
export const config = {
  api: {
    bodyParser: false,
  },
};

// Database connection
const sql = neon(process.env.NEON_DATABASE_URL!);

// Helper function to parse coordinates
function parseCoordinate(value: any): number | null {
  if (!value) return null;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}

// Helper function to parse date
function parseDate(value: any): string | null {
  if (!value) return null;
  // Handle various date formats from Excel
  if (typeof value === 'number') {
    // Excel date serial number
    const date = new Date((value - 25569) * 86400 * 1000);
    return date.toISOString();
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

// Parse Excel file and extract 1Map data
async function parseOneMapFile(filePath: string) {
  const workbook = XLSX.readFile(filePath);
  const records = [];
  
  // Process the main sheet (SHEET1)
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const jsonData = XLSX.utils.sheet_to_json(worksheet);
  
  for (const row of jsonData) {
    // Extract coordinates from the Latitude Longitude field if individual fields are empty
    let lat = parseCoordinate(row['Latitude']);
    let lng = parseCoordinate(row['Longitude']);
    
    if ((!lat || !lng) && row['Latitude Longitude']) {
      const coords = row['Latitude Longitude'].split(',');
      if (coords.length === 2) {
        lat = parseCoordinate(coords[0]);
        lng = parseCoordinate(coords[1]);
      }
    }
    
    records.push({
      // Primary identifiers
      property_id: row['Property ID'] || null,
      onemap_nad_id: row['1map NAD ID'] || null,
      job_id: row['Job ID'] || null,
      
      // Status and location
      status: row['Status'] || null,
      flow_name_groups: row['Flow Name Groups'] || null,
      site: row['Site'] || null,
      sections: row['Sections'] || null,
      pons: row['PONs'] || null,
      location_address: row['Location Address'] || null,
      latitude: lat,
      longitude: lng,
      stand_number: row['Stand Number'] || null,
      
      // Pole and drop information
      pole_number: row['Pole Number'] || null,
      drop_number: row['Drop Number'] || null,
      
      // Contact information
      contact_name: row['Contact Person: Name'] || null,
      contact_surname: row['Contact Person: Surname'] || null,
      contact_number: row['Contact Number (e.g.0123456789)'] || null,
      email_address: row['Email Address'] || null,
      id_number: row['ID Number'] || null,
      
      // Pole permission fields
      pole_permission_status: row['Status']?.includes('Pole Permission') ? row['Status'] : null,
      owner_or_tenant: row['Owner or Tenant'] || null,
      pole_permission_date: parseDate(row['Date of Signature']),
      pole_permission_agent: row['Field Agent Name (pole permission)'] || null,
      pole_lat: parseCoordinate(row['Pole Permissions - Actual Device Location (Latitude)']) || lat,
      pole_lng: parseCoordinate(row['Pole Permissions - Actual Device Location (Longitude)']) || lng,
      
      // Home sign up fields
      home_signup_date: parseDate(row['Last Modified Home Sign Ups Date']),
      home_signup_agent: row['Field Agent Name (Home Sign Ups)'] || null,
      
      // Installation fields
      ont_barcode: row['ONT Barcode'] || null,
      ont_activation_code: row['Nokia Easy Start ONT Activation Code'] || null,
      dome_joint_number: row['Dome Joint Number / BB'] || null,
      drop_cable_length: parseFloat(row['Length of Drop Cable']) || null,
      installer_name: row['Installer Name'] || null,
      installation_date: parseDate(row['Last Modified Home Installations Date']),
      
      // Sales fields
      sales_agent: row['Field Agent Name and Surname(sales)'] || null,
      sales_date: parseDate(row['Last Modified Sales Date']),
      
      // Metadata
      last_modified_by: row['lst_mod_by'] || null,
      last_modified_date: parseDate(row['lst_mod_dt'])
    });
  }
  
  return records;
}

// Store data in Neon database
async function storeInDatabase(records: any[], importId: string) {
  let recordsImported = 0;
  const propertyIds = new Map();

  for (const record of records) {
    try {
      // Insert main property record
      const propertyResult = await sql`
        INSERT INTO onemap_properties (
          import_id, property_id, onemap_nad_id, job_id, status, flow_name_groups,
          site, sections, pons, location_address, latitude, longitude,
          stand_number, pole_number, drop_number,
          contact_name, contact_surname, contact_number, email_address, id_number,
          pole_permission_status, owner_or_tenant, pole_permission_date, pole_permission_agent,
          pole_lat, pole_lng, home_signup_date, home_signup_agent,
          ont_barcode, ont_activation_code, dome_joint_number, drop_cable_length,
          installer_name, installation_date, sales_agent, sales_date,
          last_modified_by, last_modified_date
        )
        VALUES (
          ${importId}, ${record.property_id}, ${record.onemap_nad_id}, ${record.job_id},
          ${record.status}, ${record.flow_name_groups}, ${record.site}, ${record.sections},
          ${record.pons}, ${record.location_address}, ${record.latitude}, ${record.longitude},
          ${record.stand_number}, ${record.pole_number}, ${record.drop_number},
          ${record.contact_name}, ${record.contact_surname}, ${record.contact_number},
          ${record.email_address}, ${record.id_number}, ${record.pole_permission_status},
          ${record.owner_or_tenant}, ${record.pole_permission_date}, ${record.pole_permission_agent},
          ${record.pole_lat}, ${record.pole_lng}, ${record.home_signup_date}, ${record.home_signup_agent},
          ${record.ont_barcode}, ${record.ont_activation_code}, ${record.dome_joint_number},
          ${record.drop_cable_length}, ${record.installer_name}, ${record.installation_date},
          ${record.sales_agent}, ${record.sales_date}, ${record.last_modified_by}, ${record.last_modified_date}
        )
        ON CONFLICT (import_id, property_id) DO UPDATE SET
          status = EXCLUDED.status,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          last_modified_by = EXCLUDED.last_modified_by,
          last_modified_date = EXCLUDED.last_modified_date,
          updated_at = NOW()
        RETURNING id
      `;
      
      const propertyDbId = propertyResult[0].id;
      propertyIds.set(record.property_id, propertyDbId);
      
      // Insert pole record if pole number exists
      if (record.pole_number) {
        await sql`
          INSERT INTO onemap_poles (
            import_id, property_id, pole_number, latitude, longitude,
            status, permission_date, agent_name
          )
          VALUES (
            ${importId}, ${propertyDbId}, ${record.pole_number},
            ${record.pole_lat || record.latitude}, ${record.pole_lng || record.longitude},
            ${record.pole_permission_status}, ${record.pole_permission_date},
            ${record.pole_permission_agent}
          )
          ON CONFLICT (pole_number) DO UPDATE SET
            latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude,
            status = EXCLUDED.status,
            permission_date = EXCLUDED.permission_date,
            agent_name = EXCLUDED.agent_name
        `;
      }
      
      // Insert drop record if drop number exists
      if (record.drop_number) {
        await sql`
          INSERT INTO onemap_drops (
            import_id, property_id, drop_number, latitude, longitude,
            address, customer_name, contact_number, status
          )
          VALUES (
            ${importId}, ${propertyDbId}, ${record.drop_number},
            ${record.latitude}, ${record.longitude}, ${record.location_address},
            ${record.contact_name + ' ' + record.contact_surname}, ${record.contact_number},
            ${record.status}
          )
          ON CONFLICT (drop_number) DO UPDATE SET
            latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude,
            address = EXCLUDED.address,
            customer_name = EXCLUDED.customer_name,
            contact_number = EXCLUDED.contact_number,
            status = EXCLUDED.status
        `;
      }
      
      // Insert installation record if ONT barcode exists
      if (record.ont_barcode) {
        await sql`
          INSERT INTO onemap_installations (
            import_id, property_id, ont_barcode, ont_activation_code,
            dome_joint_number, drop_cable_length, installer_name,
            installation_date, latitude, longitude
          )
          VALUES (
            ${importId}, ${propertyDbId}, ${record.ont_barcode}, ${record.ont_activation_code},
            ${record.dome_joint_number}, ${record.drop_cable_length}, ${record.installer_name},
            ${record.installation_date}, ${record.latitude}, ${record.longitude}
          )
        `;
      }
      
      recordsImported++;
    } catch (error) {
      log.error(`Error processing record ${record.property_id}`, { error });
      // Continue with next record
    }
  }

  return recordsImported;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const form = formidable({
    maxFileSize: 100 * 1024 * 1024, // 100MB limit for large 1Map files
  });

  try {
    const [fields, files] = await form.parse(req);
    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Create import record
    const importResult = await sql`
      INSERT INTO onemap_imports (
        filename, file_size, status, imported_by
      )
      VALUES (
        ${file.originalFilename || 'unknown'}, 
        ${file.size}, 
        'processing',
        'system'
      )
      RETURNING id
    `;
    
    const importId = importResult[0].id;

    try {
      // Parse the 1Map Excel file
      const records = await parseOneMapFile(file.filepath);
      
      // Store in database
      const recordsImported = await storeInDatabase(records, importId);
      
      // Update import status
      await sql`
        UPDATE onemap_imports 
        SET 
          status = 'completed',
          records_imported = ${recordsImported},
          completed_at = NOW()
        WHERE id = ${importId}
      `;

      // Clean up temporary file
      fs.unlinkSync(file.filepath);

      return res.status(200).json({
        success: true,
        importId,
        recordsImported,
        message: `Successfully imported ${recordsImported} records from 1Map data`
      });

    } catch (error) {
      // Update import status to failed
      await sql`
        UPDATE onemap_imports 
        SET 
          status = 'failed',
          error_message = ${error.message},
          completed_at = NOW()
        WHERE id = ${importId}
      `;
      
      throw error;
    }

  } catch (error) {
    log.error('File upload error', { error });
    return res.status(500).json({
      error: 'Failed to process file',
      details: error.message
    });
  }
}

export default withAuth(parseOneMapFile);