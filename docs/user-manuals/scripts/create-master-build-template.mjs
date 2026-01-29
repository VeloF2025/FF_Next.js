/**
 * Create Master Build Agreement Template
 *
 * This script takes the original Master Build Agreement DOCX
 * and creates a template version with placeholders for docxtemplater
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import PizZip from 'pizzip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SOURCE_PATH = path.join(__dirname, '../../docs/Company Docs/Velocity Fibre Master Build Agreement - Final.docx');
const OUTPUT_PATH = path.join(__dirname, '../../templates/master-build-agreement.docx');

// Field names and their placeholders
// Each field appears twice - once in CUSTOMER (filled), once in CONTRACTOR (empty)
// We target the second occurrence (CONTRACTOR table)
const FIELDS = [
  { name: 'NAME', placeholder: '{contractor_name}' },
  { name: 'REGISTRATION NUMBER', placeholder: '{contractor_reg_number}' },
  { name: 'CONTACT PERSON', placeholder: '{contractor_contact_person}' },
  { name: 'PHYSICAL ADDRESS', placeholder: '{contractor_physical_address}' },
  { name: 'EMAIL ADDRESS', placeholder: '{contractor_email}' },
];

async function createTemplate() {
  console.log('Reading source DOCX...');

  if (!fs.existsSync(SOURCE_PATH)) {
    console.error('Source file not found:', SOURCE_PATH);
    console.error('Expected at:', SOURCE_PATH);
    process.exit(1);
  }

  const content = fs.readFileSync(SOURCE_PATH);
  const zip = new PizZip(content);

  const documentXml = zip.file('word/document.xml');
  if (!documentXml) {
    console.error('Could not find word/document.xml in DOCX');
    process.exit(1);
  }

  let xml = documentXml.asText();

  console.log('Inserting placeholders into CONTRACTOR table...\n');

  for (const field of FIELDS) {
    // Find the second occurrence of each field (CONTRACTOR table)
    const searchPattern = `<w:t>${field.name}</w:t>`;
    const firstIdx = xml.indexOf(searchPattern);

    if (firstIdx === -1) {
      console.log(`  ⚠️  Field not found: ${field.name}`);
      continue;
    }

    // Find the second occurrence
    const secondIdx = xml.indexOf(searchPattern, firstIdx + searchPattern.length);

    if (secondIdx === -1) {
      console.log(`  ⚠️  Second occurrence not found for: ${field.name}`);
      continue;
    }

    console.log(`  Found: ${field.name} (at position ${secondIdx})`);

    // Find the next table cell after this field label
    // The pattern is: </w:tc><w:tc> for the next cell in the same row
    const afterField = xml.substring(secondIdx);
    const cellEndIdx = afterField.indexOf('</w:tc>');

    if (cellEndIdx === -1) {
      console.log(`    ⚠️  Could not find cell end for: ${field.name}`);
      continue;
    }

    // Find the start of the next cell
    const nextCellStart = afterField.indexOf('<w:tc>', cellEndIdx);
    if (nextCellStart === -1) {
      console.log(`    ⚠️  Could not find next cell for: ${field.name}`);
      continue;
    }

    // Find the end of the next cell
    const nextCellEndSearch = afterField.substring(nextCellStart);
    // We need to find the matching </w:tc> - this is tricky with nested cells
    // For simplicity, find the first </w:tc> after the next <w:tc>
    const nextCellContent = nextCellEndSearch.indexOf('</w:tc>');

    if (nextCellContent === -1) {
      console.log(`    ⚠️  Could not find next cell end for: ${field.name}`);
      continue;
    }

    const absoluteNextCellStart = secondIdx + nextCellStart;
    const absoluteNextCellEnd = absoluteNextCellStart + nextCellContent + '</w:tc>'.length;

    // Get the cell content
    const cellContent = xml.substring(absoluteNextCellStart, absoluteNextCellEnd);

    // Create a new cell with the placeholder
    // Keep the cell structure but replace/add the text content
    let newCellContent;

    // Check if there's an existing <w:t> tag to replace
    if (cellContent.includes('<w:t>')) {
      // Replace existing text
      newCellContent = cellContent.replace(/<w:t>([^<]*)<\/w:t>/g, `<w:t>${field.placeholder}</w:t>`);
    } else if (cellContent.includes('<w:t/>')) {
      // Replace empty text tag
      newCellContent = cellContent.replace(/<w:t\/>/g, `<w:t>${field.placeholder}</w:t>`);
    } else {
      // Insert text run before </w:p>
      newCellContent = cellContent.replace(
        /<\/w:p>/,
        `<w:r><w:t>${field.placeholder}</w:t></w:r></w:p>`
      );
    }

    // Replace in XML
    xml = xml.substring(0, absoluteNextCellStart) + newCellContent + xml.substring(absoluteNextCellEnd);
    console.log(`    ✅ Inserted: ${field.placeholder}`);
  }

  // Save the modified DOCX
  zip.file('word/document.xml', xml);

  const outputBuffer = zip.generate({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });

  // Ensure output directory exists
  const outputDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_PATH, outputBuffer);

  console.log(`\n✅ Template created: ${OUTPUT_PATH}`);
  console.log('\nPlaceholders in template:');
  FIELDS.forEach(f => console.log(`  - ${f.placeholder}`));

  console.log('\n📋 Usage with docxtemplater:');
  console.log('  const data = {');
  console.log("    contractor_name: 'ABC Contractors',");
  console.log("    contractor_reg_number: '2024/123456/07',");
  console.log("    contractor_contact_person: 'John Smith',");
  console.log("    contractor_physical_address: '123 Main St, City',");
  console.log("    contractor_email: 'john@abc.co.za',");
  console.log('  };');
}

createTemplate().catch(console.error);
