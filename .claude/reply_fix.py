#!/usr/bin/env python3
"""Fix reply-to to include QuotedMessage for proper threading"""

with open('/home/louis/whatsapp-bridge-go/main.go', 'r') as f:
    content = f.read()

changes = []

# Update sendWhatsAppReply to also accept original message content for quoting
old_func = '''// sendWhatsAppReply sends a WhatsApp message as a reply to another message
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

new_func = '''// sendWhatsAppReply sends a WhatsApp message as a reply to another message
func sendWhatsAppReply(client *whatsmeow.Client, recipient string, message string, replyToID string, replyToSender string, quotedContent string) (bool, string) {
	if !client.IsConnected() {
		return false, "Not connected to WhatsApp"
	}

	// Parse recipient JID
	recipientJID, err := types.ParseJID(recipient)
	if err != nil {
		return false, fmt.Sprintf("Error parsing recipient JID: %v", err)
	}

	// Create quoted message for proper threading
	quotedMsg := &waProto.Message{
		Conversation: proto.String(quotedContent),
	}

	// Create message with reply context using ExtendedTextMessage
	msg := &waProto.Message{
		ExtendedTextMessage: &waProto.ExtendedTextMessage{
			Text: proto.String(message),
			ContextInfo: &waProto.ContextInfo{
				StanzaID:      proto.String(replyToID),
				Participant:   proto.String(replyToSender),
				QuotedMessage: quotedMsg,
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

if old_func in content:
    content = content.replace(old_func, new_func)
    changes.append('Updated sendWhatsAppReply to include QuotedMessage')

# Update sendDRAcknowledgment to pass the drop number as quoted content
old_call = 'success, msg := sendWhatsAppReply(client, chatJID, ackResp.Data.Message, messageID, senderJID)'
new_call = 'success, msg := sendWhatsAppReply(client, chatJID, ackResp.Data.Message, messageID, senderJID, dropNumber)'

if old_call in content:
    content = content.replace(old_call, new_call)
    changes.append('Updated sendDRAcknowledgment to pass dropNumber as quoted content')

with open('/home/louis/whatsapp-bridge-go/main.go', 'w') as f:
    f.write(content)

print('Changes made:')
for c in changes:
    print(f'  - {c}')
print(f'Total: {len(changes)} changes applied')
