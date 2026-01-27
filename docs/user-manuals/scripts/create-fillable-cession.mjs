import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Velocity Fibre brand colors
const COLORS = {
  navy: rgb(2/255, 48/255, 71/255),
  teal: rgb(33/255, 158/255, 188/255),
  body: rgb(60/255, 58/255, 71/255),
  gray: rgb(102/255, 102/255, 102/255),
  lightGray: rgb(249/255, 249/255, 249/255),
  white: rgb(1, 1, 1),
};

// Pre-filled Velocity Fibre details (from CIPC COR14.3)
const VF_DETAILS = {
  name: 'VELOCITY FIBRE (PTY) LTD',
  regNo: '2025/238946/07',
  taxNo: '9055917307',
  address: '26 Centenary Road, Lorraine, Gqeberha, 6070',
  email: 'info@velocityfibre.co.za',
  phone: '041-012 5010',
  signatory: 'Llewelyn Hofmeyr',
  capacity: 'Managing Director',
};

async function createFillablePDF() {
  // Load the full branded PDF that has all the legal content
  const sourcePdfPath = path.join(__dirname, '../pdf/cession-wayleave-template.pdf');
  const sourcePdfBytes = fs.readFileSync(sourcePdfPath);
  const pdfDoc = await PDFDocument.load(sourcePdfBytes);

  // Get form and fonts
  const form = pdfDoc.getForm();
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pages = pdfDoc.getPages();
  console.log(`Loaded PDF with ${pages.length} pages`);

  // Page dimensions (A4)
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 50;

  // ============================================================
  // ADD FILLABLE FORM FIELDS TO EXISTING PAGES
  // The source PDF already has all the legal content with
  // placeholder markers like [CEDENT_NAME], [PURCHASE_PRICE], etc.
  // We'll add form fields at strategic positions.
  // ============================================================

  // PAGE 3 (index 2) - Parties and Agreement Details tables
  // This page has the party details tables - we need to add fields
  if (pages.length > 2) {
    const page3 = pages[2];

    // Cedent details table - right column positions (approximately)
    const tableRightCol = 280;
    const tableWidth = 250;
    const rowHeight = 18;

    // Note: The exact Y positions depend on the PDF layout
    // These are approximate positions for the tables on page 3

    // We'll create text fields that overlay the placeholder text
    // Cedent section starts around Y=680
    let y = 545; // Approximate starting Y for Cedent table

    const cedentFields = [
      'cedent_name',
      'cedent_reg_no',
      'cedent_address',
      'cedent_rep_name',
      'cedent_rep_id',
      'cedent_email',
      'cedent_phone',
    ];

    for (const fieldName of cedentFields) {
      const textField = form.createTextField(fieldName);
      textField.addToPage(page3, {
        x: tableRightCol,
        y: y,
        width: tableWidth,
        height: rowHeight,
        borderWidth: 0,
        backgroundColor: rgb(1, 1, 0.9), // Light yellow for fillable
      });
      textField.setFontSize(9);
      y -= 24;
    }
  }

  // PAGE 4 (index 3) - Agreement Details table
  if (pages.length > 3) {
    const page4 = pages[3];
    const tableRightCol = 280;
    const tableWidth = 250;

    let y = 700;

    // Agreement details fields
    const agreementFields = [
      { name: 'agreement_date', y: 700 },
      { name: 'original_wayleave_date', y: 676 },
      { name: 'wayleave_area', y: 652 },
      { name: 'municipality_name', y: 628 },
      { name: 'purchase_price', y: 604 },
    ];

    for (const field of agreementFields) {
      const textField = form.createTextField(field.name);
      textField.addToPage(page4, {
        x: tableRightCol,
        y: field.y,
        width: tableWidth,
        height: 18,
        borderWidth: 0,
        backgroundColor: rgb(1, 1, 0.9),
      });
      textField.setFontSize(9);
    }
  }

  // Save the modified PDF
  const pdfBytes = await pdfDoc.save();
  const outputPath = path.join(__dirname, '../pdf/cession-wayleave-fillable.pdf');
  fs.writeFileSync(outputPath, pdfBytes);

  console.log(`✅ Fillable PDF created: ${outputPath}`);
  console.log(`   Pages: ${pages.length}`);
  console.log(`   Form fields: ${form.getFields().length}`);
}

createFillablePDF().catch(console.error);
