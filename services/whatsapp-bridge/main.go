package main

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"reflect"
	"regexp"
	"io"
	"strings"
	"sync"
	"syscall"
	"time"

	_ "github.com/mattn/go-sqlite3"
	_ "github.com/lib/pq"
	"github.com/mdp/qrterminal"

	"bytes"

	"go.mau.fi/whatsmeow"
	waProto "go.mau.fi/whatsmeow/binary/proto"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"

	"golang.org/x/oauth2/google"
	"google.golang.org/api/option"
	"google.golang.org/api/sheets/v4"
)
// getEnvOrDefault reads an environment variable or returns a default value
func getEnvOrDefault(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

// Project configurations
var PROJECTS = map[string]map[string]string{
	"Lawley": {
		"group_jid":          "120363418298130331@g.us",
		"project_name":       "Lawley",
		"group_description": "Lawley Activation 3 group",
	},
	"Velo Test": {
		"group_jid":          "120363421664266245@g.us",
		"project_name":       "Velo Test",
		"group_description": "Velo Test group",
	},
	"Mohadin": {
		"group_jid":          "120363421532174586@g.us",
		"project_name":       "Mohadin",
		"group_description": "Mohadin Activations group",
	},
	"Mamelodi Internal": {
		"group_jid":          "120363425029043207@g.us",
		"project_name":       "Mamelodi",
		"group_description": "Mamelodi POP1 Activations Internal",
	},
	"Mamelodi": {
		"group_jid":          "120363408849234743@g.us",
		"project_name":       "Mamelodi",
		"group_description": "Mamelodi POP1 Activations group",
	},
	"Mohadin QA": {
		"group_jid":          "120363424360693693@g.us",
		"project_name":       "Mohadin QA",
		"group_description": "Mohadin QA Maintenance Tracking group",
	},
	"Marketing Activations": {
		"group_jid":          "120363422808656601@g.us",
		"project_name":       "Marketing Activations",
		"group_description": "Lawley marketing activstions group",
	},
	"AI Recovery": {
		"group_jid":          "120363423864087150@g.us",
		"project_name":       "Admin",
		"group_description": "AI Recovery Alerts command group",
	},
}

// Database configuration — read from the DATABASE_URL env var. There is
// deliberately no default: the connection string carries the fibreflow_user
// password and must never live in a tracked file. Set it in the systemd unit.
// Name kept as NEON_DB_URL for minimal diff; actual target is self-hosted Supabase post-2026-04-18 cutover.
var NEON_DB_URL = os.Getenv("DATABASE_URL")

// Google Sheets configuration
const GOOGLE_SHEETS_ID = "1TYxDLyCqDHr0Imb5j7X4uJhxccgJTO0KrDVAD0Ja0Dk"
// FibreFlow base URL from FIBREFLOW_URL env var (default: production)
var fibreflowBaseURL = getEnvOrDefault("FIBREFLOW_URL", "https://app.fibreflow.app")
var FIBREFLOW_API_URL = fibreflowBaseURL + "/api/activate/process-new-dr"
var FIBREFLOW_ACK_API_URL = fibreflowBaseURL + "/api/activate/dr-acknowledgment"

// Bridge secret for authenticating with FibreFlow API endpoints
var bridgeSecret = getEnvOrDefault("WA_BRIDGE_SECRET", "")

// Maintenance WhatsApp API for Mohadin QA group
var MAINTENANCE_WA_API_URL = fibreflowBaseURL + "/api/maintenance/wa-message"
var FIELD_OPS_WA_API_URL = fibreflowBaseURL + "/api/field-ops/wa-message"
const MAINTENANCE_GROUP_JID = "120363424360693693@g.us"
const GOOGLE_CREDENTIALS_PATH = "./credentials.json"

// Project-specific Google Sheets tab mapping
var PROJECT_SHEETS_TABS = map[string]string{
	"Velo Test": "Velo Test",                  // Live production - direct writes
	"Mohadin":   "Mohadin WA_Tool Monitor",    // Safe monitor tab
	"Lawley":    "Lawley WA_Tool Monitor",     // Safe monitor tab
}

// Drop number pattern
var dropPattern = regexp.MustCompile(`DR\d+`)

// ============================================================================
// DB-DRIVEN GROUPS - Phase 3 of Unified Bridge
// ============================================================================

// MonitoredGroup represents a WhatsApp group loaded from the database
type MonitoredGroup struct {
	ID          string
	GroupJID    string
	GroupName   string
	ProjectName string
	GroupType   string // "dr_submission", "maintenance", "admin", "civil", "optical"
	Description string
	IsActive    bool
	SendAck     bool // whether to reply with the enriched DR acknowledgment (decoupled from group_type — migration 401)
}

// Global slice of monitored groups (loaded from DB)
var monitoredGroups []MonitoredGroup
var groupsMutex sync.RWMutex
var neonDB *sql.DB

// loadGroupsFromDB loads monitored groups from Neon PostgreSQL
func loadGroupsFromDB() error {
	groupsMutex.Lock()
	defer groupsMutex.Unlock()

	if neonDB == nil {
		var err error
		neonDB, err = sql.Open("postgres", NEON_DB_URL)
		if err != nil {
			return fmt.Errorf("failed to connect to Neon: %v", err)
		}
	}

	rows, err := neonDB.Query(`
		SELECT id, group_jid, group_name, COALESCE(project_name, ''), group_type, COALESCE(description, ''), is_active, COALESCE(send_ack, false)
		FROM wa_monitored_groups
		WHERE is_active = true
	`)
	if err != nil {
		return fmt.Errorf("failed to query groups: %v", err)
	}
	defer rows.Close()

	var groups []MonitoredGroup
	for rows.Next() {
		var g MonitoredGroup
		err := rows.Scan(&g.ID, &g.GroupJID, &g.GroupName, &g.ProjectName, &g.GroupType, &g.Description, &g.IsActive, &g.SendAck)
		if err != nil {
			return fmt.Errorf("failed to scan group: %v", err)
		}
		groups = append(groups, g)
	}

	monitoredGroups = groups
	fmt.Printf("📋 Loaded %d monitored groups from database\n", len(monitoredGroups))
	for _, g := range monitoredGroups {
		fmt.Printf("   - %s (%s) [%s]\n", g.GroupName, g.GroupJID, g.GroupType)
	}
	return nil
}

// getGroupByJID returns the MonitoredGroup for a given JID, or nil if not found
func getGroupByJID(jid string) *MonitoredGroup {
	groupsMutex.RLock()
	defer groupsMutex.RUnlock()

	for i := range monitoredGroups {
		if monitoredGroups[i].GroupJID == jid {
			return &monitoredGroups[i]
		}
	}
	return nil
}

// isTrackedGroup checks if a JID belongs to a tracked group
func isTrackedGroup(jid string) bool {
	return getGroupByJID(jid) != nil
}

// startGroupsReloader starts a goroutine that reloads groups every 5 minutes
func startGroupsReloader() {
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			fmt.Println("🔄 Reloading groups from database...")
			if err := loadGroupsFromDB(); err != nil {
				fmt.Printf("❌ Failed to reload groups: %v\n", err)
			}
		}
	}()
}


// Get project name from JID
func getProjectNameByJID(jid string) string {
	// First check DB-loaded groups (preferred)
	if group := getGroupByJID(jid); group != nil {
		return group.ProjectName
	}

	// Fallback to hardcoded PROJECTS map (backward compatibility)
	for _, config := range PROJECTS {
		if config["group_jid"] == jid {
			return config["project_name"]
		}
	}
	
	// Return empty string if no match found
	return ""
}

// Message represents a chat message for our client
type Message struct {
	Time      time.Time
	Sender    string
	Content   string
	IsFromMe  bool
	MediaType string
	Filename  string
}

// Database handler for storing message history
type MessageStore struct {
	db *sql.DB
}

// Initialize message store
func NewMessageStore() (*MessageStore, error) {
	// Create directory for database if it doesn't exist
	if err := os.MkdirAll("store", 0755); err != nil {
		return nil, fmt.Errorf("failed to create store directory: %v", err)
	}

	// Open SQLite database for messages
	db, err := sql.Open("sqlite3", "file:store/messages.db?_foreign_keys=on")
	if err != nil {
		return nil, fmt.Errorf("failed to open message database: %v", err)
	}

	// Create tables if they don't exist
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS chats (
			jid TEXT PRIMARY KEY,
			name TEXT,
			last_message_time TIMESTAMP,
			project_name TEXT
		);
		
		CREATE TABLE IF NOT EXISTS messages (
			id TEXT,
			chat_jid TEXT,
			sender TEXT,
			content TEXT,
			timestamp TIMESTAMP,
			is_from_me BOOLEAN,
			media_type TEXT,
			filename TEXT,
			url TEXT,
			media_key BLOB,
			file_sha256 BLOB,
			file_enc_sha256 BLOB,
			file_length INTEGER,
			PRIMARY KEY (id, chat_jid),
			FOREIGN KEY (chat_jid) REFERENCES chats(jid)
		);
	`)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to create tables: %v", err)
	}

	return &MessageStore{db: db}, nil
}

// Close the database connection
func (store *MessageStore) Close() error {
	return store.db.Close()
}

// Store a chat in the database
func (store *MessageStore) StoreChat(jid, name string, lastMessageTime time.Time) error {
	// Determine project name based on JID
	projectName := getProjectNameByJID(jid)

	fmt.Printf("💾 Storing chat: JID=%s, Name=%s, Project=%s\n", jid, name, projectName)

	// Store all chats, but only set project_name for tracked projects
	// This ensures foreign key constraints work for all messages
	result, err := store.db.Exec(
		"INSERT OR REPLACE INTO chats (jid, name, last_message_time, project_name) VALUES (?, ?, ?, ?)",
		jid, name, lastMessageTime, projectName,
	)

	if err != nil {
		fmt.Printf("❌ FAILED to store chat: %v\n", err)
		return err
	}

	rowsAffected, _ := result.RowsAffected()
	fmt.Printf("✅ Chat stored successfully: %d rows affected\n", rowsAffected)
	return nil
}

// Store a message in the database
func (store *MessageStore) StoreMessage(id, chatJID, sender, content string, timestamp time.Time, isFromMe bool,
	mediaType, filename, url string, mediaKey, fileSHA256, fileEncSHA256 []byte, fileLength uint64) error {
	// Only store if there's actual content or media
	if content == "" && mediaType == "" {
		return nil
	}

	// INSERT OR REPLACE rewrites the whole row, so a re-delivery of the same
	// message ID carrying no text would blank a caption we already had. History
	// sync re-sends messages that were originally captured live, so that is a
	// routine event, not an edge case — it destroyed a day of DR captions on
	// 2026-07-30. Keep the stored content whenever the incoming content is empty.
	// The trailing '' keeps content non-NULL when there is no existing row.
	_, err := store.db.Exec(
		`INSERT OR REPLACE INTO messages
		(id, chat_jid, sender, content, timestamp, is_from_me, media_type, filename, url, media_key, file_sha256, file_enc_sha256, file_length)
		VALUES (?, ?, ?, COALESCE(NULLIF(?, ''), (SELECT content FROM messages WHERE id = ?), ''), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, chatJID, sender, content, id, timestamp, isFromMe, mediaType, filename, url, mediaKey, fileSHA256, fileEncSHA256, fileLength,
	)
	return err
}

// Get messages from a chat
func (store *MessageStore) GetMessages(chatJID string, limit int) ([]Message, error) {
	rows, err := store.db.Query(
		"SELECT sender, content, timestamp, is_from_me, media_type, filename FROM messages WHERE chat_jid = ? ORDER BY timestamp DESC LIMIT ?",
		chatJID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []Message
	for rows.Next() {
		var msg Message
		var timestamp time.Time
		err := rows.Scan(&msg.Sender, &msg.Content, &timestamp, &msg.IsFromMe, &msg.MediaType, &msg.Filename)
		if err != nil {
			return nil, err
		}
		msg.Time = timestamp
		messages = append(messages, msg)
	}

	return messages, nil
}

// Get all chats
func (store *MessageStore) GetChats() (map[string]time.Time, error) {
	rows, err := store.db.Query("SELECT jid, last_message_time FROM chats ORDER BY last_message_time DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	chats := make(map[string]time.Time)
	for rows.Next() {
		var jid string
		var lastMessageTime time.Time
		err := rows.Scan(&jid, &lastMessageTime)
		if err != nil {
			return nil, err
		}
		chats[jid] = lastMessageTime
	}

	return chats, nil
}

// Extract text content from a message
func extractTextContent(msg *waProto.Message) string {
	if msg == nil {
		return ""
	}

	// Try to get text content
	if text := msg.GetConversation(); text != "" {
		return text
	} else if extendedText := msg.GetExtendedTextMessage(); extendedText != nil {
		return extendedText.GetText()
	}

	// Extract captions from media messages
	if img := msg.GetImageMessage(); img != nil {
		return img.GetCaption()
	} else if vid := msg.GetVideoMessage(); vid != nil {
		return vid.GetCaption()
	} else if doc := msg.GetDocumentMessage(); doc != nil {
		return doc.GetCaption()
	}

	// For now, we're ignoring non-text messages
	return ""
}

// SendMessageResponse represents the response for the send message API
type SendMessageResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

// FibreFlowErrorResponse represents error response from FibreFlow API
type FibreFlowErrorResponse struct {
	Success    bool   `json:"success"`
	Error      string `json:"error"`
	Message    string `json:"message"`
	DropNumber string `json:"dropNumber"`
	NotifyUser bool   `json:"notifyUser"`
}

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
}

// SyncPayload represents the request payload for FibreFlow sync API
type SyncPayload struct {
	Secret         string `json:"secret"`
	DropNumber     string `json:"dropNumber"`
	Project        string `json:"project"`
	SenderPhone    string `json:"senderPhone,omitempty"`
	WaMessageId    string `json:"waMessageId,omitempty"`
	WaSenderJid    string `json:"waSenderJid,omitempty"`
	WaOriginalText string `json:"waOriginalText,omitempty"`
	WaGroupJid     string `json:"waGroupJid,omitempty"`
}

// SendMessageRequest represents the request body for the send message API
type SendMessageRequest struct {
	Recipient     string `json:"recipient"`
	Message       string `json:"message"`
	MediaPath     string `json:"media_path,omitempty"`
	// Reply threading fields (optional)
	ReplyToID     string `json:"replyToId,omitempty"`
	ReplyToSender string `json:"replyToSender,omitempty"`
	QuotedContent string `json:"quotedContent,omitempty"`
	MentionJIDs   []string `json:"mentionJIDs,omitempty"`
}


// SentMessage tracks sent messages for deletion capability
type SentMessage struct {
	MessageID    string    `json:"message_id"`
	GroupJID     string    `json:"group_jid"`
	RecipientJID string    `json:"recipient_jid"`
	MessageText  string    `json:"message_text"`
	SentAt       time.Time `json:"sent_at"`
}

// Global tracking for sent messages (for deletion within 1 hour)
var (
	sentMessages   = make(map[string]SentMessage)
	sentMessagesMu sync.RWMutex
	recentMessages []SentMessage
)
// Function to send a WhatsApp message
func sendWhatsAppMessage(client *whatsmeow.Client, recipient string, message string, mediaPath string) (bool, string) {
	if !client.IsConnected() {
		return false, "Not connected to WhatsApp"
	}

	// Create JID for recipient
	var recipientJID types.JID
	var err error

	// Check if recipient is a JID
	isJID := strings.Contains(recipient, "@")

	if isJID {
		// Parse the JID string
		recipientJID, err = types.ParseJID(recipient)
		if err != nil {
			return false, fmt.Sprintf("Error parsing JID: %v", err)
		}
	} else {
		// Create JID from phone number
		recipientJID = types.JID{
			User:   recipient,
			Server: "s.whatsapp.net", // For personal chats
		}
	}

	msg := &waProto.Message{}

	// Check if we have media to send
	if mediaPath != "" {
		// Read media file
		mediaData, err := os.ReadFile(mediaPath)
		if err != nil {
			return false, fmt.Sprintf("Error reading media file: %v", err)
		}

		// Determine media type and mime type based on file extension
		fileExt := strings.ToLower(mediaPath[strings.LastIndex(mediaPath, ".")+1:])
		var mediaType whatsmeow.MediaType
		var mimeType string

		// Handle different media types
		switch fileExt {
		// Image types
		case "jpg", "jpeg":
			mediaType = whatsmeow.MediaImage
			mimeType = "image/jpeg"
		case "png":
			mediaType = whatsmeow.MediaImage
			mimeType = "image/png"
		case "gif":
			mediaType = whatsmeow.MediaImage
			mimeType = "image/gif"
		case "webp":
			mediaType = whatsmeow.MediaImage
			mimeType = "image/webp"

		// Audio types
		case "ogg":
			mediaType = whatsmeow.MediaAudio
			mimeType = "audio/ogg; codecs=opus"

		// Video types
		case "mp4":
			mediaType = whatsmeow.MediaVideo
			mimeType = "video/mp4"
		case "avi":
			mediaType = whatsmeow.MediaVideo
			mimeType = "video/avi"
		case "mov":
			mediaType = whatsmeow.MediaVideo
			mimeType = "video/quicktime"

		// Document types (for any other file type)
		default:
			mediaType = whatsmeow.MediaDocument
			mimeType = "application/octet-stream"
		}

		// Upload media to WhatsApp servers
		resp, err := client.Upload(context.Background(), mediaData, mediaType)
		if err != nil {
			return false, fmt.Sprintf("Error uploading media: %v", err)
		}

		fmt.Println("Media uploaded", resp)

		// Create the appropriate message type based on media type
		switch mediaType {
		case whatsmeow.MediaImage:
			msg.ImageMessage = &waProto.ImageMessage{
				Caption:       proto.String(message),
				Mimetype:      proto.String(mimeType),
				URL:           &resp.URL,
				DirectPath:    &resp.DirectPath,
				MediaKey:      resp.MediaKey,
				FileEncSHA256: resp.FileEncSHA256,
				FileSHA256:    resp.FileSHA256,
				FileLength:    &resp.FileLength,
			}
		case whatsmeow.MediaAudio:
			// Handle ogg audio files
			var seconds uint32 = 30 // Default fallback
			var waveform []byte = nil

			// Try to analyze the ogg file
			if strings.Contains(mimeType, "ogg") {
				analyzedSeconds, analyzedWaveform, err := analyzeOggOpus(mediaData)
				if err == nil {
					seconds = analyzedSeconds
					waveform = analyzedWaveform
				} else {
					return false, fmt.Sprintf("Failed to analyze Ogg Opus file: %v", err)
				}
			} else {
				fmt.Printf("Not an Ogg Opus file: %s\n", mimeType)
			}

			msg.AudioMessage = &waProto.AudioMessage{
				Mimetype:      proto.String(mimeType),
				URL:           &resp.URL,
				DirectPath:    &resp.DirectPath,
				MediaKey:      resp.MediaKey,
				FileEncSHA256: resp.FileEncSHA256,
				FileSHA256:    resp.FileSHA256,
				FileLength:    &resp.FileLength,
				Seconds:       proto.Uint32(seconds),
				PTT:           proto.Bool(true),
				Waveform:      waveform,
			}
		case whatsmeow.MediaVideo:
			msg.VideoMessage = &waProto.VideoMessage{
				Caption:       proto.String(message),
				Mimetype:      proto.String(mimeType),
				URL:           &resp.URL,
				DirectPath:    &resp.DirectPath,
				MediaKey:      resp.MediaKey,
				FileEncSHA256: resp.FileEncSHA256,
				FileSHA256:    resp.FileSHA256,
				FileLength:    &resp.FileLength,
			}
		case whatsmeow.MediaDocument:
			msg.DocumentMessage = &waProto.DocumentMessage{
				Title:         proto.String(mediaPath[strings.LastIndex(mediaPath, "/")+1:]),
				Caption:       proto.String(message),
				Mimetype:      proto.String(mimeType),
				URL:           &resp.URL,
				DirectPath:    &resp.DirectPath,
				MediaKey:      resp.MediaKey,
				FileEncSHA256: resp.FileEncSHA256,
				FileSHA256:    resp.FileSHA256,
				FileLength:    &resp.FileLength,
			}
		}
	} else {
		msg.Conversation = proto.String(message)
	}

	// Send message
	_, err = client.SendMessage(context.Background(), recipientJID, msg)

	if err != nil {
		return false, fmt.Sprintf("Error sending message: %v", err)
	}

	return true, fmt.Sprintf("Message sent to %s", recipient)
}

// sendWhatsAppReply sends a WhatsApp message as a reply to another message
func sendWhatsAppReply(client *whatsmeow.Client, recipient string, message string, replyToID string, replyToSender string, quotedContent string, mentionJIDs []string) (bool, string) {
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
				MentionedJID:  mentionJIDs,
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
}

// Extract media info from a message
func extractMediaInfo(msg *waProto.Message) (mediaType string, filename string, url string, mediaKey []byte, fileSHA256 []byte, fileEncSHA256 []byte, fileLength uint64) {
	if msg == nil {
		return "", "", "", nil, nil, nil, 0
	}

	// Check for image message
	if img := msg.GetImageMessage(); img != nil {
		return "image", "image_" + time.Now().Format("20060102_150405") + ".jpg",
			img.GetURL(), img.GetMediaKey(), img.GetFileSHA256(), img.GetFileEncSHA256(), img.GetFileLength()
	}

	// Check for video message
	if vid := msg.GetVideoMessage(); vid != nil {
		return "video", "video_" + time.Now().Format("20060102_150405") + ".mp4",
			vid.GetURL(), vid.GetMediaKey(), vid.GetFileSHA256(), vid.GetFileEncSHA256(), vid.GetFileLength()
	}

	// Check for audio message
	if aud := msg.GetAudioMessage(); aud != nil {
		return "audio", "audio_" + time.Now().Format("20060102_150405") + ".ogg",
			aud.GetURL(), aud.GetMediaKey(), aud.GetFileSHA256(), aud.GetFileEncSHA256(), aud.GetFileLength()
	}

	// Check for document message
	if doc := msg.GetDocumentMessage(); doc != nil {
		filename := doc.GetFileName()
		if filename == "" {
			filename = "document_" + time.Now().Format("20060102_150405")
		}
		return "document", filename,
			doc.GetURL(), doc.GetMediaKey(), doc.GetFileSHA256(), doc.GetFileEncSHA256(), doc.GetFileLength()
	}

	return "", "", "", nil, nil, nil, 0
}
// ====================================================================
// Forward message to FibreFlow for Chat display (added by Claude)
// ====================================================================
func forwardToFibreFlow(chatJID, sender, senderName, content, messageType, timestamp string, isFromMe bool) {
	// Skip outgoing messages (we already log those via Send API)
	if isFromMe {
		return
	}

	// Skip empty messages
	if content == "" {
		return
	}

	// FibreFlow inbound API endpoint
	apiURL := fibreflowBaseURL + "/api/communications/whatsapp/inbound"

	payload := map[string]interface{}{
		"secret":          bridgeSecret,
		"sender_jid":      sender + "@s.whatsapp.net",
		"sender_name":     senderName,
		"group_jid":       chatJID,
		"message_content": content,
		"message_type":    messageType,
		"timestamp":       timestamp,
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		fmt.Printf("⚠️  Failed to marshal FibreFlow payload: %v\n", err)
		return
	}

	// Fire and forget (non-blocking)
	go func() {
		resp, err := http.Post(apiURL, "application/json", bytes.NewBuffer(jsonData))
		if err != nil {
			fmt.Printf("⚠️  Failed to forward to FibreFlow: %v\n", err)
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode == 200 {
			fmt.Printf("📤 Forwarded to FibreFlow Chat\n")
		} else {
			body, _ := io.ReadAll(resp.Body)
			fmt.Printf("⚠️  FibreFlow returned %d: %s\n", resp.StatusCode, string(body))
		}
	}()
}



// forwardToMaintenanceAPI sends messages from the maintenance group to FibreFlow's maintenance processor
func forwardToMaintenanceAPI(chatJID, senderJID, senderName, content string, timestamp time.Time, messageID string, hasMedia bool, mediaType string) {
	// Prepare the payload for maintenance API
	payload := map[string]interface{}{
		"secret":       bridgeSecret,
		"message_id":   messageID,
		"group_jid":    chatJID,
		"sender_jid":   senderJID,
		"sender_name":  senderName,
		"text":         content,
		"timestamp":    timestamp.Format(time.RFC3339),
		"has_media":    hasMedia,
	}

	// Add media info if present
	if hasMedia && mediaType != "" {
		payload["media"] = []map[string]string{
			{
				"type":      mediaType,
				"mime_type": mediaType,
			},
		}
	}

	jsonPayload, err := json.Marshal(payload)
	if err != nil {
		fmt.Printf("Failed to marshal maintenance payload: %v\n", err)
		return
	}

	fmt.Printf("Forwarding to maintenance API: %s\n", string(jsonPayload))

	resp, err := http.Post(MAINTENANCE_WA_API_URL, "application/json", bytes.NewReader(jsonPayload))
	if err != nil {
		fmt.Printf("Failed to send to maintenance API: %v\n", err)
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == 200 {
		fmt.Printf("Maintenance API response: %s\n", string(body))
	} else {
		fmt.Printf("Maintenance API error (%d): %s\n", resp.StatusCode, string(body))
	}
}


// forwardToFieldOpsAPI sends messages from civil/optical groups to FibreFlow's field ops processor.
// photoBase64 and photoFilename are optional — pass empty strings when no photo is present.
func forwardToFieldOpsAPI(chatJID, senderJID, senderName, content string, timestamp time.Time, messageID string, hasMedia bool, mediaType string, mediaCount int, photoBase64 string, photoFilename string) {
	payload := map[string]interface{}{
		"group_jid":    chatJID,
		"sender_jid":   senderJID,
		"sender_name":  senderName,
		"message_text": content,
		"message_id":   messageID,
		"timestamp":    timestamp.Format(time.RFC3339),
		"has_media":    hasMedia,
		"media_type":   mediaType,
		"media_count":  mediaCount,
	}

	if photoBase64 != "" {
		payload["photo_base64"] = photoBase64
		payload["photo_filename"] = photoFilename
	}

	jsonPayload, err := json.Marshal(payload)
	if err != nil {
		fmt.Printf("Failed to marshal field ops payload: %v\n", err)
		return
	}

	fmt.Printf("🏗️ Forwarding to field ops API: %s\n", string(jsonPayload))

	req, err := http.NewRequest("POST", FIELD_OPS_WA_API_URL, bytes.NewReader(jsonPayload))
	if err != nil {
		fmt.Printf("Failed to create field ops request: %v\n", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-bridge-secret", bridgeSecret)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		fmt.Printf("Failed to send to field ops API: %v\n", err)
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == 200 || resp.StatusCode == 201 {
		fmt.Printf("🏗️ Field ops API response: %s\n", string(body))
	} else {
		fmt.Printf("🏗️ Field ops API error (%d): %s\n", resp.StatusCode, string(body))
	}
}

// Handle regular incoming messages with media support
func handleMessage(client *whatsmeow.Client, messageStore *MessageStore, msg *events.Message, logger waLog.Logger) {
	// Check if message is from a configured project group
	chatJID := msg.Info.Chat.String()

	// First check DB-loaded groups (preferred)
	group := getGroupByJID(chatJID)
	
	// Fallback to PROJECTS map if not in DB
	isProjectGroup := group != nil
	if !isProjectGroup {
		for _, config := range PROJECTS {
			if config["group_jid"] == chatJID {
				isProjectGroup = true
				break
			}
		}
	}

	if !isProjectGroup {
		// Silently ignore messages from non-project chats for privacy
		return
	}
	
	// Determine group type for routing
	groupType := "dr_submission" // default
	if group != nil {
		groupType = group.GroupType
	}
	
	// Log immediate debug info
	fmt.Printf("🎯 handleMessage [%s]: Chat=%s, Sender=%s, IsFromMe=%v\n",
		groupType, msg.Info.Chat.String(), msg.Info.Sender.String(), msg.Info.IsFromMe)
	logger.Infof("🎯 handleMessage [%s]: Chat=%s, Sender=%s, IsFromMe=%v",
		groupType, msg.Info.Chat.String(), msg.Info.Sender.String(), msg.Info.IsFromMe)
	
	// Check if this is a revoke message (Delete for Everyone)
	if msg.Message.GetProtocolMessage() != nil && msg.Message.GetProtocolMessage().GetType() == waProto.ProtocolMessage_REVOKE {
		revokedID := msg.Message.GetProtocolMessage().GetKey().GetID()
		fmt.Printf("🗑️  REVOKE detected: Chat=%s, RevokedMessageID=%s\n", chatJID, revokedID)
		logger.Infof("🗑️  REVOKE detected: Chat=%s, RevokedMessageID=%s", chatJID, revokedID)
		err := messageStore.MarkDeleted(revokedID, chatJID)
		if err != nil {
			logger.Errorf("Failed to mark revoked message as deleted: %v", err)
		} else {
			fmt.Printf("✅ Marked message %s as deleted\n", revokedID)
		}
		return // Don't process revoke messages further
	}

	// Save message to database  
	sender := msg.Info.Sender.User

	// Get appropriate chat name (pass nil for conversation since we don't have one for regular messages)
	fmt.Printf("🔍 Getting chat name for JID: %s\n", chatJID)
	name := GetChatName(client, messageStore, msg.Info.Chat, chatJID, nil, sender, logger)
	fmt.Printf("✅ Chat name retrieved: %s\n", name)

	// Update chat in database with the message timestamp (keeps last message time updated)
	err := messageStore.StoreChat(chatJID, name, msg.Info.Timestamp)
	if err != nil {
		logger.Warnf("Failed to store chat: %v", err)
	}

	// Extract text content
	content := extractTextContent(msg.Message)

	// Extract media info
	mediaType, filename, url, mediaKey, fileSHA256, fileEncSHA256, fileLength := extractMediaInfo(msg.Message)

	// Skip if there's no content and no media
	if content == "" && mediaType == "" {
		return
	}

	// Store message in database
	fmt.Printf("💾 Storing message in SQLite: ID=%s, Chat=%s, Content='%s'\n",
		msg.Info.ID, chatJID, content)
	err = messageStore.StoreMessage(
		msg.Info.ID,
		chatJID,
		sender,
		content,
		msg.Info.Timestamp,
		msg.Info.IsFromMe,
		mediaType,
		filename,
		url,
		mediaKey,
		fileSHA256,
		fileEncSHA256,
		fileLength,
	)

	if err != nil {
		fmt.Printf("❌ FAILED to store message: %v\n", err)
		logger.Warnf("Failed to store message: %v", err)
	} else {
		fmt.Printf("✅ SUCCESS: Message stored in SQLite\n")
		// Log message reception
		timestamp := msg.Info.Timestamp.Format("2006-01-02 15:04:05")
		direction := "←"
		if msg.Info.IsFromMe {
			direction = "→"
		}

		// Log based on message type
		if mediaType != "" {
			fmt.Printf("[%s] %s %s: [%s: %s] %s\n", timestamp, direction, sender, mediaType, filename, content)
		} else if content != "" {
			fmt.Printf("[%s] %s %s: %s\n", timestamp, direction, sender, content)
		}

		// Process drop numbers if content exists
		// TEMPORARILY REMOVED IsFromMe restriction to fix processing issue
		if content != "" {
			fmt.Printf("🎯 Processing drop numbers from message: '%s' (IsFromMe: %v)\n", content, msg.Info.IsFromMe)
			// Preserve legacy default: when the group record is missing, groupType
			// defaults to dr_submission, so ACK should fire (group == nil ⇒ send).
			processDropNumbers(client, content, chatJID, sender, msg.Info.Timestamp, msg.Info.ID, msg.Info.Sender.String(), logger, msg.Message, groupType, group == nil || group.SendAck)
		}

		// Forward to FibreFlow for Chat display
		msgType := "text"
		if mediaType != "" {
			msgType = mediaType
		}
		
		// Route based on group type
		switch groupType {
		case "maintenance":
			fmt.Printf("🔧 Maintenance group message detected, routing to maintenance API\n")
			forwardToMaintenanceAPI(chatJID, msg.Info.Sender.String(), name, content, msg.Info.Timestamp, msg.Info.ID, (mediaType != ""), mediaType)
			forwardToFibreFlow(chatJID, sender, name, content, msgType, timestamp, msg.Info.IsFromMe)
			return
		case "civil", "optical":
			mediaCount := 0
			if mediaType != "" {
				mediaCount = 1
			}
			fmt.Printf("🏗️ Field ops [%s] message detected, routing to field ops API\n", groupType)

			// Download image inline and encode as base64 when an image is attached
			photoBase64 := ""
			photoFilename := ""
			if mediaType == "image" && msg.Message.GetImageMessage() != nil {
				imgMsg := msg.Message.GetImageMessage()
				rawBytes, dlErr := client.Download(context.Background(), imgMsg)
				if dlErr != nil {
					fmt.Printf("⚠️ Failed to download field ops image: %v\n", dlErr)
				} else {
					photoBase64 = base64.StdEncoding.EncodeToString(rawBytes)
					ts := msg.Info.Timestamp.Format("20060102_150405")
					photoFilename = fmt.Sprintf("image_%s.jpg", ts)

					// Save backup copy to disk: store/{chatJID}/{messageID}.jpg
					backupDir := fmt.Sprintf("store/%s", chatJID)
					if mkErr := os.MkdirAll(backupDir, 0755); mkErr == nil {
						backupPath := fmt.Sprintf("%s/%s.jpg", backupDir, msg.Info.ID)
						if writeErr := os.WriteFile(backupPath, rawBytes, 0644); writeErr != nil {
							fmt.Printf("⚠️ Failed to save field ops image backup: %v\n", writeErr)
						} else {
							fmt.Printf("📥 Saved field ops image backup: %s (%d bytes)\n", backupPath, len(rawBytes))
						}
					} else {
						fmt.Printf("⚠️ Failed to create backup dir %s: %v\n", backupDir, mkErr)
					}
				}
			}

			forwardToFieldOpsAPI(chatJID, msg.Info.Sender.String(), name, content, msg.Info.Timestamp, msg.Info.ID, (mediaType != ""), mediaType, mediaCount, photoBase64, photoFilename)
			forwardToFibreFlow(chatJID, sender, name, content, msgType, timestamp, msg.Info.IsFromMe)
			return
		}

		forwardToFibreFlow(chatJID, sender, name, content, msgType, timestamp, msg.Info.IsFromMe)
	}
}

// DownloadMediaRequest represents the request body for the download media API
type DownloadMediaRequest struct {
	MessageID string `json:"message_id"`
	ChatJID   string `json:"chat_jid"`
}

// DownloadMediaResponse represents the response for the download media API
type DownloadMediaResponse struct {
	Success  bool   `json:"success"`
	Message  string `json:"message"`
	Filename string `json:"filename,omitempty"`
	Path     string `json:"path,omitempty"`
}

// Store additional media info in the database
func (store *MessageStore) StoreMediaInfo(id, chatJID, url string, mediaKey, fileSHA256, fileEncSHA256 []byte, fileLength uint64) error {
	_, err := store.db.Exec(
		"UPDATE messages SET url = ?, media_key = ?, file_sha256 = ?, file_enc_sha256 = ?, file_length = ? WHERE id = ? AND chat_jid = ?",
		url, mediaKey, fileSHA256, fileEncSHA256, fileLength, id, chatJID,
	)
	return err
}

// Get media info from the database
func (store *MessageStore) GetMediaInfo(id, chatJID string) (string, string, string, []byte, []byte, []byte, uint64, error) {
	var mediaType, filename, url string
	var mediaKey, fileSHA256, fileEncSHA256 []byte
	var fileLength uint64

	err := store.db.QueryRow(
		"SELECT media_type, filename, url, media_key, file_sha256, file_enc_sha256, file_length FROM messages WHERE id = ? AND chat_jid = ?",
		id, chatJID,
	).Scan(&mediaType, &filename, &url, &mediaKey, &fileSHA256, &fileEncSHA256, &fileLength)

	return mediaType, filename, url, mediaKey, fileSHA256, fileEncSHA256, fileLength, err
}

// MarkDeleted marks a message as deleted in the database
func (store *MessageStore) MarkDeleted(id, chatJID string) error {
	_, err := store.db.Exec(
		"UPDATE messages SET deleted = TRUE WHERE id = ? AND chat_jid = ?",
		id, chatJID,
	)
	if err != nil {
		return fmt.Errorf("failed to mark message as deleted: %v", err)
	}
	fmt.Printf("🗑️  Marked message as deleted: ID=%s, Chat=%s\n", id, chatJID)
	return nil
}

// MediaDownloader implements the whatsmeow.DownloadableMessage interface
type MediaDownloader struct {
	URL           string
	DirectPath    string
	MediaKey      []byte
	FileLength    uint64
	FileSHA256    []byte
	FileEncSHA256 []byte
	MediaType     whatsmeow.MediaType
}

// GetDirectPath implements the DownloadableMessage interface
func (d *MediaDownloader) GetDirectPath() string {
	return d.DirectPath
}

// GetURL implements the DownloadableMessage interface
func (d *MediaDownloader) GetURL() string {
	return d.URL
}

// GetMediaKey implements the DownloadableMessage interface
func (d *MediaDownloader) GetMediaKey() []byte {
	return d.MediaKey
}

// GetFileLength implements the DownloadableMessage interface
func (d *MediaDownloader) GetFileLength() uint64 {
	return d.FileLength
}

// GetFileSHA256 implements the DownloadableMessage interface
func (d *MediaDownloader) GetFileSHA256() []byte {
	return d.FileSHA256
}

// GetFileEncSHA256 implements the DownloadableMessage interface
func (d *MediaDownloader) GetFileEncSHA256() []byte {
	return d.FileEncSHA256
}

// GetMediaType implements the DownloadableMessage interface
func (d *MediaDownloader) GetMediaType() whatsmeow.MediaType {
	return d.MediaType
}

// Function to download media from a message
func downloadMedia(client *whatsmeow.Client, messageStore *MessageStore, messageID, chatJID string) (bool, string, string, string, error) {
	// Query the database for the message
	var mediaType, filename, url string
	var mediaKey, fileSHA256, fileEncSHA256 []byte
	var fileLength uint64
	var err error

	// First, check if we already have this file
	chatDir := fmt.Sprintf("store/%s", strings.ReplaceAll(chatJID, ":", "_"))
	localPath := ""

	// Get media info from the database
	mediaType, filename, url, mediaKey, fileSHA256, fileEncSHA256, fileLength, err = messageStore.GetMediaInfo(messageID, chatJID)

	if err != nil {
		// Try to get basic info if extended info isn't available
		err = messageStore.db.QueryRow(
			"SELECT media_type, filename FROM messages WHERE id = ? AND chat_jid = ?",
			messageID, chatJID,
		).Scan(&mediaType, &filename)

		if err != nil {
			return false, "", "", "", fmt.Errorf("failed to find message: %v", err)
		}
	}

	// Check if this is a media message
	if mediaType == "" {
		return false, "", "", "", fmt.Errorf("not a media message")
	}

	// Create directory for the chat if it doesn't exist
	if err := os.MkdirAll(chatDir, 0755); err != nil {
		return false, "", "", "", fmt.Errorf("failed to create chat directory: %v", err)
	}

	// Generate a local path for the file
	localPath = fmt.Sprintf("%s/%s", chatDir, filename)

	// Get absolute path
	absPath, err := filepath.Abs(localPath)
	if err != nil {
		return false, "", "", "", fmt.Errorf("failed to get absolute path: %v", err)
	}

	// Check if file already exists
	if _, err := os.Stat(localPath); err == nil {
		// File exists, return it
		return true, mediaType, filename, absPath, nil
	}

	// If we don't have all the media info we need, we can't download
	if url == "" || len(mediaKey) == 0 || len(fileSHA256) == 0 || len(fileEncSHA256) == 0 || fileLength == 0 {
		return false, "", "", "", fmt.Errorf("incomplete media information for download")
	}

	fmt.Printf("Attempting to download media for message %s in chat %s...\n", messageID, chatJID)

	// Extract direct path from URL
	directPath := extractDirectPathFromURL(url)

	// Create a downloader that implements DownloadableMessage
	var waMediaType whatsmeow.MediaType
	switch mediaType {
	case "image":
		waMediaType = whatsmeow.MediaImage
	case "video":
		waMediaType = whatsmeow.MediaVideo
	case "audio":
		waMediaType = whatsmeow.MediaAudio
	case "document":
		waMediaType = whatsmeow.MediaDocument
	default:
		return false, "", "", "", fmt.Errorf("unsupported media type: %s", mediaType)
	}

	downloader := &MediaDownloader{
		URL:           url,
		DirectPath:    directPath,
		MediaKey:      mediaKey,
		FileLength:    fileLength,
		FileSHA256:    fileSHA256,
		FileEncSHA256: fileEncSHA256,
		MediaType:     waMediaType,
	}

	// Download the media using whatsmeow client
	mediaData, err := client.Download(context.Background(), downloader)
	if err != nil {
		return false, "", "", "", fmt.Errorf("failed to download media: %v", err)
	}

	// Save the downloaded media to file
	if err := os.WriteFile(localPath, mediaData, 0644); err != nil {
		return false, "", "", "", fmt.Errorf("failed to save media file: %v", err)
	}

	fmt.Printf("Successfully downloaded %s media to %s (%d bytes)\n", mediaType, absPath, len(mediaData))
	return true, mediaType, filename, absPath, nil
}

// Extract direct path from a WhatsApp media URL
func extractDirectPathFromURL(url string) string {
	// The direct path is typically in the URL, we need to extract it
	// Example URL: https://mmg.whatsapp.net/v/t62.7118-24/13812002_698058036224062_3424455886509161511_n.enc?ccb=11-4&oh=...

	// Find the path part after the domain
	parts := strings.SplitN(url, ".net/", 2)
	if len(parts) < 2 {
		return url // Return original URL if parsing fails
	}

	pathPart := parts[1]

	// Remove query parameters
	pathPart = strings.SplitN(pathPart, "?", 2)[0]

	// Create proper direct path format
	return "/" + pathPart
}

// Start a REST API server to expose the WhatsApp client functionality
func startRESTServer(client *whatsmeow.Client, messageStore *MessageStore, port int) {
	// Mutating endpoints run through the inbound secret check in the configured
	// mode; handleStrict rejects unconditionally.
	//
	// What stays open, and why each one is a deliberate choice rather than a
	// blanket "read-only is safe" claim:
	//
	//	/health         - the local healthcheck cron polls it and holds no secret.
	//	                  Discloses link state and the bridge's own phone number.
	//	/groups         - group names and JIDs. Read by the FibreFlow admin UI.
	//	/all-groups     - as above, for groups not yet registered in the DB.
	//	/api/download   - media by ID. Callers in field-ops and NOC photo services.
	//	/api/lid-lookup - a phone-number to LID oracle.
	//
	// The last three disclose real data to an unauthenticated caller and should
	// be closed once their callers send the secret; they are left open here only
	// because migrating them is a wider change than this one. /list-recent is
	// NOT in that list: it returns message text for everything sent in the last
	// hour, has no caller anywhere in the repo, on the VPS, or in cron, so it is
	// closed outright below.
	handleGuarded := func(path string, h http.HandlerFunc) {
		http.HandleFunc(path, guard(path, h))
	}
	handleStrict := func(path string, h http.HandlerFunc) {
		http.HandleFunc(path, guardStrict(h))
	}
	registerPairingRoutes(client)

	// Handler for sending messages
	handleGuarded("/api/send", func(w http.ResponseWriter, r *http.Request) {
		// Only allow POST requests
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Parse the request body
		var req SendMessageRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request format", http.StatusBadRequest)
			return
		}

		// Validate request
		if req.Recipient == "" {
			http.Error(w, "Recipient is required", http.StatusBadRequest)
			return
		}

		if req.Message == "" && req.MediaPath == "" {
			http.Error(w, "Message or media path is required", http.StatusBadRequest)
			return
		}

		fmt.Println("Received request to send message", req.Message, req.MediaPath)

		var success bool
		var message string

		// Check if this is a reply (has reply threading fields)
		if req.ReplyToID != "" && req.ReplyToSender != "" {
			// Use sendWhatsAppReply for threaded replies
			fmt.Printf("Sending as reply to message %s from %s\n", req.ReplyToID, req.ReplyToSender)
			success, message = sendWhatsAppReply(client, req.Recipient, req.Message, req.ReplyToID, req.ReplyToSender, req.QuotedContent, req.MentionJIDs)
		} else {
			// Send regular message
			success, message = sendWhatsAppMessage(client, req.Recipient, req.Message, req.MediaPath)
		}
		fmt.Println("Message sent", success, message)
		// Set response headers
		w.Header().Set("Content-Type", "application/json")

		// Set appropriate status code
		if !success {
			w.WriteHeader(http.StatusInternalServerError)
		}

		// Send response
		json.NewEncoder(w).Encode(SendMessageResponse{
			Success: success,
			Message: message,
		})
	})

	// Handler for downloading media
	http.HandleFunc("/api/download", func(w http.ResponseWriter, r *http.Request) {
		// Only allow POST requests
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Parse the request body
		var req DownloadMediaRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request format", http.StatusBadRequest)
			return
		}

		// Validate request
		if req.MessageID == "" || req.ChatJID == "" {
			http.Error(w, "Message ID and Chat JID are required", http.StatusBadRequest)
			return
		}

		// Download the media
		success, mediaType, filename, path, err := downloadMedia(client, messageStore, req.MessageID, req.ChatJID)

		// Set response headers
		w.Header().Set("Content-Type", "application/json")

		// Handle download result
		if !success || err != nil {
			errMsg := "Unknown error"
			if err != nil {
				errMsg = err.Error()
			}

			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(DownloadMediaResponse{
				Success: false,
				Message: fmt.Sprintf("Failed to download media: %s", errMsg),
			})
			return
		}

		// Send successful response
		json.NewEncoder(w).Encode(DownloadMediaResponse{
			Success:  true,
			Message:  fmt.Sprintf("Successfully downloaded %s media", mediaType),
			Filename: filename,
			Path:     path,
		})
	})

	// Handler for LID lookup (phone number to WhatsApp LID)
	http.HandleFunc("/api/lid-lookup", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		phone := r.URL.Query().Get("phone")
		if phone == "" {
			http.Error(w, "phone parameter is required", http.StatusBadRequest)
			return
		}

		// Query whatsapp.db for LID mapping
		db, err := sql.Open("sqlite3", "file:store/whatsapp.db?mode=ro")
		if err != nil {
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}
		defer db.Close()

		var lid string
		err = db.QueryRow("SELECT lid FROM whatsmeow_lid_map WHERE pn = ?", phone).Scan(&lid)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "LID not found for phone"})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "lid": lid, "jid": lid + "@lid", "phone": phone})
	})

	// Handler: /send-document - send an xlsx/document to a group (restored 2026-05-27)
	handleGuarded("/send-document", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "Method not allowed"})
			return
		}

		var req struct {
			GroupJID    string `json:"group_jid"`
			DocumentURL string `json:"document_url"`
			Filename    string `json:"filename"`
			Caption     string `json:"caption"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "Invalid JSON"})
			return
		}

		if req.GroupJID == "" || req.DocumentURL == "" || req.Filename == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "group_jid, document_url and filename are required"})
			return
		}

		groupJID, err := types.ParseJID(req.GroupJID)
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": fmt.Sprintf("Invalid group_jid: %v", err)})
			return
		}

		httpClient := &http.Client{Timeout: 60 * time.Second}
		resp, err := httpClient.Get(req.DocumentURL)
		if err != nil {
			w.WriteHeader(http.StatusBadGateway)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "Failed to download document: " + err.Error()})
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			w.WriteHeader(http.StatusBadGateway)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": fmt.Sprintf("Document URL returned HTTP %d", resp.StatusCode)})
			return
		}

		docBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "Failed to read document: " + err.Error()})
			return
		}

		uploadResp, err := client.Upload(context.Background(), docBytes, whatsmeow.MediaDocument)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "Failed to upload to WhatsApp: " + err.Error()})
			return
		}

		mimeType := "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
		caption := req.Caption
		filename := req.Filename
		msg := &waProto.Message{
			DocumentMessage: &waProto.DocumentMessage{
				Title:         proto.String(filename),
				Caption:       proto.String(caption),
				Mimetype:      proto.String(mimeType),
				URL:           &uploadResp.URL,
				DirectPath:    &uploadResp.DirectPath,
				MediaKey:      uploadResp.MediaKey,
				FileEncSHA256: uploadResp.FileEncSHA256,
				FileSHA256:    uploadResp.FileSHA256,
				FileLength:    &uploadResp.FileLength,
			},
		}

		_, err = client.SendMessage(context.Background(), groupJID, msg)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "Failed to send: " + err.Error()})
			return
		}

		fmt.Printf("Document sent to %s: %s\n", req.GroupJID, req.Filename)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "message": "Document sent", "filename": req.Filename})
	})

	// Handler: /send-message - Sender-compatible endpoint
	handleGuarded("/send-message", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
	
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "Method not allowed. Use POST"})
			return
		}
	
		var req struct {
			GroupJID     string `json:"group_jid"`
			RecipientJID string `json:"recipient_jid"`
			Message      string `json:"message"`
		}
	
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "Invalid JSON"})
			return
		}
	
		if req.GroupJID == "" || req.Message == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "Missing group_jid or message"})
			return
		}
	
		// Parse group JID
		groupJID, err := types.ParseJID(req.GroupJID)
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": fmt.Sprintf("Invalid group_jid: %v", err)})
			return
		}
	
		// Create message (with mention if recipient provided)
		var msg *waProto.Message
		if req.RecipientJID != "" && req.RecipientJID != "0@s.whatsapp.net" {
			recipientJID, _ := types.ParseJID(req.RecipientJID)
			messageText := fmt.Sprintf("@%s %s", recipientJID.User, req.Message)
			msg = &waProto.Message{
				ExtendedTextMessage: &waProto.ExtendedTextMessage{
					Text: proto.String(messageText),
					ContextInfo: &waProto.ContextInfo{
						MentionedJID: []string{req.RecipientJID},
					},
				},
			}
		} else {
			msg = &waProto.Message{
				Conversation: proto.String(req.Message),
			}
		}
	
		// Send message
		resp, err := client.SendMessage(context.Background(), groupJID, msg)
		if err != nil {
			fmt.Printf("❌ Failed to send message to %s (%s): %v\n", groupJID.String(), getGroupNameOrUnknown(groupJID.String()), err)
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": fmt.Sprintf("Failed to send: %v", err)})
			return
		}
	
		// Track for potential deletion
		sentMsg := SentMessage{
			MessageID:    resp.ID,
			GroupJID:     req.GroupJID,
			RecipientJID: req.RecipientJID,
			MessageText:  req.Message,
			SentAt:       time.Now(),
		}
		if len(sentMsg.MessageText) > 50 {
			sentMsg.MessageText = sentMsg.MessageText[:50]
		}
	
		sentMessagesMu.Lock()
		sentMessages[resp.ID] = sentMsg
		recentMessages = append(recentMessages, sentMsg)
		if len(recentMessages) > 100 {
			recentMessages = recentMessages[len(recentMessages)-100:]
		}
		sentMessagesMu.Unlock()
	
		fmt.Printf("✅ Sent message %s to group %s\n", resp.ID, req.GroupJID)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "message_id": resp.ID, "message": "Message sent successfully"})
	})
	
	// Handler: /delete-message - Delete a sent message
	handleGuarded("/delete-message", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
	
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "Method not allowed"})
			return
		}
	
		var req struct {
			MessageID string `json:"message_id"`
			GroupJID  string `json:"group_jid"`
		}
	
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "Invalid JSON"})
			return
		}
	
		if req.MessageID == "" || req.GroupJID == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "Missing message_id or group_jid"})
			return
		}
	
		groupJID, err := types.ParseJID(req.GroupJID)
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": fmt.Sprintf("Invalid group_jid: %v", err)})
			return
		}
	
		// Create revoke message
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
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": fmt.Sprintf("Failed to delete: %v", err)})
			return
		}
	
		sentMessagesMu.Lock()
		delete(sentMessages, req.MessageID)
		sentMessagesMu.Unlock()
	
		fmt.Printf("🗑️ Deleted message %s\n", req.MessageID)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "message": "Message deleted"})
	})
	
	// Handler: /list-recent - List recently sent messages
	handleStrict("/list-recent", func(w http.ResponseWriter, r *http.Request) {
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
	
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "count": len(deletable), "messages": deletable})
	})
	
	// Handler: /health - Health check endpoint
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		
		phoneNumber := "unknown"
		deviceJID := "unknown"
		needsAuth := true
		sessionValid := false
		
		if client != nil && client.Store != nil && client.Store.ID != nil {
			deviceJID = client.Store.ID.String()
			phoneNumber = "+" + client.Store.ID.User
			needsAuth = false
			sessionValid = true
		}
	
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":        "ok",
			"service":       "whatsapp-bridge-unified",
			"version":       "2.0.0",
			"connected":     client != nil && client.IsConnected(),
			"session_valid": sessionValid,
			"needs_auth":    needsAuth,
			"device_jid":    deviceJID,
			"phone_number":  phoneNumber,
			"pairing_state": func() string { if sessionValid { return "connected" } else { return "needs_pairing" } }(),
			"recent_count":  len(recentMessages),
			"group_membership": membershipHealth(),
		})
	})
	
	// Handler: /react - Send emoji reaction to a message
	handleGuarded("/react", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
	
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "Method not allowed"})
			return
		}
	
		var req struct {
			GroupJID  string `json:"group_jid"`
			MessageID string `json:"message_id"`
			Emoji     string `json:"emoji"`
			SenderJID string `json:"sender_jid"` // Original message sender
		}
	
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "Invalid JSON"})
			return
		}
	
		if req.GroupJID == "" || req.MessageID == "" || req.Emoji == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "Missing group_jid, message_id, or emoji"})
			return
		}
	
		groupJID, err := types.ParseJID(req.GroupJID)
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": fmt.Sprintf("Invalid group_jid: %v", err)})
			return
		}
	
		// Determine if message is from us or someone else
		fromMe := req.SenderJID == "" || req.SenderJID == client.Store.ID.String()
	
		// Create reaction message
		reactionMsg := &waProto.Message{
			ReactionMessage: &waProto.ReactionMessage{
				Key: &waProto.MessageKey{
					RemoteJID: proto.String(req.GroupJID),
					ID:        proto.String(req.MessageID),
					FromMe:    proto.Bool(fromMe),
					Participant: func() *string {
						if !fromMe && req.SenderJID != "" {
							return proto.String(req.SenderJID)
						}
						return nil
					}(),
				},
				Text:              proto.String(req.Emoji),
				SenderTimestampMS: proto.Int64(time.Now().UnixMilli()),
			},
		}
	
		_, err = client.SendMessage(context.Background(), groupJID, reactionMsg)
		if err != nil {
			fmt.Printf("❌ Failed to send reaction: %v\n", err)
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": fmt.Sprintf("Failed to react: %v", err)})
			return
		}
	
		fmt.Printf("%s Reacted to message %s in %s\n", req.Emoji, req.MessageID, req.GroupJID)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "message": "Reaction sent"})
	})
	

	// Handler: /reload-groups - Reload groups from database
	handleGuarded("/reload-groups", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Println("📥 /reload-groups endpoint called")
		
		err := loadGroupsFromDB()
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"error":   err.Error(),
			})
			return
		}
		
		groupsMutex.RLock()
		count := len(monitoredGroups)
		groupsMutex.RUnlock()
		
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": fmt.Sprintf("Reloaded %d groups from database", count),
			"count":   count,
		})
	})

	// Handler: /groups - List current monitored groups
	http.HandleFunc("/groups", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		groupsMutex.RLock()
		defer groupsMutex.RUnlock()

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"count":   len(monitoredGroups),
			"groups":  monitoredGroups,
		})
	})

	// List ALL WhatsApp groups the phone is joined to (for group discovery)
	http.HandleFunc("/all-groups", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		groups, err := client.GetJoinedGroups(context.Background())
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"error":   err.Error(),
			})
			return
		}

		type groupInfo struct {
			JID          string `json:"jid"`
			Name         string `json:"name"`
			Topic        string `json:"topic"`
			Participants int    `json:"participants"`
			IsLocked     bool   `json:"is_locked"`
			IsAnnounce   bool   `json:"is_announce"`
		}

		var result []groupInfo
		for _, g := range groups {
			result = append(result, groupInfo{
				JID:          g.JID.String(),
				Name:         g.Name,
				Topic:        g.Topic,
				Participants: len(g.Participants),
				IsLocked:     g.IsLocked,
				IsAnnounce:   g.IsAnnounce,
			})
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"count":   len(result),
			"groups":  result,
		})
	})

	// Start the server
	serverAddr := fmt.Sprintf(":%d", port)
	fmt.Printf("Starting REST API server on %s...\n", serverAddr)

	// Run server in a goroutine so it doesn't block
	go func() {
		if err := http.ListenAndServe(serverAddr, nil); err != nil {
			fmt.Printf("REST API server error: %v\n", err)
		}
	}()
}

func main() {
	// Set up logger - reduced logging to prevent rate limiting
	logger := waLog.Stdout("Client", "WARN", true)
	logger.Warnf("Starting WhatsApp client...")

	// Fail fast rather than dialling a zero-value DSN: every ack path needs the DB.
	if NEON_DB_URL == "" {
		logger.Errorf("DATABASE_URL is not set - refusing to start")
		os.Exit(1)
	}


	// Load monitored groups from Neon database
	fmt.Println("📋 Loading monitored groups from database...")
	if err := loadGroupsFromDB(); err != nil {
		logger.Warnf("Failed to load groups from DB (will use hardcoded fallback): %v", err)
	}
	
	// Start background goroutine to reload groups every 5 minutes
	startGroupsReloader()

	// Create database connection for storing session data
	dbLog := waLog.Stdout("Database", "WARN", true)

	// Create directory for database if it doesn't exist
	if err := os.MkdirAll("store", 0755); err != nil {
		logger.Errorf("Failed to create store directory: %v", err)
		return
	}

	container, err := sqlstore.New(context.Background(), "sqlite3", "file:store/whatsapp.db?_foreign_keys=on", dbLog)
	if err != nil {
		logger.Errorf("Failed to connect to database: %v", err)
		return
	}

	// Get device store - This contains session information
	deviceStore, err := container.GetFirstDevice(context.Background())
	if err != nil {
		if err == sql.ErrNoRows {
			// No device exists, create one
			deviceStore = container.NewDevice()
			logger.Infof("Created new device")
		} else {
			logger.Errorf("Failed to get device: %v", err)
			return
		}
	}

	// Create client instance
	client := whatsmeow.NewClient(deviceStore, logger)
	if client == nil {
		logger.Errorf("Failed to create WhatsApp client")
		return
	}

	// Set bridge client for direct sending (replaces external sender service)
	SetBridgeClient(client)

	// Initialize message store
	messageStore, err := NewMessageStore()
	if err != nil {
		logger.Errorf("Failed to initialize message store: %v", err)
		return
	}
	defer messageStore.Close()

	// Setup event handling for messages and history sync
	client.AddEventHandler(func(evt interface{}) {
		fmt.Printf("🚀 EVENT RECEIVED: %T\n", evt)
		switch v := evt.(type) {
		case *events.Message:
			// Process regular messages
			fmt.Printf("🔥 Message event received: ID=%s, Chat=%s, Sender=%s\n",
				v.Info.ID, v.Info.Chat.String(), v.Info.Sender.String())
			logger.Infof("🔥 Message event received: ID=%s, Chat=%s, Sender=%s",
				v.Info.ID, v.Info.Chat.String(), v.Info.Sender.String())
			handleMessage(client, messageStore, v, logger)

		case *events.HistorySync:
			// Process history sync events
			handleHistorySync(client, messageStore, v, logger)

		case *events.Connected:
			logger.Infof("Connected to WhatsApp")
			fmt.Printf("✅ [Reconnect] Connected to WhatsApp at %s - offline sync will process missed DRs\n", time.Now().Format("2006-01-02 15:04:05"))

	case *events.LoggedOut:
		logger.Warnf("Device logged out, please scan QR code to log in again")

	case *events.Receipt:
		// Handle receipt events - these indicate message status changes
		handleReceiptEvent(client, messageStore, v, logger)
	

	case *events.DeleteForMe:
		// Handle message deletions
		fmt.Printf("🗑️  Message deleted: Chat=%s, MessageID=%s\n", v.ChatJID.String(), v.MessageID)
		logger.Infof("🗑️  Message deleted: Chat=%s, MessageID=%s", v.ChatJID.String(), v.MessageID)
		err := messageStore.MarkDeleted(v.MessageID, v.ChatJID.String())
		if err != nil {
			logger.Errorf("Failed to mark message as deleted: %v", err)
		}
	default:
		// Log unknown events for debugging
		logger.Infof("Received unhandled event type: %T", v)
		}
	})

	// Connect to WhatsApp
	err = client.Connect()
	if err != nil {
		logger.Errorf("Failed to connect: %v", err)
		return
	}

	// Handle pairing if necessary
	if client.Store.ID == nil {
		// No ID stored, this is a new client, need to pair with phone
		phoneNumber := os.Getenv("WHATSAPP_PHONE_NUMBER")
		if phoneNumber == "" {
			phoneNumber = "+27727665862" // Default to Louis's number
		}

		fmt.Printf("📱 Using phone number pairing for: %s\n", phoneNumber)
		logger.Infof("Starting phone number pairing for: %s", phoneNumber)

		code, err := client.PairPhone(context.Background(), phoneNumber, true, whatsmeow.PairClientChrome, "Chrome (Linux)")
		if err != nil {
			logger.Errorf("Failed to request pairing code, falling back to QR: %v", err)
			// Fallback to QR code if phone pairing fails
			qrChan, _ := client.GetQRChannel(context.Background())
			for evt := range qrChan {
				if evt.Event == "code" {
					fmt.Println("\nScan this QR code with your WhatsApp app:")
					qrterminal.GenerateHalfBlock(evt.Code, qrterminal.L, os.Stdout)
				} else {
					logger.Infof("QR channel event: %s", evt.Event)
				}
			}
		} else {
			fmt.Printf("\n🔑 PAIRING CODE: %s\n\n", code)
			fmt.Println("📱 Enter this code in WhatsApp on your phone")
		}
	}

	// Wait a moment for connection to stabilize
	time.Sleep(2 * time.Second)

	if !client.IsConnected() {
		logger.Errorf("Failed to establish stable connection")
		return
	}

	fmt.Println("\n✓ Connected to WhatsApp! Type 'help' for commands.")

	// Check membership once the session is live. A number that was swapped or
	// removed from groups looks completely healthy until something tries to send.
	setReconcileClient(client)
	runGroupReconciliation(context.Background(), getReconcileClient())
	startMembershipReconciler()

	// Start REST API server
	startRESTServer(client, messageStore, 8083)

	// Create a channel to keep the main goroutine alive
	exitChan := make(chan os.Signal, 1)
	signal.Notify(exitChan, syscall.SIGINT, syscall.SIGTERM)

	fmt.Println("REST server is running. Press Ctrl+C to disconnect and exit.")

	// Wait for termination signal
	<-exitChan

	fmt.Println("Disconnecting...")
	// Disconnect client
	client.Disconnect()
}

// GetChatName determines the appropriate name for a chat based on JID and other info
func GetChatName(client *whatsmeow.Client, messageStore *MessageStore, jid types.JID, chatJID string, conversation interface{}, sender string, logger waLog.Logger) string {
	// First, check if chat already exists in database with a name
	var existingName string
	err := messageStore.db.QueryRow("SELECT name FROM chats WHERE jid = ?", chatJID).Scan(&existingName)
	if err == nil && existingName != "" {
		// Chat exists with a name, use that
		logger.Infof("Using existing chat name for %s: %s", chatJID, existingName)
		return existingName
	}

	// Need to determine chat name
	var name string

	if jid.Server == "g.us" {
		// This is a group chat
		logger.Infof("Getting name for group: %s", chatJID)

		// Use conversation data if provided (from history sync)
		if conversation != nil {
			// Extract name from conversation if available
			// This uses type assertions to handle different possible types
			var displayName, convName *string
			// Try to extract the fields we care about regardless of the exact type
			v := reflect.ValueOf(conversation)
			if v.Kind() == reflect.Ptr && !v.IsNil() {
				v = v.Elem()

				// Try to find DisplayName field
				if displayNameField := v.FieldByName("DisplayName"); displayNameField.IsValid() && displayNameField.Kind() == reflect.Ptr && !displayNameField.IsNil() {
					dn := displayNameField.Elem().String()
					displayName = &dn
				}

				// Try to find Name field
				if nameField := v.FieldByName("Name"); nameField.IsValid() && nameField.Kind() == reflect.Ptr && !nameField.IsNil() {
					n := nameField.Elem().String()
					convName = &n
				}
			}

			// Use the name we found
			if displayName != nil && *displayName != "" {
				name = *displayName
			} else if convName != nil && *convName != "" {
				name = *convName
			}
		}

		// If we didn't get a name, try group info
		if name == "" {
			groupInfo, err := client.GetGroupInfo(context.Background(), jid)
			if err == nil && groupInfo.Name != "" {
				name = groupInfo.Name
			} else {
				// Fallback name for groups
				name = fmt.Sprintf("Group %s", jid.User)
			}
		}

		logger.Infof("Using group name: %s", name)
	} else {
		// This is an individual contact
		logger.Infof("Getting name for contact: %s", chatJID)

		// Just use contact info (full name)
		contact, err := client.Store.Contacts.GetContact(context.Background(), jid)
		if err == nil && contact.FullName != "" {
			name = contact.FullName
		} else if sender != "" {
			// Fallback to sender
			name = sender
		} else {
			// Last fallback to JID
			name = jid.User
		}

		logger.Infof("Using contact name: %s", name)
	}

	return name
}

// Insert into wa_monitor_drops table for WA Monitor integration
func insertIntoWAMonitorDrops(db *sql.DB, dropNumber, projectName, userName, sender string, reviewDate time.Time) error {
	_, err := db.Exec(`
		INSERT INTO wa_monitor_drops (
			drop_number, project, status, user_name,
			comment, sender_phone, completed_photos, outstanding_photos,
			created_at, updated_at
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10
		) ON CONFLICT (drop_number) DO UPDATE SET
			updated_at = CURRENT_TIMESTAMP,
			comment = EXCLUDED.comment,
			sender_phone = EXCLUDED.sender_phone,
			project = EXCLUDED.project,
			user_name = EXCLUDED.user_name
	`, dropNumber, projectName, "incomplete", userName,
		fmt.Sprintf("Detected from WhatsApp group on %s", reviewDate.Format("2006-01-02 15:04:05")),
		sender, 0, 12, reviewDate, reviewDate)

	if err != nil {
		return fmt.Errorf("failed to insert into wa_monitor_drops: %v", err)
	}

	fmt.Printf("✅ Inserted/Updated %s in wa_monitor_drops table\n", dropNumber)
	return nil
}

// isRetryableDBError reports whether err is a transient Postgres connection-slot
// exhaustion (SQLSTATE 53300) worth retrying after a short backoff. When the shared
// Supabase pool is momentarily saturated the bridge's QA-review insert is refused;
// retrying rather than dropping prevents a silently missed ack.
func isRetryableDBError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "remaining connection slots are reserved") ||
		strings.Contains(msg, "too many clients already") ||
		strings.Contains(msg, "sorry, too many clients")
}

// Create or update QA photo review record in Neon database
func createQAPhotoReview(client *whatsmeow.Client, chatJID, dropNumber, projectName, userName, sender, messageID, senderJID, originalText string, reviewDate time.Time) error {
	db, err := sql.Open("postgres", NEON_DB_URL)
	if err != nil {
		return fmt.Errorf("failed to connect to Neon database: %v", err)
	}
	defer db.Close()

	// Also insert into wa_monitor_drops table for WA Monitor integration
	err = insertIntoWAMonitorDrops(db, dropNumber, projectName, userName, sender, reviewDate)
	if err != nil {
		// Log but don't fail - wa_monitor_drops is secondary
		fmt.Printf("⚠️ Warning: Failed to insert into wa_monitor_drops: %v\n", err)
	}

	// Check if QA review already exists for this drop and date

	// Load South African timezone (SAST)
	loc, locErr := time.LoadLocation("Africa/Johannesburg")
	if locErr != nil {
		// Fallback to UTC if timezone loading fails
		loc = time.UTC
	}
	// Get current time in SAST
	nowSAST := time.Now().In(loc)
	var existingID string
	err = db.QueryRow("SELECT id FROM qa_photo_reviews WHERE drop_number = $1", 
		dropNumber).Scan(&existingID)
	
	if err == nil {
		// Record exists - this is a resubmission, update it
		fmt.Printf("🔄 Drop %s already has QA review - updating as resubmission\n", dropNumber)

		// Reset completion status and add resubmission note.
		// Backfill wa_group_jid if it was never set (older rows), preserving the
		// first-seen group; record the resubmission's source group in the comment
		// trail so a drop reappearing in a different group is still captured.
		_, updateErr := db.Exec(`
			UPDATE qa_photo_reviews
			SET
				incomplete = FALSE,
				resubmitted = TRUE,
				feedback_sent = NULL,
				comment = COALESCE(comment, '') || $1,
				wa_group_jid = COALESCE(NULLIF(wa_group_jid, ''), $3),
				updated_at = CURRENT_TIMESTAMP
			WHERE id = $2
		`, fmt.Sprintf("\n--- RESUBMITTED %s SAST (group %s) ---\nPhotos updated by %s. QA can continue review.\n",
			nowSAST.Format("2006-01-02 15:04:05"), chatJID, userName), existingID, chatJID)
		
		if updateErr != nil {
			return fmt.Errorf("failed to update QA photo review for resubmission: %v", updateErr)
		}
		
		fmt.Printf("✅ Updated QA photo review for resubmission: %s\n", dropNumber)
		return nil
	}
	

	// Record doesn't exist - create new one
	if err == sql.ErrNoRows {
		_, err = db.Exec(`
			INSERT INTO qa_photo_reviews (
				drop_number, user_name, project, review_date, comment, submitted_by, whatsapp_message_date, wa_group_jid
			) VALUES (
				$1, $2, $3, $4, $5, $6, $7, $8
			)
		`, dropNumber, userName, projectName, reviewDate.Format("2006-01-02"),
			fmt.Sprintf("Auto-created from WhatsApp on %s SAST", nowSAST.Format("2006-01-02 15:04:05")), sender, reviewDate, chatJID)

		if err != nil {
			return fmt.Errorf("failed to create QA photo review: %v", err)
		}

		fmt.Printf("✅ Created QA photo review for %s (user: %s, project: %s)\n", dropNumber, userName, projectName)
		// Sync to FibreFlow unified table
		syncToFibreFlow(client, chatJID, dropNumber, projectName, sender, messageID, senderJID, originalText)
		return nil
	}

	// Some other database error
	return fmt.Errorf("failed to check existing QA review: %v", err)
}

// syncToFibreFlow calls the FibreFlow process-new-dr API to sync DR to unified table
func syncToFibreFlow(client *whatsmeow.Client, chatJID, dropNumber, projectName, senderPhone, messageID, senderJID, originalText string) {
	go func() {
		// Use proper JSON encoding to handle special characters in message text
		syncData := SyncPayload{
			Secret:         bridgeSecret,
			DropNumber:     dropNumber,
			Project:        projectName,
			SenderPhone:    senderPhone,
			WaMessageId:    messageID,
			WaSenderJid:    senderJID,
			WaOriginalText: originalText,
			WaGroupJid:     chatJID,
		}
		payloadBytes, err := json.Marshal(syncData)
		if err != nil {
			fmt.Printf("\033[31m[Client ERROR] Failed to marshal sync payload for %s: %v\033[0m\n", dropNumber, err)
			return
		}
		resp, err := http.Post(FIBREFLOW_API_URL, "application/json", bytes.NewReader(payloadBytes))
		if err != nil {
			fmt.Printf("\033[31m[Client ERROR] Failed to sync %s to FibreFlow: %v\033[0m\n", dropNumber, err)
			return
		}
		defer resp.Body.Close()

		body, _ := io.ReadAll(resp.Body)

		if resp.StatusCode == 200 || resp.StatusCode == 201 {
			fmt.Printf("✅ Synced %s to FibreFlow unified table\n", dropNumber)
		} else {
			fmt.Printf("\033[33m[Client WARN] FibreFlow sync for %s returned %d: %s\033[0m\n", dropNumber, resp.StatusCode, string(body))

			// Parse error response and notify user if needed
			var errResp FibreFlowErrorResponse
			if json.Unmarshal(body, &errResp) == nil && errResp.NotifyUser {
				// Send WhatsApp notification to the group
				notifyMsg := fmt.Sprintf("⚠️ %s\n\n%s", errResp.Error, errResp.Message)
				success, msg := sendWhatsAppMessage(client, chatJID, notifyMsg, "")
				if success {
					fmt.Printf("📱 Sent rejection notification to %s: %s\n", chatJID, errResp.Message)
				} else {
					fmt.Printf("\033[31m[Client ERROR] Failed to send notification: %s\033[0m\n", msg)
				}
			}
		}
	}()
}


// FibreFlow ACK API URLs — tried in order (Layer 1: multi-URL fallback)
var fibreflowACKURLs = []string{
	"https://app.fibreflow.app/api/activate/dr-acknowledgment",  // Production
	"https://dev.fibreflow.app/api/activate/dr-acknowledgment",  // Dev
	"https://vf.fibreflow.app/api/activate/dr-acknowledgment",   // Staging
}

// tryFibreFlowACK attempts to get ACK message from a FibreFlow URL.
// Returns the response on success, or an error string on failure.
func tryFibreFlowACK(url, payload, dropNumber string) (*DrAcknowledgmentResponse, string) {
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Post(url, "application/json", strings.NewReader(payload))
	if err != nil {
		return nil, fmt.Sprintf("request failed: %v", err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Sprintf("API returned %d: %s", resp.StatusCode, string(body))
	}

	var ackResp DrAcknowledgmentResponse
	if err := json.Unmarshal(body, &ackResp); err != nil {
		return nil, fmt.Sprintf("parse error: %v", err)
	}

	return &ackResp, ""
}

// sendDRAcknowledgment sends immediate acknowledgment reply to the user.
// Layer 1: Tries production → dev → staging FibreFlow URLs.
// Layer 2: If all URLs fail, generates ACK locally using direct DB + BOSS API.
func sendDRAcknowledgment(client *whatsmeow.Client, chatJID string, dropNumber string, project string, messageID string, senderJID string) {
	// Dedup: suppress "not found" DRs for 2 hours to prevent group spam
	notFoundKey := fmt.Sprintf("notfound:%s:%s", chatJID, dropNumber)
	processedMsgsMu.Lock()
	if lastSent, exists := processedMsgs[notFoundKey]; exists && time.Since(lastSent) < 2*time.Hour {
		processedMsgsMu.Unlock()
		fmt.Printf("🚫 DEDUP: Suppressing repeat NOT FOUND ACK for %s (first sent %v ago)\n", dropNumber, time.Since(lastSent).Round(time.Second))
		return
	}
	processedMsgsMu.Unlock()

	// Dedup at DR level - only send one ACK per DR per 5 minutes
	ackDedupKey := fmt.Sprintf("ack:%s:%s", chatJID, dropNumber)
	processedMsgsMu.Lock()
	if lastSent, exists := processedMsgs[ackDedupKey]; exists && time.Since(lastSent) < 5*time.Minute {
		processedMsgsMu.Unlock()
		fmt.Printf("⏭️  DEDUP: Skipping duplicate DR ACK for %s (sent %v ago)\n", dropNumber, time.Since(lastSent).Round(time.Second))
		return
	}
	processedMsgs[ackDedupKey] = time.Now()
	processedMsgsMu.Unlock()

	go func() {
		payload := fmt.Sprintf(`{"secret":"%s","dropNumber":"%s","project":"%s"}`, bridgeSecret, dropNumber, project)

		// Layer 1: Try each FibreFlow URL with 1 retry each
		var ackResp *DrAcknowledgmentResponse
		var lastErr string

		for _, url := range fibreflowACKURLs {
			// Try each URL twice (immediate + 2s retry)
			for attempt := 1; attempt <= 2; attempt++ {
				resp, errMsg := tryFibreFlowACK(url, payload, dropNumber)
				if errMsg == "" && resp != nil {
					ackResp = resp
					break
				}
				lastErr = errMsg
				if attempt == 1 {
					fmt.Printf("\033[33m[ACK] %s failed for %s (%s), retrying...\033[0m\n", url, dropNumber, errMsg)
					time.Sleep(2 * time.Second)
				}
			}
			if ackResp != nil {
				break
			}
			fmt.Printf("\033[33m[ACK] %s exhausted for %s, trying next URL...\033[0m\n", url, dropNumber)
		}

		var ackMessage string

		if ackResp != nil && ackResp.Success && ackResp.Data.Message != "" {
			// FibreFlow API succeeded — use enriched message
			ackMessage = ackResp.Data.Message

			// If DR was not found, extend dedup to 2 hours to prevent group spam
			if !ackResp.Data.Found {
				notFoundKey := fmt.Sprintf("notfound:%s:%s", chatJID, dropNumber)
				processedMsgsMu.Lock()
				processedMsgs[notFoundKey] = time.Now()
				processedMsgsMu.Unlock()
				fmt.Printf("🚫 NOT FOUND: %s — suppressing repeat ACKs for 2 hours\n", dropNumber)
			}

			fmt.Printf("📱 ACK via FibreFlow API for %s (photos: %d, ONT: %v, UPS: %v)\n",
				dropNumber, ackResp.Data.PhotoCount, ackResp.Data.OntSerial != "", ackResp.Data.UpsSerial != "")
		} else {
			// Layer 2: All FibreFlow URLs failed — generate locally
			fmt.Printf("\033[33m[ACK FALLBACK] All FibreFlow URLs failed for %s (%s). Generating local ACK...\033[0m\n",
				dropNumber, lastErr)

			localMsg, localErr := generateLocalAck(dropNumber, project)
			if localErr != nil {
				fmt.Printf("\033[31m[ACK FAILED] Local ACK generation also failed for %s: %v\033[0m\n", dropNumber, localErr)
				return
			}
			if localMsg == "" {
				fmt.Printf("\033[33m[ACK WARN] Local ACK returned empty message for %s\033[0m\n", dropNumber)
				return
			}
			ackMessage = localMsg
		}

		// Send the ACK message to WhatsApp
		success, msg := sendViaSenderService(chatJID, senderJID, ackMessage)
		if success {
			fmt.Printf("✅ ACK delivered for %s\n", dropNumber)
		} else {
			fmt.Printf("\033[31m[ACK ERROR] Failed to send acknowledgment reply for %s: %s\033[0m\n", dropNumber, msg)
		}
	}()
}

// Find first empty row starting from row 17
func findFirstEmptyRow(srv *sheets.Service, tabName string, ctx context.Context) (int, error) {
	// Start checking from row 17
	startRow := 17

	// Read rows 17-100 to find first empty one
	readRange := fmt.Sprintf("%s!A%d:A%d", tabName, startRow, startRow + 83) // Check rows 17-100
	resp, err := srv.Spreadsheets.Values.Get(GOOGLE_SHEETS_ID, readRange).Context(ctx).Do()
	if err != nil {
		return startRow, fmt.Errorf("failed to read rows to find empty spot: %v", err)
	}

	// If no data found, start at row 17
	if len(resp.Values) == 0 {
		return startRow, nil
	}

	// Find first row where Column A is empty
	for i, row := range resp.Values {
		if len(row) == 0 || row[0] == nil || row[0] == "" {
			return startRow + i, nil
		}
	}

	// If we reach here, all returned rows have data
	// The next empty row is startRow + len(resp.Values)
	nextEmptyRow := startRow + len(resp.Values)
	
	// Make sure we don't exceed reasonable bounds
	if nextEmptyRow > 200 {
		fmt.Printf("⚠️  Warning: Next empty row is %d, which seems very high. Using row 101 instead.\n", nextEmptyRow)
		return 101, nil
	}
	
	fmt.Printf("📍 Next empty row determined: %d (after %d filled rows)\n", nextEmptyRow, len(resp.Values))
	return nextEmptyRow, nil
}

// Write drop number to Google Sheets
func writeToGoogleSheets(dropNumber, projectName, userName string, reviewDate time.Time) error {
	// Check if we have a sheets tab configured for this project
	tabName, exists := PROJECT_SHEETS_TABS[projectName]
	if !exists {
		return fmt.Errorf("no Google Sheets tab configured for project: %s", projectName)
	}

	// Check if credentials file exists
	if _, err := os.Stat(GOOGLE_CREDENTIALS_PATH); os.IsNotExist(err) {
		return fmt.Errorf("Google Sheets credentials not found at %s", GOOGLE_CREDENTIALS_PATH)
	}

	// Read service account credentials
	creds, err := os.ReadFile(GOOGLE_CREDENTIALS_PATH)
	if err != nil {
		return fmt.Errorf("failed to read credentials file: %v", err)
	}

	// Create Google Sheets service with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	config, err := google.CredentialsFromJSON(ctx, creds, sheets.SpreadsheetsScope)
	if err != nil {
		// Check for the specific JSON unmarshaling error
		if strings.Contains(err.Error(), "cannot unmarshal string into Go value") {
			fmt.Println("⚠️  Initial credential parsing failed. Retrying with un-escaping...")
			var credsStr string
			if json.Unmarshal(creds, &credsStr) == nil {
				// The file content was a JSON string, so we use the un-escaped version
				config, err = google.CredentialsFromJSON(ctx, []byte(credsStr), sheets.SpreadsheetsScope)
			}
		}
		// If it's still an error after the retry, fail for real
		if err != nil {
			return fmt.Errorf("failed to parse credentials: %v", err)
		}
	}

	srv, err := sheets.NewService(ctx, option.WithCredentials(config))
	if err != nil {
		return fmt.Errorf("failed to create sheets service: %v", err)
	}

	// Prepare row data (matching the format from the monitoring services)
	today := reviewDate.Format("2006/01/02")

	// Find first empty row starting from row 17
	targetRow, err := findFirstEmptyRow(srv, tabName, ctx)
	if err != nil {
		return fmt.Errorf("failed to find empty row in %s: %v", tabName, err)
	}

	// Different row data formats for different tabs
	var rowData []interface{}
	var sheetRange string

	// All tabs now use identical 24-column structure (A-X) with 14-step checkboxes
	switch tabName {
	case "Velo Test", "Mohadin WA_Tool Monitor", "Lawley WA_Tool Monitor":
		// All tabs: 24 columns (A-X) with identical 14-step checkbox structure
		rowData = []interface{}{
			today,        // A: Date
			dropNumber,   // B: Drop Number
			"FALSE", "FALSE", "FALSE", "FALSE", "FALSE", "FALSE", "FALSE", // C-I: Steps 1-7 (checkboxes)
			"FALSE", "FALSE", "FALSE", "FALSE", "FALSE", "FALSE", "FALSE", // J-P: Steps 8-14 (checkboxes)
			0,            // Q: Completed Photos
			14,           // R: Outstanding Photos
			userName,     // S: Contractor Name
			"Processing", // T: Status
			"",           // U: QA Notes
			"",           // V: Comments
			"FALSE",      // W: Resubmitted
			"",           // X: Additional Notes
		}
		sheetRange = fmt.Sprintf("%s!A%d:X%d", tabName, targetRow, targetRow)

	default:
		return fmt.Errorf("unknown tab format for: %s", tabName)
	}

	// Write to specific row instead of appending
	vr := &sheets.ValueRange{
		Values: [][]interface{}{rowData},
	}
	fmt.Printf("📝 Writing to Google Sheets - DR: %s, Tab: %s, Row: %d\n", dropNumber, tabName, targetRow)

	_, err = srv.Spreadsheets.Values.Update(GOOGLE_SHEETS_ID, sheetRange, vr).
		ValueInputOption("USER_ENTERED").
		Context(ctx).
		Do()

	if err != nil {
		return fmt.Errorf("failed to write to Google Sheets (tab: %s, row: %d): %v", tabName, targetRow, err)
	}

	// Apply checkbox data validation to the checkbox columns (C-P and W)
	err = applyCheckboxValidation(srv, tabName, targetRow, ctx)
	if err != nil {
		fmt.Printf("⚠️  Failed to apply checkbox validation (data still written): %v\n", err)
		// Don't return error - data is written, validation is optional
	}

	// Only print success message if everything worked
	fmt.Printf("✅ Added %s to '%s' Google Sheets tab with checkboxes\n", dropNumber, tabName)
	return nil
}



// Copy checkbox formatting from existing rows to ensure proper checkbox display
func applyCheckboxValidation(srv *sheets.Service, tabName string, targetRow int, ctx context.Context) error {
	fmt.Printf("📝 Copying checkbox format to row %d from template row...\n", targetRow)
	
	// Copy checkbox data validation from row 17 (which has working checkboxes)
	// to the new row to ensure proper checkbox display
	
	// Source: Row 17 columns C-P (checkbox columns)
	sourceRange := &sheets.GridRange{
		SheetId:          1654167750, // Velo Test sheet ID
		StartRowIndex:    16, // Row 17 (0-based)
		EndRowIndex:      17, // Row 17 (exclusive end)
		StartColumnIndex: 2,  // Column C (0-based)
		EndColumnIndex:   16, // Column P (exclusive end)
	}
	
	// Destination: New row columns C-P
	destinationRange := &sheets.GridRange{
		SheetId:          1654167750,
		StartRowIndex:    int64(targetRow - 1), // Convert to 0-based
		EndRowIndex:      int64(targetRow),     // Exclusive end
		StartColumnIndex: 2,                    // Column C
		EndColumnIndex:   16,                   // Column P
	}
	
	// Source: Row 17 column W (Resubmitted checkbox)
	sourceRangeW := &sheets.GridRange{
		SheetId:          1654167750,
		StartRowIndex:    16, // Row 17
		EndRowIndex:      17,
		StartColumnIndex: 22, // Column W (0-based)
		EndColumnIndex:   23,
	}
	
	// Destination: New row column W
	destinationRangeW := &sheets.GridRange{
		SheetId:          1654167750,
		StartRowIndex:    int64(targetRow - 1), // Convert to 0-based
		EndRowIndex:      int64(targetRow),
		StartColumnIndex: 22, // Column W
		EndColumnIndex:   23,
	}
	
	// Create batch request to copy formatting for both ranges
	batchRequest := &sheets.BatchUpdateSpreadsheetRequest{
		Requests: []*sheets.Request{
			{
				CopyPaste: &sheets.CopyPasteRequest{
					Source:      sourceRange,
					Destination: destinationRange,
					PasteType:   "PASTE_DATA_VALIDATION", // Only copy validation rules
				},
			},
			{
				CopyPaste: &sheets.CopyPasteRequest{
					Source:      sourceRangeW,
					Destination: destinationRangeW,
					PasteType:   "PASTE_DATA_VALIDATION",
				},
			},
		},
	}
	
	_, err := srv.Spreadsheets.BatchUpdate(GOOGLE_SHEETS_ID, batchRequest).Context(ctx).Do()
	if err != nil {
		return fmt.Errorf("failed to copy checkbox formatting: %v", err)
	}
	
	fmt.Printf("✅ Successfully copied checkbox formatting to row %d\n", targetRow)
	return nil
}

// Handle receipt events for message status updates
func handleReceiptEvent(client *whatsmeow.Client, messageStore *MessageStore, receipt *events.Receipt, logger waLog.Logger) {
	// Receipt events indicate message delivery/read status changes
	// We can use these to detect when messages are processed
	fmt.Printf("📬 Receipt event: Chat=%s, MessageIDs=%v, Timestamp=%v\n", 
		receipt.Chat.String(), receipt.MessageIDs, receipt.Timestamp)
	
	// For resubmissions, we're mainly interested in messages that contain drop numbers
	// The Receipt event alone doesn't give us message content, but we can cross-reference
	// with stored messages to check if any recent messages had 'done' keywords
	
	// checkRecentCompletions removed - Google Sheets no longer used (2026-02-10)
}

// Check recent messages for completion patterns and update sheets accordingly
func checkRecentCompletions(client *whatsmeow.Client, messageStore *MessageStore, chatJID string, timestamp time.Time, logger waLog.Logger) {
	// Only process Velo Test group
	veloTestJID := "120363421664266245@g.us"
	if chatJID != veloTestJID {
		return
	}
	
	// Get recent messages from this chat (last 10 messages in past hour)
	since := timestamp.Add(-1 * time.Hour)
	rows, err := messageStore.db.Query(`
		SELECT content, sender, timestamp FROM messages 
		WHERE chat_jid = ? AND timestamp > ? 
		ORDER BY timestamp DESC LIMIT 10
	`, chatJID, since)
	
	if err != nil {
		logger.Warnf("Failed to query recent messages: %v", err)
		return
	}
	defer rows.Close()
	
	// Look for completion patterns in recent messages
	for rows.Next() {
		var content, sender string
		var msgTime time.Time
		
		if err := rows.Scan(&content, &sender, &msgTime); err != nil {
			continue
		}
		
		// Check if this message indicates completion/resubmission
		if isCompletionMessage(content) {
			fmt.Printf("🔔 Found completion message: '%s' from %s\n", content, sender)
			processCompletionMessage(content, chatJID, sender, msgTime, logger)
		}
	}
}

// Check if a message indicates completion or resubmission
func isCompletionMessage(content string) bool {
	content = strings.ToLower(strings.TrimSpace(content))
	
	// Look for completion indicators combined with drop numbers
	hasDropNumber := dropPattern.MatchString(strings.ToUpper(content))
	if !hasDropNumber {
		return false
	}
	
	// Check for completion keywords
	completionWords := []string{"done", "complete", "finished", "ready", "submitted", "resubmitted"}
	for _, word := range completionWords {
		if strings.Contains(content, word) {
			return true
		}
	}
	
	return false
}

// Process completion message and update Google Sheets
func processCompletionMessage(content, chatJID, sender string, timestamp time.Time, logger waLog.Logger) {
	// Extract drop numbers from the completion message
	dropNumbers := dropPattern.FindAllString(strings.ToUpper(content), -1)
	if len(dropNumbers) == 0 {
		return
	}
	
	projectName := getProjectNameByJID(chatJID)
	if projectName == "" {
		return
	}
	
	// For each drop number, update Google Sheets to show resubmission
	for _, dropNumber := range dropNumbers {
		dropNumber = strings.ToUpper(dropNumber)
		fmt.Printf("🔄 Processing completion for %s from %s\n", dropNumber, sender)
		
		// Google Sheets resubmission update removed - no longer needed (2026-02-10)
	}
}

// Update Google Sheets to show resubmission status
func updateSheetsForResubmission(dropNumber, projectName string, logger waLog.Logger) error {
	// Check if we have a sheets tab configured for this project
	tabName, exists := PROJECT_SHEETS_TABS[projectName]
	if !exists {
		return fmt.Errorf("no Google Sheets tab configured for project: %s", projectName)
	}
	
	// Check if credentials file exists
	if _, err := os.Stat(GOOGLE_CREDENTIALS_PATH); os.IsNotExist(err) {
		return fmt.Errorf("Google Sheets credentials not found at %s", GOOGLE_CREDENTIALS_PATH)
	}
	
	// Read service account credentials
	creds, err := os.ReadFile(GOOGLE_CREDENTIALS_PATH)
	if err != nil {
		return fmt.Errorf("failed to read credentials file: %v", err)
	}
	
	// Create Google Sheets service with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	
	config, err := google.CredentialsFromJSON(ctx, creds, sheets.SpreadsheetsScope)
	if err != nil {
		return fmt.Errorf("failed to parse credentials: %v", err)
	}
	
	srv, err := sheets.NewService(ctx, option.WithCredentials(config))
	if err != nil {
		return fmt.Errorf("failed to create sheets service: %v", err)
	}
	
	// Get all data to find the drop number row
	result, err := srv.Spreadsheets.Values.Get(
		GOOGLE_SHEETS_ID, fmt.Sprintf("%s!A:X", tabName)).Context(ctx).Do()
	if err != nil {
		return fmt.Errorf("failed to read sheet data: %v", err)
	}
	
	values := result.Values
	targetRow := -1
	
	// Find the row with this drop number (Column B)
	for rowIndex, row := range values {
		if len(row) > 1 && row[1] != nil {
			if strings.TrimSpace(fmt.Sprintf("%v", row[1])) == dropNumber {
				targetRow = rowIndex + 1 // Convert to 1-based
				break
			}
		}
	}
	
	if targetRow == -1 {
		return fmt.Errorf("drop number %s not found in Google Sheets", dropNumber)
	}
	
	// Update Column W (Resubmitted) to TRUE
	resubmittedRange := fmt.Sprintf("%s!W%d", tabName, targetRow)
	vr := &sheets.ValueRange{
		Values: [][]interface{}{{"TRUE"}},
	}
	
	_, err = srv.Spreadsheets.Values.Update(GOOGLE_SHEETS_ID, resubmittedRange, vr).
		ValueInputOption("USER_ENTERED").
		Context(ctx).
		Do()
	
	if err != nil {
		return fmt.Errorf("failed to update resubmission status: %v", err)
	}
	
	fmt.Printf("📊 ✅ Updated Google Sheets: %s Column W=TRUE (Resubmitted)\n", dropNumber)
	return nil
}

// Process drop numbers from message content (enhanced version)

// saveWAPhotoToNeon saves photo metadata to the wa_photos table in Neon
func saveWAPhotoToNeon(dropNumber, project, groupJID, senderJID, senderName, messageID, filename, localPath, mimeType string, fileSize int64, photoIndex int) error {
	db, err := sql.Open("postgres", NEON_DB_URL)
	if err != nil {
		return fmt.Errorf("failed to connect to Neon: %v", err)
	}
	defer db.Close()

	_, err = db.Exec(`
		INSERT INTO wa_photos (
			wa_message_id, wa_group_jid, sender_jid, sender_name, message_timestamp,
			drop_number, project, original_filename, mime_type, file_size_bytes,
			local_path, purpose, photo_index
		) VALUES (
			$1, $2, $3, $4, NOW(),
			$5, $6, $7, $8, $9,
			$10, 'activation', $11
		)
	`, messageID, groupJID, senderJID, senderName,
		dropNumber, project, filename, mimeType, fileSize,
		localPath, photoIndex)

	if err != nil {
		return fmt.Errorf("failed to insert wa_photo: %v", err)
	}

	fmt.Printf("📸 Saved WA photo metadata: %s -> %s\n", filename, dropNumber)
	return nil
}

// downloadAndSaveWAPhoto downloads a WhatsApp image and saves it locally
func downloadAndSaveWAPhoto(client *whatsmeow.Client, msg *waProto.Message, dropNumber, project, groupJID, senderJID, senderName, messageID string, photoIndex int) error {
	imgMsg := msg.GetImageMessage()
	if imgMsg == nil {
		return fmt.Errorf("no image message found")
	}

	storeDir := fmt.Sprintf("/var/lib/docker/volumes/boss-vps_dr_photos/_data/%s", dropNumber)
	if err := os.MkdirAll(storeDir, 0755); err != nil {
		return fmt.Errorf("failed to create store directory: %v", err)
	}

	timestamp := time.Now().Format("20060102_150405")
	filename := fmt.Sprintf("wa_%s_%s_%d.jpg", dropNumber, timestamp, photoIndex)
	localPath := fmt.Sprintf("%s/%s", storeDir, filename)

	data, err := client.Download(context.Background(), imgMsg)
	if err != nil {
		return fmt.Errorf("failed to download image: %v", err)
	}

	err = os.WriteFile(localPath, data, 0644)
	if err != nil {
		return fmt.Errorf("failed to save image: %v", err)
	}

	fmt.Printf("📥 Downloaded WA photo: %s (%d bytes)\n", localPath, len(data))

	mimeType := imgMsg.GetMimetype()
	if mimeType == "" {
		mimeType = "image/jpeg"
	}

	err = saveWAPhotoToNeon(dropNumber, project, groupJID, senderJID, senderName, messageID, filename, localPath, mimeType, int64(len(data)), photoIndex)
	if err != nil {
		fmt.Printf("⚠️ Warning: Failed to save photo metadata to Neon: %v\n", err)
	}

	return nil
}

func processDropNumbers(client *whatsmeow.Client, content, chatJID, sender string, timestamp time.Time, messageID, senderJID string, logger waLog.Logger, msg *waProto.Message, groupType string, sendAck bool) {
	// Check if message is from a tracked project group
	projectName := getProjectNameByJID(chatJID)
	if projectName == "" {
		return // Not from a tracked project group
	}

	// Find all drop numbers in the message
	// Skip messages that look like our own ack messages (prevents infinite loop)
	if strings.Contains(content, "Received!") || strings.Contains(content, "QA review will follow") || strings.HasPrefix(content, "@") {
		fmt.Printf("⏭️  Skipping ack-like message: %s...\n", content[:min(50, len(content))])
		return
	}

	// Skip DR submission processing for maintenance groups
	// Maintenance groups only route through the maintenance API
	if groupType == "maintenance" {
		fmt.Printf("Skipping DR processing in maintenance group: %s\n", chatJID)
		return
	}

	dropNumbers := dropPattern.FindAllString(strings.ToUpper(content), -1)
	if len(dropNumbers) == 0 {
		return // No drop numbers found
	}

	// Check if this is a completion/resubmission message
	isCompletion := isCompletionMessage(content)
	if isCompletion {
		fmt.Printf("🎯 Completion message detected: '%s' from %s\n", content, sender)
		// Handle completion directly
		processCompletionMessage(content, chatJID, sender, timestamp, logger)
		return
	}

	// Process each drop number (regular new drop processing)
	for _, dropNumber := range dropNumbers {
		dropNumber = strings.ToUpper(dropNumber)

		// Create contractor name from sender
		userName := sender
		if len(sender) > 20 {
			userName = sender[:20]
		}

		// Create QA photo review record. Retry on transient connection-slot
		// exhaustion so a momentary Supabase saturation does not permanently drop
		// the ack. createQAPhotoReview is idempotent (SELECT-then-UPDATE-or-INSERT
		// keyed on drop_number), so re-running it is safe.
		var err error
		for attempt := 1; attempt <= 4; attempt++ {
			err = createQAPhotoReview(client, chatJID, dropNumber, projectName, userName, sender, messageID, senderJID, content, timestamp)
			if err == nil || !isRetryableDBError(err) {
				break
			}
			backoff := time.Duration(attempt) * 2 * time.Second // 2s, 4s, 6s
			logger.Warnf("⏳ DB saturated creating QA review for %s (attempt %d/4): %v — retrying in %s", dropNumber, attempt, err, backoff)
			time.Sleep(backoff)
		}
		if err != nil {
			logger.Errorf("❌ FAILED to create QA review for %s after retries: %v", dropNumber, err)
			continue // Skip to next drop number if database write still failing
		}

		// Check for attached image and save it
		if msg != nil && msg.GetImageMessage() != nil {
			fmt.Printf("📷 DR %s has attached image - saving...\n", dropNumber)
			err := downloadAndSaveWAPhoto(client, msg, dropNumber, projectName, chatJID, senderJID, userName, messageID, 1)
			if err != nil {
				logger.Errorf("Failed to save WA photo for %s: %v", dropNumber, err)
			} else {
				fmt.Printf("✅ Saved WA serial photo for %s\n", dropNumber)
			}
		} else {
			fmt.Printf("📭 DR %s submitted without attached photo\n", dropNumber)
		}


		// Send immediate acknowledgment reply — gated on the group's send_ack flag
		// (migration 401), no longer hard-coded to group_type='dr_submission'. This lets
		// home recon groups (group_type='pre_provision') receive the enriched ACK while
		// still being excluded from installation counts. All groups continue to process
		// and store the DR so it feeds DR history / ONT lifecycle regardless of ACK.
		if sendAck {
			sendDRAcknowledgment(client, chatJID, dropNumber, projectName, messageID, senderJID)
		} else {
			fmt.Printf("Skipping ACK for %s (send_ack=false, group_type=%s, %s)\n", dropNumber, groupType, chatJID)
		}

		// Google Sheets write removed - no longer needed (2026-02-10)

		logger.Infof("✅ Processed drop number: %s from %s (project: %s)", dropNumber, sender, projectName)
	}
}

// Handle history sync events
func handleHistorySync(client *whatsmeow.Client, messageStore *MessageStore, historySync *events.HistorySync, logger waLog.Logger) {
	fmt.Printf("Received history sync event with %d conversations\n", len(historySync.Data.Conversations))

	syncedCount := 0
	for _, conversation := range historySync.Data.Conversations {
		// Parse JID from the conversation
		if conversation.ID == nil {
			continue
		}

		chatJID := *conversation.ID

		// Try to parse the JID
		jid, err := types.ParseJID(chatJID)
		if err != nil {
			logger.Warnf("Failed to parse JID %s: %v", chatJID, err)
			continue
		}

		// Get appropriate chat name by passing the history sync conversation directly
		name := GetChatName(client, messageStore, jid, chatJID, conversation, "", logger)

		// Process messages
		messages := conversation.Messages
		if len(messages) > 0 {
			// Update chat with latest message timestamp
			latestMsg := messages[0]
			if latestMsg == nil || latestMsg.Message == nil {
				continue
			}

			// Get timestamp from message info
			timestamp := time.Time{}
			if ts := latestMsg.Message.GetMessageTimestamp(); ts != 0 {
				timestamp = time.Unix(int64(ts), 0)
			} else {
				continue
			}

			messageStore.StoreChat(chatJID, name, timestamp)

			// Store messages
			for _, msg := range messages {
				if msg == nil || msg.Message == nil {
					continue
				}

				// Extract text content using the SAME helper as the live path
				// (extractTextContent, used at the events.Message call site).
				//
				// This used to inline a Conversation/ExtendedTextMessage check only,
				// which never looked at GetImageMessage().GetCaption(). DR numbers
				// arrive as image captions, so every photo submission came out of
				// history sync with content == "" — and the DR-processing gate below
				// requires content != "". Net effect: reconnects silently recovered
				// nothing for the actual DR workflow, and (via INSERT OR REPLACE in
				// StoreMessage) wiped captions off rows that had been captured live.
				// That is how the 2026-07-30 outage lost 30 submissions; the captions
				// were in the history-sync payload the whole time, unread.
				var content string
				if msg.Message.Message != nil {
					content = extractTextContent(msg.Message.Message)
				}

				// Extract media info
				var mediaType, filename, url string
				var mediaKey, fileSHA256, fileEncSHA256 []byte
				var fileLength uint64

				if msg.Message.Message != nil {
					mediaType, filename, url, mediaKey, fileSHA256, fileEncSHA256, fileLength = extractMediaInfo(msg.Message.Message)
				}

				// Log the message content for debugging
				logger.Infof("Message content: %v, Media Type: %v", content, mediaType)

				// Skip messages with no content and no media
				if content == "" && mediaType == "" {
					continue
				}

				// Determine sender
				var sender string
				isFromMe := false
				if msg.Message.Key != nil {
					if msg.Message.Key.FromMe != nil {
						isFromMe = *msg.Message.Key.FromMe
					}
					if !isFromMe && msg.Message.Key.Participant != nil && *msg.Message.Key.Participant != "" {
						sender = *msg.Message.Key.Participant
					} else if isFromMe {
						sender = client.Store.ID.User
					} else {
						sender = jid.User
					}
				} else {
					sender = jid.User
				}

				// Store message
				msgID := ""
				if msg.Message.Key != nil && msg.Message.Key.ID != nil {
					msgID = *msg.Message.Key.ID
				}

				// Get message timestamp
				timestamp := time.Time{}
				if ts := msg.Message.GetMessageTimestamp(); ts != 0 {
					timestamp = time.Unix(int64(ts), 0)
				} else {
					continue
				}

				err = messageStore.StoreMessage(
					msgID,
					chatJID,
					sender,
					content,
					timestamp,
					isFromMe,
					mediaType,
					filename,
					url,
					mediaKey,
					fileSHA256,
					fileEncSHA256,
					fileLength,
				)
				if err != nil {
					logger.Warnf("Failed to store history message: %v", err)
				} else {
					syncedCount++
					// Log successful message storage
					if mediaType != "" {
						logger.Infof("Stored message: [%s] %s -> %s: [%s: %s] %s",
							timestamp.Format("2006-01-02 15:04:05"), sender, chatJID, mediaType, filename, content)
					} else {
						logger.Infof("Stored message: [%s] %s -> %s: %s",
							timestamp.Format("2006-01-02 15:04:05"), sender, chatJID, content)
					}

					// RECONNECT FIX: Process drop numbers from history sync messages
					// This catches DRs that were missed during disconnect windows
					// Only process messages from the last 24 hours to avoid re-processing old history
					if content != "" && !isFromMe && time.Since(timestamp) < 24*time.Hour {
						group := getGroupByJID(chatJID)
						if group != nil {
							fmt.Printf("🔄 [HistorySync] Processing DR from offline message: '%s' in %s (age: %s)\n", content, chatJID, time.Since(timestamp).Round(time.Second))
							logger.Infof("🔄 [HistorySync] Processing DR from offline message: '%s' in %s", content, chatJID)
							processDropNumbers(client, content, chatJID, sender, timestamp, msgID, sender, logger, msg.Message.Message, group.GroupType, group.SendAck)
						}
					}
				}
			}
		}
	}

	fmt.Printf("History sync complete. Stored %d messages, processed for DRs.\n", syncedCount)
}

// Request history sync from the server
func requestHistorySync(client *whatsmeow.Client) {
	if client == nil {
		fmt.Println("Client is not initialized. Cannot request history sync.")
		return
	}

	if !client.IsConnected() {
		fmt.Println("Client is not connected. Please ensure you are connected to WhatsApp first.")
		return
	}

	if client.Store.ID == nil {
		fmt.Println("Client is not logged in. Please scan the QR code first.")
		return
	}

	// Build and send a history sync request
	historyMsg := client.BuildHistorySyncRequest(nil, 100)
	if historyMsg == nil {
		fmt.Println("Failed to build history sync request.")
		return
	}

	_, err := client.SendMessage(context.Background(), types.JID{
		Server: "s.whatsapp.net",
		User:   "status",
	}, historyMsg)

	if err != nil {
		fmt.Printf("Failed to request history sync: %v\n", err)
	} else {
		fmt.Println("History sync requested. Waiting for server response...")
	}
}

// analyzeOggOpus tries to extract duration and generate a simple waveform from an Ogg Opus file
func analyzeOggOpus(data []byte) (duration uint32, waveform []byte, err error) {
	// Try to detect if this is a valid Ogg file by checking for the "OggS" signature
	// at the beginning of the file
	if len(data) < 4 || string(data[0:4]) != "OggS" {
		return 0, nil, fmt.Errorf("not a valid Ogg file (missing OggS signature)")
	}

	// Parse Ogg pages to find the last page with a valid granule position
	var lastGranule uint64
	var sampleRate uint32 = 48000 // Default Opus sample rate
	var preSkip uint16 = 0
	var foundOpusHead bool

	// Scan through the file looking for Ogg pages
	for i := 0; i < len(data); {
		// Check if we have enough data to read Ogg page header
		if i+27 >= len(data) {
			break
		}

		// Verify Ogg page signature
		if string(data[i:i+4]) != "OggS" {
			// Skip until next potential page
			i++
			continue
		}

		// Extract header fields
		granulePos := binary.LittleEndian.Uint64(data[i+6 : i+14])
		pageSeqNum := binary.LittleEndian.Uint32(data[i+18 : i+22])
		numSegments := int(data[i+26])

		// Extract segment table
		if i+27+numSegments >= len(data) {
			break
		}
		segmentTable := data[i+27 : i+27+numSegments]

		// Calculate page size
		pageSize := 27 + numSegments
		for _, segLen := range segmentTable {
			pageSize += int(segLen)
		}

		// Check if we're looking at an OpusHead packet (should be in first few pages)
		if !foundOpusHead && pageSeqNum <= 1 {
			// Look for "OpusHead" marker in this page
			pageData := data[i : i+pageSize]
			headPos := bytes.Index(pageData, []byte("OpusHead"))
			if headPos >= 0 && headPos+12 < len(pageData) {
				// Found OpusHead, extract sample rate and pre-skip
				// OpusHead format: Magic(8) + Version(1) + Channels(1) + PreSkip(2) + SampleRate(4) + ...
				headPos += 8 // Skip "OpusHead" marker
				// PreSkip is 2 bytes at offset 10
				if headPos+12 <= len(pageData) {
					preSkip = binary.LittleEndian.Uint16(pageData[headPos+10 : headPos+12])
					sampleRate = binary.LittleEndian.Uint32(pageData[headPos+12 : headPos+16])
					foundOpusHead = true
					fmt.Printf("Found OpusHead: sampleRate=%d, preSkip=%d\n", sampleRate, preSkip)
				}
			}
		}

		// Keep track of last valid granule position
		if granulePos != 0 {
			lastGranule = granulePos
		}

		// Move to next page
		i += pageSize
	}

	if !foundOpusHead {
		fmt.Println("Warning: OpusHead not found, using default values")
	}

	// Calculate duration based on granule position
	if lastGranule > 0 {
		// Formula for duration: (lastGranule - preSkip) / sampleRate
		durationSeconds := float64(lastGranule-uint64(preSkip)) / float64(sampleRate)
		duration = uint32(math.Ceil(durationSeconds))
		fmt.Printf("Calculated Opus duration from granule: %f seconds (lastGranule=%d)\n",
			durationSeconds, lastGranule)
	} else {
		// Fallback to rough estimation if granule position not found
		fmt.Println("Warning: No valid granule position found, using estimation")
		durationEstimate := float64(len(data)) / 2000.0 // Very rough approximation
		duration = uint32(durationEstimate)
	}

	// Make sure we have a reasonable duration (at least 1 second, at most 300 seconds)
	if duration < 1 {
		duration = 1
	} else if duration > 300 {
		duration = 300
	}

	// Generate waveform
	waveform = placeholderWaveform(duration)

	fmt.Printf("Ogg Opus analysis: size=%d bytes, calculated duration=%d sec, waveform=%d bytes\n",
		len(data), duration, len(waveform))

	return duration, waveform, nil
}

// min returns the smaller of x or y
func min(x, y int) int {
	if x < y {
		return x
	}
	return y
}

// placeholderWaveform generates a synthetic waveform for WhatsApp voice messages
// that appears natural with some variability based on the duration
func placeholderWaveform(duration uint32) []byte {
	// WhatsApp expects a 64-byte waveform for voice messages
	const waveformLength = 64
	waveform := make([]byte, waveformLength)

	// Seed the random number generator for consistent results with the same duration
	rand.Seed(int64(duration))

	// Create a more natural looking waveform with some patterns and variability
	// rather than completely random values

	// Base amplitude and frequency - longer messages get faster frequency
	baseAmplitude := 35.0
	frequencyFactor := float64(min(int(duration), 120)) / 30.0

	for i := range waveform {
		// Position in the waveform (normalized 0-1)
		pos := float64(i) / float64(waveformLength)

		// Create a wave pattern with some randomness
		// Use multiple sine waves of different frequencies for more natural look
		val := baseAmplitude * math.Sin(pos*math.Pi*frequencyFactor*8)
		val += (baseAmplitude / 2) * math.Sin(pos*math.Pi*frequencyFactor*16)

		// Add some randomness to make it look more natural
		val += (rand.Float64() - 0.5) * 15

		// Add some fade-in and fade-out effects
		fadeInOut := math.Sin(pos * math.Pi)
		val = val * (0.7 + 0.3*fadeInOut)

		// Center around 50 (typical voice baseline)
		val = val + 50

		// Ensure values stay within WhatsApp's expected range (0-100)
		if val < 0 {
			val = 0
		} else if val > 100 {
			val = 100
		}

		waveform[i] = byte(val)
	}

	return waveform
}
