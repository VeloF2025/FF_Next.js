---
pdf_options:
  format: A4
  margin:
    top: 25mm
    bottom: 25mm
    left: 20mm
    right: 20mm
  displayHeaderFooter: true
  headerTemplate: |-
    <style>
      section { width: 100%; font-family: 'IBM Plex Sans', Helvetica, Arial, sans-serif; font-size: 8px; color: #666; padding: 0 20mm; }
      .header-line { border-bottom: 2px solid #219ebc; padding-bottom: 4px; display: flex; justify-content: space-between; }
    </style>
    <section>
      <div class="header-line">
        <span style="color: #023047; font-weight: 600;">VELOCITY FIBRE</span>
        <span>Cession of Wayleave Agreement — Template v1.0</span>
      </div>
    </section>
  footerTemplate: |-
    <style>
      section { width: 100%; font-family: 'IBM Plex Sans', Helvetica, Arial, sans-serif; font-size: 8px; color: #666; padding: 0 20mm; }
      .footer-line { border-top: 1px solid #219ebc; padding-top: 4px; display: flex; justify-content: space-between; }
    </style>
    <section>
      <div class="footer-line">
        <span>Confidential — Velocity Fibre (Pty) Ltd</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>
    </section>
body_class: velocity-legal
css: |-
  /* ============================================
     VELOCITY FIBRE — Legal Document Theme
     Colors extracted from velocityfibre.co.za
     ============================================ */

  :root {
    --vf-navy: #023047;
    --vf-blue: #1e73be;
    --vf-teal: #219ebc;
    --vf-sky: #2ea3f2;
    --vf-dark: #0e0c19;
    --vf-body: #3c3a47;
    --vf-gray-bg: #f9f9f9;
    --vf-light-border: #e0e0e0;
    --vf-red-accent: #8b2346;
  }

  /* === Font Import === */
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+Condensed:wght@400;500;600&display=swap');

  /* === Page & Typography === */
  body {
    font-family: 'IBM Plex Sans', Helvetica, Arial, sans-serif;
    color: var(--vf-body);
    line-height: 1.5;
    font-size: 10.5pt;
  }

  /* === Cover Page === */
  .cover-page {
    page-break-after: always;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    min-height: 85vh;
    text-align: center;
    padding: 40px;
  }

  .cover-page img {
    width: 200px;
    margin-bottom: 40px;
  }

  .cover-title {
    font-family: 'IBM Plex Sans Condensed', Helvetica, Arial, sans-serif;
    font-size: 32pt;
    font-weight: 500;
    color: var(--vf-navy);
    margin: 0 0 8px 0;
    line-height: 1.2;
  }

  .cover-subtitle {
    font-size: 14pt;
    color: var(--vf-teal);
    font-weight: 500;
    margin: 0 0 40px 0;
    letter-spacing: 1px;
  }

  .cover-divider {
    width: 80px;
    height: 3px;
    background: linear-gradient(90deg, var(--vf-navy), var(--vf-teal));
    margin: 0 auto 40px;
    border: none;
  }

  .cover-meta {
    font-size: 10pt;
    color: #666;
    line-height: 2;
  }

  .cover-meta strong {
    color: var(--vf-navy);
  }

  .cover-footer {
    margin-top: 60px;
    padding-top: 20px;
    border-top: 2px solid var(--vf-teal);
    font-size: 9pt;
    color: #999;
  }

  /* === Headings === */
  h1 {
    font-family: 'IBM Plex Sans Condensed', Helvetica, Arial, sans-serif;
    font-size: 20pt;
    font-weight: 600;
    color: var(--vf-navy);
    border-bottom: 3px solid var(--vf-teal);
    padding-bottom: 6px;
    margin-top: 30px;
    page-break-after: avoid;
  }

  h2 {
    font-family: 'IBM Plex Sans Condensed', Helvetica, Arial, sans-serif;
    font-size: 14pt;
    font-weight: 600;
    color: var(--vf-navy);
    border-bottom: 2px solid var(--vf-teal);
    padding-bottom: 4px;
    margin-top: 24px;
    page-break-after: avoid;
  }

  h3 {
    font-family: 'IBM Plex Sans', Helvetica, Arial, sans-serif;
    font-size: 12pt;
    font-weight: 600;
    color: var(--vf-navy);
    margin-top: 18px;
    page-break-after: avoid;
  }

  h4 {
    font-family: 'IBM Plex Sans', Helvetica, Arial, sans-serif;
    font-size: 11pt;
    font-weight: 600;
    color: var(--vf-teal);
    margin-top: 14px;
  }

  /* === Tables === */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 16px 0;
    font-size: 10pt;
  }

  th {
    background: var(--vf-teal);
    color: white;
    padding: 10px 12px;
    text-align: left;
    font-weight: 600;
    border: 1px solid var(--vf-teal);
  }

  td {
    padding: 10px 12px;
    border: 1px solid var(--vf-light-border);
    vertical-align: top;
  }

  tr:nth-child(even) {
    background: var(--vf-gray-bg);
  }

  /* === Template Fields === */
  .template-field {
    background: #fff3cd;
    border: 1px dashed #856404;
    padding: 2px 6px;
    border-radius: 3px;
    font-family: monospace;
    font-size: 9pt;
    color: #856404;
  }

  /* === Legal Clauses === */
  .clause {
    margin: 12px 0;
    padding-left: 0;
  }

  .sub-clause {
    margin-left: 24px;
    margin-top: 8px;
  }

  .sub-sub-clause {
    margin-left: 48px;
    margin-top: 6px;
  }

  /* === Annexure References === */
  .annexure-ref {
    display: inline-block;
    background: rgba(33, 158, 188, 0.1);
    color: var(--vf-navy);
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 600;
    font-size: 9pt;
  }

  /* === Signature Block === */
  .signature-block {
    margin-top: 40px;
    page-break-inside: avoid;
  }

  .signature-line {
    border-bottom: 1px solid var(--vf-body);
    width: 250px;
    margin: 30px 0 5px 0;
  }

  .signature-label {
    font-size: 9pt;
    color: #666;
  }

  /* === Index/TOC === */
  .toc {
    background: var(--vf-gray-bg);
    padding: 20px;
    border-radius: 8px;
    margin: 20px 0;
  }

  .toc-title {
    font-weight: 600;
    color: var(--vf-navy);
    margin-bottom: 12px;
    font-size: 12pt;
  }

  .toc-item {
    padding: 4px 0;
    border-bottom: 1px dotted var(--vf-light-border);
  }

  /* === Blockquotes for Recitals === */
  blockquote {
    border-left: 4px solid var(--vf-teal);
    background: var(--vf-gray-bg);
    padding: 12px 16px;
    margin: 16px 0;
    font-style: italic;
  }

  /* === Print Optimization === */
  @media print {
    body { font-size: 10pt; }
    h1 { font-size: 18pt; }
    h2 { font-size: 13pt; }
    h3 { font-size: 11pt; }
    .cover-page { min-height: 90vh; }
  }
---

<!-- Cover Page -->
<div class="cover-page">
  <img src="../assets/velocity-logo.jpg" alt="Velocity Fibre">
  <h1 class="cover-title">Cession of Wayleave Agreement</h1>
  <p class="cover-subtitle">VELOCITY FIBRE (PTY) LTD</p>
  <hr class="cover-divider">
  <div class="cover-meta">
    <p><strong>Document Type:</strong> Cession of Wayleave Agreement</p>
    <p><strong>Version:</strong> 1.0</p>
    <p><strong>Date:</strong> January 2026</p>
    <p><strong>Classification:</strong> Confidential</p>
  </div>
  <div class="cover-footer">
    Velocity Fibre (Pty) Ltd — Fibre Network Operator
  </div>
</div>

# Cession of Wayleave Agreement

Entered into by and between:

**_________________** (hereinafter the "Cedent")

and

**VELOCITY FIBRE (PTY) LTD** (hereinafter the "Cessionary")

(hereinafter collectively referred to as "the Parties")

---

## Index

<div class="toc">
<div class="toc-title">TABLE OF CONTENTS</div>
<div class="toc-item">1. Parties and Agreement Details</div>
<div class="toc-item">2. Recitals</div>
<div class="toc-item">3. Background</div>
<div class="toc-item">4. Definitions and Interpretation</div>
<div class="toc-item">5. Cession of Wayleave and Transaction Terms</div>
<div class="toc-item">6. Continuity of Rights and Obligations</div>
<div class="toc-item">7. Restraint of Trade</div>
<div class="toc-item">8. Implementation of Good Faith</div>
<div class="toc-item">9. Parties' Further Respective Obligations</div>
<div class="toc-item">10. Domicilium Citandi et Executandi</div>
<div class="toc-item">11. Breach of Agreement</div>
<div class="toc-item">12. Dispute Resolution</div>
<div class="toc-item">13. Post-Cession Support</div>
<div class="toc-item">14. Insurance and Risk Transfer</div>
<div class="toc-item">15. General Provisions</div>
<div class="toc-item">16. Signature Page</div>
<div class="toc-item">Annexure A — Original Wayleave Agreement</div>
<div class="toc-item">Annexure B — Grantor Consent Letter</div>
<div class="toc-item">Annexure C — Infrastructure As-Built Schedule</div>
<div class="toc-item">Annexure D — Municipal Rates Clearance Certificate</div>
<div class="toc-item">Annexure E — Cedent Solvency Certificate</div>
<div class="toc-item">Annexure F — Regulatory Approvals</div>
<div class="toc-item">Annexure G — Municipal Contact List</div>
</div>

---

## 1. Parties and Agreement Details

### The Cedent

| Field | Value |
|-------|-------|
| Full Legal Name | _________________________________________ |
| Registration Number | _________________________________________ |
| Registered Address | _________________________________________ |
| Represented by | _________________________________________ |
| Identity Number | _________________________________________ |
| Contact Email | _________________________________________ |
| Contact Number | _________________________________________ |

### The Cessionary

| Field | Value |
|-------|-------|
| Full Legal Name | VELOCITY FIBRE (PTY) LTD |
| Registration Number | 2025/238946/07 |
| Tax Number | 9055917307 |
| Registered Address | 26 Centenary Road, Lorraine, Gqeberha, 6070 |
| Represented by | Llewelyn Hofmeyr |
| Capacity | Managing Director |
| Contact Email | info@velocityfibre.co.za |
| Contact Number | 041-012 5010 |

### Agreement Details

| Field | Value |
|-------|-------|
| Agreement Date | _________________________________________ |
| Original Wayleave Date | _________________________________________ |
| Wayleave Area | _________________________________________ |
| Municipality/Grantor | _________________________________________ |
| Purchase Price | R _______________________________________ |

---

## 2. Recitals

> **WHEREAS:**
>
> 1. The Cedent is the lawful holder of a Wayleave Agreement granted by _________________ ("the Grantor") on _________________ by way of letter attached hereto marked as <span class="annexure-ref">Annexure "A"</span>, authorising the installation, operation and maintenance of aerial and underground fibre optic infrastructure within the property or servitude area described as _________________ ("the Wayleave Area");
>
> 2. The Cedent wishes to transfer, assign, and cede all its rights, title, and interest in and to the said Wayleave Agreement to the Cessionary;
>
> 3. _________________ has consented to this cession by way of letter dated _________________, attached hereto as <span class="annexure-ref">Annexure "B"</span>;
>
> 4. The Parties individually record that all authorisations and consents required to enter into this Agreement have been duly obtained.

**NOW THEREFORE**, the Parties agree as follows:

---

## 3. Background

3.1. The Wayleave Agreement authorises the Cedent to utilise such land for the purpose of constructing and maintaining fibre infrastructure in accordance with the technical and legal requirements set out in the said agreement.

3.2. The Cedent now wishes to cede, assign, and transfer all its rights, title, and interest in and to the said Wayleave Agreement to the Cessionary. The Cessionary has agreed to accept such cession, assignment, and transfer and to assume all obligations, liabilities, and responsibilities of the Cedent arising under the Wayleave Agreement from the Effective Date (as defined below).

3.3. The Grantor has consented to the said cession by way of letter dated _________________ attached as <span class="annexure-ref">Annexure "B"</span> and recognises the Cessionary as the new holder of the Wayleave Rights.

---

## 4. Definitions and Interpretation

Unless otherwise stated, or the context otherwise requires, the words and expressions listed below shall have the meanings assigned to them hereunder and cognate expressions shall have corresponding meanings:

**4.1. "Agreement"** means this Cession and Assignment of Wayleave Agreement together with all annexures attached hereto.

**4.2. "Wayleave Agreement"** means the written permission or authorisation granted by the Grantor to the Cedent, dated _________________, under which the Cedent was permitted to install and maintain network infrastructure within the Wayleave Area.

**4.3. "Wayleave Rights"** means all rights, privileges, and entitlements of the Cedent under the Wayleave Agreement, including but not limited to the right to install, operate, access, maintain, upgrade, and repair telecommunications infrastructure.

**4.4. "Effective Date"** means the date on which all conditions precedent in clause 5.7 have been fulfilled, or such earlier date as the Parties may agree in writing.

**4.5. "Infrastructure"** means all physical and supporting assets installed, constructed, or maintained in terms of the Wayleave Agreement, including but not limited to ducting, cabling, fibre, conduits, access chambers, manholes, enclosures, poles, masts, equipment, power supplies, and any related apparatus, fixtures, or ancillary facilities.

**4.6. "Purchase Price"** means the consideration payable by the Cessionary to the Cedent as set out in clause 5.1.

**4.7. "FNO"** means Fibre Network Operator, being a licensed telecommunications operator.

**4.8. "Grantor"** means _________________, being the municipality that granted the Wayleave Agreement to the Cedent.

**4.9. "Wayleave Area"** means _________________ as described in the Wayleave Agreement.

**4.10.** Any reference to one gender includes the other; any reference to the singular includes the plural and vice versa. Headings are for convenience only and do not affect interpretation.

---

## 5. Cession of Wayleave and Transaction Terms

### 5.1. Purchase Price and Payment

5.1.1. The Cessionary shall pay to the Cedent the sum of **R _________________** (the "Purchase Price") as consideration for this cession.

5.1.2. Payment shall be made as follows:

- **Deposit:** R [DEPOSIT_AMOUNT] within [DEPOSIT_DAYS] days of signature
- **Balance:** R [BALANCE_AMOUNT] on the Effective Date

5.1.3. The Purchase Price is conditional upon:

- Verification of Infrastructure condition (if applicable) in accordance with clause 5.5
- Grantor consent confirmation as per <span class="annexure-ref">Annexure "B"</span>
- No material adverse changes to the Wayleave Agreement

5.1.4. Payment shall be made via EFT to:

| Bank Details | |
|--------------|---|
| Bank | [BANK_NAME] |
| Account | [ACCOUNT_NUMBER] |
| Branch | [BRANCH_CODE] |

### 5.2. Cession of Wayleave

5.2.1. The Cedent hereby cedes, assigns, and transfers to the Cessionary, with effect from the Effective Date, all of the Cedent's rights, title, and interest in and to the Wayleave Agreement, including without limitation:

- The right to install, construct, operate, maintain, upgrade, and repair telecommunications infrastructure within the Wayleave Area;
- The right to access the Wayleave Area for purposes of exercising the Wayleave Rights;
- Any and all ancillary rights, privileges, and entitlements arising from or connected with the Wayleave Agreement;
- The benefit of all warranties, representations, and undertakings given by the Grantor under the Wayleave Agreement.

### 5.3. Warranties and Representations

5.3.1. The Cedent warrants and represents to the Cessionary that:

- The Cedent is the sole and lawful holder of the Wayleave Rights;
- The Wayleave Agreement is valid, binding, and enforceable;
- The Cedent has full legal capacity and authority to enter into this Agreement;
- There are no disputes, claims, or litigation pending or threatened in respect of the Wayleave Agreement;
- The Cedent has complied with all material obligations under the Wayleave Agreement to date;
- There are no undisclosed liabilities, arrears, or charges relating to the Wayleave Agreement;
- The Wayleave Agreement has not been amended, varied, or supplemented except as disclosed to the Cessionary;
- No event has occurred which would entitle the Grantor to cancel, suspend, or terminate the Wayleave Agreement.

### 5.4. Indemnification

5.4.1. The Cedent indemnifies and holds harmless the Cessionary against any and all losses, damages, costs, expenses, claims, or liabilities arising from:

- Any breach of the Cedent's warranties and representations in this Agreement;
- Any acts or omissions of the Cedent prior to the Effective Date;
- Any failure by the Cedent to comply with its obligations under the Wayleave Agreement prior to the Effective Date;
- Any undisclosed liabilities or charges relating to the Wayleave Agreement;
- Any breach by the Cedent of clause 7 (Restraint of Trade) or clause 5.13 (Direct Engagement Rights).

5.4.2. This indemnity shall survive termination or cancellation of this Agreement and shall remain in force for a period of **5 (five) years** from the Effective Date.

### 5.5. Infrastructure Status and Condition

5.5.1. The Parties record that as at the date of signature: *[SELECT ONE]*

**OPTION A — No Infrastructure Installed:**
No physical infrastructure has been installed by the Cedent as at the Effective Date. The Cessionary acknowledges that it is acquiring the Wayleave Rights only.

**OPTION B — Infrastructure Installed:**
The Cedent has installed infrastructure as described in <span class="annexure-ref">Annexure "C"</span>. The Cessionary shall have the right to conduct a technical audit within 30 days.

### 5.6. Regulatory Compliance and Municipal Wayleave

5.6.1. **Municipal Wayleave Compliance (Cedent's Responsibility):** The Cedent warrants that it has complied with all municipal requirements, bylaws, and conditions imposed by the Grantor up to the Effective Date.

5.6.2. **FNO Regulatory Compliance (Cessionary's Responsibility):** From the Effective Date, the Cessionary (as the FNO) shall be solely responsible for obtaining and maintaining all ICASA licenses and compliance with the Electronic Communications Act.

5.6.3. The Cedent shall have no liability for any FNO regulatory compliance obligations arising after the Effective Date.

### 5.7. Conditions Precedent

5.7.1. This Agreement is subject to the fulfilment of the following conditions precedent:

- Written consent from the Grantor to this cession in the form attached as <span class="annexure-ref">Annexure "B"</span>;
- Verification that the Wayleave Agreement has a remaining validity period of not less than 12 months (clause 5.10);
- Confirmation that the Wayleave Agreement is cessionable and Grantor consent obtained (clause 5.11);
- Confirmation that aerial deployment is permitted (clause 5.12);
- Payment of the deposit by the Cessionary;
- Provision of all annexures and supporting documents;
- Municipal rates clearance certificate (<span class="annexure-ref">Annexure "D"</span>).

5.7.2. These conditions precedent must be fulfilled within **60 (sixty) days** of signature, failing which either Party may cancel this Agreement by written notice.

### 5.8. Municipal Fees and Charges

5.8.1. The Cedent warrants that all municipal rates, fees, charges, and levies relating to the Wayleave Agreement have been paid in full up to the Effective Date.

5.8.2. The Cedent shall provide a municipal rates clearance certificate (<span class="annexure-ref">Annexure "D"</span>) confirming no arrears.

5.8.3. From the Effective Date, the Cessionary shall be responsible for payment of all future municipal fees.

### 5.9. Municipal Relationship

5.9.1. The Cedent warrants that its relationship with the Grantor is in good standing with no disputes, complaints, or compliance actions pending.

5.9.2. The Cedent will provide the Cessionary with all municipal contact details (<span class="annexure-ref">Annexure "G"</span>).

### 5.10. Wayleave Validity Period and Renewal

#### 5.10.1. Minimum Remaining Term

- The Cedent warrants that as at the Effective Date, the Wayleave Agreement has a remaining validity period of not less than **12 (twelve) months**.
- The Wayleave Agreement will not expire, lapse, or require renewal within 12 (twelve) months of the Effective Date.
- If the Wayleave Agreement is subject to periodic renewal, the next renewal date is not earlier than [RENEWAL_DATE] which is at least 12 months from the anticipated Effective Date.

#### 5.10.2. Automatic Renewal or Extension Rights

The Cedent warrants that the Wayleave Agreement either:
- (a) provides for automatic renewal upon expiry; or
- (b) grants the holder an enforceable right to apply for renewal; or
- (c) is granted in perpetuity or for an indefinite period; or
- (d) has an initial term of not less than 15-20 years from _________________.

#### 5.10.3. Long-Term Security

The Parties acknowledge that the commercial value of this cession is predicated on the Wayleave Agreement providing long-term, secure access rights. A Wayleave Agreement with less than 12 months remaining validity constitutes a material misrepresentation.

### 5.11. Cessionability and Municipal Consent

#### 5.11.1. Express Cessionability

The Cedent warrants that the Wayleave Agreement expressly permits cession, assignment, or transfer to third parties.

#### 5.11.2. Grantor's Written Consent

The Cedent shall procure written consent from the Grantor in the form attached as <span class="annexure-ref">Annexure "B"</span>, which shall acknowledge that the Cessionary is recognized as the new wayleave holder and that the Grantor will engage directly with the Cessionary.

#### 5.11.3. Risk of Non-Cessionability

If the Wayleave Agreement is non-cessionable or Grantor consent is refused, then:
- This Agreement shall automatically terminate;
- Cedent shall refund all amounts paid plus interest at the prescribed rate + 2%;
- Cedent shall pay damages equal to 100% of the Purchase Price.

### 5.12. Deployment Method — Aerial Preference

#### 5.12.1. Aerial Deployment Preference

The Parties acknowledge that the Cessionary's business model is predicated on **AERIAL DEPLOYMENT** of fibre infrastructure, which is significantly more cost-effective than trenching and civil works.

#### 5.12.2. Express Aerial Authorization

The Cedent warrants that:
- The Wayleave Agreement expressly permits aerial deployment;
- There are no restrictions preventing aerial deployment;
- The Grantor has not imposed trenching as the mandatory method;
- Aerial deployment on municipal/Eskom poles is permitted (subject to technical approval).

#### 5.12.3. Civil Works Limitation

The Cedent warrants that trenching and civil works are NOT required as the mandatory primary deployment method.

#### 5.12.4. Deployment Method as Material Term

If aerial deployment is not permitted or is commercially unviable:
- The Cessionary may cancel and obtain full refund plus damages equal to 100% of Purchase Price; or
- The Parties shall renegotiate the Purchase Price downward by 50-75%.

### 5.13. Cessionary's Right to Engage Directly with Grantor

#### 5.13.1. No Ongoing Cedent Involvement

From the Effective Date, the Cessionary shall have the **EXCLUSIVE** right to engage with the Grantor on all matters including network design, permit applications, wayleave renewals, compliance reporting, and fee payments.

The Cedent shall have NO authority to engage with the Grantor on behalf of the Cessionary after the Effective Date.

#### 5.13.2. Grantor Acknowledgment

The Grantor's consent letter (<span class="annexure-ref">Annexure "B"</span>) must acknowledge that the Cessionary is the sole wayleave holder and the Grantor will engage exclusively with the Cessionary.

#### 5.13.3. No Cedent Interference

The Cedent undertakes that it shall not:
- Make any representations to the Grantor regarding the Cessionary;
- Lodge complaints or objections with the Grantor;
- Apply for competing wayleaves within the Wayleave Area;
- Take any action that may prejudice the Cessionary's relationship with the Grantor.

#### 5.13.4. Breach and Remedies

Any breach of this clause shall entitle the Cessionary to urgent interdict, damages, and/or cancellation with restitution.

---

## 6. Continuity of Rights and Obligations

6.1. From the Effective Date, the Cessionary shall succeed to all rights, privileges, and entitlements of the Cedent under the Wayleave Agreement.

6.2. From the Effective Date, the Cessionary shall assume all obligations, liabilities, and responsibilities of the Cedent under the Wayleave Agreement.

6.3. The Cedent shall have no further rights, liabilities, or obligations under the Wayleave Agreement from the Effective Date, save as expressly provided in this Agreement.

---

## 7. Restraint of Trade

7.1. The Cedent undertakes that for a period of **5 (five) years** from the Effective Date, it shall not, within the Wayleave Area, apply for any wayleave, compete with the Cessionary, or assist any third party in competing.

7.2. The Cedent acknowledges that this restraint is reasonable and necessary to protect the Cessionary's legitimate commercial interests.

---

## 8. Implementation of Good Faith

8.1. The Parties undertake to act in good faith and deal fairly with each other in the implementation of this Agreement.

8.2. The Cedent specifically undertakes to execute all documents, provide all records, introduce the Cessionary to the Grantor, and provide reasonable assistance.

---

## 9. Parties' Further Respective Obligations

9.1. After the Effective Date, the Cedent shall notify the Grantor in writing, redirect all correspondence, and provide reasonable assistance for 90 days.

9.2. The Cessionary shall comply with all Wayleave Agreement terms and indemnify the Cedent against claims arising after the Effective Date.

---

## 10. Domicilium Citandi et Executandi

10.1. The Parties choose the following addresses for purposes of giving notices:

**CEDENT:**

| | |
|-|-|
| Physical Address | _________________________________________ |
| Email | _________________________________________ |

**CESSIONARY:**

| | |
|-|-|
| Physical Address | 26 Centenary Road, Lorraine, Gqeberha, 6070 |
| Email | info@velocityfibre.co.za |
| Phone | 041-012 5010 |

10.2. Any Party may change its domicilium by giving 10 (ten) business days' written notice.

---

## 11. Breach of Agreement

11.1. If either Party commits a material breach, the non-breaching Party may give **10 business days'** notice to remedy, and if not remedied, may cancel and/or claim damages.

11.2. Material breaches include breach of warranties, failure to obtain Grantor consent, misrepresentation regarding validity or deployment method, failure to pay, and breach of restraint or direct engagement rights.

---

## 12. Dispute Resolution

12.1. The Parties shall first attempt to resolve disputes through good faith negotiations.

12.2. If unresolved within **14 days**, either Party may refer the dispute to arbitration under AFSA Expedited Rules in Johannesburg.

12.3. Nothing shall prevent either Party from approaching a court for urgent interim relief.

---

## 13. Post-Cession Support

13.1. For **90 days** from the Effective Date, the Cedent shall provide reasonable transition support including responding to queries, providing records, facilitating introductions, and assisting with administrative handover.

13.2. Such support shall be provided at no additional cost to the Cessionary.

---

## 14. Insurance and Risk Transfer

14.1. From the Effective Date, all risk shall pass to the Cessionary.

14.2. The Cessionary shall obtain and maintain adequate insurance cover.

14.3. The Cedent shall have no liability for loss or damage after the Effective Date.

---

## 15. General Provisions

15.1. This Agreement constitutes the entire agreement and supersedes all prior negotiations.

15.2. No amendment shall be effective unless in writing and signed by both Parties.

15.3. No indulgence shall constitute a waiver of rights.

15.4. Invalid provisions shall be severable without affecting remaining provisions.

15.5. Each Party bears its own legal costs.

15.6. This Agreement is governed by **South African law**.

15.7. This Agreement may be executed in counterparts.

---

## 16. Signature Page

<div class="signature-block">

**SIGNED** at _________________ on this _____ day of _________________ 20_____

### For and on Behalf of the Cedent:

<div class="signature-line"></div>
<p class="signature-label">Signature</p>

| | |
|-|-|
| Name | _________________________________________ |
| Capacity | _________________________________________ |
| Date | _________________________________________ |

</div>

<div class="signature-block">

**SIGNED** at _________________ on this _____ day of _________________ 20_____

### For and on Behalf of Velocity Fibre (Pty) Ltd:

<div class="signature-line"></div>
<p class="signature-label">Signature</p>

| | |
|-|-|
| Name | Llewelyn Hofmeyr |
| Capacity | Managing Director |
| Date | _________________________ |

</div>

<div class="signature-block">

### Witnesses:

**Witness 1:**
<div class="signature-line"></div>
<p class="signature-label">Name: ________________________________</p>

**Witness 2:**
<div class="signature-line"></div>
<p class="signature-label">Name: ________________________________</p>

</div>

---

## Annexures

The following annexures form part of this Agreement:

| Annexure | Description | Attached |
|----------|-------------|----------|
| **A** | Original Wayleave Agreement | [ ] |
| **B** | Grantor Consent Letter | [ ] |
| **C** | Infrastructure As-Built Schedule | [ ] |
| **D** | Municipal Rates Clearance Certificate | [ ] |
| **E** | Cedent Solvency Certificate | [ ] |
| **F** | Regulatory Approvals | [ ] |
| **G** | Municipal Contact List | [ ] |

---

*End of Document*
