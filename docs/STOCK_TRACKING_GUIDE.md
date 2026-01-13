# Stock Tracking Guide for Field Technicians

**Version:** 1.0
**Last Updated:** January 13, 2026
**Audience:** Field Technicians, Installation Teams

---

## Overview

This guide explains how to use the equipment tracking system during fiber installations. The system ensures all ONTs and UPS units are properly tracked from checkout to installation.

## Quick Start

### Daily Workflow

```
Morning:
1. Go to warehouse → Receive equipment → Sign for checkout

During Day:
2. Install at customer site → Scan ONT/UPS barcode in WA Monitor

End of Day:
3. Return unused equipment → Scan returns at warehouse
```

---

## Stage 1: Morning Checkout (Warehouse)

### What Happens
- Warehouse staff issues you 10-30 ONTs and UPS units for the day
- Each serial number is recorded against your name
- You sign digitally on the tablet/phone

### What You Need to Do
1. Arrive at warehouse at scheduled time
2. Wait while staff scans equipment serials
3. Review the list of items on screen
4. Sign your name on the digital pad
5. Receive your printed checkout slip (keep this!)

### Your Checkout Slip Shows
```
DAILY CHECKOUT - ISS-202601-0123
Date: 2026-01-13 07:30
Technician: John Smith
Contractor: ABC Installations

Items Issued:
- ONT x 15 (ONT-001 to ONT-015)
- UPS x 15 (UPS-001 to UPS-015)

Signature: [Your signature]
```

---

## Stage 2: Installation at Customer Site

### Scanning Equipment (NEW FEATURE)

When completing QA photos in WA Monitor, you'll now scan the ONT and UPS barcodes.

### Step-by-Step

1. **Complete normal installation** (Steps 1-7 in WA Monitor)

2. **Step 8 - Scan ONT Barcode**
   - Tap the "Scan" button next to "ONT Barcode"
   - Point phone camera at the ONT barcode sticker
   - Wait for beep/confirmation
   - Serial number appears on screen with green checkmark

3. **Step 9 - Scan UPS Serial**
   - Tap the "Scan" button next to "UPS Serial"
   - Scan the UPS barcode
   - Serial number appears with green checkmark

4. **Complete remaining steps** (10-12)

5. **Submit review** - Serials are now linked to this drop number

### What the Screen Shows

```
[✓] 8. ONT Barcode
    Serial: ONT-ABC123 ✓   [Scan] [Clear]

[✓] 9. UPS Serial
    Serial: UPS-XYZ789 ✓   [Scan] [Clear]
```

---

## Troubleshooting Scans

### "Serial not found" Error
**Cause:** The serial number isn't registered in the system.
**Fix:**
- Double-check you're scanning the correct barcode (not product code)
- Try manual entry: Tap "Manual Entry" and type the serial
- If still failing, contact warehouse

### "Serial not issued to you" Error
**Cause:** This equipment was issued to a different technician.
**Fix:**
- Check if you have the correct equipment
- If you borrowed from another technician, contact warehouse for transfer
- Do NOT use equipment issued to someone else

### "Already installed" Error
**Cause:** This serial was already used at another drop.
**Fix:**
- You may have picked up a used unit by mistake
- Get a fresh ONT/UPS from your vehicle stock
- Report the duplicate to warehouse

### Camera Not Working
**Fix:**
1. Allow camera permission when prompted
2. Try "Manual Entry" button to type serial
3. Ensure good lighting on barcode
4. Clean barcode sticker if dirty/damaged

### Barcode Won't Scan
**Possible causes:**
- Damaged/faded sticker
- Poor lighting
- Camera focus issues

**Fix:**
1. Tap "Manual Entry"
2. Type serial number exactly as shown on sticker
3. System validates the same way

---

## Stage 3: End of Day

### Returning Unused Equipment

If you have equipment you didn't install:

1. Return to warehouse
2. Warehouse staff scans each returned item
3. Items are removed from your accountability

### What Counts as "Unaccounted"

At end of day, the system calculates:

```
Unaccounted = Issued - Installed - Returned

Example:
  Issued:    15 ONTs
  Installed: 13 ONTs (scanned at drops)
  Returned:   0 ONTs
  ─────────────────
  Unaccounted: 2 ONTs ⚠️
```

### Unaccounted Item Limits

| Items | Status | Action |
|-------|--------|--------|
| 0-2   | OK | No action needed |
| 3+    | Warning | Review with supervisor |
| 5+    | Alert | May block future checkout |

---

## Best Practices

### Do's
- ✅ Scan equipment at EVERY installation
- ✅ Keep checkout slip for reference
- ✅ Return unused equipment same day
- ✅ Report lost/damaged items immediately
- ✅ Use manual entry if barcode damaged

### Don'ts
- ❌ Use equipment issued to other technicians
- ❌ Skip scanning to "save time"
- ❌ Leave equipment in vehicle overnight (return it!)
- ❌ Swap serials between vehicles without transfer

---

## Common Questions

### Q: Why do I need to scan barcodes?
**A:** Scanning links each piece of equipment to a specific customer installation. This helps:
- Track warranty claims
- Prove you installed the correct equipment
- Reduce accountability disputes
- Generate accurate reports

### Q: What if I forget to scan?
**A:** You can scan later by editing the QA review:
1. Go to WA Monitor
2. Find the drop
3. Click "Edit"
4. Scan the serial numbers
5. Save

### Q: Can I install without scanning?
**A:** Yes, but your daily reconciliation will show "unaccounted" items. Supervisors review this daily.

### Q: What if I lost equipment?
**A:** Report immediately to warehouse. They'll mark it as "lost" and start recovery process. The value may be deducted if patterns of loss continue.

### Q: The serial on the box doesn't match the unit?
**A:** Report to warehouse. Don't install mismatched equipment.

---

## Getting Help

### Contacts
- **Warehouse Issues:** warehouse@fibreflow.app
- **Technical Problems:** support@fibreflow.app
- **Equipment Shortage:** Contact supervisor

### In-App Help
- Tap "?" icon in WA Monitor for quick tips
- Long-press on scan button for video tutorial

---

## Quick Reference Card

Print this and keep in your vehicle:

```
┌─────────────────────────────────────────┐
│        SERIAL SCANNING CHECKLIST        │
├─────────────────────────────────────────┤
│ Step 8: Tap Scan → Scan ONT barcode     │
│         Verify: Green checkmark ✓       │
│                                         │
│ Step 9: Tap Scan → Scan UPS barcode     │
│         Verify: Green checkmark ✓       │
├─────────────────────────────────────────┤
│ ERRORS:                                 │
│ • "Not found" → Try manual entry        │
│ • "Not issued" → Wrong equipment        │
│ • "Already installed" → Get new unit    │
├─────────────────────────────────────────┤
│ HELP: support@fibreflow.app             │
└─────────────────────────────────────────┘
```

---

**Document Version:** 1.0
**Effective Date:** January 13, 2026
**Review Date:** April 13, 2026
