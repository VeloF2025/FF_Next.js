package main

import (
	"context"
	"fmt"
	"sync"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
	waProto "go.mau.fi/whatsmeow/binary/proto"
	"google.golang.org/protobuf/proto"
)

// Global reference to the bridge's WhatsApp client (set in main)
var (
	bridgeClient   *whatsmeow.Client
	bridgeClientMu sync.RWMutex
)

// SetBridgeClient stores the bridge's WA client for direct sending
func SetBridgeClient(c *whatsmeow.Client) {
	bridgeClientMu.Lock()
	defer bridgeClientMu.Unlock()
	bridgeClient = c
}

// Deduplication cache to prevent duplicate sends
var (
	processedMsgs   = make(map[string]time.Time)
	processedMsgsMu sync.Mutex
	msgCacheTTL     = 90 * time.Second
)

func cleanOldMsgs() {
	processedMsgsMu.Lock()
	defer processedMsgsMu.Unlock()
	now := time.Now()
	for key, t := range processedMsgs {
		if now.Sub(t) > msgCacheTTL {
			delete(processedMsgs, key)
		}
	}
}

// sendViaSenderService sends a message directly via the bridge's own WhatsApp client
// (No longer needs an external sender service)
func sendViaSenderService(groupJID string, recipientJID string, message string) (bool, string) {
	// Dedup check
	msgKey := message
	if len(message) > 30 {
		msgKey = message[:30]
	}
	dedupKey := fmt.Sprintf("%s|%s|%s", groupJID, recipientJID, msgKey)

	processedMsgsMu.Lock()
	if lastSent, exists := processedMsgs[dedupKey]; exists {
		elapsed := time.Since(lastSent)
		if elapsed < msgCacheTTL {
			processedMsgsMu.Unlock()
			fmt.Printf("⏭️  DEDUP: Skipping duplicate ack (sent %v ago): %s\n", elapsed.Round(time.Second), msgKey)
			return true, "Duplicate - already sent recently"
		}
	}
	processedMsgs[dedupKey] = time.Now()
	processedMsgsMu.Unlock()

	go cleanOldMsgs()

	// Get the bridge client
	bridgeClientMu.RLock()
	cli := bridgeClient
	bridgeClientMu.RUnlock()

	if cli == nil {
		return false, "Bridge client not initialized"
	}

	// Parse group JID
	targetJID, err := types.ParseJID(groupJID)
	if err != nil {
		return false, fmt.Sprintf("Invalid group JID %s: %v", groupJID, err)
	}

	// Send message directly via bridge client
	msg := &waProto.Message{
		Conversation: proto.String(message),
	}

	_, err = cli.SendMessage(context.Background(), targetJID, msg)
	if err != nil {
		return false, fmt.Sprintf("Failed to send message: %v", err)
	}

	fmt.Printf("✅ ACK sent directly via bridge to %s\n", groupJID)
	return true, "Message sent directly via bridge"
}
