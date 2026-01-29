import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Light yellow for fillable fields
const FIELD_BG = rgb(1, 1, 0.85);

async function createFillablePDF() {
  // Load the full branded PDF
  const sourcePdfPath = path.join(__dirname, '../pdf/cession-wayleave-template.pdf');
  const sourcePdfBytes = fs.readFileSync(sourcePdfPath);
  const pdfDoc = await PDFDocument.load(sourcePdfBytes);

  const form = pdfDoc.getForm();
  const pages = pdfDoc.getPages();

  console.log(`Loaded PDF with ${pages.length} pages`);

  // A4 dimensions
  const pageWidth = 595.28;

  // Field dimensions - adjusted based on actual PDF layout
  // A4 page = 595pts wide, margins ~57pts each side
  // Table uses about 380pts width, Field col ~150pts, Value col ~230pts
  const fieldHeight = 18;
  const tableFieldX = 188;  // Value column inner edge
  const tableFieldWidth = 170;

  // ============================================================
  // PAGE 3 (index 2) - Cedent Party Table
  // Measured from screenshot - table rows at these Y positions
  // ============================================================
  const page3 = pages[2];

  // Y positions measured from bottom of page (A4 = 842pts)
  // Table header at ~Y=490, first row at ~468, rows ~20pts apart
  const cedentFields = [
    { name: 'cedent_name', y: 468, label: 'Cedent Name' },
    { name: 'cedent_reg_no', y: 448, label: 'Registration Number' },
    { name: 'cedent_address', y: 428, label: 'Registered Address' },
    { name: 'cedent_rep_name', y: 408, label: 'Representative Name' },
    { name: 'cedent_rep_id', y: 388, label: 'ID Number' },
    { name: 'cedent_email', y: 368, label: 'Email' },
    { name: 'cedent_phone', y: 348, label: 'Phone' },
  ];

  for (const f of cedentFields) {
    const tf = form.createTextField(f.name);
    tf.addToPage(page3, {
      x: tableFieldX,
      y: f.y,
      width: tableFieldWidth,
      height: fieldHeight,
      borderWidth: 0,
      backgroundColor: FIELD_BG,
    });
    tf.setFontSize(9);
  }

  // ============================================================
  // PAGE 4 (index 3) - Agreement Details Table
  // Table is near top of page 4, after Cessionary details
  // ============================================================
  const page4 = pages[3];

  const agreementFields = [
    { name: 'agreement_date', y: 598, label: 'Agreement Date' },
    { name: 'original_wayleave_date', y: 578, label: 'Original Wayleave Date' },
    { name: 'wayleave_area', y: 558, label: 'Wayleave Area' },
    { name: 'municipality_name', y: 538, label: 'Municipality/Grantor' },
    { name: 'purchase_price', y: 518, label: 'Purchase Price (R)' },
  ];

  for (const f of agreementFields) {
    const tf = form.createTextField(f.name);
    tf.addToPage(page4, {
      x: tableFieldX,
      y: f.y,
      width: tableFieldWidth,
      height: fieldHeight,
      borderWidth: 0,
      backgroundColor: FIELD_BG,
    });
    tf.setFontSize(9);
  }

  // Note: Domicilium and signature fields removed for now
  // Focus on getting the main party/agreement tables correct first
  // Can add more fields once positioning is verified

  // Save with a different name (fillable version)
  const pdfBytes = await pdfDoc.save();
  const outputPath = path.join(__dirname, '../pdf/cession-wayleave-fillable.pdf');
  fs.writeFileSync(outputPath, pdfBytes);

  const fields = form.getFields();
  console.log(`\n✅ Fillable PDF created: ${outputPath}`);
  console.log(`   Pages: ${pages.length}`);
  console.log(`   Form fields: ${fields.length}`);
  console.log('\nFields added:');
  fields.forEach(f => console.log(`   - ${f.getName()}`));
}

createFillablePDF().catch(console.error);
