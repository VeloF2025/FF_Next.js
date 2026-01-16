#!/usr/bin/env python3
"""Patch Go bridge to add DR acknowledgment with reply-to support"""

with open('/home/louis/whatsapp-bridge-go/main.go', 'r') as f:
    content = f.read()

changes = []

# 1. Add FIBREFLOW_ACK_API_URL constant after FIBREFLOW_API_URL
old_const = 'const FIBREFLOW_API_URL = "https://vf.fibreflow.app/api/activate/process-new-dr"'
new_const = 'const FIBREFLOW_API_URL = "https://vf.fibreflow.app/api/activate/process-new-dr"\nconst FIBREFLOW_ACK_API_URL = "https://vf.fibreflow.app/api/activate/dr-acknowledgment"'

if old_const in content and 'FIBREFLOW_ACK_API_URL' not in content:
    content = content.replace(old_const, new_const)
    changes.append('Added FIBREFLOW_ACK_API_URL constant')

# 2. Add DrAcknowledgmentResponse struct after FibreFlowErrorResponse
if 'DrAcknowledgmentResponse' not in content:
    old_struct_end = '\tNotifyUser bool   `json:"notifyUser"`\n}'
    new_struct = old_struct_end + '''

// DrAcknowledgmentResponse represents response from FibreFlow acknowledgment API
type DrAcknowledgmentResponse struct {
	Success    bool   `json:"success"`
	Data       struct {
		DropNumber string `json:"dropNumber"`
		Found      bool   `json:"found"`
		PhotoCount int    `json:"photoCount"`
		OntSerial  string `json:"ontSerial"`
		UpsSerial  string `json:"upsSerial"`
		Message    string `json:"message"`
	} `json:"data"`
}'''
    # Only replace first occurrence in FibreFlowErrorResponse
    idx = content.find('type FibreFlowErrorResponse struct')
    if idx > 0:
        end_idx = content.find(old_struct_end, idx)
        if end_idx > 0:
            content = content[:end_idx] + new_struct + content[end_idx+len(old_struct_end):]
            changes.append('Added DrAcknowledgmentResponse struct')

# 3. Add sendWhatsAppReply function after sendWhatsAppMessage
if 'sendWhatsAppReply' not in content:
    reply_func = '''

// sendWhatsAppReply sends a WhatsApp message as a reply to another message
func sendWhatsAppReply(client *whatsmeow.Client, recipient string, message string, replyToID string, replyToSender string) (bool, string) {
	if !client.IsConnected() {
		return false, "Not connected to WhatsApp"
	}

	// Parse recipient JID
	recipientJID, err := types.ParseJID(recipient)
	if err != nil {
		return false, fmt.Sprintf("Error parsing recipient JID: %v", err)
	}

	// Create message with reply context using ExtendedTextMessage
	msg := &waProto.Message{
		ExtendedTextMessage: &waProto.ExtendedTextMessage{
			Text: proto.String(message),
			ContextInfo: &waProto.ContextInfo{
				StanzaID:    proto.String(replyToID),
				Participant: proto.String(replyToSender),
			},
		},
	}

	// Send message
	_, err = client.SendMessage(context.Background(), recipientJID, msg)
	if err != nil {
		return false, fmt.Sprintf("Error sending reply: %v", err)
	}

	return true, fmt.Sprintf("Reply sent to %s (reply to %s)", recipient, replyToID)
}'''

    # Find where to insert - after sendWhatsAppMessage function
    insert_marker = 'return true, fmt.Sprintf("Message sent to %s", recipient)\n}'
    if insert_marker in content:
        content = content.replace(insert_marker, insert_marker + reply_func, 1)
        changes.append('Added sendWhatsAppReply function')

# 4. Add sendDRAcknowledgment function after syncToFibreFlow
if 'sendDRAcknowledgment' not in content:
    ack_func = '''

// sendDRAcknowledgment sends immediate acknowledgment reply to the user
func sendDRAcknowledgment(client *whatsmeow.Client, chatJID string, dropNumber string, project string, messageID string, senderJID string) {
	go func() {
		// Call FibreFlow acknowledgment API
		payload := fmt.Sprintf(`{"dropNumber":"%s","project":"%s"}`, dropNumber, project)
		resp, err := http.Post(FIBREFLOW_ACK_API_URL, "application/json", strings.NewReader(payload))
		if err != nil {
			fmt.Printf("\\033[31m[ACK ERROR] Failed to get acknowledgment for %s: %v\\033[0m\\n", dropNumber, err)
			return
		}
		defer resp.Body.Close()

		body, _ := io.ReadAll(resp.Body)

		if resp.StatusCode != 200 {
			fmt.Printf("\\033[33m[ACK WARN] Acknowledgment API returned %d for %s: %s\\033[0m\\n", resp.StatusCode, dropNumber, string(body))
			return
		}

		var ackResp DrAcknowledgmentResponse
		if err := json.Unmarshal(body, &ackResp); err != nil {
			fmt.Printf("\\033[31m[ACK ERROR] Failed to parse acknowledgment response for %s: %v\\033[0m\\n", dropNumber, err)
			return
		}

		if !ackResp.Success || ackResp.Data.Message == "" {
			fmt.Printf("\\033[33m[ACK WARN] No acknowledgment message for %s\\033[0m\\n", dropNumber)
			return
		}

		// Send reply to the original message
		success, msg := sendWhatsAppReply(client, chatJID, ackResp.Data.Message, messageID, senderJID)
		if success {
			fmt.Printf("📱 Sent acknowledgment reply for %s (photos: %d, ONT: %v, UPS: %v)\\n",
				dropNumber, ackResp.Data.PhotoCount, ackResp.Data.OntSerial != "", ackResp.Data.UpsSerial != "")
		} else {
			fmt.Printf("\\033[31m[ACK ERROR] Failed to send acknowledgment reply: %s\\033[0m\\n", msg)
		}
	}()
}'''

    # Find syncToFibreFlow function end and insert after it
    idx = content.find('// Find first empty row starting from row 17')
    if idx > 0:
        content = content[:idx] + ack_func + '\n\n' + content[idx:]
        changes.append('Added sendDRAcknowledgment function')

# 5. Update processDropNumbers signature
old_sig = 'func processDropNumbers(client *whatsmeow.Client, content, chatJID, sender string, timestamp time.Time, logger waLog.Logger)'
new_sig = 'func processDropNumbers(client *whatsmeow.Client, content, chatJID, sender string, timestamp time.Time, messageID, senderJID string, logger waLog.Logger)'

if old_sig in content:
    content = content.replace(old_sig, new_sig)
    changes.append('Updated processDropNumbers signature')

# 6. Update the call to processDropNumbers
old_call = 'processDropNumbers(client, content, chatJID, sender, msg.Info.Timestamp, logger)'
new_call = 'processDropNumbers(client, content, chatJID, sender, msg.Info.Timestamp, msg.Info.ID, msg.Info.Sender.String(), logger)'

if old_call in content:
    content = content.replace(old_call, new_call)
    changes.append('Updated processDropNumbers call')

# 7. Add acknowledgment call after syncToFibreFlow
old_sync = 'syncToFibreFlow(client, chatJID, dropNumber, projectName, sender)'
new_sync = '''syncToFibreFlow(client, chatJID, dropNumber, projectName, sender)

			// Send immediate acknowledgment reply to the user
			sendDRAcknowledgment(client, chatJID, dropNumber, projectName, messageID, senderJID)'''

if old_sync in content and 'sendDRAcknowledgment(client, chatJID, dropNumber, projectName, messageID' not in content:
    content = content.replace(old_sync, new_sync, 1)
    changes.append('Added sendDRAcknowledgment call')

with open('/home/louis/whatsapp-bridge-go/main.go', 'w') as f:
    f.write(content)

print('Changes made:')
for c in changes:
    print(f'  - {c}')
print(f'\nTotal: {len(changes)} changes applied')
