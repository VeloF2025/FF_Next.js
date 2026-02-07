---
name: FiberTime Standards
triggers:
  - fibertime
  - fiber standards
  - pole standards
  - cable standards
  - fiber installation
  - osp standards
  - drop cable
  - ont installation
  - optical testing
  - gpon standards
  - slack requirements
  - dome joint
description: Reference for FiberTime OSP network installation standards including pole specifications, cable routing, customer premises installation, and optical testing requirements
version: 1.1
---

# FiberTime Installation Standards Reference

This skill provides comprehensive FiberTime OSP (Outside Plant) network standards for validating installations and answering technical questions.

## Network Architecture

**Network Hierarchy:**
```
POP (Point of Presence)
  ↓
Primary Feeder (PFN) → First Tier Splitter (FTS)
  ↓
Secondary Feeder (SFN) → Second Tier Splitter (STS)
  ↓
Distribution Feeder (DFN)
  ↓
Drop Cable → Customer Premises → ONT
```

**Key Principles:**
- Live fiber "link" from POP to customer - no back feeding
- No "spur" cables on primary feeder
- Slack at every pole for maintenance
- All fibers tested before activation

---

## Pole Standards

### Pole Specifications
- **Standard**: CCA H4 SANS 754
- **Long-haul pole heights**: 5.4m, 7.2m, 9.0m

### Slack Requirements by Pole Height

| Pole Height | Required Slack |
|-------------|----------------|
| 5.4m (CCA H4 SANS 754) | 15.8m |
| 7.2m (CCA H4 SANS 754) | 19.4m |
| 9.0m (CCA H4 SANS 754) | 23.0m |

**Slack Installation:**
- Slack brackets form part of civil pole dressing
- Placed at all locations with breakouts to secondary feeder cable
- Slack coiled and neatly tied back on brackets
- Maximum slack coil diameter: ≤300mm

### Pole Components
- Stays and struts per civil specification
- All components labeled according to labeling convention
- Pole dressing conforms to on-site training examples
- Manholes fitted with slack brackets and emergency mounting points

---

## Cable Standards

### Cable Types
**Primary Feeder:**
- ADSS (All-Dielectric Self-Supporting) cable
- No splicing before first-tier splitter
- No drop cables allowed
- Slack on each pole for maintenance (15.8m, 19.4m, or 23.0m depending on pole height)

**Secondary Feeder:**
- Mini ADSS cables preferred (reduces need for stays/struts, speeds deployment)
- Splicing allowed to accommodate drops along route
- "Spur" links allowed to reach all distribution sections

**Distribution Feeder:**
- Cable sizes 24F down to 2F
- Mini ADSS cables preferred

**Drop Cables:**
- Maximum length: 50m from STS to ONT
- Maximum slack: 10m
- Slack coils: ≤300mm diameter
- Stored on STS pole in slack bracket

### Cable Installation Rules
- All cables labeled according to FiberTime naming convention
- Cable slack hidden behind ONT or mounting bracket
- Drop cable coiled once in slack management on back of ONT before plugging into PON port
- Fiber enters vertically into fiber entry point, looped at least once around integrated fiber management

### Labeling
- All cabling entering POP site labeled
- Manholes labeled (e.g., "KYA.MH.A001", "KYA.MH.A002")
- All dome joint components labeled
- Drop numbers printed according to FiberTime naming standards (format: DRXXXX)
- FiberTime ONT sticker applied
- Nokia Serial number sticker applied below Nokia name

---

## POP Site Standards

### Civil Environment
- Trenched infrastructure with collocated point
- Two manholes outside POP for optical cable entry
- First two manholes numbered and named (e.g., "KYA.MH.A001" and "KYA.MH.A002")
- Manholes fitted with slack brackets and emergency mounting points
- 2x 110mm sleeves from both manholes into POP site
- 7-way 14/10 in one manhole, 2-way 14/10 in other (for redundancy)
- Plinth or pedestal design by structural engineer
- Entry point sealed with expanding foam, neatened inside
- Power cable enters as 75mm Nextube, no visible sign of entry (bottom entry)
- Ducts separated, cables tied to cable tray one by one
- Duct cut-back: 1.5m total inside manhole with 150mm outer sheathing

### Optical Environment
- Fiber cabling collocated in two manholes in front of POP
- Both manholes supplied with 50m slack on primary feeder and backhaul cable (15m for maintenance)
- Slack on slack bracket, neatly tied back
- All cabling labeled according to FiberTime labeling and naming convention
- Optical cable exiting duct neatly tied to cable tray
- ISP Optical standards for termination inside POP

### Third Party Environment
- Optical cable and route trenched underground only
- Backhaul fiber floated separately in 2-way 14/10 duct entering POP
- Backhaul fiber separate from feeder cables as far as possible
- Backhaul cables marked in manholes entering POP
- Backhaul fiber NEVER in dome joint with feeder cables outside POP (may be spliced in emergency but installed in separate dome)
- Backhaul cable and ducting marked as high risk

---

## Dome Joint Standards

### Installation Requirements
- Slack brackets at all breakout locations to secondary feeder cable
- Emergency mounting points for dome joint installation
- Slack brackets part of civil pole dressing
- All components labeled per labeling convention
- Backhaul fiber never presented in dome joint with feeder cables outside POP
- Separate dome if backhaul splicing required in emergency

---

## Customer Premises Standards

### Entry Point Selection

**All Housing Types:**
- Approximately midpoint of house
- Ask homeowner about Wi-Fi usage area
- Entry into common area (living room) preferred
- Entry should accommodate tenants not living in the house
- Non-common area entries require customer awareness of Wi-Fi coverage limitations
- Within 10m cable run of main power supply (Formal)
- Within 5m of electrical outlet (Informal)
- Entry point as close as possible to peak of roof
- Entry within 10m of ONT location inside (RDP)

### Installation Standards by Housing Type

#### Formal Housing
**Entry Method:**
- Drill into highest point of curve of IBR or corrugated zinc roof
- Use pigtail screw secured with black marine silicone HV rated and/or Super Laykold tape
- Secure drop cable by wrapping dead-end onto drop cable and hooking to pigtail screw
- Drill 12mm hole through wall
- Insert 12/10mm duct (same length as wall thickness) to secure drop
- Drop fiber makes small loop before entering house (water drainage)
- Seal duct after drop cable installation
- Fix damages with Polyfilla

**Cable Routing:**
- Unobtrusive as possible, fitted to natural contours (corners, skirting, ceilings)
- Open space runs on walls only as last resort
- Cable runs short as possible
- Slack hidden behind ONT or mounting bracket
- Drop cable coiled once in slack management on back of ONT before PON port
- Power supply cable (Gizzu/UPS) secured to wooden board, neatly routed to main power supply (glue gun or saddles)

#### Informal Housing
**Entry Method:**
- Drill 5mm pilot hole through zinc into trusses
- Use pigtail screw secured into pilot hole
- Hole sealed
- Secure drop cable by wrapping dead-end onto drop cable and hooking to pigtail screw
- Drop fiber makes small loop before entering house (water drainage)
- Enter house by drilling hole and installing electrical gland to secure drop entry
- Entry point sealed outside to prevent weather damage
- If entry between roof and trusses, use 12/10mm duct to protect from heat and pinching (duct sealed)

**Cable Routing:**
- Unobtrusive as possible, fitted to natural contours
- Open space runs only as last resort
- Short cable runs
- Slack hidden behind ONT
- Power supply cable (Gizzu/UPS) secured to wooden board or directly to wall, neatly routed
- Cable installed to surfaces not exposed to zinc or heat
- Saddles in spec with cable OD min 3mm ID min 300mm spacing, clear silicone to secure

#### RDP Housing
**Entry Method:**
- Preferably guest bedroom (closest to pole, best Wi-Fi signal)
- Supervisor approval required for different rooms
- Non-common area requires customer awareness of Wi-Fi coverage
- Entry within 10m of main power supply
- Entry as close as possible to ONT location inside
- Land on roof trusses behind fascia board (drill hole through fascia into roof trusses)
- Drill 12mm hole through wall
- Insert 12/10mm duct (same length as wall)
- Duct cut end-to-end to slide over drop cable (SC-APC connector won't fit through duct)
- Seal duct after installation
- Fix damages with Polyfilla

**Cable Routing:**
- Unobtrusive, fitted to natural contours
- Short runs
- Slack hidden behind ONT
- Power supply cable secured with glue gun or saddles

### ONT/Mini-UPS Installation Checklist

**Components Required:**
1. Varnished wooden board (280mm x 120mm) with 4 pre-drilled holes
2. ONT bracket
3. X 2 flat head self-tapping screws for ONT bracket
4. X 2 self-tapping screws or fisher plugs for bricks (wooden board mounting)
5. X 1 black cable tie for mounting Gizzu
6. Nokia Optical Network Terminal (ONT)
7. Mini-UPS (Gizzu)
8. 10m 3-prong power supply cord for Gizzu
9. Multi plug
10. FiberTime ONT sticker
11. Brady Tape for drop number (matches drop label at distribution point)

**Installation Steps:**

1. **Wooden Board (280mm x 120mm):**
   - Varnish and trim edges
   - Fix against wall using level
   - Mark 2 holes, drill with 6mm bit
   - Tighten with 2 self-tapping screws
   - If fixed to outer wall with protruding screws, seal with black marine silicone and/or Laykold tape

2. **ONT Bracket:**
   - Drill 5mm hole in middle of bracket for cable tie
   - Place bracket in middle of wooden board
   - Mark 2 holes, fix with 2 flat head self-tapping screws
   - Use level before tightening

3. **Drop Cable Slack:**
   - Coil drop cable slack (max 10m) to loop ≤300mm diameter
   - Prevents breaking fiber when ONT unmounted for maintenance
   - Use 2x black cable ties on loop to keep neat
   - Put drop cable slack over ONT bracket before mini-UPS installation

4. **Mini-UPS (Gizzu) Installation:**
   - Remove plastic tape from middle
   - Mount on top of ONT bracket, secure with cable tie
   - Plug supplied multi plug into legal power supply
   - Plug AC power cable into AC input socket and type D plug of mini-UPS
   - When extension cable plugged in and switched on, battery lights of mini-UPS light up (not during loadshedding)
   - Connect DC output cable (2 ends) to output socket of mini-UPS and ONT DC jack port
   - Output voltage selector on mini-UPS: 12V
   - Secure power cable of mini-UPS to wooden board (glue gun or saddles)

5. **ONT Installation:**
   - Fiber runs vertically into fiber entry point
   - Looped at least once around integrated fiber management before connecting to PON port
   - Connect DC output cable to DC jack port of ONT
   - Install ONT onto bracket by sliding mounting holes into bracket
   - ONT antennas in upright position
   - Neaten DC cable with small cable tie, store behind ONT

6. **FiberTime Sticker:**
   - Apply to middle of ONT (straight, neat, no lights covered)
   - Print drop number per FiberTime naming standards: DRXXXX
   - Apply drop number label onto sticker where space provided
   - Drop label black on yellow
   - Apply small Serial number sticker of ONT below Nokia name

7. **Final Installation:**
   - Must look like provided reference photos
   - For RDP: Fiber coiled anti-clockwise at back of ONT to enter PON port without bends

---

## Optical Testing Standards

### Power Budget (GPON Class C+)

**OLT (TX +5dBm) at 1490nm:**
- Maximum Receive Level: -12dBm
- Minimum Receive Level: -32dBm
- Maximum Power Budget: 30dB
- Minimum Power Budget: 14dB

**ONT (TX +2.5dBm) at 1310nm:**
- Maximum Receive Level: -8dBm
- Minimum Receive Level: -26dBm
- Maximum Power Budget: 32dB
- Minimum Power Budget: 13dB

### Link Loss Budget

**Maximum Acceptable Losses:**
- Head-End OLT and ONT: 0.8 dB
- Splitter 1:2: 3.8 dB
- Splitter 1:4: 7.1 dB
- Splitter 1:8: 10.2 dB
- Splitter 1:16: 13.5 dB
- Splitter 1:32: 16.5 dB
- Splitter 1:64: 20.4 dB
- Splice: Pass ≤ 0.23dB Warning ≤ 0.25dB Fail ≥ 0.25dB
- Mated connector Loss: 0.5 dB
- Loss 1310nm dB/km: 0.4dB/km
- Loss 1490nm dB/km: 0.26dB/km
- Loss 1550nm dB/km: 0.3dB/km
- Margin: 2 dB

**Safety Margin:** 2 dB mandatory to factor in aging of active and passive equipment

**Link Calculation:**
- For most scenarios, 2nd tier split marks conclusion of link loss calculation
- Distance generally standardized to maximum 50 meters
- For exceptions, add distribution length and drop length to overall distance

### Connector Standards

**Optical Return Loss (ORL):**
- Minimum ORL: 32dB
- Test using OTDR or calibrated OLTS tester

**Connector Reflectance:**
- APC (Angled Physical Contact) connectors: maximum reflectance -55dB
- PC (Physical Contact) connectors: maximum reflectance -40dB

### Testing Requirements

**Required Equipment:**
- OTDR with valid calibration certificate (1310nm and 1550nm, iOLM enabled)
- OLTS (Optical Loss Test Set) with calibrated equipment
- PON power meter with in-line function and calibration certificate
- Connector cleaning tools (wet/dry method)

**Testing Procedures:**
1. **OLTS Testing** (during construction phase):
   - Bi-directional testing at 1310nm and 1550nm
   - Loopback function required
   - All results uploaded to EXFO exchange
   - Pass/fail determinations with photographic evidence

2. **iOLM/OTDR Testing** (link handover to port):
   - Distribution up to primary feeder starting point
   - End-to-end testing from preterm cable linking ODF to OLT

3. **Power Meter Testing**:
   - Fault identification in operational network
   - ONT auto-provision monitoring
   - Ongoing maintenance activities

4. **Testing from POP to Customer**:
   - All testing requirements from testing specification required
   - FiberTime validates from STS to POP for "link" completion

### Connector Cleaning

**Cleaning Method (Wet/Dry):**
- Two stages: wet cleaning (dislodges dirt/contaminants), dry cleaning (eliminates residue)
- Use formulated cleaning solutions (excel in dirt removal, avoid static electricity)
- Specialized cleaners for different surfaces

**Cleaning Tools:**
- Dry connector cleaners (lint-free tapes in cassettes/boxes/compact handheld tools)
- Probes for cleaning within mating adapters
- Use specialized swab for far end (not general probes)

**Importance:**
- Dirty connectors cause connector loss, elevated reflectance, pollution transceivers
- Network operators report 15-50% of network complications from dirty connectors
- Clean all optical connectors before testing

---

## Network Sections Reference

### Section A - Primary Feeder
- From POP to First Tier Splitter
- No splitting before FTS
- No drop cables
- Slack on each pole (15.8m, 19.4m, or 23.0m)
- No back feeding
- No "spur" cables

### Section B - Secondary Feeder
- From FTS to Second Tier Splitter
- Splicing allowed to accommodate drops
- "Spur" links allowed
- Fiber cables not requiring post-installation testing
- Slack on each pole

### Section C - Distribution Feeder
- From STS to customer drop points
- Cable sizes 24F down to 2F
- Mini ADSS preferred
- Slack on each pole

### Section D - Drop Cables
- From STS to customer premises ONT
- Maximum 50m length
- Maximum 10m slack stored at STS
- Slack coils ≤300mm diameter
- Testing required from STS to POP for "link" completion

---

## Quality Standards

### Zero Tolerance Rules
- No console.log in production code
- No empty catch blocks
- 100% type coverage
- Maximum 300 lines per file
- All edge cases handled
- Proper error messages
- Security vulnerabilities addressed

### Training Requirements

**Contractors:**
- Training from certified institute required
- Required for both Civil and Optical contractors

**Training Providers:**
- Triple Play – Splicing and Testing
- Terafibre – OSP work install and site management

**Site Managers:**
- Certified Site Management Specialist (SMS) – Terafibre
- Outside Plant (OSP) Project Specialist

**Team Leaders:**
- Certified Shared Pole Route Specialist (SPRS)

**Splicers:**
- Certified Fiber Optic Technician (CFOT) Training

**Testing:**
- Fiber Testing Specialist Course (FTS)

### Health and Safety
- Comply with OHSA Act 85 of 1993
- Health and safety vetting before work commencement
- Master safety file required (26 items including PPE, inspections, policies, procedures, etc.)

---

## Usage Notes

When validating QField photos or answering installation questions:

1. **Reference the correct section** based on network location (POP, Primary, Secondary, Distribution, Drop)
2. **Check pole height** to verify correct slack amount (5.4m=15.8m, 7.2m=19.4m, 9.0m=23.0m)
3. **Verify cable type** matches section requirements (ADSS, Mini ADSS, drop cable)
4. **Confirm slack coil diameter** ≤300mm at all locations
5. **Validate housing type** installation matches standards (Formal, Informal, RDP)
6. **Check ONT installation** includes all required components and proper fiber management
7. **Verify labeling** follows FiberTime naming conventions (DRXXXX format)
8. **Confirm testing** meets optical budget and loss requirements for GPON Class C+

---

## Document References

- Fibertime-Standard-OSP-Network.20240219[57].pdf
- Installation Standards - Formal - Rev 1.1-1.pdf
- Installation Standards - Informal - Rev 1.1-1.pdf
- Installation Standards - RDP housing - Rev 1.1-1.pdf
- Optical Assurance Testing Specification GPON - Rev 1.1.pdf

**Last Updated:** 2026-02-07
**Version:** 1.1
**Status:** Active
