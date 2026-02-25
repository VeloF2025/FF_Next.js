/**
 * Master Build Agreement (MBA) HTML Template
 * PRD-058: Agreement Generation
 */
import { formatDisplayDateLong, formatDisplayDate } from '@/utils/dateFormat';

export interface MBATemplateData {
  // Header Info
  referenceNumber: string;
  effectiveDate: string;
  expiryDate: string;

  // Parties
  clientName: string;
  clientRegistration?: string;
  clientAddress?: string;
  clientRepresentative?: string;
  contractorName: string;
  contractorRegistration?: string;
  contractorAddress?: string;
  contractorRepresentative?: string;

  // Agreement Details
  agreementPurpose?: string;
  geographicScope?: string;

  // Financial Terms
  currency: string;
  paymentTerms: string;
  retentionPercentage?: number;
  defectsLiabilityPeriod?: string;

  // Insurance Requirements
  publicLiabilityAmount?: number;
  professionalIndemnityAmount?: number;
  workersCompRequired?: boolean;

  // Compliance
  bbbeeLevel?: string;
  taxClearanceRequired?: boolean;
  cidbGrading?: string;

  // Terms
  noticePeriod?: string;
  disputeResolution?: string;
  governingLaw?: string;

  // Schedules/Annexures
  schedules?: Array<{
    name: string;
    description: string;
  }>;
}

export function generateMBAHtml(data: MBATemplateData): string {
  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-ZA', { style: 'currency', currency: data.currency || 'ZAR' }).format(amount);

  const formatDate = (dateStr: string) => {
    return formatDisplayDateLong(dateStr, '—');
  };

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Master Build Agreement - ${data.referenceNumber}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #1f2937;
      padding: 40px 50px;
    }

    .header {
      text-align: center;
      margin-bottom: 40px;
      padding-bottom: 20px;
      border-bottom: 3px solid #1e40af;
    }

    .header h1 {
      font-size: 28pt;
      color: #1e40af;
      margin-bottom: 10px;
      text-transform: uppercase;
      letter-spacing: 3px;
    }

    .header .subtitle {
      font-size: 12pt;
      color: #6b7280;
    }

    .reference-box {
      background: #1e40af;
      color: white;
      padding: 15px 25px;
      border-radius: 8px;
      display: inline-block;
      margin: 20px 0;
    }

    .reference-box .ref-label {
      font-size: 9pt;
      text-transform: uppercase;
      opacity: 0.8;
    }

    .reference-box .ref-value {
      font-size: 16pt;
      font-weight: bold;
    }

    .parties-container {
      display: flex;
      gap: 30px;
      margin: 30px 0;
    }

    .party-card {
      flex: 1;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 25px;
    }

    .party-card .party-type {
      font-size: 10pt;
      text-transform: uppercase;
      color: #64748b;
      letter-spacing: 1px;
      margin-bottom: 15px;
    }

    .party-card .party-name {
      font-size: 16pt;
      font-weight: bold;
      color: #1e40af;
      margin-bottom: 15px;
    }

    .party-card .party-detail {
      font-size: 10pt;
      color: #475569;
      margin-bottom: 8px;
    }

    .party-card .party-detail strong {
      color: #1f2937;
    }

    .article {
      margin: 30px 0;
      page-break-inside: avoid;
    }

    .article-number {
      font-size: 10pt;
      font-weight: bold;
      color: #1e40af;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .article-title {
      font-size: 14pt;
      font-weight: bold;
      color: #1f2937;
      margin: 10px 0 15px 0;
      padding-bottom: 10px;
      border-bottom: 2px solid #e2e8f0;
    }

    .article-content {
      padding-left: 20px;
    }

    .clause {
      margin: 15px 0;
      padding-left: 25px;
      position: relative;
    }

    .clause-number {
      position: absolute;
      left: 0;
      font-weight: bold;
      color: #64748b;
    }

    .sub-clause {
      margin: 10px 0;
      padding-left: 30px;
      position: relative;
    }

    .sub-clause-marker {
      position: absolute;
      left: 0;
      color: #64748b;
    }

    .highlight-box {
      background: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 15px 20px;
      margin: 20px 0;
      border-radius: 0 8px 8px 0;
    }

    .highlight-box h4 {
      color: #92400e;
      margin-bottom: 8px;
    }

    .info-table {
      width: 100%;
      margin: 20px 0;
      border-collapse: collapse;
    }

    .info-table th {
      background: #f1f5f9;
      padding: 12px 15px;
      text-align: left;
      font-size: 10pt;
      text-transform: uppercase;
      color: #64748b;
      border-bottom: 2px solid #e2e8f0;
    }

    .info-table td {
      padding: 12px 15px;
      border-bottom: 1px solid #e2e8f0;
    }

    .info-table tr:last-child td {
      border-bottom: none;
    }

    .schedules-section {
      background: #f8fafc;
      padding: 25px;
      border-radius: 12px;
      margin: 30px 0;
    }

    .schedules-section h3 {
      color: #1e40af;
      margin-bottom: 15px;
    }

    .schedule-item {
      display: flex;
      padding: 12px 0;
      border-bottom: 1px dashed #cbd5e1;
    }

    .schedule-item:last-child {
      border-bottom: none;
    }

    .schedule-name {
      font-weight: bold;
      width: 150px;
      color: #1f2937;
    }

    .schedule-desc {
      flex: 1;
      color: #475569;
    }

    .signature-section {
      margin-top: 60px;
      page-break-inside: avoid;
    }

    .signature-section h3 {
      text-align: center;
      color: #1e40af;
      margin-bottom: 40px;
      text-transform: uppercase;
      letter-spacing: 2px;
    }

    .signature-grid {
      display: flex;
      gap: 40px;
    }

    .signature-block {
      flex: 1;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 30px;
    }

    .signature-block h4 {
      font-size: 10pt;
      text-transform: uppercase;
      color: #64748b;
      margin-bottom: 30px;
      text-align: center;
    }

    .signature-field {
      margin: 25px 0;
    }

    .signature-field .line {
      border-bottom: 1px solid #1f2937;
      height: 30px;
    }

    .signature-field .label {
      font-size: 9pt;
      color: #64748b;
      margin-top: 5px;
    }

    .footer {
      margin-top: 50px;
      padding-top: 20px;
      border-top: 1px solid #e2e8f0;
      text-align: center;
      font-size: 9pt;
      color: #9ca3af;
    }

    .page-break {
      page-break-before: always;
    }

    @media print {
      body {
        padding: 20px;
      }

      .article {
        page-break-inside: avoid;
      }

      .signature-section {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Master Build Agreement</h1>
    <p class="subtitle">For Fiber Network Construction Services</p>
    <div class="reference-box">
      <div class="ref-label">Agreement Reference</div>
      <div class="ref-value">${data.referenceNumber}</div>
    </div>
  </div>

  <div class="parties-container">
    <div class="party-card">
      <div class="party-type">The Client</div>
      <div class="party-name">${data.clientName}</div>
      ${data.clientRegistration ? `<div class="party-detail"><strong>Reg No:</strong> ${data.clientRegistration}</div>` : ''}
      ${data.clientAddress ? `<div class="party-detail"><strong>Address:</strong> ${data.clientAddress}</div>` : ''}
      ${data.clientRepresentative ? `<div class="party-detail"><strong>Representative:</strong> ${data.clientRepresentative}</div>` : ''}
    </div>
    <div class="party-card">
      <div class="party-type">The Contractor</div>
      <div class="party-name">${data.contractorName}</div>
      ${data.contractorRegistration ? `<div class="party-detail"><strong>Reg No:</strong> ${data.contractorRegistration}</div>` : ''}
      ${data.contractorAddress ? `<div class="party-detail"><strong>Address:</strong> ${data.contractorAddress}</div>` : ''}
      ${data.contractorRepresentative ? `<div class="party-detail"><strong>Representative:</strong> ${data.contractorRepresentative}</div>` : ''}
    </div>
  </div>

  <div class="highlight-box">
    <h4>Agreement Period</h4>
    <p><strong>Effective Date:</strong> ${formatDate(data.effectiveDate)}</p>
    <p><strong>Expiry Date:</strong> ${formatDate(data.expiryDate)}</p>
    ${data.geographicScope ? `<p><strong>Geographic Scope:</strong> ${data.geographicScope}</p>` : ''}
  </div>

  <!-- ARTICLE 1: INTERPRETATION -->
  <div class="article">
    <div class="article-number">Article 1</div>
    <div class="article-title">Interpretation and Definitions</div>
    <div class="article-content">
      <div class="clause">
        <span class="clause-number">1.1</span>
        In this Agreement, unless the context indicates otherwise:
        <div class="sub-clause">
          <span class="sub-clause-marker">(a)</span>
          "Agreement" means this Master Build Agreement and all schedules and annexures attached hereto;
        </div>
        <div class="sub-clause">
          <span class="sub-clause-marker">(b)</span>
          "Client" means ${data.clientName};
        </div>
        <div class="sub-clause">
          <span class="sub-clause-marker">(c)</span>
          "Contractor" means ${data.contractorName};
        </div>
        <div class="sub-clause">
          <span class="sub-clause-marker">(d)</span>
          "Project" means any fiber network construction or installation project undertaken pursuant to a Statement of Work issued under this Agreement;
        </div>
        <div class="sub-clause">
          <span class="sub-clause-marker">(e)</span>
          "SOW" or "Statement of Work" means the project-specific scope of work document issued under this Agreement;
        </div>
        <div class="sub-clause">
          <span class="sub-clause-marker">(f)</span>
          "Works" means the construction, installation, and commissioning services to be performed by the Contractor.
        </div>
      </div>
    </div>
  </div>

  <!-- ARTICLE 2: SCOPE -->
  <div class="article">
    <div class="article-number">Article 2</div>
    <div class="article-title">Scope of Agreement</div>
    <div class="article-content">
      <div class="clause">
        <span class="clause-number">2.1</span>
        ${data.agreementPurpose || 'This Agreement establishes the terms and conditions under which the Contractor shall provide fiber network construction and installation services to the Client.'}
      </div>
      <div class="clause">
        <span class="clause-number">2.2</span>
        Individual projects shall be governed by Statements of Work issued under this Agreement, which shall incorporate these terms by reference.
      </div>
      <div class="clause">
        <span class="clause-number">2.3</span>
        In the event of any conflict between this Agreement and a Statement of Work, the terms of this Agreement shall prevail unless expressly stated otherwise in the SOW.
      </div>
    </div>
  </div>

  <!-- ARTICLE 3: FINANCIAL TERMS -->
  <div class="article">
    <div class="article-number">Article 3</div>
    <div class="article-title">Financial Terms</div>
    <div class="article-content">
      <table class="info-table">
        <tr>
          <th>Term</th>
          <th>Details</th>
        </tr>
        <tr>
          <td><strong>Payment Terms</strong></td>
          <td>${data.paymentTerms}</td>
        </tr>
        <tr>
          <td><strong>Currency</strong></td>
          <td>${data.currency || 'ZAR'}</td>
        </tr>
        ${data.retentionPercentage ? `
        <tr>
          <td><strong>Retention</strong></td>
          <td>${data.retentionPercentage}% of each payment to be retained</td>
        </tr>
        ` : ''}
        ${data.defectsLiabilityPeriod ? `
        <tr>
          <td><strong>Defects Liability Period</strong></td>
          <td>${data.defectsLiabilityPeriod}</td>
        </tr>
        ` : ''}
      </table>
    </div>
  </div>

  <!-- ARTICLE 4: INSURANCE -->
  <div class="article">
    <div class="article-number">Article 4</div>
    <div class="article-title">Insurance Requirements</div>
    <div class="article-content">
      <div class="clause">
        <span class="clause-number">4.1</span>
        The Contractor shall maintain the following insurance coverage throughout the duration of this Agreement:
      </div>
      <table class="info-table">
        <tr>
          <th>Insurance Type</th>
          <th>Minimum Cover</th>
        </tr>
        ${data.publicLiabilityAmount ? `
        <tr>
          <td>Public Liability Insurance</td>
          <td>${formatCurrency(data.publicLiabilityAmount)}</td>
        </tr>
        ` : ''}
        ${data.professionalIndemnityAmount ? `
        <tr>
          <td>Professional Indemnity Insurance</td>
          <td>${formatCurrency(data.professionalIndemnityAmount)}</td>
        </tr>
        ` : ''}
        ${data.workersCompRequired ? `
        <tr>
          <td>Workers' Compensation</td>
          <td>As required by law</td>
        </tr>
        ` : ''}
      </table>
    </div>
  </div>

  <!-- ARTICLE 5: COMPLIANCE -->
  <div class="article">
    <div class="article-number">Article 5</div>
    <div class="article-title">Compliance Requirements</div>
    <div class="article-content">
      <table class="info-table">
        <tr>
          <th>Requirement</th>
          <th>Status/Level</th>
        </tr>
        ${data.bbbeeLevel ? `
        <tr>
          <td>B-BBEE Level</td>
          <td>Level ${data.bbbeeLevel} or better</td>
        </tr>
        ` : ''}
        ${data.taxClearanceRequired ? `
        <tr>
          <td>Tax Clearance Certificate</td>
          <td>Valid certificate required</td>
        </tr>
        ` : ''}
        ${data.cidbGrading ? `
        <tr>
          <td>CIDB Grading</td>
          <td>${data.cidbGrading}</td>
        </tr>
        ` : ''}
      </table>
    </div>
  </div>

  <!-- ARTICLE 6: TERMINATION -->
  <div class="article">
    <div class="article-number">Article 6</div>
    <div class="article-title">Term and Termination</div>
    <div class="article-content">
      <div class="clause">
        <span class="clause-number">6.1</span>
        This Agreement shall commence on the Effective Date and continue until the Expiry Date, unless terminated earlier in accordance with this Article.
      </div>
      <div class="clause">
        <span class="clause-number">6.2</span>
        Either party may terminate this Agreement by giving ${data.noticePeriod || '30 days'} written notice to the other party.
      </div>
      <div class="clause">
        <span class="clause-number">6.3</span>
        Termination of this Agreement shall not affect any rights or obligations accrued prior to termination, including any outstanding Statements of Work.
      </div>
    </div>
  </div>

  <!-- ARTICLE 7: DISPUTES -->
  <div class="article">
    <div class="article-number">Article 7</div>
    <div class="article-title">Dispute Resolution</div>
    <div class="article-content">
      <div class="clause">
        <span class="clause-number">7.1</span>
        ${data.disputeResolution || 'Any dispute arising from this Agreement shall first be referred to senior management of both parties for resolution within 14 days.'}
      </div>
      <div class="clause">
        <span class="clause-number">7.2</span>
        If the dispute cannot be resolved through negotiation, it shall be submitted to arbitration in accordance with the rules of the Arbitration Foundation of Southern Africa.
      </div>
    </div>
  </div>

  <!-- ARTICLE 8: GENERAL -->
  <div class="article">
    <div class="article-number">Article 8</div>
    <div class="article-title">General Provisions</div>
    <div class="article-content">
      <div class="clause">
        <span class="clause-number">8.1</span>
        <strong>Governing Law:</strong> This Agreement shall be governed by the laws of ${data.governingLaw || 'the Republic of South Africa'}.
      </div>
      <div class="clause">
        <span class="clause-number">8.2</span>
        <strong>Entire Agreement:</strong> This Agreement constitutes the entire agreement between the parties and supersedes all prior negotiations, representations, or agreements.
      </div>
      <div class="clause">
        <span class="clause-number">8.3</span>
        <strong>Amendment:</strong> No amendment to this Agreement shall be valid unless made in writing and signed by both parties.
      </div>
      <div class="clause">
        <span class="clause-number">8.4</span>
        <strong>Waiver:</strong> No failure to exercise any right shall constitute a waiver of such right.
      </div>
    </div>
  </div>

  ${data.schedules && data.schedules.length > 0 ? `
  <div class="schedules-section">
    <h3>Schedules and Annexures</h3>
    ${data.schedules.map(schedule => `
      <div class="schedule-item">
        <div class="schedule-name">${schedule.name}</div>
        <div class="schedule-desc">${schedule.description}</div>
      </div>
    `).join('')}
  </div>
  ` : ''}

  <div class="signature-section">
    <h3>Execution</h3>
    <p style="text-align: center; color: #64748b; margin-bottom: 30px;">
      The parties have caused this Agreement to be executed by their duly authorized representatives.
    </p>

    <div class="signature-grid">
      <div class="signature-block">
        <h4>For and on behalf of the Client</h4>
        <div class="signature-field">
          <div class="line"></div>
          <div class="label">Signature</div>
        </div>
        <div class="signature-field">
          <div class="line"></div>
          <div class="label">Full Name</div>
        </div>
        <div class="signature-field">
          <div class="line"></div>
          <div class="label">Title / Designation</div>
        </div>
        <div class="signature-field">
          <div class="line"></div>
          <div class="label">Date</div>
        </div>
      </div>

      <div class="signature-block">
        <h4>For and on behalf of the Contractor</h4>
        <div class="signature-field">
          <div class="line"></div>
          <div class="label">Signature</div>
        </div>
        <div class="signature-field">
          <div class="line"></div>
          <div class="label">Full Name</div>
        </div>
        <div class="signature-field">
          <div class="line"></div>
          <div class="label">Title / Designation</div>
        </div>
        <div class="signature-field">
          <div class="line"></div>
          <div class="label">Date</div>
        </div>
      </div>
    </div>
  </div>

  <div class="footer">
    <p>Master Build Agreement - ${data.referenceNumber}</p>
    <p>Generated by FibreFlow • ${formatDisplayDate(new Date())}</p>
  </div>
</body>
</html>
`;
}
