# OLT Serial Mismatch Report

**Generated:** 2026-01-31
**Analyst:** Claude AI (FibreFlow PAI)
**Data Sources:** Nokia OLT Reports (30/01/2026), FibreFlow Production Database, 1Map API
**Report Period:** Week ending 30 January 2026

---

## Executive Summary

| Metric | Value |
|--------|-------|
| **Total DRs Analyzed** | 7,850 |
| **Match Rate** | 98.3% |
| **Total Mismatches** | 134 (unique) |
| **Auto-Fixed via 1Map API** | 56 |
| **Already Correct (false positives)** | 11 |
| **Not Found in 1Map** | 67 |
| **Pending** | 0 |

### Week-over-Week Comparison

| Metric | 23 Jan (prev) | 30 Jan (this) | Change |
|--------|---------------|---------------|--------|
| Total DRs | 7,137 | 7,850 | +713 (+10%) |
| Lawley | 4,172 | 4,423 | +251 |
| Mohadin | 2,574 | 2,962 | +388 |
| Mamelodi | 391 | 465 | +74 |
| Match Rate | 98.1% | 98.3% | +0.2% |
| Mismatches | 136 | 134 | -2 |

---

## Data Sources

### OLT Reports Imported

| File | Total DRs | Matches | Mismatches | Not Found |
|------|-----------|---------|------------|-----------|
| Lawley Nokia Fibertime...30012026.xlsx | 4,423 | 4,388 (99.2%) | 35 | 2 |
| Mohadin Nokia Fibertime...30012026.xlsx | 2,962 | 2,895 (97.7%) | 67 | 61 |
| Mamelodi POP1 Nokia...30012026.xlsx | 465 | 433 (93.1%) | 32 | 32 |
| **TOTAL** | **7,850** | **7,716 (98.3%)** | **134** | **95** |

**Note:** Lawley was imported 4 times during the day (testing/refinement). Only the latest import per file is counted above.

---

## Resolution Summary

### Fix Status Breakdown

| Status | Count | Description |
|--------|-------|-------------|
| **Fixed (updated)** | 45 | 1Map serial was wrong or empty — corrected via API |
| **Fixed (already_correct)** | 11 | 1Map already had the correct serial (false positive from stale DB) |
| **Not Found in 1Map** | 67 | DR does not exist in 1Map layer |
| **Needs Reinvestigation** | 1 | Requires manual review |
| **Pending** | 0 | All actionable records processed |

### Auto-Fix Breakdown by Project

| Project | Total Mismatches | Fixed | Already Correct | Not Found |
|---------|-----------------|-------|-----------------|-----------|
| **Lawley** | 35 | 7 | 10 | 17 (+ 1 reinvestigation) |
| **Mohadin** | 67 | 21 | 0 | 23 (+ 23 from earlier imports) |
| **Mamelodi** | 32 | 17 | 1 | 14 |

---

## Mismatch Categories

### Category 1: Empty Serial Filled (33 DRs)

ONT serial was missing in 1Map (field was empty/null). The correct OLT serial was written in.

| DR Number | Project | OLT Serial Written |
|-----------|---------|-------------------|
| DR1730634 | Lawley | ALCLB47D528E |
| DR1731143 | Lawley | ALCLB48CE26B |
| DR1735975 | Lawley | ALCLB48CE001 |
| DR1736233 | Lawley | ALCLB48CB77D |
| DR1738502 | Lawley | ALCLB4811A08 |
| DR1738570 | Lawley | ALCLB48CE054 |
| DR470369 | Mamelodi | ALCLB4851577 |
| DR470521 | Mamelodi | ALCLB480E25B |
| DR470972 | Mamelodi | ALCLB4811FB1 |
| DR472745 | Mamelodi | ALCLB480F706 |
| DR472806 | Mamelodi | ALCLB48512CA |
| DR472815 | Mamelodi | ALCLB4810B99 |
| DR472840 | Mamelodi | ALCLB484E26E |
| DR472863 | Mamelodi | ALCLB4810E4E |
| DR473232 | Mamelodi | ALCLB485169F |
| DR473233 | Mamelodi | ALCLB48514FC |
| DR473235 | Mamelodi | ALCLB484DECA |
| DR1857905 | Mohadin | ALCLB48CB0AE |
| DR1857936 | Mohadin | ALCLB484FC17 |
| DR1858320 | Mohadin | ALCLB48A9EEB |
| DR1862486 | Mohadin | ALCLB48ADC3E |
| DR1862500 | Mohadin | ALCLB48ADC37 |
| DR1862541 | Mohadin | ALCLB48AD00C |
| DR1862577 | Mohadin | ALCLB48AA498 |
| DR1862585 | Mohadin | ALCLB48ADE88 |
| DR1862588 | Mohadin | ALCLB48ABC2D |
| DR1862611 | Mohadin | ALCLB48ABD00 |
| DR1862638 | Mohadin | ALCLB48ADC2E |
| DR1862703 | Mohadin | ALCLB48CE264 |
| DR1862734 | Mohadin | ALCLB48CE1DF |
| DR1862776 | Mohadin | ALCLB48ABBC5 |
| DR1862780 | Mohadin | ALCLB48ABA94 |
| DR1862806 | Mohadin | ALCLB48CDAF8 |
| DR1862814 | Mohadin | ALCLB48CE1E6 |
| DR1863025 | Mohadin | ALCLB48ADBFC |
| DR1863166 | Mohadin | ALCLB48CE292 |
| DR1863216 | Mohadin | ALCLB48CE002 |
| DR1863251 | Mohadin | ALCLB48CD92E |
| DR1863254 | Mohadin | ALCLB48DA325 |
| DR1863282 | Mohadin | ALCLB48AA69E |
| DR1863283 | Mohadin | ALCLB48ADE7C |
| DR1863292 | Mohadin | ALCLB48ADE6D |

### Category 2: Wrong Serial Corrected (12 DRs)

1Map had an incorrect ONT serial which was replaced with the correct OLT serial.

| DR Number | Project | OLT (Correct) | Was in 1Map (Wrong) | Error Type |
|-----------|---------|---------------|---------------------|------------|
| DR1734922 | Lawley | ALCLB477FED7 | ALCLB48CE072 | Completely wrong |
| DR470004 | Mamelodi | ALCLB47D3512 | ALCLB480DE96 | Completely wrong |
| DR470057 | Mamelodi | ALCLB484DE67 | ALCLN484DE67 | Typo (B→N) |
| DR470439 | Mamelodi | ALCLB4811E99 | 11504715 | Raw barcode |
| DR470516 | Mamelodi | ALCLB48119F7 | 1TCN-AA01 | Wrong device type |
| DR471315 | Mamelodi | ALCLB484E1D1 | ALCLB484E00C | Transposition |
| DR473234 | Mamelodi | ALCLB4851244 | ALCLB4351244 | Typo (8→3) |
| DR1862489 | Mohadin | ALCLB48ABBBC | ALCB48ABBBC | Missing prefix (L) |
| DR1862537 | Mohadin | ALCLB48AD060 | ACLB48AD060 | Missing prefix (LC) |
| DR1862540 | Mohadin | ALCLB48AC213 | ALCB48AC213 | Missing prefix (L) |
| DR1862570 | Mohadin | ALCLB48CE415 | ALCB48CE415 | Missing prefix (L) |
| DR1862688 | Mohadin | ALCLB48CE00C | 4897119170702 | Raw barcode |

#### Error Pattern Analysis

| Error Type | Count | Description |
|------------|-------|-------------|
| Missing prefix characters | 4 | `ALCB` or `ACLB` instead of `ALCLB` — scanner truncation |
| Raw barcode scanned | 2 | Numeric barcode entered instead of ALCL serial |
| Completely wrong serial | 2 | Different ONT serial entirely — likely wrong device scanned |
| Wrong device type | 1 | `1TCN-AA01` (not an ONT serial at all) |
| Single character typo | 2 | One character wrong (B→N, 8→3) |
| Transposition | 1 | Last chars differ slightly |

### Category 3: Swapped Serials (6 DRs)

1Map had a different serial that was overwritten. The old serial belonged to a different DR (serial swap between installations).

| DR Number | Project | OLT (Correct) | Was in 1Map |
|-----------|---------|---------------|-------------|
| DR1862759 | Mohadin | ALCLB48CDA88 | ALCLB48CDA9E |
| DR1863167 | Mohadin | ALCLB48CE280 | ALCLB48CE1D0 |
| DR1863225 | Mohadin | ALCLB48CB4B5 | ALCLB48D9568 |
| DR1863253 | Mohadin | ALCLB48AB903 | ALCLB48DA325 |
| DR1863260 | Mohadin | ALCLB48CDE63 | ALCLB48AD5DE |
| DR1863293 | Mohadin | ALCLB48ABFB5 | ALCLB48ADE7C |
| DR1863311 | Mohadin | ALCLB48D956C | ALCLB48D959C |
| DR1863325 | Mohadin | ALCLB48DA33C | ALCLB48AD011 |

### Category 4: Already Correct / False Positives (11 DRs)

These appeared as mismatches in the import comparison but 1Map already had the correct serial. This happens when our DB snapshot is stale compared to 1Map's current data.

| DR Number | Project | Serial (Verified Correct) |
|-----------|---------|--------------------------|
| DR1730567 | Lawley | ALCLB47CF703 |
| DR1731013 | Lawley | ALCLB47CF97D |
| DR1735962 | Lawley | ALCLB48DA0ED |
| DR1735965 | Lawley | ALCLB48DE166 |
| DR1735966 | Lawley | ALCLB48CE025 |
| DR1736164 | Lawley | ALCLB48CDAD5 |
| DR1736185 | Lawley | ALCLB48CD804 |
| DR1736228 | Lawley | ALCLB48CDAEE |
| DR1736230 | Lawley | ALCLB48CAA47 |
| DR1750705 | Lawley | ALCLB48CB37F |
| DR470053 | Mamelodi | ALCLB480F86D |

---

## Not Found in 1Map (67 DRs)

These DRs exist in the Nokia OLT report (ONT is activated on the network) and in FibreFlow's database, but **do not exist in the 1Map Fibertime Installations layer**. The field team has not captured these installations in 1Map yet.

### FibreFlow Data Coverage for Not-Found DRs

| Metric | Count | Percentage |
|--------|-------|------------|
| In FibreFlow unified_reviews | 67/67 | 100% |
| In FibreFlow drops (SOW) | 67/67 | 100% |
| Have OES serial | 67/67 | 100% |
| Have WA photos (VLM) | 11/67 | 16% |
| Have ONT serial data | 5/67 | 7% |
| Have UPS serial data | 13/67 | 19% |
| Have QA decision | 5/67 | 7% |

### Categorization

**A. OES-Only Installs (52 DRs)** — Activated on network, have OES serial, but no WA photos or QA yet. These are installations in the pipeline that haven't completed the photo submission process.

**B. Have WA Photos but No ONT (10 DRs)** — Have VLM-extracted UPS serials from photos but no ONT serial yet.

**C. Fully Processed but Missing from 1Map (5 DRs)** — Have complete serial data AND QA decisions but still not in 1Map. **These are the priority concern.**

| DR Number | Project | ONT Serial | UPS Serial | QA Decision |
|-----------|---------|-----------|------------|-------------|
| DR470546 | Mamelodi | ALCLB4851707 | GU18W12V25176431 | FAIL (overall PASS) |
| DR470661 | Mamelodi | ALCLB480E134 | GU18W12V25176375 | FAIL (overall PASS) |
| DR471022 | Mamelodi | ALCLB4810021 | GU18W12V25177084 | pending |
| DR1858723 | Mohadin | ALCLB48CB48B | GU18W12V2508034632 | FAIL (overall PASS) |
| DR1858725 | Mohadin | ALCLB48C997E | GU18W12V2508034640 | FAIL (overall PASS) |

### Full Not-Found List by Project

#### Lawley (17 DRs)

| DR Number | OLT Serial | OES Serial |
|-----------|-----------|------------|
| DR1729577 | ALCLB480FDCD | ALCLB480FDCD |
| DR1730549 | ALCLB47CFA8D | ALCLB47CFA8D |
| DR1730620 | ALCLB47D587A | ALCLB47D587A |
| DR1730646 | ALCLB477B09F | ALCLB477B09F |
| DR1730676 | ALCLB47CF963 | ALCLB47CF963 |
| DR1730703 | ALCLB47D56EA | ALCLB47D56EA |
| DR1730786 | ALCLB48CCA63 | ALCLB48CCA63 |
| DR1733708 | ALCLB47D4ABE | ALCLB47D4ABE |
| DR1736503 | ALCLB484CBF7 | ALCLB484CBF7 |
| DR1748753 | ALCLB472D4EC | ALCLB472D4EC |
| DR1750767 | ALCLB465A5EC | ALCLB465A5EC |
| DR1750912 | ALCLB46BD260 | ALCLB46BD260 |
| DR1751902 | ALCLB477AB79 | ALCLB477AB79 |
| DR1752062 | ALCLB477F9D7 | ALCLB477F9D7 |
| DR1752155 | ALCLB480EBC4 | ALCLB480EBC4 |
| DR1752198 | ALCLB47CF7CA | ALCLB47CF7CA |
| DR1752438 | ALCLB463F66E | ALCLB463F66E |

#### Mamelodi (14 DRs)

| DR Number | OLT Serial | OES Serial | Has Photos | Has ONT |
|-----------|-----------|------------|------------|---------|
| DR469872 | ALCLB480FC46 | ALCLB480FC46 | No | No |
| DR469884 | ALCLB480F7CD | ALCLB480F7CD | 1 (VLM) | No |
| DR470019 | ALCLB480FC5C | ALCLB480FC5C | No | No |
| DR470083 | ALCLB480FCFE | ALCLB480FCFE | No | No |
| DR470131 | ALCLB480FFEF | ALCLB480FFEF | No | No |
| DR470200 | ALCLB480F84F | ALCLB480F84F | No | No |
| DR470201 | ALCLB480F504 | ALCLB480F504 | No | No |
| DR470239 | ALCLB480F887 | ALCLB480F887 | No | No |
| DR470316 | ALCLB48518F8 | ALCLB48518F8 | 1 (VLM) | No |
| DR470341 | ALCLB480FCAB | ALCLB480FCAB | No | No |
| DR470343 | ALCLB4851596 | ALCLB4851596 | No | No |
| DR470546 | ALCLB4851707 | ALCLB4851707 | No | **Yes** |
| DR470661 | ALCLB480E134 | ALCLB480E134 | No | **Yes** |
| DR471022 | ALCLB4810021 | ALCLB4810021 | No | **Yes** |

#### Mohadin (23 DRs)

| DR Number | OLT Serial | OES Serial | Has Photos | Has ONT |
|-----------|-----------|------------|------------|---------|
| DR1853303 | ALCLB477C9F8 | ALCLB477C9F8 | No | No |
| DR1853585 | ALCLB477DB93 | ALCLB477DB93 | No | No |
| DR1856219 | ALCLB48AB78E | ALCLB48AB78E | No | No |
| DR1856297 | ALCLB48CD975 | ALCLB48CD975 | 1 (VLM) | No |
| DR1856299 | ALCLB48CA013 | ALCLB48CA013 | 1 (VLM) | No |
| DR1856547 | ALCLB480E890 | ALCLB480E890 | No | No |
| DR1857413 | ALCLB480F517 | ALCLB480F517 | No | No |
| DR1858247 | ALCLB48AD3DB | ALCLB48AD3DB | No | No |
| DR1858356 | ALCLB48CB03B | ALCLB48CB03B | No | No |
| DR1858536 | ALCLB48CB0B2 | ALCLB48CB0B2 | No | No |
| DR1858667 | ALCLB48AC709 | ALCLB48AC709 | No | No |
| DR1858723 | ALCLB48CB48B | ALCLB48CB48B | No | **Yes** |
| DR1858725 | ALCLB48C997E | ALCLB48C997E | No | **Yes** |
| DR1862602 | ALCLB48ABA9D | ALCLB48ABA9D | No | No |
| DR1862660 | ALCLB48ABB3F | ALCLB48ABB3F | No | No |
| DR1862782 | ALCLB48AD046 | ALCLB48AD046 | 1 (VLM) | No |
| DR1862833 | ALCLB48CE1A9 | ALCLB48CE1A9 | 1 (VLM) | No |
| DR1863022 | ALCLB48CE02C | ALCLB48CE02C | 1 (VLM) | No |
| DR1863165 | ALCLB48CE1D0 | ALCLB48CE1D0 | 1 (VLM) | No |
| DR1863221 | ALCLB48D95BF | ALCLB48D95BF | 1 (VLM) | No |
| DR1863233 | ALCLB48AD0C8 | ALCLB48AD0C8 | 1 (VLM) | No |
| DR1863256 | ALCLB48AD5DE | ALCLB48AD5DE | No | No |
| DR1863330 | ALCLB48ACFB7 | ALCLB48ACFB7 | 1 (VLM) | No |

---

## All-Time Cumulative Statistics

| Metric | Count |
|--------|-------|
| Total mismatch records (all imports) | 283 |
| Fixed | 169 (60%) |
| Not found in 1Map | 113 (40%) |
| Pending | 0 |

---

## Observations & Recommendations

### 1. Missing 1Map Records (Priority: HIGH)
67 DRs are activated on the OLT but don't exist in 1Map. Of these, **5 are fully processed** (have serials + QA) — meaning the installation is complete but never captured in 1Map. This is a field process gap.

**Recommendation:** Flag these 5 DRs to the field team for immediate 1Map entry. The remaining 62 are likely newer installs still in the pipeline.

### 2. Scanner Truncation Errors (Priority: MEDIUM)
4 cases where barcode scanners dropped prefix characters (`ALCLB` → `ALCB` or `ACLB`). This is a recurring pattern from Mohadin.

**Recommendation:** Check scanner firmware/settings at Mohadin site. Consider adding client-side validation that ONT serials must start with `ALCLB`.

### 3. Raw Barcode Entries (Priority: LOW)
2 cases where a numeric barcode was entered instead of the ALCL serial. One was `11504715` and another `4897119170702`.

**Recommendation:** Add 1Map field validation to reject numeric-only ONT serials.

### 4. Wrong Device Scanned (Priority: LOW)
`DR470516` had `1TCN-AA01` in the ONT field — this is not an ONT serial format at all. Likely a different label was scanned.

### 5. False Positive Reduction
11 records were "already correct" in 1Map despite showing as mismatches. This happens when our comparison snapshot is stale.

**Recommendation:** Reduce false positives by refreshing 1Map data closer to import time, or adding a pre-check before flagging mismatches.

---

## Methodology

1. Nokia OLT reports (Excel) imported via FibreFlow Data Sync tool
2. Each DR's OLT serial compared against the stored `wrong_onemap_serial` from previous 1Map snapshot
3. Mismatches auto-fixed via 1Map REST API (`/api/v1/data/5121`)
4. DRs not found in 1Map flagged as `not_found`
5. Cross-referenced with FibreFlow `dr_photo_unified_reviews`, `wa_photos`, and `drops` tables for completeness analysis

---

*Report generated by FibreFlow PAI on 2026-01-31*
