/**
 * Test script for Project Import Service
 * Run: node scripts/test-project-import.js
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// Simple mappings test (mirrors the TypeScript mappings)
const DROPS_HEADERS = [
  ['label', 'drop_number', 'drop_id', 'drop_label'],
  ['strtfeat', 'start_feature', 'pole_number', 'from_pole'],
  ['type', 'cable_type'],
  ['spec', 'specification', 'cable_spec'],
  ['dim2', 'length', 'cable_length', 'distance'],
  ['cblcpty', 'capacity', 'cable_capacity', 'fibre_count'],
  ['lat', 'latitude', 'y'],
  ['lon', 'longitude', 'lng', 'x'],
  ['address', 'location', 'drop_address'],
  ['pon_no', 'pon', 'pon_number'],
  ['zone_no', 'zone', 'zone_number'],
  ['mun', 'municipality', 'city'],
];

function extractValue(row, possibleKeys) {
  for (const key of possibleKeys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
      return row[key];
    }
    const foundKey = Object.keys(row).find(k => k.toLowerCase() === key.toLowerCase());
    if (foundKey && row[foundKey] !== undefined && row[foundKey] !== null) {
      return row[foundKey];
    }
  }
  return undefined;
}

async function testImport() {
  console.log('🧪 Testing Project Import Service\n');

  // Test 1: Parse sample file
  console.log('Test 1: Parse Drops file');
  const filePath = path.join(__dirname, '../docs/Uploads/Lawley/Drops_Lawley.xlsx');

  if (!fs.existsSync(filePath)) {
    console.log('❌ Sample file not found:', filePath);
    return;
  }

  const buffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const jsonData = XLSX.utils.sheet_to_json(sheet);

  console.log(`  ✓ Parsed ${jsonData.length} rows`);
  console.log(`  ✓ Sheet: ${workbook.SheetNames[0]}`);

  // Test 2: Validate header mapping
  console.log('\nTest 2: Validate header mappings');
  const headers = Object.keys(jsonData[0]);
  let mappedCount = 0;

  for (const headerGroup of DROPS_HEADERS) {
    const matchedHeader = headers.find(h =>
      headerGroup.some(expected => h.toLowerCase() === expected.toLowerCase())
    );
    if (matchedHeader) {
      mappedCount++;
      console.log(`  ✓ ${headerGroup[0]} → "${matchedHeader}"`);
    } else {
      console.log(`  ⚠ ${headerGroup[0]} → NOT FOUND`);
    }
  }
  console.log(`  Mapped: ${mappedCount}/${DROPS_HEADERS.length}`);

  // Test 3: Extract sample values
  console.log('\nTest 3: Extract sample values from row 1');
  const sampleRow = jsonData[0];

  const drop_number = extractValue(sampleRow, ['label', 'drop_number']);
  const pole_number = extractValue(sampleRow, ['strtfeat', 'pole_number']);
  const cable_type = extractValue(sampleRow, ['type', 'cable_type']);
  const cable_length = extractValue(sampleRow, ['dim2', 'cable_length']);
  const pon_no = extractValue(sampleRow, ['pon_no', 'pon']);
  const municipality = extractValue(sampleRow, ['mun', 'municipality']);

  console.log(`  drop_number: ${drop_number}`);
  console.log(`  pole_number: ${pole_number}`);
  console.log(`  cable_type: ${cable_type}`);
  console.log(`  cable_length: ${cable_length}`);
  console.log(`  pon_no: ${pon_no}`);
  console.log(`  municipality: ${municipality}`);

  // Test 4: Count by identifier
  console.log('\nTest 4: Validate data quality');
  const withLabel = jsonData.filter(r => extractValue(r, ['label'])).length;
  const withCoords = jsonData.filter(r =>
    extractValue(r, ['lat']) && extractValue(r, ['lon'])
  ).length;
  const withPon = jsonData.filter(r => extractValue(r, ['pon_no'])).length;

  console.log(`  Rows with drop_number: ${withLabel}/${jsonData.length}`);
  console.log(`  Rows with coordinates: ${withCoords}/${jsonData.length}`);
  console.log(`  Rows with PON: ${withPon}/${jsonData.length}`);

  // Test 5: Fibre file
  console.log('\nTest 5: Parse Fibre file');
  const fibrePath = path.join(__dirname, '../docs/Uploads/Lawley/Fibre_Lawley.xlsx');

  if (fs.existsSync(fibrePath)) {
    const fibreBuffer = fs.readFileSync(fibrePath);
    const fibreWorkbook = XLSX.read(fibreBuffer, { type: 'buffer' });
    const fibreSheet = fibreWorkbook.Sheets[fibreWorkbook.SheetNames[0]];
    const fibreData = XLSX.utils.sheet_to_json(fibreSheet);

    console.log(`  ✓ Parsed ${fibreData.length} rows`);
    console.log(`  ✓ Sheet: ${fibreWorkbook.SheetNames[0]}`);
    console.log(`  Headers: ${Object.keys(fibreData[0]).join(', ')}`);
  } else {
    console.log('  ⚠ Fibre file not found');
  }

  console.log('\n✅ All tests completed!');
}

testImport().catch(console.error);
