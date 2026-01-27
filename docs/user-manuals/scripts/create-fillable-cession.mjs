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

  // Field dimensions
  const fieldHeight = 14;
  const tableFieldX = 255;  // Right column of tables
  const tableFieldWidth = 280;

  // ============================================================
  // PAGE 3 (index 2) - Cedent Party Table
  // The table starts around Y=580 from bottom
  // ============================================================
  const page3 = pages[2];

  const cedentFields = [
    { name: 'cedent_name', y: 528, label: 'Cedent Name' },
    { name: 'cedent_reg_no', y: 510, label: 'Registration Number' },
    { name: 'cedent_address', y: 492, label: 'Registered Address' },
    { name: 'cedent_rep_name', y: 474, label: 'Representative Name' },
    { name: 'cedent_rep_id', y: 456, label: 'ID Number' },
    { name: 'cedent_email', y: 438, label: 'Email' },
    { name: 'cedent_phone', y: 420, label: 'Phone' },
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
  // PAGE 3 (index 2) - Agreement Details Table (below parties)
  // ============================================================
  const agreementFields = [
    { name: 'agreement_date', y: 254, label: 'Agreement Date' },
    { name: 'original_wayleave_date', y: 236, label: 'Original Wayleave Date' },
    { name: 'wayleave_area', y: 218, label: 'Wayleave Area' },
    { name: 'municipality_name', y: 200, label: 'Municipality/Grantor' },
    { name: 'purchase_price', y: 182, label: 'Purchase Price (R)' },
  ];

  for (const f of agreementFields) {
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

  // Consent date field (in recitals)
  const consentDateField = form.createTextField('consent_date');
  consentDateField.addToPage(page3, {
    x: tableFieldX,
    y: 164,
    width: 120,
    height: fieldHeight,
    borderWidth: 0,
    backgroundColor: FIELD_BG,
  });
  consentDateField.setFontSize(9);

  // ============================================================
  // PAGE 12-13 - Domicilium (Cedent section) - Adjust based on actual page
  // ============================================================
  if (pages.length >= 11) {
    const domPage = pages[10]; // Page 11 (index 10)

    const domFields = [
      { name: 'cedent_dom_address', y: 500, width: tableFieldWidth },
      { name: 'cedent_dom_email', y: 482, width: 200 },
    ];

    for (const f of domFields) {
      const tf = form.createTextField(f.name);
      tf.addToPage(domPage, {
        x: tableFieldX,
        y: f.y,
        width: f.width,
        height: fieldHeight,
        borderWidth: 0,
        backgroundColor: FIELD_BG,
      });
      tf.setFontSize(9);
    }
  }

  // ============================================================
  // SIGNATURE PAGES - Last pages
  // ============================================================
  if (pages.length >= 13) {
    const sigPage = pages[12]; // Page 13 (index 12)

    // Cedent signature block
    const cedentSigFields = [
      { name: 'cedent_signing_location', y: 680, x: 150, width: 150 },
      { name: 'cedent_signing_day', y: 680, x: 340, width: 30 },
      { name: 'cedent_signing_month', y: 680, x: 410, width: 80 },
      { name: 'cedent_signing_year', y: 680, x: 520, width: 40 },
      { name: 'cedent_signatory_name', y: 580, x: tableFieldX, width: 200 },
      { name: 'cedent_signatory_capacity', y: 562, x: tableFieldX, width: 200 },
      { name: 'cedent_signature_date', y: 544, x: tableFieldX, width: 120 },
    ];

    for (const f of cedentSigFields) {
      const tf = form.createTextField(f.name);
      tf.addToPage(sigPage, {
        x: f.x,
        y: f.y,
        width: f.width,
        height: fieldHeight,
        borderWidth: 0,
        backgroundColor: FIELD_BG,
      });
      tf.setFontSize(9);
    }

    // Witness fields for Cedent
    const witnessFields = [
      { name: 'cedent_witness1_name', y: 480, x: 100, width: 180 },
      { name: 'cedent_witness1_id', y: 462, x: 100, width: 140 },
      { name: 'cedent_witness2_name', y: 420, x: 100, width: 180 },
      { name: 'cedent_witness2_id', y: 402, x: 100, width: 140 },
    ];

    for (const f of witnessFields) {
      const tf = form.createTextField(f.name);
      tf.addToPage(sigPage, {
        x: f.x,
        y: f.y,
        width: f.width,
        height: fieldHeight,
        borderWidth: 0,
        backgroundColor: FIELD_BG,
      });
      tf.setFontSize(9);
    }
  }

  // VF signature page (next page)
  if (pages.length >= 14) {
    const vfSigPage = pages[13];

    const vfSigFields = [
      { name: 'vf_signing_location', y: 680, x: 150, width: 150 },
      { name: 'vf_signing_day', y: 680, x: 340, width: 30 },
      { name: 'vf_signing_month', y: 680, x: 410, width: 80 },
      { name: 'vf_signing_year', y: 680, x: 520, width: 40 },
      { name: 'vf_signature_date', y: 544, x: tableFieldX, width: 120 },
    ];

    for (const f of vfSigFields) {
      const tf = form.createTextField(f.name);
      tf.addToPage(vfSigPage, {
        x: f.x,
        y: f.y,
        width: f.width,
        height: fieldHeight,
        borderWidth: 0,
        backgroundColor: FIELD_BG,
      });
      tf.setFontSize(9);
    }

    // Witness fields for VF
    const vfWitnessFields = [
      { name: 'vf_witness1_name', y: 480, x: 100, width: 180 },
      { name: 'vf_witness1_id', y: 462, x: 100, width: 140 },
      { name: 'vf_witness2_name', y: 420, x: 100, width: 180 },
      { name: 'vf_witness2_id', y: 402, x: 100, width: 140 },
    ];

    for (const f of vfWitnessFields) {
      const tf = form.createTextField(f.name);
      tf.addToPage(vfSigPage, {
        x: f.x,
        y: f.y,
        width: f.width,
        height: fieldHeight,
        borderWidth: 0,
        backgroundColor: FIELD_BG,
      });
      tf.setFontSize(9);
    }
  }

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
