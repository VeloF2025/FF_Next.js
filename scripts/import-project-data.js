#!/usr/bin/env node
/**
 * Project Data Import Script
 * PRD-047: Import drops, poles, or fibre from Excel files
 *
 * Usage:
 *   node scripts/import-project-data.js <projectId> <filePath> [dataType]
 *
 * Examples:
 *   node scripts/import-project-data.js abc-123 ./Drops_Lawley.xlsx drops
 *   node scripts/import-project-data.js abc-123 ./Fibre_Lawley.xlsx fibre
 *   node scripts/import-project-data.js abc-123 ./Poles_Lawley.xlsx poles
 *   node scripts/import-project-data.js abc-123 ./data.xlsx  # Auto-detect type
 *
 * Environment:
 *   DATABASE_URL - PostgreSQL connection string (required)
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { Client } = require('pg');

// Field mappings (mirrors src/services/project-import/mappings.ts)
const MAPPINGS = {
  drops: {
    tableName: 'drops',
    uniqueConstraint: ['project_id', 'drop_number'],
    fields: [
      { headers: ['label', 'drop_number', 'drop_id', 'drop_label'], column: 'drop_number', required: true },
      { headers: ['strtfeat', 'start_feature', 'pole_number', 'from_pole'], column: 'pole_number' },
      { headers: ['strtfeat', 'start_feature', 'start_point'], column: 'start_point' },
      { headers: ['endfeat', 'end_feature', 'to_pole', 'end_point'], column: 'end_point' },
      { headers: ['type', 'cable_type'], column: 'cable_type' },
      { headers: ['spec', 'specification', 'cable_spec'], column: 'cable_spec' },
      { headers: ['dim2', 'length', 'cable_length', 'distance'], column: 'cable_length', type: 'number' },
      { headers: ['cblcpty', 'capacity', 'cable_capacity', 'fibre_count'], column: 'cable_capacity', type: 'number' },
      { headers: ['address', 'location', 'drop_address'], column: 'address' },
      { headers: ['pon_no', 'pon', 'pon_number'], column: 'pon_no' },
      { headers: ['zone_no', 'zone', 'zone_number'], column: 'zone_no' },
      { headers: ['mun', 'municipality', 'city'], column: 'municipality' },
    ],
  },
  poles: {
    tableName: 'poles',
    uniqueConstraint: ['project_id', 'pole_number'],
    fields: [
      { headers: ['label_1', 'pole_number', 'pole_id', 'pole_label'], column: 'pole_number', required: true },
      { headers: ['type_1', 'pole_type', 'type'], column: 'pole_type' },
      { headers: ['spec_1', 'specification', 'spec'], column: 'specification' },
      { headers: ['lat', 'latitude', 'y'], column: 'latitude', type: 'number' },
      { headers: ['lon', 'longitude', 'lng', 'x'], column: 'longitude', type: 'number' },
      { headers: ['height', 'pole_height'], column: 'height', type: 'number' },
      { headers: ['material', 'pole_material'], column: 'material' },
      { headers: ['status', 'pole_status'], column: 'status' },
      { headers: ['zone_no', 'zone', 'zone_number'], column: 'zone_no' },
      { headers: ['pon_no', 'pon', 'pon_number'], column: 'pon_no' },
      { headers: ['address', 'location'], column: 'address' },
      { headers: ['mun', 'municipality', 'city'], column: 'municipality' },
    ],
  },
  fibre: {
    tableName: 'fibre_segments',
    uniqueConstraint: ['project_id', 'segment_id'],
    fields: [
      { headers: ['label', 'segment_id', 'fibre_id', 'cable_id'], column: 'segment_id', required: true },
      { headers: ['cable size', 'cable_size', 'size', 'fibre_count'], column: 'cable_size' },
      { headers: ['layer', 'network_layer'], column: 'layer' },
      { headers: ['length', 'cable_length', 'distance'], column: 'length', type: 'number' },
      { headers: ['pon_no', 'pon', 'pon_number'], column: 'pon_no' },
      { headers: ['zone_no', 'zone', 'zone_number'], column: 'zone_no' },
      { headers: ['from_pole', 'start_pole', 'strtfeat', 'from_point'], column: 'from_point' },
      { headers: ['to_pole', 'end_pole', 'endfeat', 'to_point'], column: 'to_point' },
      { headers: ['contractor', 'installed_by'], column: 'contractor' },
      { headers: ['complete', 'completed', 'status'], column: 'is_complete', type: 'boolean' },
      { headers: ['String Com', 'string_completed', 'string_complete'], column: 'string_completed' },
      { headers: ['Date Comp', 'date_completed', 'completion_date'], column: 'date_completed', type: 'date' },
    ],
  },
};

// Detect data type from headers
function detectDataType(headers) {
  const lowerHeaders = headers.map(h => h.toLowerCase().trim());

  // Drops: has 'label' + 'strtfeat' or 'type'/'spec' combo
  if (lowerHeaders.includes('label') &&
      (lowerHeaders.includes('strtfeat') || lowerHeaders.includes('type'))) {
    return 'drops';
  }

  // Poles: has 'label_1' or 'pole_number'
  if (lowerHeaders.includes('label_1') || lowerHeaders.includes('pole_number')) {
    return 'poles';
  }

  // Fibre: has 'cable size' or 'layer' with 'length'
  if ((lowerHeaders.includes('cable size') || lowerHeaders.includes('cable_size')) &&
      lowerHeaders.includes('length')) {
    return 'fibre';
  }

  return null;
}

// Extract value from row with case-insensitive matching
function extractValue(row, possibleHeaders) {
  for (const header of possibleHeaders) {
    if (row[header] !== undefined && row[header] !== null && row[header] !== '') {
      return row[header];
    }
    const found = Object.keys(row).find(k => k.toLowerCase().trim() === header.toLowerCase().trim());
    if (found && row[found] !== undefined && row[found] !== null && row[found] !== '') {
      return row[found];
    }
  }
  return undefined;
}

// Convert Excel serial date to JS Date
function excelDateToJS(serial) {
  // Excel dates start from 1900-01-01 (serial 1)
  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * 86400 * 1000;
  return new Date(utcValue);
}

// Convert value to proper type
function convertValue(value, type) {
  if (value === undefined || value === null || value === '') return null;

  const str = String(value).trim();

  switch (type) {
    case 'number': {
      const cleaned = str.replace(/[^\d.-]/g, '');
      const num = parseFloat(cleaned);
      return isNaN(num) ? null : num;
    }
    case 'boolean': {
      const lower = str.toLowerCase();
      if (['yes', 'true', '1', 'complete', 'completed', 'y'].includes(lower)) return true;
      if (['no', 'false', '0', 'incomplete', 'pending', 'n', ''].includes(lower)) return false;
      return null;
    }
    case 'date': {
      // Handle Excel serial dates
      if (typeof value === 'number' && value > 30000 && value < 60000) {
        return excelDateToJS(value).toISOString();
      }
      // Try parsing as date string
      const date = new Date(str);
      return isNaN(date.getTime()) ? null : date.toISOString();
    }
    default:
      return str;
  }
}

// Deduplicate rows by primary key field (keep last occurrence)
function deduplicateRows(rows, mapping) {
  const primaryField = mapping.fields.find(f => f.required);
  if (!primaryField) return rows;

  const seen = new Map();
  for (const row of rows) {
    const key = extractValue(row, primaryField.headers);
    if (key) seen.set(key, row);
  }

  const deduped = Array.from(seen.values());
  if (deduped.length < rows.length) {
    console.log(`   ⚠️  Removed ${rows.length - deduped.length} duplicate rows`);
  }
  return deduped;
}

// Build upsert query
function buildUpsertQuery(mapping, projectId, rows) {
  const columns = ['project_id', ...mapping.fields.map(f => f.column), 'raw_data', 'created_at', 'updated_at'];
  const conflictColumns = mapping.uniqueConstraint;
  const updateColumns = columns.filter(c => !conflictColumns.includes(c) && c !== 'created_at');

  const values = [];
  const placeholders = [];
  let paramIndex = 1;

  for (const row of rows) {
    const rowValues = [projectId];

    for (const field of mapping.fields) {
      const rawValue = extractValue(row, field.headers);
      const value = convertValue(rawValue, field.type);
      rowValues.push(value);
    }

    rowValues.push(JSON.stringify(row)); // raw_data
    rowValues.push(new Date().toISOString()); // created_at
    rowValues.push(new Date().toISOString()); // updated_at

    const rowPlaceholders = rowValues.map(() => `$${paramIndex++}`);
    placeholders.push(`(${rowPlaceholders.join(', ')})`);
    values.push(...rowValues);
  }

  const updateSet = updateColumns.map(c => `${c} = EXCLUDED.${c}`).join(', ');

  const query = `
    INSERT INTO ${mapping.tableName} (${columns.join(', ')})
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (${conflictColumns.join(', ')})
    DO UPDATE SET ${updateSet}
  `;

  return { query, values };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log(`
Usage: node scripts/import-project-data.js <projectId> <filePath> [dataType]

Arguments:
  projectId   Project UUID to import data into
  filePath    Path to Excel file (.xlsx)
  dataType    Optional: 'drops', 'poles', or 'fibre' (auto-detected if not provided)

Environment:
  DATABASE_URL  PostgreSQL connection string (required)

Examples:
  node scripts/import-project-data.js abc-123 ./Drops.xlsx drops
  node scripts/import-project-data.js abc-123 ./data.xlsx  # auto-detect
`);
    process.exit(1);
  }

  const [projectId, filePath, dataTypeArg] = args;

  // Check file exists
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`❌ File not found: ${resolvedPath}`);
    process.exit(1);
  }

  // Check DATABASE_URL
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL environment variable is required');
    console.log('\nSet it with:');
    console.log("  export DATABASE_URL='postgresql://...'");
    process.exit(1);
  }

  console.log(`\n📂 Importing from: ${resolvedPath}`);
  console.log(`📋 Project ID: ${projectId}`);

  // Parse Excel file
  console.log('\n📊 Parsing Excel file...');
  const buffer = fs.readFileSync(resolvedPath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet);

  if (rows.length === 0) {
    console.error('❌ No data rows found in file');
    process.exit(1);
  }

  const headers = Object.keys(rows[0]);
  console.log(`   Sheet: ${sheetName}`);
  console.log(`   Rows: ${rows.length}`);
  console.log(`   Headers: ${headers.slice(0, 5).join(', ')}${headers.length > 5 ? '...' : ''}`);

  // Determine data type
  let dataType = dataTypeArg;
  if (!dataType) {
    dataType = detectDataType(headers);
    if (!dataType) {
      console.error('\n❌ Could not auto-detect data type');
      console.log('   Please specify: drops, poles, or fibre');
      process.exit(1);
    }
    console.log(`\n🔍 Auto-detected type: ${dataType}`);
  } else {
    console.log(`\n📌 Using specified type: ${dataType}`);
  }

  const mapping = MAPPINGS[dataType];
  if (!mapping) {
    console.error(`❌ Unknown data type: ${dataType}`);
    process.exit(1);
  }

  // Show field mappings
  console.log(`\n🗺️  Field Mappings (${mapping.tableName}):`);
  let mappedCount = 0;
  for (const field of mapping.fields) {
    const matched = headers.find(h =>
      field.headers.some(fh => h.toLowerCase().trim() === fh.toLowerCase())
    );
    if (matched) {
      mappedCount++;
      console.log(`   ✓ ${field.column} ← "${matched}"`);
    } else {
      console.log(`   ○ ${field.column} (not found)`);
    }
  }
  console.log(`   Mapped: ${mappedCount}/${mapping.fields.length}`);

  // Connect to database
  console.log('\n🔌 Connecting to database...');
  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  try {
    // Deduplicate rows
    const dedupedRows = deduplicateRows(rows, mapping);

    // Import in batches
    const BATCH_SIZE = 500;
    const batches = [];
    for (let i = 0; i < dedupedRows.length; i += BATCH_SIZE) {
      batches.push(dedupedRows.slice(i, i + BATCH_SIZE));
    }

    console.log(`\n⬆️  Importing ${dedupedRows.length} rows in ${batches.length} batches...`);

    let imported = 0;
    const startTime = Date.now();

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const { query, values } = buildUpsertQuery(mapping, projectId, batch);

      await client.query(query, values);
      imported += batch.length;

      const progress = Math.round((imported / dedupedRows.length) * 100);
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = Math.round(imported / elapsed);

      process.stdout.write(`\r   Batch ${i + 1}/${batches.length} - ${imported}/${dedupedRows.length} (${progress}%) - ${rate} rows/sec`);
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n\n✅ Import complete!`);
    console.log(`   Rows: ${imported}`);
    console.log(`   Time: ${totalTime}s`);
    console.log(`   Rate: ${Math.round(imported / parseFloat(totalTime))} rows/sec`);

    // Verify count
    const countResult = await client.query(
      `SELECT COUNT(*) as count FROM ${mapping.tableName} WHERE project_id = $1`,
      [projectId]
    );
    console.log(`\n📊 Total ${dataType} for project: ${countResult.rows[0].count}`);

  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('\n❌ Import failed:', err.message);
  process.exit(1);
});
