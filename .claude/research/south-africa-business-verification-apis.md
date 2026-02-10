# South Africa Business Verification APIs - Research Report

**Date:** 2026-02-09
**Purpose:** Identify practical, implementable solutions for company verification in South Africa

---

## Executive Summary

BizPortal.gov.za itself does NOT offer a public API. However, several official and third-party services provide programmatic access to South African business data through the CIPC (Companies and Intellectual Property Commission) system.

**CONFIDENCE:** HIGH

---

## 1. BizPortal.gov.za Analysis

### What BizPortal Provides

- **Purpose:** Online portal for company registration and services (not an API)
- **Operator:** Companies and Intellectual Property Commission (CIPC)
- **Services:**
  - Company registration (CIPC)
  - Tax registration (SARS)
  - UIF registration
  - Domain registration
  - Integrated government services

### BizPortal Data Access

**Manual Access Only:**
- Web-based search functionality
- Search by company name, registration number, or director ID
- Returns: company name, registration number, status, registration date, addresses

**No Public API:**
- BizPortal is a user-facing portal, not an API platform
- All searches require manual login and web interface interaction
- No developer documentation or API endpoints available

**Integration:** BizPortal integrates with CIPC, SARS, UIF, and Compensation Fund on the backend, but these integrations are internal only.

---

## 2. CIPC APIVerse Hub (Official API)

### Overview

**Platform:** https://apim.cipc.co.za/
**Developer Portal:** https://developer.cipc.co.za/
**Documentation:** https://guide.cipc.co.za/
**Status:** ACTIVE (Official CIPC API platform)

### Authentication

- **Method:** OAuth 2.0 (JWT flows)
- **Architecture:** RESTful APIs
- **Access:** Self-service developer portal
- **Testing:** Sandbox environment available

### Available APIs

1. **Company Data Search**
   - Search by company name or registration number
   - Returns: company details, status, directors, auditors

2. **XBRL APIs**
   - Financial data extraction

3. **Disqualified Directors Search**
   - Check director eligibility

4. **Company Documents/Disclosure Certificates**
   - Retrieve official documents

5. **Intellectual Property APIs**
   - Trademark, design, patent, copyright searches

### Data Available

- Company registration details
- Company status (active, deregistered, etc.)
- Director information (names, ID numbers, appointment dates)
- Auditor/accounting officer details
- Registered addresses
- Filing history
- Director changes and shareholding structures

### Pricing

- **Model:** Usage-based (specific pricing not public)
- **Access:** Must register on developer portal
- **Contact:** Direct inquiry required for pricing details

### Implementation Complexity

**RATING:** MEDIUM
- OAuth 2.0 implementation required
- RESTful API (standard)
- Sandbox for testing
- Self-service onboarding

---

## 3. Third-Party API Providers

### 3.1 Datanamix

**Website:** https://www.datanamix.com/
**Developer Hub:** https://www.datanamix.com/developer-hub/
**API Documentation:** https://api-docs.datanamix.com/

#### Services

**CIPC Company Verification API:**
- Real-time access to CIPC data
- Company standard search
- Company search plus (enhanced history)
- Director verification

**Additional Services:**
- ID verification (Home Affairs data + facial recognition)
- Contact data verification
- Consumer credit reports
- Bank account verification

#### Technical Details

- **Architecture:** RESTful API
- **Documentation:** Swagger/OpenAPI
- **Testing:** API Manager with built-in POST function
- **Authentication:** API key-based

#### Pricing

- **Minimum Credit Facility:** R30,000
- **Payment Options:**
  - Prepaid account
  - 30-day account (in arrears)
- **Per-transaction pricing:** Contact for details
- **Setup:** Free consultation and onboarding

#### Implementation Complexity

**RATING:** LOW-MEDIUM
- Simple REST API
- API key authentication
- Swagger documentation
- Free support and training
- Fast approval (1 business day response)

**RECOMMENDATION:** HIGHLY PRACTICAL - Good balance of features, documentation, and support.

---

### 3.2 Standard Bank SearchWorks™

**Website:** https://corporateandinvestment.standardbank.com/
**Platform:** OneHub API Marketplace

#### Services

**CIPC Information API:**
- Company search by name or registration number
- Director and auditor information
- Company history (status changes, directorship changes)

**Related SearchWorks APIs:**
- Company Credit Checks
- Consumer Credit Checks
- Deeds Database (property searches)
- Property History
- Watchlist screening

#### Technical Details

- **Architecture:** RESTful API
- **Platform:** Standard Bank OneHub
- **Integration:** Direct system integration
- **Security:** Banking-grade

#### Pricing

- **Model:** Not publicly listed
- **Access:** Requires Standard Bank business banking relationship
- **Contact:** Corporate and Investment Banking division

#### Implementation Complexity

**RATING:** MEDIUM-HIGH
- Requires existing Standard Bank relationship
- Corporate banking onboarding process
- Enterprise-grade security requirements

**RECOMMENDATION:** BEST FOR: Existing Standard Bank clients or large enterprises

---

### 3.3 LexisNexis WinDeed

**Website:** https://www.windeed.co.za/
**Product:** Lexis WinDeed

#### Services

**Company Search:**
- Company name or registration number search
- Company status and registration details
- Director information
- Enterprise type and industry classification

**Additional Services:**
- Property/Deeds searches
- Home Affairs ID verification
- Bank account verification
- Credit bureau data

#### Technical Details

- **Architecture:** SOAP interfaces
- **Data Source:** CIPC and leading credit bureaus
- **Access:** Web-based and API

#### Pricing

- **Registration:** FREE (no subscription fees)
- **Model:** Pay-per-search
- **Training:** FREE
- **Support:** FREE

#### Implementation Complexity

**RATING:** MEDIUM
- SOAP API (older technology, more complex than REST)
- Pay-per-use model (good for low volume)
- No minimum commitments

**RECOMMENDATION:** GOOD FOR: Low-volume searches, no upfront commitment

---

### 3.4 Inoxico

**Website:** https://www.inoxico.com/

#### Services

- Business data verification across Africa
- 25+ years of experience
- 400+ clients
- Integrated with every available data source across Africa

#### Technical Details

- **Architecture:** API and data feeds
- **Coverage:** Pan-African (not just South Africa)
- **Platform:** Proprietary South African technology

#### Pricing

- **Model:** Not publicly listed
- **Contact:** Direct inquiry required

#### Implementation Complexity

**RATING:** UNKNOWN (insufficient public information)

**RECOMMENDATION:** CONSIDER FOR: Pan-African business verification needs

---

### 3.5 XDS Credit Bureau

**Website:** https://www.xds.co.za/
**Type:** Major South African credit bureau

#### Services

- Business credit data
- Consumer credit data
- Company verification
- South African-owned

#### Technical Details

- **Access:** Through credit bureau partnerships (Datanamix, etc.)
- **Direct API:** Not widely advertised

#### Pricing

- **Model:** Through resellers/partners

#### Implementation Complexity

**RATING:** MEDIUM (via partners like Datanamix)

**RECOMMENDATION:** Access via Datanamix or other resellers

---

### 3.6 Experian South Africa

**Website:** https://www.experian.co.za/
**Global Website:** https://www.experian.com/

#### Services

- Identity verification
- Business data
- Credit bureau data
- Consumer onboarding

#### Technical Details

- **Architecture:** RESTful API (global API hub)
- **Platform:** Enterprise-grade
- **Coverage:** Global with South African presence

#### Pricing

- **Model:** Enterprise licensing
- **Contact:** Direct inquiry required

#### Implementation Complexity

**RATING:** HIGH
- Enterprise sales process
- Complex licensing
- Large-scale implementations

**RECOMMENDATION:** BEST FOR: Large enterprises with international needs

---

### 3.7 OpenCorporates

**Website:** https://opencorporates.com/
**API:** https://api.opencorporates.com/

#### South Africa Data

**CRITICAL LIMITATION:**
- Data sourced from CIPRO (CIPC predecessor)
- **Last Updated:** September 2014
- **Status:** HISTORICAL/ARCHIVE ONLY
- CIPC introduced restrictive terms in 2014 blocking data re-use

#### API Access

- **Free Tier:** Available for open data projects (share-alike attribution license)
- **API Key:** Required
- **Rate Limits:** Based on account type

#### Implementation Complexity

**RATING:** LOW (but data is outdated)

**RECOMMENDATION:** NOT SUITABLE for current South African company verification (data too old)

---

### 3.8 Bureau van Dijk / Moody's Orbis

**Website:** https://www.moodys.com/ (formerly bvdinfo.com)
**Product:** Orbis

#### Services

- Global company database (600+ million companies)
- 170+ data sources
- Financial statements, ownership hierarchies, subsidiaries
- Standardized, comparable data

#### Technical Details

- **Architecture:** API available
- **Coverage:** Global (including South Africa)
- **Data Quality:** Enterprise-grade

#### Pricing

- **Model:** Enterprise subscription
- **Cost:** High (institutional/enterprise level)

#### Implementation Complexity

**RATING:** HIGH
- Enterprise sales process
- Complex licensing
- Institutional pricing

**RECOMMENDATION:** BEST FOR: Large corporations, financial institutions, research organizations

---

## 4. SARS Tax Compliance Verification

### Tax Compliance Status (TCS) System

**Website:** https://www.sars.gov.za/
**Verification Tool:** https://tools.sars.gov.za/sarsonlinequery/tcsverify

### How It Works

1. **Taxpayer Request:**
   - Taxpayer logs into eFiling or SARS Online Query System (SOQS)
   - Requests Tax Compliance Status
   - Receives a PIN

2. **Third-Party Verification:**
   - Third party uses PIN + taxpayer reference number
   - Accesses TCS Verify tool
   - Views compliance status (color-coded: Green = compliant, Red = non-compliant)

### API Access

**STATUS:** NO PUBLIC API DOCUMENTED
- Web-based verification tools only
- PIN-based access control
- Manual verification process

### Implementation Considerations

- **Integration:** Not currently API-friendly
- **Workaround:** Screen scraping (NOT RECOMMENDED - likely violates ToS)
- **Alternative:** Manual verification workflow

---

## 5. BEE Certificate Verification

### B-BBEE Commission Portal

**Website:** https://portal.bbbeecommission.co.za/

### Services

- Central repository for all B-BBEE certificates
- Issued by accredited Verification Agencies/Professionals
- Public search functionality

### Verification Agencies

- **Accreditation:** SANAS (South African National Accreditation System)
- **Examples:**
  - Honeycomb BEE (https://honeycomb-bee.co.za/)
  - DVS BEE
  - Others

### API Access

**STATUS:** NO PUBLIC API DOCUMENTED
- Web-based portal search
- No developer documentation found

### Data Available

- B-BBEE certificate validity
- B-BBEE level (1-8 or Non-Compliant)
- Certificate expiry dates
- Verification agency details

### Implementation Considerations

- **Integration:** Not currently API-friendly
- **Workaround:** Manual verification or partnerships with verification agencies

---

## 6. Web Scraping Considerations

### BizPortal / CIPC Terms of Service

**CRITICAL:** CIPC introduced restrictive terms in September 2014 that prohibit:
- Data re-use from the CIPC website
- Automated scraping
- Redistribution of data

### Legal Considerations

- **robots.txt:** Should be checked but not legally binding
- **Terms of Service:** Legally binding - scraping likely violates ToS
- **POPIA Compliance:** South Africa's data protection law (similar to GDPR)

### Recommendation

**DO NOT SCRAPE:**
- BizPortal.gov.za
- CIPC eServices
- SARS portals
- B-BBEE Commission portal

**USE OFFICIAL APIs INSTEAD:**
- CIPC APIVerse Hub
- Licensed third-party providers (Datanamix, Standard Bank, etc.)

---

## 7. Practical Implementation Recommendations

### Scenario 1: Small Business / Startup (Low Volume)

**RECOMMENDED SOLUTION:** LexisNexis WinDeed
- **Pros:** Pay-per-search, no upfront costs, free registration
- **Cons:** SOAP API (older tech), per-transaction costs can add up
- **Best For:** <100 searches/month

### Scenario 2: Growing Business (Medium Volume)

**RECOMMENDED SOLUTION:** Datanamix
- **Pros:** Modern REST API, good documentation, R30k credit facility reasonable
- **Cons:** Requires credit facility, monthly commitment
- **Best For:** 100-1000 searches/month

### Scenario 3: Enterprise / Existing Standard Bank Client

**RECOMMENDED SOLUTION:** Standard Bank SearchWorks™
- **Pros:** Banking-grade security, integrated with existing relationship
- **Cons:** Requires Standard Bank relationship, higher onboarding complexity
- **Best For:** Large enterprises, >1000 searches/month

### Scenario 4: Direct CIPC Integration

**RECOMMENDED SOLUTION:** CIPC APIVerse Hub
- **Pros:** Official source, most authoritative data
- **Cons:** OAuth 2.0 implementation, pricing not transparent
- **Best For:** Developers comfortable with OAuth 2.0, need official source

### Scenario 5: Pan-African Verification

**RECOMMENDED SOLUTION:** Inoxico
- **Pros:** 25+ years experience, coverage across Africa
- **Cons:** Limited public information, need to contact for details
- **Best For:** Multi-country verification (not just South Africa)

---

## 8. Implementation Example: Datanamix

### Quick Start Steps

1. **Registration:**
   - Visit https://www.datanamix.com/developers-page/
   - Apply for API account (R30k credit facility or prepaid)
   - Receive approval (typically 1 business day)

2. **Credentials:**
   - Access API Manager and Swagger tools
   - Receive API key and endpoint URLs

3. **Integration:**
   ```typescript
   // Example: CIPC Company Search
   interface CompanySearchRequest {
     companyName?: string;
     registrationNumber?: string;
   }

   interface CompanySearchResponse {
     companyName: string;
     registrationNumber: string;
     status: string;
     registrationDate: string;
     directors: Director[];
     address: Address;
     filingHistory: Filing[];
   }

   async function searchCompany(
     apiKey: string,
     search: CompanySearchRequest
   ): Promise<CompanySearchResponse> {
     const response = await fetch('https://api.datanamix.com/cipc/company-search', {
       method: 'POST',
       headers: {
         'Authorization': `Bearer ${apiKey}`,
         'Content-Type': 'application/json',
       },
       body: JSON.stringify(search),
     });

     return response.json();
   }
   ```

4. **Testing:**
   - Use Swagger UI for testing
   - Validate responses
   - Check error handling

5. **Production:**
   - Monitor usage via API Manager
   - Track costs per transaction
   - Scale as needed

---

## 9. Data Availability Matrix

| Data Type | BizPortal | CIPC API | Datanamix | Standard Bank | WinDeed | SARS | B-BBEE Portal |
|-----------|-----------|----------|-----------|---------------|---------|------|---------------|
| Company Status | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Registration Number | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Directors | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Addresses | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Filing History | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Financial Data | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Tax Compliance | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| BEE Certificate | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Credit Data | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ |
| ID Verification | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ |

---

## 10. Cost Comparison (Estimated)

| Provider | Setup Cost | Monthly Min | Per-Search Cost | Notes |
|----------|-----------|-------------|-----------------|-------|
| **Datanamix** | R0 | R30,000 credit facility | ~R5-R50 (varies by product) | 30-day account or prepaid |
| **WinDeed** | R0 | R0 | ~R10-R100 (pay-per-use) | No commitment |
| **Standard Bank** | Unknown | Unknown | Unknown | Contact for quote |
| **CIPC API** | Unknown | Unknown | Unknown | Contact for quote |
| **Experian** | High | High | Enterprise pricing | Large-scale only |
| **Bureau van Dijk** | Very High | Very High | Enterprise subscription | Institutional level |

**Note:** Prices are estimates based on typical South African bureau pricing. Contact providers for exact quotes.

---

## 11. Technical Architecture Comparison

| Provider | Protocol | Auth Method | Documentation | Sandbox | Support |
|----------|----------|-------------|---------------|---------|---------|
| **CIPC API** | REST | OAuth 2.0 JWT | ✅ Good | ✅ Yes | Self-service |
| **Datanamix** | REST | API Key | ✅ Excellent (Swagger) | ✅ Yes | Free 1-day response |
| **Standard Bank** | REST | Banking-grade | ✅ Good | ✅ Likely | Enterprise support |
| **WinDeed** | SOAP | API Key | ⚠️ Basic | ❌ Unknown | Free training |
| **OpenCorporates** | REST | API Key | ✅ Excellent | ✅ Yes | Community/Paid |

---

## 12. Key Findings Summary

### What BizPortal Offers

1. **NO PUBLIC API** - BizPortal is a user-facing portal only
2. **Manual Search Only** - Requires login and web interface
3. **Integration Backend** - BizPortal connects CIPC, SARS, UIF internally (not exposed)

### How to Programmatically Access Company Data

**Option 1: Official CIPC API** (apim.cipc.co.za)
- Most authoritative source
- OAuth 2.0 required
- Pricing not transparent

**Option 2: Datanamix** (RECOMMENDED for most use cases)
- Modern REST API
- Excellent documentation
- Reasonable pricing (R30k credit facility)
- Fast onboarding (1 business day)

**Option 3: Standard Bank SearchWorks™**
- Best for existing Standard Bank clients
- Banking-grade security
- Requires corporate relationship

**Option 4: LexisNexis WinDeed**
- Good for low-volume use
- Pay-per-search (no commitment)
- SOAP API (older tech)

### Data Verification Options

**Company Status:** ✅ Available via CIPC API, Datanamix, Standard Bank, WinDeed
**BEE Certificates:** ⚠️ Manual verification via B-BBEE Commission portal (no API)
**Tax Compliance:** ⚠️ Manual verification via SARS TCS system with PIN (no API)
**Credit Data:** ✅ Available via Datanamix, Standard Bank, WinDeed (credit bureau partners)

### CIPC-SARS-UIF Integration

**How BizPortal Integrates:**
- BizPortal submits company registration to CIPC
- CIPC automatically forwards data to SARS for tax registration
- UIF and Compensation Fund registration also triggered
- **NOT EXPOSED TO PUBLIC:** These integrations are internal government systems only

**For Third-Party Apps:**
- Must integrate separately with CIPC API (company data)
- Must integrate separately with SARS (no API - manual TCS verification)
- No unified government API available

### Web Scraping

**DO NOT SCRAPE:**
- CIPC introduced restrictive ToS in 2014
- Scraping violates terms of service
- Legal risks (POPIA compliance)
- Use official APIs instead

---

## 13. Next Steps for Implementation

### Immediate Actions

1. **Define Requirements:**
   - Expected search volume (searches/month)
   - Budget constraints
   - Data refresh requirements
   - Integration timeline

2. **Choose Provider:**
   - **Low volume (<100/month):** WinDeed
   - **Medium volume (100-1000/month):** Datanamix
   - **Enterprise (>1000/month):** Standard Bank or CIPC API
   - **Official source required:** CIPC API

3. **Register and Test:**
   - Apply for API access
   - Test in sandbox
   - Validate data quality
   - Measure performance

4. **Build Integration:**
   - Implement authentication
   - Build search functionality
   - Add error handling
   - Cache results (if allowed by ToS)

5. **Handle Edge Cases:**
   - Tax compliance: Build manual verification workflow (no API)
   - BEE certificates: Build manual verification workflow (no API)
   - Expired data: Implement refresh logic

### Long-Term Considerations

- **Cost Optimization:** Monitor usage, negotiate volume discounts
- **Data Quality:** Validate against multiple sources
- **Compliance:** POPIA, PAIA, CIPC terms of service
- **Redundancy:** Consider backup provider for critical applications

---

## 14. Conclusion

**ANSWER TO ORIGINAL QUESTIONS:**

1. **Does BizPortal offer any API?**
   ❌ NO - BizPortal is a web portal only, no public API

2. **What services does BizPortal provide?**
   ✅ Company registration, tax registration, UIF registration (web-based)

3. **Can you programmatically query company data?**
   ✅ YES - Via CIPC APIVerse Hub or third-party providers (Datanamix, Standard Bank, WinDeed)

4. **What data is available?**
   ✅ Company status, directors, addresses, filing history, financial data (XBRL)
   ⚠️ BEE certificates and tax compliance require manual verification (no APIs)

5. **How does BizPortal integrate with CIPC, SARS, etc.?**
   ✅ Internal government integration (not exposed to public)

6. **Are there third-party services?**
   ✅ YES - Datanamix, Standard Bank SearchWorks™, LexisNexis WinDeed, Experian, Inoxico, XDS

7. **Web scraping considerations?**
   ❌ DO NOT SCRAPE - Violates CIPC ToS (restrictive terms since 2014)

**PRACTICAL RECOMMENDATION:**
Start with **Datanamix** for company verification (modern API, good docs, reasonable pricing). For tax compliance and BEE certificates, build manual verification workflows (no APIs available).

---

## 15. Sources

- [BizPortal Official Site](https://www.bizportal.gov.za/)
- [CIPC APIVerse Hub](https://apim.cipc.co.za/)
- [CIPC API Documentation](https://guide.cipc.co.za/)
- [Datanamix Developer Hub](https://www.datanamix.com/developer-hub/)
- [Standard Bank SearchWorks™](https://corporateandinvestment.standardbank.com/cib/global/products-and-services/onehub/api-marketplace/cipc-information)
- [LexisNexis WinDeed](https://www.windeed.co.za/)
- [Inoxico](https://www.inoxico.com/)
- [XDS Credit Bureau](https://www.xds.co.za/)
- [Experian South Africa](https://www.experian.co.za/)
- [OpenCorporates](https://opencorporates.com/registers/237)
- [SARS Tax Compliance Status](https://www.sars.gov.za/individuals/manage-your-tax-compliance-status/)
- [B-BBEE Commission Portal](https://portal.bbbeecommission.co.za/)

---

**Report Prepared By:** Claude Code
**Confidence Level:** HIGH
**Last Updated:** 2026-02-09
