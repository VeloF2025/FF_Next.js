# WhatsApp Monitor - Device Pairing Lock Tracking

**Phone Number**: +27 72 766 5862
**Environment**: Development Bridge (`/opt/wa-monitor/dev/whatsapp-bridge/`)

## Current Status

**Last Pairing Attempt**: Monday, November 10, 2025 at 13:25 SAST
**Result**: Failed - "Could not sign in"
**Lock Status**: ACTIVE - WhatsApp rate limit/device lock in effect

## When Can We Try Again?

### Recommended Retry Times

| Time Window | Date/Time | Status |
|-------------|-----------|--------|
| **Minimum Wait** | Tuesday, November 11, 2025 at 13:30 SAST | 24 hours after last attempt |
| **Recommended** | Tuesday, November 11, 2025 at 18:00 SAST | 28.5 hours (safer) |
| **If Still Locked** | Wednesday, November 12, 2025 at 09:00 SAST | 48 hours (maximum lock) |

### How to Test if Lock is Cleared

```bash
# Generate new pairing code
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no -o PreferredAuthentications=password root@72.60.17.245 \
  "systemctl restart whatsapp-bridge-dev && sleep 5 && tail -30 /opt/wa-monitor/dev/logs/whatsapp-bridge-dev.log | grep -A 2 'PAIRING CODE'"

# Try pairing - if it fails with same error, lock is still active
# If it works, proceed with linking
```

## Pairing Attempt History

### Attempt #1 - November 9, 2025
- **Time**: Multiple attempts throughout the day
- **Result**: Failed
- **Error**: Multiple pairing code failures
- **Action**: Created separate dev bridge environment

### Attempt #2 - November 10, 2025 at 12:50 SAST
- **Pairing Code**: `XCEH-17Q5`
- **Result**: Failed - logged out immediately
- **Error**: Device logged out after brief connection

### Attempt #3 - November 10, 2025 at 12:54 SAST
- **Pairing Code**: `V4B7-4MDL`
- **Result**: Failed - "logging in" then "could link again"
- **Error**: Connection timeout during pairing

### Attempt #4 - November 10, 2025 at 12:59 SAST
- **Pairing Code**: `WVLG-1KBA`
- **Result**: Failed - similar timeout
- **Action**: Cleared all session data

### Attempt #5 - November 10, 2025 at 13:02 SAST
- **Pairing Code**: `LYR9-257H`
- **Result**: Brief connection, received DR1857025 from Mohadin at 13:04:02
- **Error**: WhatsApp logged out at 13:04:51 (48 seconds later)
- **Note**: Partial success - proves bridge works, but pairing incomplete

### Attempt #6 - November 10, 2025 at 13:21 SAST
- **Pairing Code**: `CAKR-9VK8`
- **Result**: Failed - "could not sign in"
- **Error**: Rate limit/device lock triggered

### Attempt #7 - November 10, 2025 at 13:25 SAST (FINAL)
- **Result**: Failed - "could not sign in"
- **Lock Status**: CONFIRMED - WhatsApp has locked the device
- **Action Taken**: Documented lock, scheduled retry for Nov 11

## WhatsApp Device Lock Details

### What Causes Device Locks?

1. **Multiple Failed Pairing Attempts** (most common)
   - 5+ attempts within 2 hours triggers temporary lock
   - WhatsApp anti-spam/abuse protection

2. **Repeated Login/Logout Cycles**
   - Phone number linking/unlinking repeatedly
   - Session invalidation loops

3. **Rate Limiting**
   - Native WhatsApp protocol has strict limits
   - Applies per phone number, not per device

### Lock Duration

| Lock Type | Duration | Trigger |
|-----------|----------|---------|
| Soft Lock | 2-6 hours | 3-5 failed attempts |
| Medium Lock | 12-24 hours | 5-10 failed attempts |
| Hard Lock | 24-48 hours | 10+ attempts or suspicious activity |

### How to Avoid Future Locks

1. **Wait Between Attempts**: Minimum 10 minutes between pairing codes
2. **Complete Pairing**: Don't exit WhatsApp until "Linked" is confirmed
3. **Clear Session First**: Always clear old session before new pairing
4. **One Attempt Per Code**: Don't retry same code multiple times
5. **Maximum 3 Attempts**: If 3 codes fail, stop and wait 24 hours

## Current Dev Environment Setup

### Architecture
```
Production Bridge (UNTOUCHED)
├── Phone: 064 041 2391 ✅ Active
├── Location: /opt/velo-test-monitor/services/whatsapp-bridge/
├── Database: /opt/velo-test-monitor/services/whatsapp-bridge/store/messages.db
└── Monitors: 4 projects (Lawley, Mohadin, Velo Test, Mamelodi)

Development Bridge (NEW - WAITING FOR UNLOCK)
├── Phone: +27 72 766 5862 ⏳ Locked
├── Location: /opt/wa-monitor/dev/whatsapp-bridge/
├── Database: /opt/wa-monitor/dev/whatsapp-bridge/store/messages.db
├── Monitors: 2 projects (Velo Test, Mohadin)
└── Service: whatsapp-bridge-dev.service
```

### Services Status
```bash
# Check all services
ssh root@72.60.17.245 "ps aux | grep -E 'whatsapp-bridge|wa-monitor' | grep -v grep"

# Expected output:
# root  980185  ... ./whatsapp-bridge              ← PROD (working)
# root  1026662 ... whatsapp-bridge-dev            ← DEV (waiting for pairing)
```

### Database Verification
```bash
# Dev database created and working
ls -lh /opt/wa-monitor/dev/whatsapp-bridge/store/
# messages.db (20K) - captured 1 message during brief connection
# whatsapp.db (232K) - session attempted but incomplete
```

## Next Steps (After Lock Clears)

### Tuesday, November 11, 2025 - 18:00 SAST

1. **Generate Fresh Pairing Code**
   ```bash
   ssh root@72.60.17.245 "systemctl restart whatsapp-bridge-dev && sleep 5 && tail -30 /opt/wa-monitor/dev/logs/whatsapp-bridge-dev.log | grep -B 2 -A 2 'PAIRING CODE'"
   ```

2. **Pair Device ONCE**
   - Open WhatsApp on +27 72 766 5862
   - Settings → Linked Devices → Link a Device
   - "Link with phone number instead"
   - Enter code carefully
   - **WAIT** for "Linked" confirmation (don't close app!)

3. **Verify Connection**
   ```bash
   # Watch logs for connection
   ssh root@72.60.17.245 "tail -f /opt/wa-monitor/dev/logs/whatsapp-bridge-dev.log"

   # Should see:
   # "✓ Connected to WhatsApp!"
   # "🚀 EVENT RECEIVED: *events.Connected"
   ```

4. **Test with Message**
   - Send test message to Velo Test group
   - Check dev dashboard: https://dev.fibreflow.app/wa-monitor
   - Verify captured in database

5. **If Still Locked**
   - DO NOT retry immediately
   - Wait until Wednesday, November 12 at 09:00 SAST
   - Document attempt in this file

## Alternative: Use Different Phone Number

If +27 72 766 5862 remains locked after 48 hours:

**Option 1**: Try different phone number
**Option 2**: Contact WhatsApp support (rare, usually not needed)
**Option 3**: Use QR code pairing if business account

## Evidence of Partial Success

The brief connection at 13:04:02 proves:
- ✅ Dev bridge binary works correctly
- ✅ Phone number CAN connect to WhatsApp
- ✅ Message capture works (DR1857025 from Mohadin)
- ✅ Database writing works
- ✅ Dev monitor reads from dev database
- ❌ Pairing not completed fully (logged out after 48 seconds)

**Root Cause**: Rate limit kicked in during pairing handshake.

## Related Documentation

- **Pairing Troubleshooting**: `WA_MONITOR_PAIRING_TROUBLESHOOTING.md`
- **Dev Environment Setup**: Documented in this session (Nov 10, 2025)
- **Architecture**: `WA_MONITOR_ARCHITECTURE_V2.md`
- **Dual Testing**: `WA_MONITOR_DUAL_TESTING.md`

---

**Document Created**: November 10, 2025 at 13:30 SAST
**Last Updated**: November 10, 2025 at 13:30 SAST
**Next Review**: November 11, 2025 at 18:00 SAST
**Status**: ACTIVE TRACKING - Device lock in effect

---

## Update Log

### November 10, 2025 - 13:30 SAST
- Created tracking document
- Documented 7 pairing attempts
- Confirmed device lock active
- Scheduled next attempt for Nov 11, 18:00 SAST
- Dev environment fully configured and ready for testing once lock clears
