package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"go.mau.fi/whatsmeow"
	waProto "go.mau.fi/whatsmeow/binary/proto"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"
)

// Global WhatsApp client and store
var (
	client         *whatsmeow.Client
	storeContainer *sqlstore.Container
	logger         waLog.Logger
)

// Pairing state - accessible via API
type PairingState struct {
	Status       string    `json:"status"` // idle, generating, waiting, connected, failed, expired
	PairingCode  string    `json:"pairing_code,omitempty"`
	PhoneNumber  string    `json:"phone_number"`
	ExpiresAt    time.Time `json:"expires_at,omitempty"`
	ErrorMessage string    `json:"error_message,omitempty"`
	mu           sync.RWMutex
}

var pairingState = &PairingState{
	Status:      "idle",
	PhoneNumber: "+27824189511", // Default, can be overridden
}

// Sent message tracking for deletion
type SentMessage struct {
	MessageID    string    `json:"message_id"`
	GroupJID     string    `json:"group_jid"`
	RecipientJID string    `json:"recipient_jid"`
	MessageText  string    `json:"message_text"`
	SentAt       time.Time `json:"sent_at"`
}

var (
	sentMessages   = make(map[string]SentMessage)
	sentMessagesMu sync.RWMutex
	recentMessages []SentMessage
)

// Request/Response types
type SendMessageRequest struct {
	GroupJID     string `json:"group_jid"`
	RecipientJID string `json:"recipient_jid"`
	Message      string `json:"message"`
}

type SendMessageResponse struct {
	Success   bool   `json:"success"`
	MessageID string `json:"message_id,omitempty"`
	Message   string `json:"message,omitempty"`
	Error     string `json:"error,omitempty"`
}

type DeleteMessageRequest struct {
	MessageID string `json:"message_id"`
	GroupJID  string `json:"group_jid"`
}

type DeleteMessageResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
	Error   string `json:"error,omitempty"`
}

type PairRequest struct {
	PhoneNumber string `json:"phone_number"` // Optional, uses default if empty
}

func main() {
	// Set up logger
	logger = waLog.Stdout("Sender", "INFO", true)
	logger.Infof("🚀 WhatsApp Message Sender Service v2 Starting...")

	// Get phone number from env
	phoneNumber := os.Getenv("WHATSAPP_PHONE_NUMBER")
	if phoneNumber != "" {
		pairingState.PhoneNumber = phoneNumber
	}
	logger.Infof("📱 Configured phone number: %s", pairingState.PhoneNumber)

	// Initialize database store
	dbLog := waLog.Stdout("Database", "WARN", true)
	var err error
	storeContainer, err = sqlstore.New(context.Background(), "sqlite3", "file:store/whatsapp.db?_foreign_keys=on", dbLog)
	if err != nil {
		logger.Errorf("Failed to connect to store: %v", err)
		os.Exit(1)
	}

	// Initialize client
	if err := initializeClient(); err != nil {
		logger.Errorf("Failed to initialize client: %v", err)
		// Don't exit - allow API to trigger pairing
	}

	// Set up HTTP server with all endpoints
	http.HandleFunc("/send-message", handleSendMessage)
	http.HandleFunc("/delete-message", handleDeleteMessage)
	http.HandleFunc("/list-recent", handleListRecent)
	http.HandleFunc("/health", handleHealth)
	// NEW: Pairing management endpoints
	http.HandleFunc("/pair", handlePair)
	http.HandleFunc("/pairing-status", handlePairingStatus)
	http.HandleFunc("/logout", handleLogout)

	// Get port from env
	port := os.Getenv("WHATSAPP_PORT")
	if port == "" {
		port = "8081"
	}

	// Start HTTP server
	go func() {
		logger.Infof("🌐 HTTP Server listening on :%s", port)
		if err := http.ListenAndServe(":"+port, nil); err != nil {
			logger.Errorf("HTTP server error: %v", err)
		}
	}()

	// Wait for interrupt signal
	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)
	<-c

	logger.Infof("Shutting down...")
	if client != nil {
		client.Disconnect()
	}
}

// initializeClient creates and connects the WhatsApp client
func initializeClient() error {
	// Get the first device or create new one
	deviceStore, err := storeContainer.GetFirstDevice(context.Background())
	if err != nil {
		return fmt.Errorf("failed to get device: %v", err)
	}

	if deviceStore == nil {
		deviceStore = storeContainer.NewDevice()
		logger.Infof("📱 New device created - pairing required")
	}

	// Create WhatsApp client
	client = whatsmeow.NewClient(deviceStore, waLog.Stdout("Client", "WARN", true))

	// Connect to WhatsApp
	if err := client.Connect(); err != nil {
		return fmt.Errorf("failed to connect: %v", err)
	}

	// Check if device is logged in
	if client.Store.ID == nil {
		pairingState.mu.Lock()
		pairingState.Status = "idle"
		pairingState.mu.Unlock()
		logger.Infof("🔑 Device not logged in - awaiting pairing request via API")
		return nil
	}

	// Already logged in
	pairingState.mu.Lock()
	pairingState.Status = "connected"
	pairingState.mu.Unlock()
	logger.Infof("✅ Device already logged in as: %s", client.Store.ID.User)

	return nil
}

// handlePair initiates the pairing process
func handlePair(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Method not allowed. Use POST",
		})
		return
	}

	// Parse optional phone number from request
	body, _ := io.ReadAll(r.Body)
	var req PairRequest
	json.Unmarshal(body, &req)

	phoneNumber := pairingState.PhoneNumber
	if req.PhoneNumber != "" {
		phoneNumber = req.PhoneNumber
	}

	// Update pairing state
	pairingState.mu.Lock()
	pairingState.Status = "generating"
	pairingState.PhoneNumber = phoneNumber
	pairingState.ErrorMessage = ""
	pairingState.mu.Unlock()

	logger.Infof("🔑 Initiating pairing for phone: %s", phoneNumber)

	// If client is connected, disconnect first
	if client != nil && client.IsConnected() {
		client.Disconnect()
	}

	// Clear existing session to force re-pairing
	if client != nil && client.Store != nil && client.Store.ID != nil {
		err := client.Logout(context.Background())
		if err != nil {
			logger.Warnf("Logout error (may be expected): %v", err)
		}
	}

	// Reinitialize with fresh device
	deviceStore := storeContainer.NewDevice()
	client = whatsmeow.NewClient(deviceStore, waLog.Stdout("Client", "WARN", true))

	// Connect
	if err := client.Connect(); err != nil {
		pairingState.mu.Lock()
		pairingState.Status = "failed"
		pairingState.ErrorMessage = err.Error()
		pairingState.mu.Unlock()
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Failed to connect: %v", err),
		})
		return
	}

	// Request pairing code
	code, err := client.PairPhone(context.Background(), phoneNumber, true, whatsmeow.PairClientChrome, "Chrome (Linux)")
	if err != nil {
		pairingState.mu.Lock()
		pairingState.Status = "failed"
		pairingState.ErrorMessage = err.Error()
		pairingState.mu.Unlock()

		logger.Errorf("Failed to generate pairing code: %v", err)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Failed to generate pairing code: %v", err),
		})
		return
	}

	// Update pairing state with code
	pairingState.mu.Lock()
	pairingState.Status = "waiting"
	pairingState.PairingCode = code
	pairingState.ExpiresAt = time.Now().Add(2 * time.Minute) // Pairing codes expire ~2min
	pairingState.mu.Unlock()

	logger.Infof("🔑 PAIRING CODE: %s (expires in 2 minutes)", code)

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"pairing_code": code,
		"phone_number": phoneNumber,
		"expires_at":   pairingState.ExpiresAt.Format(time.RFC3339),
		"instructions": []string{
			"1. Open WhatsApp on your phone",
			"2. Go to Settings → Linked Devices",
			"3. Tap 'Link a Device'",
			"4. Tap 'Link with Phone Number Instead'",
			fmt.Sprintf("5. Enter code: %s", code),
		},
	})
}

// handlePairingStatus returns the current pairing state
func handlePairingStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	pairingState.mu.RLock()
	defer pairingState.mu.RUnlock()

	// Check if code has expired
	status := pairingState.Status
	if status == "waiting" && time.Now().After(pairingState.ExpiresAt) {
		status = "expired"
	}

	// Check actual connection status
	isConnected := client != nil && client.IsConnected()
	sessionValid := client != nil && client.Store != nil && client.Store.ID != nil

	if sessionValid && isConnected {
		status = "connected"
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":       true,
		"status":        status,
		"pairing_code":  pairingState.PairingCode,
		"phone_number":  pairingState.PhoneNumber,
		"expires_at":    pairingState.ExpiresAt.Format(time.RFC3339),
		"error_message": pairingState.ErrorMessage,
		"connected":     isConnected,
		"session_valid": sessionValid,
	})
}

// handleLogout logs out and clears the session
func handleLogout(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Method not allowed. Use POST",
		})
		return
	}

	if client == nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Client not initialized",
		})
		return
	}

	// Logout from WhatsApp
	err := client.Logout(context.Background())
	if err != nil {
		logger.Warnf("Logout error: %v", err)
	}

	client.Disconnect()

	pairingState.mu.Lock()
	pairingState.Status = "idle"
	pairingState.PairingCode = ""
	pairingState.ErrorMessage = ""
	pairingState.mu.Unlock()

	logger.Infof("📱 Logged out and session cleared")

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Logged out successfully. Use /pair to link a new device.",
	})
}

// handleHealth returns service health status
func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	pairingState.mu.RLock()
	status := pairingState.Status
	pairingState.mu.RUnlock()

	isConnected := client != nil && client.IsConnected()
	sessionValid := client != nil && client.Store != nil && client.Store.ID != nil
	needsAuth := !sessionValid

	var deviceJID string
	if sessionValid {
		deviceJID = client.Store.ID.User
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":        "ok",
		"service":       "whatsapp-sender",
		"version":       "2.0.0",
		"connected":     isConnected,
		"session_valid": sessionValid,
		"needs_auth":    needsAuth,
		"pairing_state": status,
		"phone_number":  pairingState.PhoneNumber,
		"device_jid":    deviceJID,
		"recent_count":  len(recentMessages),
	})
}

// handleListRecent lists recently sent messages
func handleListRecent(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	sentMessagesMu.RLock()
	defer sentMessagesMu.RUnlock()

	deletable := []SentMessage{}
	oneHourAgo := time.Now().Add(-1 * time.Hour)
	for _, msg := range recentMessages {
		if msg.SentAt.After(oneHourAgo) {
			deletable = append(deletable, msg)
		}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"count":    len(deletable),
		"messages": deletable,
	})
}

// handleDeleteMessage deletes a previously sent message
func handleDeleteMessage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		json.NewEncoder(w).Encode(DeleteMessageResponse{
			Success: false,
			Error:   "Method not allowed. Use POST",
		})
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(DeleteMessageResponse{
			Success: false,
			Error:   "Failed to read request body",
		})
		return
	}

	var req DeleteMessageRequest
	if err := json.Unmarshal(body, &req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(DeleteMessageResponse{
			Success: false,
			Error:   "Invalid JSON",
		})
		return
	}

	if req.MessageID == "" || req.GroupJID == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(DeleteMessageResponse{
			Success: false,
			Error:   "Missing required fields: message_id, group_jid",
		})
		return
	}

	groupJID, err := types.ParseJID(req.GroupJID)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(DeleteMessageResponse{
			Success: false,
			Error:   fmt.Sprintf("Invalid group_jid: %v", err),
		})
		return
	}

	sentMessagesMu.RLock()
	sentMsg, exists := sentMessages[req.MessageID]
	sentMessagesMu.RUnlock()

	if exists && time.Since(sentMsg.SentAt) > time.Hour {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(DeleteMessageResponse{
			Success: false,
			Error:   fmt.Sprintf("Message too old to delete (sent %v ago)", time.Since(sentMsg.SentAt).Round(time.Minute)),
		})
		return
	}

	revokeMsg := &waProto.Message{
		ProtocolMessage: &waProto.ProtocolMessage{
			Type: waProto.ProtocolMessage_REVOKE.Enum(),
			Key: &waProto.MessageKey{
				RemoteJID: proto.String(req.GroupJID),
				ID:        proto.String(req.MessageID),
				FromMe:    proto.Bool(true),
			},
		},
	}

	_, err = client.SendMessage(context.Background(), groupJID, revokeMsg)
	if err != nil {
		fmt.Printf("❌ Failed to delete message %s: %v\n", req.MessageID, err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(DeleteMessageResponse{
			Success: false,
			Error:   fmt.Sprintf("Failed to delete message: %v", err),
		})
		return
	}

	sentMessagesMu.Lock()
	delete(sentMessages, req.MessageID)
	sentMessagesMu.Unlock()

	fmt.Printf("🗑️ Deleted message %s from group %s\n", req.MessageID, req.GroupJID)

	json.NewEncoder(w).Encode(DeleteMessageResponse{
		Success: true,
		Message: fmt.Sprintf("Message %s deleted for everyone", req.MessageID),
	})
}

// handleSendMessage sends a WhatsApp message with mention
func handleSendMessage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		json.NewEncoder(w).Encode(SendMessageResponse{
			Success: false,
			Error:   "Method not allowed. Use POST",
		})
		return
	}

	// Check if connected
	if client == nil || !client.IsConnected() {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(SendMessageResponse{
			Success: false,
			Error:   "WhatsApp not connected. Please authenticate first via /pair endpoint.",
		})
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(SendMessageResponse{
			Success: false,
			Error:   "Failed to read request body",
		})
		return
	}

	var req SendMessageRequest
	if err := json.Unmarshal(body, &req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(SendMessageResponse{
			Success: false,
			Error:   "Invalid JSON",
		})
		return
	}

	if req.GroupJID == "" || req.RecipientJID == "" || req.Message == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(SendMessageResponse{
			Success: false,
			Error:   "Missing required fields: group_jid, recipient_jid, message",
		})
		return
	}

	groupJID, err := types.ParseJID(req.GroupJID)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(SendMessageResponse{
			Success: false,
			Error:   fmt.Sprintf("Invalid group_jid: %v", err),
		})
		return
	}

	recipientJID, err := types.ParseJID(req.RecipientJID)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(SendMessageResponse{
			Success: false,
			Error:   fmt.Sprintf("Invalid recipient_jid: %v", err),
		})
		return
	}

	messageText := fmt.Sprintf("@%s %s", recipientJID.User, req.Message)

	msg := &waProto.Message{
		ExtendedTextMessage: &waProto.ExtendedTextMessage{
			Text: proto.String(messageText),
			ContextInfo: &waProto.ContextInfo{
				MentionedJID: []string{req.RecipientJID},
			},
		},
	}

	resp, err := client.SendMessage(context.Background(), groupJID, msg)
	if err != nil {
		fmt.Printf("❌ Failed to send message: %v\n", err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(SendMessageResponse{
			Success: false,
			Error:   fmt.Sprintf("Failed to send message: %v", err),
		})
		return
	}

	sentMsg := SentMessage{
		MessageID:    resp.ID,
		GroupJID:     req.GroupJID,
		RecipientJID: req.RecipientJID,
		MessageText:  req.Message[:min(50, len(req.Message))],
		SentAt:       time.Now(),
	}

	sentMessagesMu.Lock()
	sentMessages[resp.ID] = sentMsg
	recentMessages = append(recentMessages, sentMsg)
	if len(recentMessages) > 100 {
		recentMessages = recentMessages[len(recentMessages)-100:]
	}
	sentMessagesMu.Unlock()

	fmt.Printf("✅ Sent message %s to %s in group %s\n", resp.ID, req.RecipientJID, req.GroupJID)

	json.NewEncoder(w).Encode(SendMessageResponse{
		Success:   true,
		MessageID: resp.ID,
		Message:   "Message sent successfully",
	})
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
