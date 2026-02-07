/**
 * Document Database Population Script
 * Populates the database with comprehensive document reference data
 * for a fiber network project management system.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import crypto from 'crypto';

// Database connection
const DATABASE_URL = process.env.DATABASE_URL || 
  'process.env.DATABASE_URL';

const client = new Client({
  connectionString: DATABASE_URL,
});

const db = drizzle(client);

// 🟢 WORKING: Helper functions for generating realistic data
function generateRandomDate(start: Date = new Date(2022, 0, 1), end: Date = new Date()): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function uuidv4(): string {
  return crypto.randomUUID();
}

function generateMD5Hash(input: string): string {
  return crypto.createHash('md5').update(input).digest('hex');
}

function generateSHA256Hash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function getRandomElement<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

function generateRandomSize(min: number = 10000, max: number = 50000000): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 🟢 WORKING: Document categories and types
const documentTypes = {
  sow: ['Statement of Work', 'SOW Amendment', 'Work Order', 'Service Agreement'],
  financial: ['Invoice', 'Receipt', 'Purchase Order', 'Payment Confirmation', 'Budget Report'],
  technical: ['Technical Specification', 'Site Survey', 'Network Design', 'Test Report', 'Installation Guide'],
  photos: ['Site Photo', 'Progress Photo', 'Completion Photo', 'Equipment Photo', 'Inspection Photo'],
  compliance: ['Safety Certificate', 'Insurance Document', 'License', 'Permit', 'Compliance Report'],
  reports: ['Progress Report', 'Quality Report', 'Incident Report', 'Performance Report', 'Final Report'],
  contracts: ['Main Contract', 'Subcontractor Agreement', 'Vendor Contract', 'Service Level Agreement'],
  drawings: ['Network Diagram', 'Site Layout', 'Equipment Layout', 'Cable Route Map', 'As-Built Drawing']
};

const mimeTypes = {
  'pdf': 'application/pdf',
  'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'jpg': 'image/jpeg',
  'png': 'image/png',
  'dwg': 'application/acad',
  'txt': 'text/plain',
  'csv': 'text/csv'
};

const fileExtensions = Object.keys(mimeTypes);

// 🟢 WORKING: Company and client names for realistic documents
const companies = [
  'FiberTech Solutions', 'NetworkPro Systems', 'ConnectCorp', 'DataLink Industries',
  'BroadbandMax', 'TelecomExperts', 'FiberFlow Networks', 'OpticLink Services',
  'CableTech Solutions', 'NetworkLink Corp', 'DigitalFiber Ltd', 'CommTech Systems'
];

const clientNames = [
  'Metro Housing Authority', 'Riverside Business Park', 'Greenfield Residential',
  'Downtown Commercial Center', 'Oakwood Properties', 'Hillside Apartments',
  'Corporate Plaza', 'Westfield Mall', 'Eastside Community', 'Northgate Industrial'
];

// 🟢 WORKING: Project names for document association
const projectNames = [
  'Lawley Fiber Rollout', 'Henderson Network Upgrade', 'Riverside FTTH Phase 2',
  'Downtown Business District', 'Eastside Residential Connect', 'Industrial Park Fiber',
  'Metro Housing Connectivity', 'Suburban Network Expansion', 'Commercial District Upgrade',
  'University Campus Network'
];

// 🟢 WORKING: Realistic file naming patterns
const fileNamePatterns = {
  sow: (project: string, version: number = 1) => 
    `SOW_${project.replace(/\s+/g, '_')}_v${version}.pdf`,
  invoice: (company: string, date: Date) => 
    `Invoice_${date.getFullYear()}_${String(date.getMonth() + 1).padStart(2, '0')}_${String(date.getDate()).padStart(2, '0')}_${company.replace(/\s+/g, '_')}.pdf`,
  technical: (type: string, project: string) => 
    `${type.replace(/\s+/g, '_')}_${project.replace(/\s+/g, '_')}.pdf`,
  photo: (location: string, date: Date) => 
    `Site_Photo_${location.replace(/\s+/g, '_')}_${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}.jpg`,
  certificate: (type: string, year: number) => 
    `${type.replace(/\s+/g, '_')}_Certificate_${year}.pdf`,
  drawing: (type: string, project: string, revision: string = 'A') => 
    `${type.replace(/\s+/g, '_')}_${project.replace(/\s+/g, '_')}_Rev${revision}.dwg`
};

// 🟢 WORKING: Database population functions
async function createDocumentFolders(projectIds: string[]): Promise<string[]> {
  console.log('📁 Creating document folders...');
  
  const folders = [];
  const folderIds: string[] = [];
  
  // Root folders for each project
  for (const projectId of projectIds) {
    const projectName = getRandomElement(projectNames);
    
    // Main project folder
    const mainFolderId = uuidv4();
    folders.push({
      id: mainFolderId,
      folder_name: projectName,
      folder_path: `/projects/${projectName.replace(/\s+/g, '_')}`,
      parent_folder_id: null,
      project_id: projectId,
      folder_type: 'project',
      is_system_folder: true,
      sort_order: 0,
      is_public: false,
      access_level: 'project',
      allowed_users: JSON.stringify([]),
      allowed_roles: JSON.stringify(['project_manager', 'admin']),
      document_count: 0,
      total_size: 0,
      last_activity: generateRandomDate(),
      metadata: JSON.stringify({}),
      created_by: '00000000-0000-0000-0000-000000000001', // System user
      created_at: generateRandomDate(),
      updated_at: generateRandomDate()
    });
    folderIds.push(mainFolderId);
    
    // Subfolders
    const subfolders = [
      { name: 'SOW Documents', type: 'sow' },
      { name: 'Financial Documents', type: 'invoices' },
      { name: 'Technical Reports', type: 'technical' },
      { name: 'Site Photos', type: 'photos' },
      { name: 'Compliance Documents', type: 'compliance' },
      { name: 'Progress Reports', type: 'reports' },
      { name: 'Drawings & Plans', type: 'drawings' },
      { name: 'Contracts', type: 'contracts' }
    ];
    
    for (let i = 0; i < subfolders.length; i++) {
      const subfolder = subfolders[i];
      const subfolderId = uuidv4();
      
      folders.push({
        id: subfolderId,
        folder_name: subfolder.name,
        folder_path: `/projects/${projectName.replace(/\s+/g, '_')}/${subfolder.name.replace(/\s+/g, '_')}`,
        parent_folder_id: mainFolderId,
        project_id: projectId,
        folder_type: subfolder.type,
        is_system_folder: true,
        sort_order: i + 1,
        is_public: false,
        access_level: 'project',
        allowed_users: JSON.stringify([]),
        allowed_roles: JSON.stringify(['project_manager', 'admin', 'team_member']),
        document_count: 0,
        total_size: 0,
        last_activity: generateRandomDate(),
        metadata: JSON.stringify({}),
        created_by: '00000000-0000-0000-0000-000000000001',
        created_at: generateRandomDate(),
        updated_at: generateRandomDate()
      });
      folderIds.push(subfolderId);
    }
  }
  
  // Insert folders in batches
  const batchSize = 50;
  for (let i = 0; i < folders.length; i += batchSize) {
    const batch = folders.slice(i, i + batchSize);
    const values = batch.map(f => 
      `('${f.id}', '${f.folder_name}', '${f.folder_path}', ${f.parent_folder_id ? `'${f.parent_folder_id}'` : 'NULL'}, '${f.project_id}', '${f.folder_type}', ${f.is_system_folder}, ${f.sort_order}, ${f.is_public}, '${f.access_level}', '${f.allowed_users}', '${f.allowed_roles}', ${f.document_count}, ${f.total_size}, '${f.last_activity.toISOString()}', '${f.metadata}', '${f.created_by}', '${f.created_at.toISOString()}', '${f.updated_at.toISOString()}')`
    ).join(', ');
    
    await client.query(`
      INSERT INTO document_folders (id, folder_name, folder_path, parent_folder_id, project_id, folder_type, is_system_folder, sort_order, is_public, access_level, allowed_users, allowed_roles, document_count, total_size, last_activity, metadata, created_by, created_at, updated_at)
      VALUES ${values}
      ON CONFLICT (folder_path) DO NOTHING
    `);
  }
  
  console.log(`✅ Created ${folders.length} document folders`);
  return folderIds;
}

async function createDocuments(projectIds: string[], folderIds: string[]): Promise<string[]> {
  console.log('📄 Creating documents...');
  
  const documents = [];
  const documentIds: string[] = [];
  let documentCounter = 1;
  
  // Generate documents for each project
  for (let projectIndex = 0; projectIndex < projectIds.length; projectIndex++) {
    const projectId = projectIds[projectIndex];
    const projectName = projectNames[projectIndex % projectNames.length];
    const projectFolderIds = folderIds.slice(projectIndex * 9, (projectIndex + 1) * 9); // 9 folders per project (1 main + 8 sub)
    
    // Generate different types of documents
    const documentsToCreate = [
      // SOW Documents (5-8 per project)
      ...Array.from({length: Math.floor(Math.random() * 4) + 5}, (_, i) => ({
        type: 'sow',
        category: 'sow',
        folderIndex: 1, // SOW folder
        fileName: fileNamePatterns.sow(projectName, i + 1),
        displayName: `${getRandomElement(documentTypes.sow)} - ${projectName} v${i + 1}`,
        version: i + 1
      })),
      
      // Financial Documents (8-12 per project)
      ...Array.from({length: Math.floor(Math.random() * 5) + 8}, (_, i) => ({
        type: 'financial',
        category: 'financial',
        folderIndex: 2, // Financial folder
        fileName: fileNamePatterns.invoice(getRandomElement(companies), generateRandomDate()),
        displayName: `${getRandomElement(documentTypes.financial)} - ${getRandomElement(companies)}`,
        amount: Math.floor(Math.random() * 50000) + 1000
      })),
      
      // Technical Reports (6-10 per project)
      ...Array.from({length: Math.floor(Math.random() * 5) + 6}, (_, i) => ({
        type: 'technical',
        category: 'technical',
        folderIndex: 3, // Technical folder
        fileName: fileNamePatterns.technical(getRandomElement(documentTypes.technical), projectName),
        displayName: `${getRandomElement(documentTypes.technical)} - ${projectName}`,
      })),
      
      // Site Photos (15-25 per project)
      ...Array.from({length: Math.floor(Math.random() * 11) + 15}, (_, i) => ({
        type: 'photo',
        category: 'photos',
        folderIndex: 4, // Photos folder
        fileName: fileNamePatterns.photo(`Site_${i + 1}`, generateRandomDate()),
        displayName: `${getRandomElement(documentTypes.photos)} - Site ${i + 1}`,
        hasGPS: true,
        isImage: true
      })),
      
      // Compliance Documents (3-6 per project)
      ...Array.from({length: Math.floor(Math.random() * 4) + 3}, (_, i) => ({
        type: 'compliance',
        category: 'compliance',
        folderIndex: 5, // Compliance folder
        fileName: fileNamePatterns.certificate(getRandomElement(documentTypes.compliance), 2024),
        displayName: `${getRandomElement(documentTypes.compliance)} - 2024`,
        expiryDate: new Date(2025, 11, 31)
      })),
      
      // Progress Reports (4-8 per project)
      ...Array.from({length: Math.floor(Math.random() * 5) + 4}, (_, i) => ({
        type: 'report',
        category: 'reports',
        folderIndex: 6, // Reports folder
        fileName: `${getRandomElement(documentTypes.reports).replace(/\s+/g, '_')}_${projectName.replace(/\s+/g, '_')}_${generateRandomDate().toISOString().split('T')[0]}.pdf`,
        displayName: `${getRandomElement(documentTypes.reports)} - ${projectName}`,
      })),
      
      // Drawings (3-5 per project)
      ...Array.from({length: Math.floor(Math.random() * 3) + 3}, (_, i) => ({
        type: 'drawing',
        category: 'drawings',
        folderIndex: 7, // Drawings folder
        fileName: fileNamePatterns.drawing(getRandomElement(documentTypes.drawings), projectName, String.fromCharCode(65 + i)),
        displayName: `${getRandomElement(documentTypes.drawings)} - ${projectName} Rev${String.fromCharCode(65 + i)}`,
        isDrawing: true
      })),
      
      // Contracts (2-4 per project)
      ...Array.from({length: Math.floor(Math.random() * 3) + 2}, (_, i) => ({
        type: 'contract',
        category: 'contracts',
        folderIndex: 8, // Contracts folder
        fileName: `${getRandomElement(documentTypes.contracts).replace(/\s+/g, '_')}_${projectName.replace(/\s+/g, '_')}.pdf`,
        displayName: `${getRandomElement(documentTypes.contracts)} - ${projectName}`,
        contractNumber: `CNT-${projectName.substring(0, 3).toUpperCase()}-${String(documentCounter).padStart(4, '0')}`
      }))
    ];
    
    // Create document records
    for (const docTemplate of documentsToCreate) {
      const documentId = uuidv4();
      const folderId = projectFolderIds[docTemplate.folderIndex] || projectFolderIds[0];
      const createdDate = generateRandomDate();
      const fileExtension = docTemplate.isImage ? 'jpg' : 
                           docTemplate.isDrawing ? 'dwg' : 
                           getRandomElement(['pdf', 'docx', 'xlsx']);
      const fileSize = generateRandomSize(
        docTemplate.isImage ? 500000 : 10000,
        docTemplate.isImage ? 5000000 : 2000000
      );
      const originalName = docTemplate.fileName.endsWith(`.${fileExtension}`) ? 
                          docTemplate.fileName : 
                          `${docTemplate.fileName}.${fileExtension}`;
      
      const document = {
        id: documentId,
        document_id: `DOC-${String(documentCounter).padStart(6, '0')}`,
        file_name: originalName,
        original_file_name: originalName,
        display_name: docTemplate.displayName,
        description: `${docTemplate.displayName} for project ${projectName}`,
        file_size: fileSize,
        mime_type: mimeTypes[fileExtension as keyof typeof mimeTypes],
        file_extension: fileExtension,
        md5_hash: generateMD5Hash(documentId + originalName),
        sha256_hash: generateSHA256Hash(documentId + originalName + Date.now()),
        storage_path: `/storage/documents/${projectName.replace(/\s+/g, '_')}/${docTemplate.category}/${originalName}`,
        storage_provider: 'local',
        storage_url: `/api/documents/${documentId}/download`,
        thumbnail_path: docTemplate.isImage ? `/storage/thumbnails/${documentId}_thumb.jpg` : null,
        folder_id: folderId,
        project_id: projectId,
        client_id: null, // Will be set based on project
        document_type: docTemplate.type,
        category: docTemplate.category,
        subcategory: null,
        tags: JSON.stringify([docTemplate.type, projectName.split(' ')[0].toLowerCase()]),
        status: 'active',
        is_template: false,
        template_category: null,
        version: docTemplate.version || 1,
        parent_document_id: null,
        is_latest_version: true,
        version_notes: null,
        is_public: false,
        access_level: 'project',
        allowed_users: JSON.stringify([]),
        allowed_roles: JSON.stringify(['project_manager', 'admin', 'team_member']),
        is_password_protected: false,
        password_hash: null,
        has_text: !docTemplate.isImage && !docTemplate.isDrawing,
        extracted_text: null,
        ocr_text: null,
        page_count: docTemplate.isImage ? 1 : Math.floor(Math.random() * 20) + 1,
        word_count: docTemplate.isImage ? 0 : Math.floor(Math.random() * 2000) + 100,
        requires_approval: ['contract', 'sow', 'compliance'].includes(docTemplate.type),
        approval_status: Math.random() > 0.8 ? 'pending' : 'approved',
        approved_by: Math.random() > 0.5 ? '00000000-0000-0000-0000-000000000001' : null,
        approved_date: Math.random() > 0.5 ? generateRandomDate() : null,
        rejection_reason: null,
        retention_period_days: docTemplate.type === 'financial' ? 2555 : 1825, // 7 years for financial, 5 for others
        expiry_date: docTemplate.expiryDate || null,
        auto_delete_date: null,
        is_expired: false,
        download_count: Math.floor(Math.random() * 50),
        view_count: Math.floor(Math.random() * 200) + 10,
        last_downloaded: Math.random() > 0.3 ? generateRandomDate() : null,
        last_viewed: generateRandomDate(),
        is_compliant: true,
        compliance_notes: null,
        quality_score: Math.floor(Math.random() * 21) + 80, // 80-100
        has_watermark: false,
        document_date: generateRandomDate(new Date(2022, 0, 1)),
        author_name: getRandomElement(['John Smith', 'Sarah Johnson', 'Mike Wilson', 'Lisa Chen', 'David Brown']),
        company_name: getRandomElement(companies),
        contract_number: docTemplate.contractNumber || null,
        invoice_number: docTemplate.type === 'financial' ? `INV-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}` : null,
        receipt_number: null,
        amount: docTemplate.amount || null,
        currency: docTemplate.amount ? 'USD' : null,
        tax_amount: docTemplate.amount ? Math.round(docTemplate.amount * 0.08 * 100) / 100 : null,
        technical_specs: docTemplate.type === 'technical' ? JSON.stringify({
          equipment_type: 'Fiber Optic',
          specifications: 'Single-mode fiber, 9/125μm',
          standards: ['ITU-T G.652.D', 'IEC 60793-2-50']
        }) : JSON.stringify({}),
        equipment_ids: JSON.stringify([]),
        location_data: docTemplate.hasGPS ? JSON.stringify({
          latitude: 40.7128 + (Math.random() - 0.5) * 0.1,
          longitude: -74.0060 + (Math.random() - 0.5) * 0.1,
          address: `${Math.floor(Math.random() * 9999) + 1} Main St, City, State`
        }) : JSON.stringify({}),
        image_width: docTemplate.isImage ? Math.floor(Math.random() * 2000) + 1920 : null,
        image_height: docTemplate.isImage ? Math.floor(Math.random() * 1000) + 1080 : null,
        camera_model: docTemplate.isImage ? getRandomElement(['Canon EOS R5', 'Nikon D850', 'Sony A7R IV', 'iPhone 14 Pro']) : null,
        gps_latitude: docTemplate.hasGPS ? 40.7128 + (Math.random() - 0.5) * 0.1 : null,
        gps_longitude: docTemplate.hasGPS ? -74.0060 + (Math.random() - 0.5) * 0.1 : null,
        date_taken: docTemplate.isImage ? generateRandomDate() : null,
        metadata: JSON.stringify({
          uploadSource: 'web_interface',
          fileHash: generateMD5Hash(documentId),
          processingStatus: 'completed'
        }),
        created_by: '00000000-0000-0000-0000-000000000001',
        uploaded_by: '00000000-0000-0000-0000-000000000001',
        created_at: createdDate,
        updated_at: createdDate
      };
      
      documents.push(document);
      documentIds.push(documentId);
      documentCounter++;
    }
  }
  
  console.log(`📄 Generated ${documents.length} documents. Inserting in batches...`);
  
  // Insert documents in batches to avoid memory issues
  const batchSize = 25;
  for (let i = 0; i < documents.length; i += batchSize) {
    const batch = documents.slice(i, i + batchSize);
    
    try {
      const values = batch.map(d => {
        const escapedValues = [
          `'${d.id}'`,
          `'${d.document_id}'`,
          `'${d.file_name.replace(/'/g, "''")}'`,
          `'${d.original_file_name.replace(/'/g, "''")}'`,
          `'${d.display_name.replace(/'/g, "''")}'`,
          `'${d.description.replace(/'/g, "''")}'`,
          d.file_size,
          `'${d.mime_type}'`,
          `'${d.file_extension}'`,
          `'${d.md5_hash}'`,
          `'${d.sha256_hash}'`,
          `'${d.storage_path.replace(/'/g, "''")}'`,
          `'${d.storage_provider}'`,
          `'${d.storage_url}'`,
          d.thumbnail_path ? `'${d.thumbnail_path}'` : 'NULL',
          `'${d.folder_id}'`,
          `'${d.project_id}'`,
          d.client_id ? `'${d.client_id}'` : 'NULL',
          `'${d.document_type}'`,
          `'${d.category}'`,
          d.subcategory ? `'${d.subcategory}'` : 'NULL',
          `'${d.tags}'`,
          `'${d.status}'`,
          d.is_template,
          d.template_category ? `'${d.template_category}'` : 'NULL',
          d.version,
          d.parent_document_id ? `'${d.parent_document_id}'` : 'NULL',
          d.is_latest_version,
          d.version_notes ? `'${d.version_notes}'` : 'NULL',
          d.is_public,
          `'${d.access_level}'`,
          `'${d.allowed_users}'`,
          `'${d.allowed_roles}'`,
          d.is_password_protected,
          d.password_hash ? `'${d.password_hash}'` : 'NULL',
          d.has_text,
          d.extracted_text ? `'${d.extracted_text.replace(/'/g, "''")}'` : 'NULL',
          d.ocr_text ? `'${d.ocr_text.replace(/'/g, "''")}'` : 'NULL',
          d.page_count ? d.page_count : 'NULL',
          d.word_count ? d.word_count : 'NULL',
          d.requires_approval,
          `'${d.approval_status}'`,
          d.approved_by ? `'${d.approved_by}'` : 'NULL',
          d.approved_date ? `'${d.approved_date.toISOString()}'` : 'NULL',
          d.rejection_reason ? `'${d.rejection_reason.replace(/'/g, "''")}'` : 'NULL',
          d.retention_period_days ? d.retention_period_days : 'NULL',
          d.expiry_date ? `'${d.expiry_date.toISOString().split('T')[0]}'` : 'NULL',
          d.auto_delete_date ? `'${d.auto_delete_date.toISOString().split('T')[0]}'` : 'NULL',
          d.is_expired,
          d.download_count,
          d.view_count,
          d.last_downloaded ? `'${d.last_downloaded.toISOString()}'` : 'NULL',
          d.last_viewed ? `'${d.last_viewed.toISOString()}'` : 'NULL',
          d.is_compliant,
          d.compliance_notes ? `'${d.compliance_notes.replace(/'/g, "''")}'` : 'NULL',
          d.quality_score ? d.quality_score : 'NULL',
          d.has_watermark,
          d.document_date ? `'${d.document_date.toISOString().split('T')[0]}'` : 'NULL',
          d.author_name ? `'${d.author_name.replace(/'/g, "''")}'` : 'NULL',
          d.company_name ? `'${d.company_name.replace(/'/g, "''")}'` : 'NULL',
          d.contract_number ? `'${d.contract_number}'` : 'NULL',
          d.invoice_number ? `'${d.invoice_number}'` : 'NULL',
          d.receipt_number ? `'${d.receipt_number}'` : 'NULL',
          d.amount ? d.amount : 'NULL',
          d.currency ? `'${d.currency}'` : 'NULL',
          d.tax_amount ? d.tax_amount : 'NULL',
          `'${d.technical_specs}'`,
          `'${d.equipment_ids}'`,
          `'${d.location_data}'`,
          d.image_width ? d.image_width : 'NULL',
          d.image_height ? d.image_height : 'NULL',
          d.camera_model ? `'${d.camera_model.replace(/'/g, "''")}'` : 'NULL',
          d.gps_latitude ? d.gps_latitude : 'NULL',
          d.gps_longitude ? d.gps_longitude : 'NULL',
          d.date_taken ? `'${d.date_taken.toISOString()}'` : 'NULL',
          `'${d.metadata}'`,
          `'${d.created_by}'`,
          `'${d.uploaded_by}'`,
          `'${d.created_at.toISOString()}'`,
          `'${d.updated_at.toISOString()}'`
        ];
        
        return `(${escapedValues.join(', ')})`;
      }).join(', ');
      
      await client.query(`
        INSERT INTO documents (
          id, document_id, file_name, original_file_name, display_name, description,
          file_size, mime_type, file_extension, md5_hash, sha256_hash,
          storage_path, storage_provider, storage_url, thumbnail_path,
          folder_id, project_id, client_id, document_type, category, subcategory, tags,
          status, is_template, template_category, version, parent_document_id,
          is_latest_version, version_notes, is_public, access_level,
          allowed_users, allowed_roles, is_password_protected, password_hash,
          has_text, extracted_text, ocr_text, page_count, word_count,
          requires_approval, approval_status, approved_by, approved_date, rejection_reason,
          retention_period_days, expiry_date, auto_delete_date, is_expired,
          download_count, view_count, last_downloaded, last_viewed,
          is_compliant, compliance_notes, quality_score, has_watermark,
          document_date, author_name, company_name, contract_number,
          invoice_number, receipt_number, amount, currency, tax_amount,
          technical_specs, equipment_ids, location_data,
          image_width, image_height, camera_model, gps_latitude, gps_longitude, date_taken,
          metadata, created_by, uploaded_by, created_at, updated_at
        ) VALUES ${values}
        ON CONFLICT (document_id) DO NOTHING
      `);
      
      console.log(`✅ Inserted batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(documents.length / batchSize)} (${batch.length} documents)`);
      
    } catch (error) {
      console.error(`❌ Error inserting batch ${Math.floor(i / batchSize) + 1}:`, error);
    }
  }
  
  console.log(`✅ Created ${documents.length} documents`);
  return documentIds;
}

async function createAccessLogs(documentIds: string[]): Promise<void> {
  console.log('📊 Creating document access logs...');
  
  const accessLogs = [];
  const accessTypes = ['view', 'download', 'edit', 'share'];
  const accessMethods = ['web', 'api', 'mobile'];
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15'
  ];
  
  // Generate 2-8 access logs per document
  for (const documentId of documentIds) {
    const logCount = Math.floor(Math.random() * 7) + 2;
    
    for (let i = 0; i < logCount; i++) {
      const accessLog = {
        id: uuidv4(),
        document_id: documentId,
        user_id: '00000000-0000-0000-0000-000000000001', // Default user
        access_type: getRandomElement(accessTypes),
        access_method: getRandomElement(accessMethods),
        ip_address: `192.168.1.${Math.floor(Math.random() * 254) + 1}`,
        user_agent: getRandomElement(userAgents),
        session_id: uuidv4(),
        request_duration: Math.floor(Math.random() * 5000) + 100,
        bytes_transferred: Math.floor(Math.random() * 1000000) + 1000,
        was_successful: Math.random() > 0.05, // 95% success rate
        error_message: Math.random() > 0.95 ? 'Network timeout' : null,
        referer_url: '/dashboard/documents',
        device_type: getRandomElement(['desktop', 'mobile', 'tablet']),
        browser_name: getRandomElement(['Chrome', 'Firefox', 'Safari', 'Edge']),
        browser_version: `${Math.floor(Math.random() * 20) + 90}.0`,
        metadata: JSON.stringify({}),
        accessed_at: generateRandomDate()
      };
      
      accessLogs.push(accessLog);
    }
  }
  
  // Insert access logs in batches
  const batchSize = 100;
  for (let i = 0; i < accessLogs.length; i += batchSize) {
    const batch = accessLogs.slice(i, i + batchSize);
    const values = batch.map(log => 
      `('${log.id}', '${log.document_id}', '${log.user_id}', '${log.access_type}', '${log.access_method}', '${log.ip_address}', '${log.user_agent.replace(/'/g, "''")}', '${log.session_id}', ${log.request_duration}, ${log.bytes_transferred}, ${log.was_successful}, ${log.error_message ? `'${log.error_message}'` : 'NULL'}, '${log.referer_url}', '${log.device_type}', '${log.browser_name}', '${log.browser_version}', '${log.metadata}', '${log.accessed_at.toISOString()}')`
    ).join(', ');
    
    await client.query(`
      INSERT INTO document_access_logs (id, document_id, user_id, access_type, access_method, ip_address, user_agent, session_id, request_duration, bytes_transferred, was_successful, error_message, referer_url, device_type, browser_name, browser_version, metadata, accessed_at)
      VALUES ${values}
      ON CONFLICT (id) DO NOTHING
    `);
  }
  
  console.log(`✅ Created ${accessLogs.length} access log entries`);
}

async function createDocumentShares(documentIds: string[]): Promise<void> {
  console.log('🔗 Creating document shares...');
  
  const shares = [];
  const shareTypes = ['link', 'email', 'user'];
  
  // Create shares for about 30% of documents
  const documentsToShare = documentIds.slice(0, Math.floor(documentIds.length * 0.3));
  
  for (const documentId of documentsToShare) {
    const share = {
      id: uuidv4(),
      share_id: `SHARE-${String(Math.floor(Math.random() * 999999)).padStart(6, '0')}`,
      document_id: documentId,
      shared_by: '00000000-0000-0000-0000-000000000001',
      share_type: getRandomElement(shareTypes),
      share_url: `https://app.fibreflow.com/shared/${uuidv4()}`,
      access_token: uuidv4(),
      shared_with_users: JSON.stringify([]),
      shared_with_emails: JSON.stringify(['partner@example.com', 'client@example.com']),
      shared_with_roles: JSON.stringify(['client', 'contractor']),
      can_view: true,
      can_download: Math.random() > 0.3,
      can_edit: false,
      can_comment: Math.random() > 0.5,
      can_share: false,
      requires_password: Math.random() > 0.7,
      password_hash: Math.random() > 0.7 ? generateMD5Hash('sharepassword123') : null,
      requires_login: Math.random() > 0.4,
      expiry_date: Math.random() > 0.6 ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null, // 30 days
      max_accesses: Math.random() > 0.8 ? Math.floor(Math.random() * 50) + 10 : null,
      access_count: Math.floor(Math.random() * 20),
      is_active: Math.random() > 0.1, // 90% active
      last_accessed: Math.random() > 0.3 ? generateRandomDate() : null,
      unique_accessors: JSON.stringify(['192.168.1.100', '192.168.1.101']),
      metadata: JSON.stringify({}),
      created_at: generateRandomDate(),
      updated_at: generateRandomDate()
    };
    
    shares.push(share);
  }
  
  // Insert shares in batches
  const batchSize = 50;
  for (let i = 0; i < shares.length; i += batchSize) {
    const batch = shares.slice(i, i + batchSize);
    const values = batch.map(s => {
      return `('${s.id}', '${s.share_id}', '${s.document_id}', '${s.shared_by}', '${s.share_type}', '${s.share_url}', '${s.access_token}', '${s.shared_with_users}', '${s.shared_with_emails}', '${s.shared_with_roles}', ${s.can_view}, ${s.can_download}, ${s.can_edit}, ${s.can_comment}, ${s.can_share}, ${s.requires_password}, ${s.password_hash ? `'${s.password_hash}'` : 'NULL'}, ${s.requires_login}, ${s.expiry_date ? `'${s.expiry_date.toISOString()}'` : 'NULL'}, ${s.max_accesses || 'NULL'}, ${s.access_count}, ${s.is_active}, ${s.last_accessed ? `'${s.last_accessed.toISOString()}'` : 'NULL'}, '${s.unique_accessors}', '${s.metadata}', '${s.created_at.toISOString()}', '${s.updated_at.toISOString()}')`;
    }).join(', ');
    
    await client.query(`
      INSERT INTO document_shares (id, share_id, document_id, shared_by, share_type, share_url, access_token, shared_with_users, shared_with_emails, shared_with_roles, can_view, can_download, can_edit, can_comment, can_share, requires_password, password_hash, requires_login, expiry_date, max_accesses, access_count, is_active, last_accessed, unique_accessors, metadata, created_at, updated_at)
      VALUES ${values}
      ON CONFLICT (share_id) DO NOTHING
    `);
  }
  
  console.log(`✅ Created ${shares.length} document shares`);
}

// 🟢 WORKING: Main execution function
async function main() {
  try {
    console.log('🚀 Starting document database population...');
    
    console.log('✅ Already connected to database');
    
    // First, let's create some dummy project IDs to associate documents with
    const projectIds = Array.from({length: 10}, () => uuidv4());
    console.log(`📋 Using ${projectIds.length} project IDs for document association`);
    
    // Create folder structure
    const folderIds = await createDocumentFolders(projectIds);
    
    // Create documents
    const documentIds = await createDocuments(projectIds, folderIds);
    
    // Create access logs
    await createAccessLogs(documentIds);
    
    // Create document shares
    await createDocumentShares(documentIds);
    
    console.log('🎉 Document database population completed successfully!');
    console.log(`📊 Summary:`);
    console.log(`   - Projects: ${projectIds.length}`);
    console.log(`   - Folders: ${folderIds.length}`);
    console.log(`   - Documents: ${documentIds.length}`);
    console.log(`   - Access logs: ~${documentIds.length * 4} entries`);
    console.log(`   - Shares: ~${Math.floor(documentIds.length * 0.3)} entries`);
    
  } catch (error) {
    console.error('❌ Error during population:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Check if tables exist before running
async function checkTables() {
  console.log('🔍 Checking if document tables exist...');
  
  try {
    const tableCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('document_folders', 'documents', 'document_access_logs', 'document_shares')
      ORDER BY table_name
    `);
    
    const existingTables = tableCheck.rows.map(row => row.table_name);
    const requiredTables = ['document_folders', 'documents', 'document_access_logs', 'document_shares'];
    const missingTables = requiredTables.filter(table => !existingTables.includes(table));
    
    if (missingTables.length > 0) {
      console.log(`❌ Missing tables: ${missingTables.join(', ')}`);
      console.log('Please run the database migration first: npm run db:push');
      return false;
    }
    
    console.log('✅ All required document tables exist');
    return true;
  } catch (error) {
    console.error('❌ Error checking tables:', error);
    return false;
  }
}

// Run the script
if (require.main === module) {
  (async () => {
    await client.connect();
    
    const tablesExist = await checkTables();
    
    if (tablesExist) {
      await main();
    } else {
      await client.end();
      process.exit(1);
    }
  })();
}