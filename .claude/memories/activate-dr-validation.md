# DR Validation System (Activate Module)

**Last Updated**: 2026-01-16

---

## Overview

When a DR is submitted via WhatsApp, the system validates it against the `drops` table before processing. Invalid DRs are rejected with automatic WhatsApp notifications to the user.

---

## Validation Flow

```
WhatsApp Message → Go Bridge → FibreFlow API → Validation Check
                                    ↓
                    ┌───────────────┼───────────────┐
                    ↓               ↓               ↓
              DR_NOT_FOUND   PROJECT_MISMATCH    Valid DR
                    ↓               ↓               ↓
              Reject + WA      Reject + WA      Process
              Notification     Notification     Normally
```

---

## Error Codes

| Error Code | Scenario | WhatsApp Message |
|------------|----------|------------------|
| `DR_NOT_FOUND` | DR not in `drops` table | "DR123456 not found in Lawley. Please verify the DR number is correct." |
| `PROJECT_MISMATCH` | DR exists but belongs to different project | "DR123456 belongs to Mohadin, not Lawley. Please resubmit to the correct group." |

---

## Implementation Details

### API (FibreFlow)
- **File**: `pages/api/activate/process-new-dr.ts`
- **Response**: Returns `notifyUser: true` on rejection errors
- **Status Code**: 400 for validation errors

```typescript
// Example rejection response
{
  success: false,
  error: 'DR_NOT_FOUND',
  message: 'DR123456 not found in Lawley. Please verify the DR number is correct.',
  dropNumber: 'DR123456',
  submittedTo: 'Lawley',
  notifyUser: true
}
```

### Go Bridge (WhatsApp)
- **File**: `/home/louis/whatsapp-bridge-go/main.go`
- **Struct**: `FibreFlowErrorResponse` - parses API error responses
- **Service**: `whatsapp-bridge.service` on Velocity Server
- **Log File**: `/home/louis/whatsapp-bridge-go/bridge.log`

```go
// FibreFlowErrorResponse struct
type FibreFlowErrorResponse struct {
    Success    bool   `json:"success"`
    Error      string `json:"error"`
    Message    string `json:"message"`
    DropNumber string `json:"dropNumber"`
    NotifyUser bool   `json:"notifyUser"`
}
```

**Key Functions (Updated Jan 2026):**
- `syncToFibreFlow(client, chatJID, dropNumber, projectName, senderPhone)` - Now handles error responses and sends WA notifications
- `processDropNumbers(client, content, chatJID, sender, timestamp, logger)` - Passes client/chatJID through chain
- `createQAPhotoReview(client, chatJID, dropNumber, projectName, userName, sender, reviewDate)` - Passes client/chatJID through chain

---

## Staging vs Production

| Environment | URL | Go Bridge Target |
|-------------|-----|------------------|
| Staging | vf.fibreflow.app | `FIBREFLOW_API_URL` in main.go |
| Production | app.fibreflow.app | (update when ready) |

---

## Troubleshooting

### Check if validation is working
```bash
# Test API directly
curl -X POST https://vf.fibreflow.app/api/activate/process-new-dr \
  -H "Content-Type: application/json" \
  -d '{"dropNumber":"DR999999","project":"Lawley","senderPhone":"27123456789"}'

# Expected response for invalid DR:
# {"success":false,"error":"DR_NOT_FOUND","message":"DR999999 not found in Lawley...","notifyUser":true}
```

### Check Go Bridge logs
```bash
ssh velo@100.96.203.105  # Password: $VELO_SSH_PASSWORD
tail -50 /home/louis/whatsapp-bridge-go/bridge.log
```

### Restart Go Bridge
```bash
ssh velo@100.96.203.105
echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart whatsapp-bridge.service
```

---

## Related Files

- `pages/api/activate/process-new-dr.ts` - API validation logic
- `/home/louis/whatsapp-bridge-go/main.go` - Go bridge with notification logic
- `src/modules/dr-photo-unified/` - Activate module components
