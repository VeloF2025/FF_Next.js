import { PDFDocument, StandardFonts, rgb, PDFTextField } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Velocity Fibre brand colors
const COLORS = {
  navy: rgb(2/255, 48/255, 71/255),      // #023047
  teal: rgb(33/255, 158/255, 188/255),   // #219ebc
  body: rgb(60/255, 58/255, 71/255),     // #3c3a47
  gray: rgb(102/255, 102/255, 102/255),  // #666666
  lightGray: rgb(249/255, 249/255, 249/255), // #f9f9f9
  white: rgb(1, 1, 1),
  black: rgb(0, 0, 0),
};

// Form field definitions with positions (x, y, width, height)
const FORM_FIELDS = [
  // Page 1 - Cover (no fields)

  // Page 2 - Parties
  { name: 'cedent_name_header', page: 1, x: 72, y: 650, width: 400, height: 18, label: 'Cedent Name' },

  // Page 3 - Cedent Details
  { name: 'cedent_full_name', page: 2, x: 200, y: 680, width: 300, height: 16, label: 'Full Legal Name' },
  { name: 'cedent_reg_no', page: 2, x: 200, y: 656, width: 300, height: 16, label: 'Registration Number' },
  { name: 'cedent_address', page: 2, x: 200, y: 632, width: 300, height: 16, label: 'Registered Address' },
  { name: 'cedent_rep_name', page: 2, x: 200, y: 608, width: 300, height: 16, label: 'Represented By' },
  { name: 'cedent_rep_id', page: 2, x: 200, y: 584, width: 300, height: 16, label: 'ID Number' },
  { name: 'cedent_email', page: 2, x: 200, y: 560, width: 300, height: 16, label: 'Email' },
  { name: 'cedent_phone', page: 2, x: 200, y: 536, width: 300, height: 16, label: 'Phone' },

  // Cessionary Details
  { name: 'vf_reg_no', page: 2, x: 200, y: 450, width: 300, height: 16, label: 'VF Registration No' },
  { name: 'vf_address', page: 2, x: 200, y: 426, width: 300, height: 16, label: 'VF Address' },
  { name: 'vf_rep_name', page: 2, x: 200, y: 402, width: 300, height: 16, label: 'VF Representative' },
  { name: 'vf_rep_id', page: 2, x: 200, y: 378, width: 300, height: 16, label: 'VF Rep ID' },
  { name: 'vf_email', page: 2, x: 200, y: 354, width: 300, height: 16, label: 'VF Email' },
  { name: 'vf_phone', page: 2, x: 200, y: 330, width: 300, height: 16, label: 'VF Phone' },

  // Agreement Details
  { name: 'agreement_date', page: 2, x: 200, y: 260, width: 300, height: 16, label: 'Agreement Date' },
  { name: 'original_wayleave_date', page: 2, x: 200, y: 236, width: 300, height: 16, label: 'Original Wayleave Date' },
  { name: 'wayleave_area', page: 2, x: 200, y: 212, width: 300, height: 16, label: 'Wayleave Area' },
  { name: 'municipality_name', page: 2, x: 200, y: 188, width: 300, height: 16, label: 'Municipality' },
  { name: 'purchase_price', page: 2, x: 200, y: 164, width: 300, height: 16, label: 'Purchase Price (R)' },
];

async function createFillablePDF() {
  // Read the existing PDF
  const existingPdfPath = path.join(__dirname, '../pdf/cession-wayleave-template.pdf');
  const existingPdfBytes = fs.readFileSync(existingPdfPath);

  // Load the PDF
  const pdfDoc = await PDFDocument.load(existingPdfBytes);

  // Get the form
  const form = pdfDoc.getForm();

  // Get fonts
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Get pages
  const pages = pdfDoc.getPages();

  // Create a new fillable PDF from scratch with proper form fields
  const newPdf = await PDFDocument.create();

  // Embed fonts
  const font = await newPdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await newPdf.embedFont(StandardFonts.HelveticaBold);

  // Page dimensions
  const pageWidth = 595.28;  // A4
  const pageHeight = 841.89;
  const margin = 50;
  const contentWidth = pageWidth - (2 * margin);

  // ============ PAGE 1: COVER ============
  let page = newPdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - 200;

  // Embed the actual Velocity logo
  const logoPath = path.join(__dirname, '../assets/velocity-logo.jpg');
  const logoBytes = fs.readFileSync(logoPath);
  const logoImage = await newPdf.embedJpg(logoBytes);
  const logoDims = logoImage.scale(0.35); // Scale to fit nicely

  page.drawImage(logoImage, {
    x: pageWidth/2 - logoDims.width/2,
    y: y - 20,
    width: logoDims.width,
    height: logoDims.height,
  });

  y -= 80;

  // Title
  page.drawText('CESSION OF WAYLEAVE', {
    x: pageWidth/2 - 130,
    y: y,
    size: 28,
    font: fontBold,
    color: COLORS.navy,
  });

  y -= 35;
  page.drawText('AGREEMENT', {
    x: pageWidth/2 - 70,
    y: y,
    size: 28,
    font: fontBold,
    color: COLORS.navy,
  });

  y -= 30;

  // Divider
  page.drawRectangle({
    x: pageWidth/2 - 50,
    y: y,
    width: 100,
    height: 3,
    color: COLORS.teal,
  });

  y -= 50;
  page.drawText('FILLABLE TEMPLATE', {
    x: pageWidth/2 - 65,
    y: y,
    size: 14,
    font: font,
    color: COLORS.teal,
  });

  y -= 80;

  // Metadata
  const metadata = [
    ['Document Type:', 'Contract Template'],
    ['Version:', '1.0 (Fillable)'],
    ['Date:', 'January 2026'],
    ['Classification:', 'Confidential'],
  ];

  for (const [label, value] of metadata) {
    page.drawText(label, {
      x: pageWidth/2 - 80,
      y: y,
      size: 10,
      font: fontBold,
      color: COLORS.navy,
    });
    page.drawText(value, {
      x: pageWidth/2 + 20,
      y: y,
      size: 10,
      font: font,
      color: COLORS.body,
    });
    y -= 20;
  }

  // Footer
  page.drawRectangle({
    x: margin,
    y: 80,
    width: contentWidth,
    height: 2,
    color: COLORS.teal,
  });
  page.drawText('Velocity Fibre (Pty) Ltd — Fibre Network Operator', {
    x: pageWidth/2 - 120,
    y: 60,
    size: 9,
    font: font,
    color: COLORS.gray,
  });

  // ============ PAGE 2: PARTIES ============
  page = newPdf.addPage([pageWidth, pageHeight]);
  y = pageHeight - margin;

  // Header
  page.drawRectangle({
    x: margin,
    y: y - 25,
    width: contentWidth,
    height: 25,
    color: COLORS.navy,
  });
  page.drawText('1. PARTIES AND AGREEMENT DETAILS', {
    x: margin + 10,
    y: y - 18,
    size: 12,
    font: fontBold,
    color: COLORS.white,
  });

  y -= 60;

  // THE CEDENT section
  page.drawText('THE CEDENT', {
    x: margin,
    y: y,
    size: 14,
    font: fontBold,
    color: COLORS.navy,
  });
  page.drawRectangle({
    x: margin,
    y: y - 5,
    width: 100,
    height: 2,
    color: COLORS.teal,
  });

  y -= 35;

  // Form fields for Cedent
  const cedentFields = [
    { name: 'cedent_full_name', label: 'Full Legal Name' },
    { name: 'cedent_reg_no', label: 'Registration Number' },
    { name: 'cedent_address', label: 'Registered Address' },
    { name: 'cedent_rep_name', label: 'Represented By' },
    { name: 'cedent_rep_id', label: 'Identity Number' },
    { name: 'cedent_email', label: 'Contact Email' },
    { name: 'cedent_phone', label: 'Contact Number' },
  ];

  const newForm = newPdf.getForm();

  for (const field of cedentFields) {
    // Label
    page.drawText(field.label + ':', {
      x: margin,
      y: y,
      size: 10,
      font: font,
      color: COLORS.body,
    });

    // Text field
    const textField = newForm.createTextField(field.name);
    textField.addToPage(page, {
      x: margin + 150,
      y: y - 5,
      width: 300,
      height: 18,
      borderColor: COLORS.teal,
      backgroundColor: COLORS.lightGray,
    });
    textField.setFontSize(10);

    y -= 28;
  }

  y -= 20;

  // THE CESSIONARY section
  page.drawText('THE CESSIONARY', {
    x: margin,
    y: y,
    size: 14,
    font: fontBold,
    color: COLORS.navy,
  });
  page.drawRectangle({
    x: margin,
    y: y - 5,
    width: 130,
    height: 2,
    color: COLORS.teal,
  });

  y -= 35;

  // Pre-filled Velocity Fibre
  page.drawText('Full Legal Name:', {
    x: margin,
    y: y,
    size: 10,
    font: font,
    color: COLORS.body,
  });
  page.drawText('VELOCITY FIBRE (PTY) LTD', {
    x: margin + 150,
    y: y,
    size: 10,
    font: fontBold,
    color: COLORS.navy,
  });

  y -= 28;

  const vfFields = [
    { name: 'vf_reg_no', label: 'Registration Number' },
    { name: 'vf_address', label: 'Registered Address' },
    { name: 'vf_rep_name', label: 'Represented By' },
    { name: 'vf_rep_id', label: 'Identity Number' },
    { name: 'vf_email', label: 'Contact Email' },
    { name: 'vf_phone', label: 'Contact Number' },
  ];

  for (const field of vfFields) {
    page.drawText(field.label + ':', {
      x: margin,
      y: y,
      size: 10,
      font: font,
      color: COLORS.body,
    });

    const textField = newForm.createTextField(field.name);
    textField.addToPage(page, {
      x: margin + 150,
      y: y - 5,
      width: 300,
      height: 18,
      borderColor: COLORS.teal,
      backgroundColor: COLORS.lightGray,
    });
    textField.setFontSize(10);

    y -= 28;
  }

  // ============ PAGE 3: AGREEMENT DETAILS ============
  page = newPdf.addPage([pageWidth, pageHeight]);
  y = pageHeight - margin;

  // Header
  page.drawRectangle({
    x: margin,
    y: y - 25,
    width: contentWidth,
    height: 25,
    color: COLORS.navy,
  });
  page.drawText('AGREEMENT DETAILS', {
    x: margin + 10,
    y: y - 18,
    size: 12,
    font: fontBold,
    color: COLORS.white,
  });

  y -= 60;

  const agreementFields = [
    { name: 'agreement_date', label: 'Agreement Date' },
    { name: 'original_wayleave_date', label: 'Original Wayleave Date' },
    { name: 'wayleave_area', label: 'Wayleave Area', multiline: true },
    { name: 'municipality_name', label: 'Municipality/Grantor' },
    { name: 'purchase_price', label: 'Purchase Price (R)' },
    { name: 'consent_date', label: 'Grantor Consent Date' },
  ];

  for (const field of agreementFields) {
    page.drawText(field.label + ':', {
      x: margin,
      y: y,
      size: 10,
      font: font,
      color: COLORS.body,
    });

    const textField = newForm.createTextField(field.name);
    const height = field.multiline ? 40 : 18;
    textField.addToPage(page, {
      x: margin + 180,
      y: y - (field.multiline ? 25 : 5),
      width: 280,
      height: height,
      borderColor: COLORS.teal,
      backgroundColor: COLORS.lightGray,
    });
    textField.setFontSize(10);
    if (field.multiline) textField.enableMultiline();

    y -= (field.multiline ? 55 : 28);
  }

  y -= 30;

  // Payment Details section
  page.drawText('PAYMENT DETAILS', {
    x: margin,
    y: y,
    size: 14,
    font: fontBold,
    color: COLORS.navy,
  });
  page.drawRectangle({
    x: margin,
    y: y - 5,
    width: 140,
    height: 2,
    color: COLORS.teal,
  });

  y -= 35;

  const paymentFields = [
    { name: 'deposit_amount', label: 'Deposit Amount (R)' },
    { name: 'deposit_days', label: 'Deposit Due (days)' },
    { name: 'balance_amount', label: 'Balance Amount (R)' },
    { name: 'bank_name', label: 'Bank Name' },
    { name: 'account_number', label: 'Account Number' },
    { name: 'branch_code', label: 'Branch Code' },
  ];

  for (const field of paymentFields) {
    page.drawText(field.label + ':', {
      x: margin,
      y: y,
      size: 10,
      font: font,
      color: COLORS.body,
    });

    const textField = newForm.createTextField(field.name);
    textField.addToPage(page, {
      x: margin + 180,
      y: y - 5,
      width: 200,
      height: 18,
      borderColor: COLORS.teal,
      backgroundColor: COLORS.lightGray,
    });
    textField.setFontSize(10);

    y -= 28;
  }

  // ============ PAGE 4: INFRASTRUCTURE STATUS ============
  page = newPdf.addPage([pageWidth, pageHeight]);
  y = pageHeight - margin;

  page.drawRectangle({
    x: margin,
    y: y - 25,
    width: contentWidth,
    height: 25,
    color: COLORS.navy,
  });
  page.drawText('INFRASTRUCTURE STATUS', {
    x: margin + 10,
    y: y - 18,
    size: 12,
    font: fontBold,
    color: COLORS.white,
  });

  y -= 60;

  page.drawText('Select one option:', {
    x: margin,
    y: y,
    size: 10,
    font: fontBold,
    color: COLORS.body,
  });

  y -= 30;

  // Option A checkbox
  const optionA = newForm.createCheckBox('option_a_no_infrastructure');
  optionA.addToPage(page, {
    x: margin,
    y: y - 5,
    width: 15,
    height: 15,
    borderColor: COLORS.teal,
  });
  page.drawText('OPTION A — No Infrastructure Installed', {
    x: margin + 25,
    y: y,
    size: 10,
    font: fontBold,
    color: COLORS.navy,
  });

  y -= 20;
  page.drawText('No physical infrastructure has been installed by the Cedent.', {
    x: margin + 25,
    y: y,
    size: 9,
    font: font,
    color: COLORS.gray,
  });

  y -= 35;

  // Option B checkbox
  const optionB = newForm.createCheckBox('option_b_infrastructure_installed');
  optionB.addToPage(page, {
    x: margin,
    y: y - 5,
    width: 15,
    height: 15,
    borderColor: COLORS.teal,
  });
  page.drawText('OPTION B — Infrastructure Installed', {
    x: margin + 25,
    y: y,
    size: 10,
    font: fontBold,
    color: COLORS.navy,
  });

  y -= 20;
  page.drawText('Infrastructure has been installed as described in Annexure C.', {
    x: margin + 25,
    y: y,
    size: 9,
    font: font,
    color: COLORS.gray,
  });

  y -= 50;

  // Renewal date
  page.drawText('WAYLEAVE VALIDITY', {
    x: margin,
    y: y,
    size: 14,
    font: fontBold,
    color: COLORS.navy,
  });
  page.drawRectangle({
    x: margin,
    y: y - 5,
    width: 140,
    height: 2,
    color: COLORS.teal,
  });

  y -= 35;

  page.drawText('Next Renewal Date:', {
    x: margin,
    y: y,
    size: 10,
    font: font,
    color: COLORS.body,
  });

  const renewalField = newForm.createTextField('renewal_date');
  renewalField.addToPage(page, {
    x: margin + 180,
    y: y - 5,
    width: 200,
    height: 18,
    borderColor: COLORS.teal,
    backgroundColor: COLORS.lightGray,
  });
  renewalField.setFontSize(10);

  // ============ PAGE 5: DOMICILIUM ============
  page = newPdf.addPage([pageWidth, pageHeight]);
  y = pageHeight - margin;

  page.drawRectangle({
    x: margin,
    y: y - 25,
    width: contentWidth,
    height: 25,
    color: COLORS.navy,
  });
  page.drawText('DOMICILIUM CITANDI ET EXECUTANDI', {
    x: margin + 10,
    y: y - 18,
    size: 12,
    font: fontBold,
    color: COLORS.white,
  });

  y -= 60;

  page.drawText('CEDENT ADDRESS FOR NOTICES', {
    x: margin,
    y: y,
    size: 12,
    font: fontBold,
    color: COLORS.navy,
  });

  y -= 30;

  page.drawText('Physical Address:', {
    x: margin,
    y: y,
    size: 10,
    font: font,
    color: COLORS.body,
  });

  const cedentPhysical = newForm.createTextField('cedent_physical_address');
  cedentPhysical.addToPage(page, {
    x: margin + 150,
    y: y - 20,
    width: 320,
    height: 40,
    borderColor: COLORS.teal,
    backgroundColor: COLORS.lightGray,
  });
  cedentPhysical.enableMultiline();
  cedentPhysical.setFontSize(10);

  y -= 60;

  page.drawText('Email:', {
    x: margin,
    y: y,
    size: 10,
    font: font,
    color: COLORS.body,
  });

  const cedentDomEmail = newForm.createTextField('cedent_dom_email');
  cedentDomEmail.addToPage(page, {
    x: margin + 150,
    y: y - 5,
    width: 320,
    height: 18,
    borderColor: COLORS.teal,
    backgroundColor: COLORS.lightGray,
  });
  cedentDomEmail.setFontSize(10);

  y -= 50;

  page.drawText('CESSIONARY ADDRESS FOR NOTICES', {
    x: margin,
    y: y,
    size: 12,
    font: fontBold,
    color: COLORS.navy,
  });

  y -= 30;

  page.drawText('Physical Address:', {
    x: margin,
    y: y,
    size: 10,
    font: font,
    color: COLORS.body,
  });

  const vfPhysical = newForm.createTextField('vf_physical_address');
  vfPhysical.addToPage(page, {
    x: margin + 150,
    y: y - 20,
    width: 320,
    height: 40,
    borderColor: COLORS.teal,
    backgroundColor: COLORS.lightGray,
  });
  vfPhysical.enableMultiline();
  vfPhysical.setFontSize(10);

  y -= 60;

  page.drawText('Email:', {
    x: margin,
    y: y,
    size: 10,
    font: font,
    color: COLORS.body,
  });

  const vfDomEmail = newForm.createTextField('vf_dom_email');
  vfDomEmail.addToPage(page, {
    x: margin + 150,
    y: y - 5,
    width: 320,
    height: 18,
    borderColor: COLORS.teal,
    backgroundColor: COLORS.lightGray,
  });
  vfDomEmail.setFontSize(10);

  // ============ PAGE 6: SIGNATURES ============
  page = newPdf.addPage([pageWidth, pageHeight]);
  y = pageHeight - margin;

  page.drawRectangle({
    x: margin,
    y: y - 25,
    width: contentWidth,
    height: 25,
    color: COLORS.navy,
  });
  page.drawText('SIGNATURE PAGE', {
    x: margin + 10,
    y: y - 18,
    size: 12,
    font: fontBold,
    color: COLORS.white,
  });

  y -= 60;

  // Cedent signature
  page.drawText('FOR AND ON BEHALF OF THE CEDENT:', {
    x: margin,
    y: y,
    size: 12,
    font: fontBold,
    color: COLORS.navy,
  });

  y -= 30;

  page.drawText('Signed at:', {
    x: margin,
    y: y,
    size: 10,
    font: font,
    color: COLORS.body,
  });
  const cedentSignLoc = newForm.createTextField('cedent_signing_location');
  cedentSignLoc.addToPage(page, {
    x: margin + 80,
    y: y - 5,
    width: 150,
    height: 18,
    borderColor: COLORS.teal,
    backgroundColor: COLORS.lightGray,
  });

  page.drawText('on this', {
    x: margin + 240,
    y: y,
    size: 10,
    font: font,
    color: COLORS.body,
  });
  const cedentSignDay = newForm.createTextField('cedent_sign_day');
  cedentSignDay.addToPage(page, {
    x: margin + 280,
    y: y - 5,
    width: 40,
    height: 18,
    borderColor: COLORS.teal,
    backgroundColor: COLORS.lightGray,
  });

  page.drawText('day of', {
    x: margin + 330,
    y: y,
    size: 10,
    font: font,
    color: COLORS.body,
  });
  const cedentSignMonth = newForm.createTextField('cedent_sign_month');
  cedentSignMonth.addToPage(page, {
    x: margin + 370,
    y: y - 5,
    width: 80,
    height: 18,
    borderColor: COLORS.teal,
    backgroundColor: COLORS.lightGray,
  });

  page.drawText('20', {
    x: margin + 460,
    y: y,
    size: 10,
    font: font,
    color: COLORS.body,
  });
  const cedentSignYear = newForm.createTextField('cedent_sign_year');
  cedentSignYear.addToPage(page, {
    x: margin + 475,
    y: y - 5,
    width: 30,
    height: 18,
    borderColor: COLORS.teal,
    backgroundColor: COLORS.lightGray,
  });

  y -= 50;

  // Signature line
  page.drawLine({
    start: { x: margin, y: y },
    end: { x: margin + 250, y: y },
    thickness: 1,
    color: COLORS.body,
  });
  page.drawText('Signature', {
    x: margin,
    y: y - 15,
    size: 9,
    font: font,
    color: COLORS.gray,
  });

  y -= 40;

  const cedentSigFields = [
    { name: 'cedent_signatory_name', label: 'Name' },
    { name: 'cedent_signatory_capacity', label: 'Capacity' },
  ];

  for (const field of cedentSigFields) {
    page.drawText(field.label + ':', {
      x: margin,
      y: y,
      size: 10,
      font: font,
      color: COLORS.body,
    });

    const textField = newForm.createTextField(field.name);
    textField.addToPage(page, {
      x: margin + 80,
      y: y - 5,
      width: 200,
      height: 18,
      borderColor: COLORS.teal,
      backgroundColor: COLORS.lightGray,
    });
    textField.setFontSize(10);

    y -= 28;
  }

  y -= 30;

  // VF signature
  page.drawText('FOR AND ON BEHALF OF VELOCITY FIBRE (PTY) LTD:', {
    x: margin,
    y: y,
    size: 12,
    font: fontBold,
    color: COLORS.navy,
  });

  y -= 30;

  page.drawText('Signed at:', {
    x: margin,
    y: y,
    size: 10,
    font: font,
    color: COLORS.body,
  });
  const vfSignLoc = newForm.createTextField('vf_signing_location');
  vfSignLoc.addToPage(page, {
    x: margin + 80,
    y: y - 5,
    width: 150,
    height: 18,
    borderColor: COLORS.teal,
    backgroundColor: COLORS.lightGray,
  });

  page.drawText('on this', {
    x: margin + 240,
    y: y,
    size: 10,
    font: font,
    color: COLORS.body,
  });
  const vfSignDay = newForm.createTextField('vf_sign_day');
  vfSignDay.addToPage(page, {
    x: margin + 280,
    y: y - 5,
    width: 40,
    height: 18,
    borderColor: COLORS.teal,
    backgroundColor: COLORS.lightGray,
  });

  page.drawText('day of', {
    x: margin + 330,
    y: y,
    size: 10,
    font: font,
    color: COLORS.body,
  });
  const vfSignMonth = newForm.createTextField('vf_sign_month');
  vfSignMonth.addToPage(page, {
    x: margin + 370,
    y: y - 5,
    width: 80,
    height: 18,
    borderColor: COLORS.teal,
    backgroundColor: COLORS.lightGray,
  });

  page.drawText('20', {
    x: margin + 460,
    y: y,
    size: 10,
    font: font,
    color: COLORS.body,
  });
  const vfSignYear = newForm.createTextField('vf_sign_year');
  vfSignYear.addToPage(page, {
    x: margin + 475,
    y: y - 5,
    width: 30,
    height: 18,
    borderColor: COLORS.teal,
    backgroundColor: COLORS.lightGray,
  });

  y -= 50;

  // Signature line
  page.drawLine({
    start: { x: margin, y: y },
    end: { x: margin + 250, y: y },
    thickness: 1,
    color: COLORS.body,
  });
  page.drawText('Signature', {
    x: margin,
    y: y - 15,
    size: 9,
    font: font,
    color: COLORS.gray,
  });

  y -= 40;

  const vfSigFields = [
    { name: 'vf_signatory_name', label: 'Name' },
    { name: 'vf_signatory_capacity', label: 'Capacity' },
  ];

  for (const field of vfSigFields) {
    page.drawText(field.label + ':', {
      x: margin,
      y: y,
      size: 10,
      font: font,
      color: COLORS.body,
    });

    const textField = newForm.createTextField(field.name);
    textField.addToPage(page, {
      x: margin + 80,
      y: y - 5,
      width: 200,
      height: 18,
      borderColor: COLORS.teal,
      backgroundColor: COLORS.lightGray,
    });
    textField.setFontSize(10);

    y -= 28;
  }

  y -= 30;

  // Witnesses
  page.drawText('WITNESSES:', {
    x: margin,
    y: y,
    size: 12,
    font: fontBold,
    color: COLORS.navy,
  });

  y -= 40;

  // Witness 1
  page.drawText('1.', {
    x: margin,
    y: y,
    size: 10,
    font: fontBold,
    color: COLORS.body,
  });
  page.drawLine({
    start: { x: margin + 20, y: y - 10 },
    end: { x: margin + 200, y: y - 10 },
    thickness: 1,
    color: COLORS.body,
  });
  page.drawText('Name:', {
    x: margin + 220,
    y: y,
    size: 10,
    font: font,
    color: COLORS.body,
  });
  const witness1 = newForm.createTextField('witness_1_name');
  witness1.addToPage(page, {
    x: margin + 260,
    y: y - 5,
    width: 150,
    height: 18,
    borderColor: COLORS.teal,
    backgroundColor: COLORS.lightGray,
  });

  y -= 40;

  // Witness 2
  page.drawText('2.', {
    x: margin,
    y: y,
    size: 10,
    font: fontBold,
    color: COLORS.body,
  });
  page.drawLine({
    start: { x: margin + 20, y: y - 10 },
    end: { x: margin + 200, y: y - 10 },
    thickness: 1,
    color: COLORS.body,
  });
  page.drawText('Name:', {
    x: margin + 220,
    y: y,
    size: 10,
    font: font,
    color: COLORS.body,
  });
  const witness2 = newForm.createTextField('witness_2_name');
  witness2.addToPage(page, {
    x: margin + 260,
    y: y - 5,
    width: 150,
    height: 18,
    borderColor: COLORS.teal,
    backgroundColor: COLORS.lightGray,
  });

  // ============ PAGE 7: ANNEXURES CHECKLIST ============
  page = newPdf.addPage([pageWidth, pageHeight]);
  y = pageHeight - margin;

  page.drawRectangle({
    x: margin,
    y: y - 25,
    width: contentWidth,
    height: 25,
    color: COLORS.navy,
  });
  page.drawText('ANNEXURES CHECKLIST', {
    x: margin + 10,
    y: y - 18,
    size: 12,
    font: fontBold,
    color: COLORS.white,
  });

  y -= 60;

  page.drawText('Tick each annexure when attached:', {
    x: margin,
    y: y,
    size: 10,
    font: font,
    color: COLORS.body,
  });

  y -= 30;

  const annexures = [
    { id: 'annexure_a', label: 'Annexure A', desc: 'Original Wayleave Agreement' },
    { id: 'annexure_b', label: 'Annexure B', desc: 'Grantor Consent Letter' },
    { id: 'annexure_c', label: 'Annexure C', desc: 'Infrastructure As-Built Schedule' },
    { id: 'annexure_d', label: 'Annexure D', desc: 'Municipal Rates Clearance Certificate' },
    { id: 'annexure_e', label: 'Annexure E', desc: 'Cedent Solvency Certificate' },
    { id: 'annexure_f', label: 'Annexure F', desc: 'Regulatory Approvals' },
    { id: 'annexure_g', label: 'Annexure G', desc: 'Municipal Contact List' },
  ];

  for (const ann of annexures) {
    const checkbox = newForm.createCheckBox(ann.id);
    checkbox.addToPage(page, {
      x: margin,
      y: y - 5,
      width: 15,
      height: 15,
      borderColor: COLORS.teal,
    });

    page.drawText(ann.label, {
      x: margin + 25,
      y: y,
      size: 10,
      font: fontBold,
      color: COLORS.navy,
    });

    page.drawText('— ' + ann.desc, {
      x: margin + 100,
      y: y,
      size: 10,
      font: font,
      color: COLORS.body,
    });

    y -= 30;
  }

  // Add page numbers to all pages
  const allPages = newPdf.getPages();
  for (let i = 0; i < allPages.length; i++) {
    const pg = allPages[i];

    // Header line
    pg.drawLine({
      start: { x: margin, y: pageHeight - 30 },
      end: { x: pageWidth - margin, y: pageHeight - 30 },
      thickness: 1,
      color: COLORS.teal,
    });

    if (i > 0) { // Skip cover page
      pg.drawText('VELOCITY FIBRE', {
        x: margin,
        y: pageHeight - 25,
        size: 8,
        font: fontBold,
        color: COLORS.navy,
      });
      pg.drawText('Cession of Wayleave Agreement', {
        x: pageWidth - margin - 140,
        y: pageHeight - 25,
        size: 8,
        font: font,
        color: COLORS.gray,
      });
    }

    // Footer
    pg.drawLine({
      start: { x: margin, y: 40 },
      end: { x: pageWidth - margin, y: 40 },
      thickness: 1,
      color: COLORS.teal,
    });
    pg.drawText('Confidential — Velocity Fibre (Pty) Ltd', {
      x: margin,
      y: 28,
      size: 8,
      font: font,
      color: COLORS.gray,
    });
    pg.drawText(`Page ${i + 1} of ${allPages.length}`, {
      x: pageWidth - margin - 60,
      y: 28,
      size: 8,
      font: font,
      color: COLORS.gray,
    });
  }

  // Save the PDF
  const pdfBytes = await newPdf.save();
  const outputPath = path.join(__dirname, '../pdf/cession-wayleave-fillable.pdf');
  fs.writeFileSync(outputPath, pdfBytes);

  console.log(`✅ Fillable PDF created: ${outputPath}`);
  console.log(`   Pages: ${allPages.length}`);
  console.log(`   Form fields: ${newForm.getFields().length}`);
}

createFillablePDF().catch(console.error);
