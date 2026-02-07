# Monitor.py Update Report - Kill Switch & Mamelodi Validation

**Date:** November 14, 2025
**Updated File:** `/home/louisdup/VF/Apps/FF_React/scripts/monitor-updated.py`
**Original File:** `/opt/wa-monitor/prod/modules/monitor.py` (VPS)

---

## Summary of Changes

This update implements two critical features:

1. **Global Kill Switch** - Environment variable to disable WhatsApp auto-reply messages
2. **Mamelodi Validation** - Add Mamelodi to drop validation system (alongside Mohadin and Lawley)

**Total Changes:** 4 modifications across 50 lines of code

---

## Change 1: Add Global Kill Switch (Lines 16-17)

**Location:** After imports, before class definition

**Before:**
```python
logger = logging.getLogger(__name__)

class DropMonitor:
    """Monitors WhatsApp messages for drop numbers with validation."""
```

**After:**
```python
logger = logging.getLogger(__name__)

# 🚨 GLOBAL KILL SWITCH - Set to 'false' to disable all WhatsApp auto-reply messages
ENABLE_WHATSAPP_MESSAGES = os.getenv('ENABLE_WHATSAPP_MESSAGES', 'true').lower() == 'true'

class DropMonitor:
    """Monitors WhatsApp messages for drop numbers with validation."""
```

**Purpose:**
- Provides emergency off-switch for WhatsApp messaging
- Defaults to 'true' (enabled) - safe default
- Can be disabled via environment variable: `ENABLE_WHATSAPP_MESSAGES=false`

**Usage:**
```bash
# Disable messages temporarily
export ENABLE_WHATSAPP_MESSAGES=false
systemctl restart wa-monitor-prod

# Re-enable messages
export ENABLE_WHATSAPP_MESSAGES=true
systemctl restart wa-monitor-prod
```

---

## Change 2: Add Kill Switch Check in send_whatsapp_direct_message() (Lines 206-209)

**Location:** Inside `send_whatsapp_direct_message()` method, before API calls

**Before:**
```python
def send_whatsapp_direct_message(self, group_jid: str, recipient_phone: str, message: str) -> bool:
    """Send direct WhatsApp message with @mention via Sender API (port 8081) with fallback."""
    # Try Sender API first (port 8081 - with @mentions)
    try:
        recipient_jid = f"{recipient_phone}@s.whatsapp.net"
        conn = http.client.HTTPConnection("localhost", 8081, timeout=5)
```

**After:**
```python
def send_whatsapp_direct_message(self, group_jid: str, recipient_phone: str, message: str) -> bool:
    """Send direct WhatsApp message with @mention via Sender API (port 8081) with fallback."""

    # 🚨 KILL SWITCH CHECK
    if not ENABLE_WHATSAPP_MESSAGES:
        logger.warning(f"🚫 Message NOT sent (kill switch active): {message[:50]}...")
        return True  # Return True so processing continues

    # Try Sender API first (port 8081 - with @mentions)
    try:
        recipient_jid = f"{recipient_phone}@s.whatsapp.net"
        conn = http.client.HTTPConnection("localhost", 8081, timeout=5)
```

**Purpose:**
- Intercepts all WhatsApp messages before sending
- Logs suppressed messages for debugging
- Returns `True` so drop processing continues normally (drops still saved to database)
- Only blocks the WhatsApp API call - all other logic remains active

**Behavior When Kill Switch Active:**
- ✅ Drops still validated against valid_drop_numbers table
- ✅ Invalid drops still logged to invalid_drop_submissions table
- ✅ Drops still saved to qa_photo_reviews table
- ❌ WhatsApp auto-reply messages NOT sent
- 📝 Log message shows: "🚫 Message NOT sent (kill switch active)..."

---

## Change 3: Add Mamelodi to Validation (Line 293)

**Location:** In `process_message()` method, validation check condition

**Before:**
```python
# ✅ VALIDATION CHECK - MOHADIN & LAWLEY (other projects pass through)
if project_name in ['Mohadin', 'Lawley']:
    if not self.validate_drop_number(drop_number, project_name):
```

**After:**
```python
# ✅ VALIDATION CHECK - MOHADIN, LAWLEY & MAMELODI (other projects pass through)
if project_name in ['Mohadin', 'Lawley', 'Mamelodi']:
    if not self.validate_drop_number(drop_number, project_name):
```

**Purpose:**
- Enables drop validation for Mamelodi project
- Mamelodi drops will be checked against valid_drop_numbers table
- Invalid Mamelodi drops will be rejected with WhatsApp auto-reply

**Impact:**
- Mamelodi now joins Mohadin and Lawley in validation system
- Velo Test remains bypass-only (no validation)

---

## Change 4: Update Skip Validation Log Message (Line 312)

**Location:** In `process_message()` method, else clause for non-validated projects

**Before:**
```python
else:
    logger.debug(f"⏭️  SKIPPED VALIDATION: {drop_number} (Velo Test and Mamelodi pass through)")
```

**After:**
```python
else:
    logger.debug(f"⏭️  SKIPPED VALIDATION: {drop_number} (Velo Test passes through)")
```

**Purpose:**
- Update log message to reflect that Mamelodi is now validated
- Only Velo Test remains as bypass project (for testing purposes)

**Accuracy:**
- Removes outdated reference to Mamelodi in skip message
- Clearly indicates only Velo Test skips validation

---

## Validation Status by Project (After Update)

| Project | Validation | Auto-Reply on Invalid | Notes |
|---------|-----------|----------------------|-------|
| **Mohadin** | ✅ Active | ✅ Yes | 22,140 valid drops loaded |
| **Lawley** | ✅ Active | ✅ Yes | Needs valid drops loaded |
| **Mamelodi** | ✅ Active (NEW) | ✅ Yes | Needs valid drops loaded |
| **Velo Test** | ⏭️ Bypass | N/A | Testing project - all drops accepted |

---

## Next Steps After Deployment

### 1. Load Mamelodi Valid Drops to Database

**Prerequisites:**
- Export valid drop numbers from SharePoint (Mamelodi project)
- Format as CSV: `drop_number` column

**Load Command:**
```bash
# Edit script to set project = 'Mamelodi'
node /home/louisdup/VF/Apps/FF_React/scripts/sync-mohadin-valid-drops.js

# Or create new script: sync-mamelodi-valid-drops.js
```

**Verify:**
```bash
psql $DATABASE_URL -c "SELECT project, COUNT(*) FROM valid_drop_numbers GROUP BY project;"
# Should show: Mohadin (22,140), Mamelodi (X drops)
```

### 2. Deploy Updated Monitor to VPS

**Upload:**
```bash
sshpass -p "$VPS_SSH_PASSWORD" scp \
  /home/louisdup/VF/Apps/FF_React/scripts/monitor-updated.py \
  root@72.60.17.245:/opt/wa-monitor/prod/modules/monitor.py
```

**Restart (CRITICAL - Use Safe Restart to Clear Cache):**
```bash
ssh root@72.60.17.245 "/opt/wa-monitor/prod/restart-monitor.sh"
```

**Verify Deployment:**
```bash
ssh root@72.60.17.245 "tail -50 /opt/wa-monitor/prod/logs/wa-monitor-prod.log"
# Look for startup messages confirming new code is running
```

### 3. Test Kill Switch (Optional)

**Test in Dev Environment First:**
```bash
# SSH to VPS
ssh root@72.60.17.245

# Set kill switch in dev systemd service
nano /etc/systemd/system/wa-monitor-dev.service
# Add: Environment="ENABLE_WHATSAPP_MESSAGES=false"

systemctl daemon-reload
systemctl restart wa-monitor-dev

# Post test drop to Velo Test group
# Check logs - should see: "🚫 Message NOT sent (kill switch active)"
tail -f /opt/wa-monitor/dev/logs/wa-monitor-dev.log | grep "Message NOT sent"
```

**Production Usage (Emergency Only):**
```bash
# Edit production service
nano /etc/systemd/system/wa-monitor-prod.service
# Add: Environment="ENABLE_WHATSAPP_MESSAGES=false"

systemctl daemon-reload
/opt/wa-monitor/prod/restart-monitor.sh
```

### 4. Monitor Mamelodi Validation

**Watch for Rejections:**
```bash
ssh root@72.60.17.245 "tail -f /opt/wa-monitor/prod/logs/wa-monitor-prod.log | grep Mamelodi"
```

**Check Invalid Drops:**
```bash
psql $DATABASE_URL -c "
  SELECT drop_number, project, sender, submitted_at
  FROM invalid_drop_submissions
  WHERE project = 'Mamelodi'
  ORDER BY submitted_at DESC
  LIMIT 10;
"
```

---

## Verification Checklist

After deployment, verify:

- [ ] Monitor service restarted successfully
- [ ] Logs show startup messages (no errors)
- [ ] Mamelodi drops trigger validation checks
- [ ] Invalid Mamelodi drops are rejected
- [ ] WhatsApp auto-replies sent (if kill switch OFF)
- [ ] Valid drops still added to database
- [ ] Velo Test drops bypass validation (unchanged)

---

## Rollback Plan

If issues occur, revert to original monitor.py:

```bash
# VPS has backup: /opt/wa-monitor/prod/modules/monitor.py.backup

ssh root@72.60.17.245 "
  cd /opt/wa-monitor/prod/modules &&
  cp monitor.py monitor.py.failed &&
  cp monitor.py.backup monitor.py &&
  /opt/wa-monitor/prod/restart-monitor.sh
"
```

---

## Code Quality Checks

✅ All existing code preserved
✅ Exact indentation maintained
✅ No logic changes beyond specified requirements
✅ Kill switch defaults to enabled (safe)
✅ Kill switch returns True (processing continues)
✅ Log messages updated for accuracy
✅ Comments added for clarity

---

## Files Generated

1. **Updated Monitor:** `/home/louisdup/VF/Apps/FF_React/scripts/monitor-updated.py`
2. **This Report:** `/home/louisdup/VF/Apps/FF_React/scripts/MONITOR_UPDATE_REPORT.md`

---

## Support

If validation issues occur:

1. Check logs: `tail -100 /opt/wa-monitor/prod/logs/wa-monitor-prod.log`
2. Verify valid drops loaded: `psql $DATABASE_URL -c "SELECT COUNT(*) FROM valid_drop_numbers WHERE project = 'Mamelodi';"`
3. Check rejections: `psql $DATABASE_URL -c "SELECT * FROM invalid_drop_submissions WHERE project = 'Mamelodi' ORDER BY submitted_at DESC LIMIT 5;"`
4. Test kill switch: Set `ENABLE_WHATSAPP_MESSAGES=false` temporarily
5. See: `docs/wa-monitor/DROP_VALIDATION_SYSTEM.md` for complete validation guide

---

**Report Generated:** November 14, 2025
**Status:** ✅ Ready for deployment
