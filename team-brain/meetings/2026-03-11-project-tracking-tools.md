# Project Tracking Tools and Methodologies Discussion
**Date:** 2026-03-11 | **Duration:** 46 min | **Meeting ID:** 4522
**Attendees:** JP Terblanche, Ettiene Janse van Rensburg, Hein Van Vuuren, Unknown (2)
**Source:** Transcribed from Teams recording via OpenAI Whisper

---

## Full Transcript

[See /tmp/meeting-4522-full-transcript.txt for raw transcript]

## Key Discussion Points

### 1. Project Status Categories (4 pillars)
JP outlined 4 status categories for tracking every PON:
1. **RFO (Ready for Optical)** — Civil side (Ettiene's responsibility)
2. **Optical Live** — Optical side (Johan's responsibility)
3. **Activations** — (Reinhardt's responsibility)
4. **Maintenance** — (Chantelle's responsibility)

For each category, need:
- **Target/Planned date** — when they commit to complete
- **Actual date** — when it was actually completed
- **Comments/Delay column** — reasons for delays (rain, SMME issues, stock issues, site stopped)

### 2. Data Sources & Current Workflow
- Ettiene builds trackers from 3 extracts: HLD drops, OP extract, and zone info
- He reconciles data manually: removes duplicates, identifies feeder vs distribution vs pull-through poles
- XFO information comes from Optical team (Jody, Hartwig, or Tertius) — they build Excels from splice plans
- OneMap exports used for signup counts, point captures
- All trackers are built identically across projects

### 3. FibreFlow vs QField Integration (Key Decision)
**Decision: 2-way sync between FibreFlow and QField**
- FibreFlow for data entry, reporting, comments/storyline tracking
- QField for visual/map-based status changes
- When status changes in QField → update FibreFlow
- When status changes in FibreFlow → sync to QField
- Already proven concept with pole planting counts

### 4. What They Want Built
**Dashboard/Reporting View:**
- Per project → per zone → per PON breakdown
- Show: total PONs, how many RFO, how many optical live, activation penetration %, maintenance status
- Target dates and actual dates
- Trend visualization
- End date projections per project per category

**Working Page (data entry):**
- 4 sections: Civil, Optical, Activations, Maintenance
- Drop-down per project → zone → PON → OLT/POP
- Date entry with dropdowns for status changes
- Comment/delay tracking per PON
- Historical timeline per PON (storyline)

### 5. Johan's Optical Tracking
- Tracks per PON: submitted, FC test, stringing, SJC, tested, delays
- Types comments manually to track why delays happened
- Wants to see timeline/storyline per PON showing what happened on each date

### 6. Monthly Targets & Actuals
- Need to show: "ETAS did 87 RFOs in January, Johan did 40 optical completions"
- Year-end view: total RFOs, total live, total activated
- Time-to-complete metrics: from pole planted → QA → PON RFO → live → activated

### 7. Immediate Action Items
- **Ettiene:** Share project tracker sheets (Loli, Mamelodi focus) with planned dates for next 1-2 weeks
- **Johan:** Fill in planned completion dates for next week's PONs per project
- **Hein:** Import tracker data, build basic working page with 4-category tracking, create dashboard view
- **Priority projects:** Loli (first), Mamelodi, Mamelodi, then the rest

### 8. Data Standardization Requirements
- All trackers must use identical column headers
- Naming conventions must be consistent across projects
- Unique identifiers required for each PON/zone
- Template approach: standardize then replicate

---

## Relevant FibreFlow Modules
- **Projects** — zone/PON structure already exists
- **Activate** — has activation tracking, could extend for RFO/optical/maintenance
- **NOC** — has PON-level views
- **QField Sync** — existing 2-way sync infrastructure
- **Reports** — needs new project progress dashboard
