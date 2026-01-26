/**
 * Statement of Work (SOW) HTML Template
 * PRD-058: Agreement Generation
 */

export interface SOWTemplateData {
  // Header Info
  referenceNumber: string;
  effectiveDate: string;
  expiryDate: string;

  // Parties
  clientName: string;
  clientAddress?: string;
  clientContact?: string;
  contractorName: string;
  contractorAddress?: string;
  contractorContact?: string;

  // Project Details
  projectName: string;
  projectLocation?: string;
  projectDescription?: string;

  // Scope
  scopeItems: Array<{
    item: string;
    description: string;
    quantity?: number;
    unit?: string;
    unitRate?: number;
    total?: number;
  }>;

  // Financials
  totalValue: number;
  currency: string;
  paymentTerms?: string;

  // Timeline
  startDate?: string;
  endDate?: string;
  milestones?: Array<{
    name: string;
    dueDate: string;
    deliverable: string;
  }>;

  // Additional Terms
  warrantyPeriod?: string;
  retentionPercentage?: number;
  specialConditions?: string[];
}

export function generateSOWHtml(data: SOWTemplateData): string {
  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-ZA', { style: 'currency', currency: data.currency || 'ZAR' }).format(amount);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-ZA', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  };

  const scopeTotal = data.scopeItems.reduce((sum, item) => sum + (item.total || 0), 0);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Statement of Work - ${data.referenceNumber}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-size: 11pt;
      line-height: 1.5;
      color: #1f2937;
      padding: 40px 50px;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 3px solid #2563eb;
    }

    .logo-section h1 {
      font-size: 24pt;
      color: #2563eb;
      margin-bottom: 5px;
    }

    .logo-section p {
      color: #6b7280;
      font-size: 10pt;
    }

    .reference-section {
      text-align: right;
    }

    .reference-section .ref-number {
      font-size: 14pt;
      font-weight: bold;
      color: #1f2937;
    }

    .reference-section .ref-date {
      color: #6b7280;
      font-size: 10pt;
    }

    .document-title {
      text-align: center;
      margin: 30px 0;
    }

    .document-title h2 {
      font-size: 18pt;
      color: #1f2937;
      text-transform: uppercase;
      letter-spacing: 2px;
    }

    .parties-section {
      display: flex;
      gap: 40px;
      margin: 30px 0;
    }

    .party-box {
      flex: 1;
      padding: 20px;
      background: #f9fafb;
      border-radius: 8px;
      border-left: 4px solid #2563eb;
    }

    .party-box h3 {
      font-size: 10pt;
      text-transform: uppercase;
      color: #6b7280;
      margin-bottom: 10px;
    }

    .party-box .party-name {
      font-size: 14pt;
      font-weight: bold;
      color: #1f2937;
      margin-bottom: 5px;
    }

    .party-box .party-details {
      font-size: 10pt;
      color: #4b5563;
    }

    .section {
      margin: 30px 0;
    }

    .section-title {
      font-size: 12pt;
      font-weight: bold;
      color: #2563eb;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 15px;
      padding-bottom: 8px;
      border-bottom: 1px solid #e5e7eb;
    }

    .project-info {
      background: #eff6ff;
      padding: 20px;
      border-radius: 8px;
    }

    .project-info h4 {
      font-size: 14pt;
      color: #1f2937;
      margin-bottom: 10px;
    }

    .project-info p {
      color: #4b5563;
      margin-bottom: 5px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 15px 0;
    }

    table th {
      background: #2563eb;
      color: white;
      padding: 12px 15px;
      text-align: left;
      font-size: 10pt;
      text-transform: uppercase;
    }

    table td {
      padding: 12px 15px;
      border-bottom: 1px solid #e5e7eb;
    }

    table tr:nth-child(even) {
      background: #f9fafb;
    }

    table .number {
      text-align: right;
    }

    .totals-row {
      background: #1f2937 !important;
      color: white;
      font-weight: bold;
    }

    .totals-row td {
      border-bottom: none;
    }

    .financial-summary {
      background: #fef3c7;
      padding: 20px;
      border-radius: 8px;
      margin: 20px 0;
    }

    .financial-summary .total-label {
      font-size: 10pt;
      color: #92400e;
      text-transform: uppercase;
    }

    .financial-summary .total-value {
      font-size: 24pt;
      font-weight: bold;
      color: #92400e;
    }

    .terms-list {
      list-style: none;
      padding: 0;
    }

    .terms-list li {
      padding: 10px 0;
      padding-left: 25px;
      position: relative;
      border-bottom: 1px solid #e5e7eb;
    }

    .terms-list li:before {
      content: "✓";
      position: absolute;
      left: 0;
      color: #2563eb;
      font-weight: bold;
    }

    .signature-section {
      display: flex;
      gap: 40px;
      margin-top: 50px;
      padding-top: 30px;
      border-top: 2px solid #e5e7eb;
    }

    .signature-box {
      flex: 1;
    }

    .signature-box h4 {
      font-size: 10pt;
      text-transform: uppercase;
      color: #6b7280;
      margin-bottom: 60px;
    }

    .signature-line {
      border-top: 1px solid #1f2937;
      padding-top: 10px;
    }

    .signature-line p {
      font-size: 10pt;
      color: #6b7280;
    }

    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      font-size: 9pt;
      color: #9ca3af;
    }

    @media print {
      body {
        padding: 20px;
      }

      .signature-section {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo-section">
      <h1>VelocityFibre</h1>
      <p>Fiber Network Solutions</p>
    </div>
    <div class="reference-section">
      <div class="ref-number">${data.referenceNumber}</div>
      <div class="ref-date">Effective: ${formatDate(data.effectiveDate)}</div>
      ${data.expiryDate ? `<div class="ref-date">Expires: ${formatDate(data.expiryDate)}</div>` : ''}
    </div>
  </div>

  <div class="document-title">
    <h2>Statement of Work</h2>
  </div>

  <div class="parties-section">
    <div class="party-box">
      <h3>Client</h3>
      <div class="party-name">${data.clientName}</div>
      <div class="party-details">
        ${data.clientAddress ? `<p>${data.clientAddress}</p>` : ''}
        ${data.clientContact ? `<p>Contact: ${data.clientContact}</p>` : ''}
      </div>
    </div>
    <div class="party-box">
      <h3>Contractor</h3>
      <div class="party-name">${data.contractorName}</div>
      <div class="party-details">
        ${data.contractorAddress ? `<p>${data.contractorAddress}</p>` : ''}
        ${data.contractorContact ? `<p>Contact: ${data.contractorContact}</p>` : ''}
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Project Details</div>
    <div class="project-info">
      <h4>${data.projectName}</h4>
      ${data.projectLocation ? `<p><strong>Location:</strong> ${data.projectLocation}</p>` : ''}
      ${data.projectDescription ? `<p><strong>Description:</strong> ${data.projectDescription}</p>` : ''}
      ${data.startDate || data.endDate ? `
        <p><strong>Duration:</strong> ${formatDate(data.startDate || '')} to ${formatDate(data.endDate || '')}</p>
      ` : ''}
    </div>
  </div>

  <div class="section">
    <div class="section-title">Scope of Work</div>
    <table>
      <thead>
        <tr>
          <th style="width: 5%">#</th>
          <th style="width: 25%">Item</th>
          <th style="width: 30%">Description</th>
          <th style="width: 10%" class="number">Qty</th>
          <th style="width: 10%">Unit</th>
          <th style="width: 10%" class="number">Rate</th>
          <th style="width: 10%" class="number">Total</th>
        </tr>
      </thead>
      <tbody>
        ${data.scopeItems.map((item, index) => `
          <tr>
            <td>${index + 1}</td>
            <td><strong>${item.item}</strong></td>
            <td>${item.description}</td>
            <td class="number">${item.quantity || '—'}</td>
            <td>${item.unit || '—'}</td>
            <td class="number">${item.unitRate ? formatCurrency(item.unitRate) : '—'}</td>
            <td class="number">${item.total ? formatCurrency(item.total) : '—'}</td>
          </tr>
        `).join('')}
        <tr class="totals-row">
          <td colspan="6" style="text-align: right;"><strong>TOTAL</strong></td>
          <td class="number"><strong>${formatCurrency(scopeTotal || data.totalValue)}</strong></td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="financial-summary">
    <div class="total-label">Contract Value (Excl. VAT)</div>
    <div class="total-value">${formatCurrency(data.totalValue)}</div>
    ${data.paymentTerms ? `<p style="margin-top: 10px; color: #92400e;"><strong>Payment Terms:</strong> ${data.paymentTerms}</p>` : ''}
  </div>

  ${data.milestones && data.milestones.length > 0 ? `
  <div class="section">
    <div class="section-title">Project Milestones</div>
    <table>
      <thead>
        <tr>
          <th style="width: 30%">Milestone</th>
          <th style="width: 20%">Due Date</th>
          <th style="width: 50%">Deliverable</th>
        </tr>
      </thead>
      <tbody>
        ${data.milestones.map(milestone => `
          <tr>
            <td><strong>${milestone.name}</strong></td>
            <td>${formatDate(milestone.dueDate)}</td>
            <td>${milestone.deliverable}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
  ` : ''}

  <div class="section">
    <div class="section-title">Terms & Conditions</div>
    <ul class="terms-list">
      ${data.warrantyPeriod ? `<li><strong>Warranty Period:</strong> ${data.warrantyPeriod}</li>` : ''}
      ${data.retentionPercentage ? `<li><strong>Retention:</strong> ${data.retentionPercentage}% of contract value to be held for defects liability period</li>` : ''}
      <li>All work shall be performed in accordance with applicable regulations and standards</li>
      <li>Contractor shall maintain appropriate insurance coverage throughout the project</li>
      <li>Any variations to scope must be approved in writing before commencement</li>
      ${data.specialConditions ? data.specialConditions.map(cond => `<li>${cond}</li>`).join('') : ''}
    </ul>
  </div>

  <div class="signature-section">
    <div class="signature-box">
      <h4>For and on behalf of the Client</h4>
      <div class="signature-line">
        <p>Signature</p>
      </div>
      <br/>
      <div class="signature-line">
        <p>Name & Title</p>
      </div>
      <br/>
      <div class="signature-line">
        <p>Date</p>
      </div>
    </div>
    <div class="signature-box">
      <h4>For and on behalf of the Contractor</h4>
      <div class="signature-line">
        <p>Signature</p>
      </div>
      <br/>
      <div class="signature-line">
        <p>Name & Title</p>
      </div>
      <br/>
      <div class="signature-line">
        <p>Date</p>
      </div>
    </div>
  </div>

  <div class="footer">
    <p>This Statement of Work is subject to the Master Build Agreement between the parties.</p>
    <p>Generated by FibreFlow • ${new Date().toLocaleDateString('en-ZA')}</p>
  </div>
</body>
</html>
`;
}
