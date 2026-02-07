// WhatsApp Photo Capture for DR Submissions
// Add this code to /home/louis/whatsapp-bridge-go/main.go on Velocity server
//
// This enables capturing serial sticker photos sent alongside DR numbers
// Photos are saved locally and metadata stored in Neon wa_photos table

// =============================================================================
// STEP 1: Add new function to save WA photos (add after saveWAPhoto function area)
// =============================================================================

/*
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
	// Get image message
	imgMsg := msg.GetImageMessage()
	if imgMsg == nil {
		return fmt.Errorf("no image message found")
	}

	// Create storage directory
	storeDir := fmt.Sprintf("/home/louis/whatsapp-bridge-go/store/%s", strings.ReplaceAll(groupJID, ":", "_"))
	if err := os.MkdirAll(storeDir, 0755); err != nil {
		return fmt.Errorf("failed to create store directory: %v", err)
	}

	// Generate filename: DR{number}_{timestamp}_{index}.jpg
	timestamp := time.Now().Format("20060102_150405")
	filename := fmt.Sprintf("%s_%s_%d.jpg", dropNumber, timestamp, photoIndex)
	localPath := fmt.Sprintf("%s/%s", storeDir, filename)

	// Download the image using whatsmeow
	data, err := client.Download(imgMsg)
	if err != nil {
		return fmt.Errorf("failed to download image: %v", err)
	}

	// Save to file
	err = os.WriteFile(localPath, data, 0644)
	if err != nil {
		return fmt.Errorf("failed to save image: %v", err)
	}

	fmt.Printf("📥 Downloaded WA photo: %s (%d bytes)\n", localPath, len(data))

	// Save metadata to Neon database
	mimeType := imgMsg.GetMimetype()
	if mimeType == "" {
		mimeType = "image/jpeg"
	}

	err = saveWAPhotoToNeon(dropNumber, project, groupJID, senderJID, senderName, messageID, filename, localPath, mimeType, int64(len(data)), photoIndex)
	if err != nil {
		// Log but don't fail - photo is saved locally
		fmt.Printf("⚠️ Warning: Failed to save photo metadata to Neon: %v\n", err)
	}

	return nil
}
*/

// =============================================================================
// STEP 2: Modify handleMessage to pass media info to processDropNumbers
// =============================================================================

// FIND this section in handleMessage (around line 790-800):
/*
	// Process drop numbers if content exists
	// TEMPORARILY REMOVED IsFromMe restriction to fix processing issue
	if content != "" {
		fmt.Printf("🎯 Processing drop numbers from message: '%s' (IsFromMe: %v)\n", content, msg.Info.IsFromMe)
		processDropNumbers(client, content, chatJID, sender, msg.Info.Timestamp, msg.Info.ID, msg.Info.Sender.String(), logger)
	}
*/

// REPLACE WITH:
/*
	// Process drop numbers if content exists
	if content != "" {
		fmt.Printf("🎯 Processing drop numbers from message: '%s' (IsFromMe: %v)\n", content, msg.Info.IsFromMe)
		// Pass the full message to processDropNumbers so it can access media
		processDropNumbers(client, content, chatJID, sender, msg.Info.Timestamp, msg.Info.ID, msg.Info.Sender.String(), logger, msg.Message)
	}
*/

// =============================================================================
// STEP 3: Modify processDropNumbers to accept and handle media
// =============================================================================

// CHANGE the function signature from:
/*
func processDropNumbers(client *whatsmeow.Client, content, chatJID, sender string, timestamp time.Time, messageID, senderJID string, logger waLog.Logger) {
*/

// TO:
/*
func processDropNumbers(client *whatsmeow.Client, content, chatJID, sender string, timestamp time.Time, messageID, senderJID string, logger waLog.Logger, msg *waProto.Message) {
*/

// ADD this block INSIDE processDropNumbers, right after the createQAPhotoReview call (around line 2070):
/*
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
*/

// =============================================================================
// STEP 4: Update other calls to processDropNumbers (if any)
// =============================================================================

// Search for other places that call processDropNumbers and add the msg parameter
// Most likely in history sync handler - pass nil for msg since we don't process photos from history

// =============================================================================
// DEPLOYMENT INSTRUCTIONS
// =============================================================================

/*
1. SSH to Velocity server:
   sshpass -p "$VELO_SSH_PASSWORD" ssh velo@100.96.203.105

2. Backup current code:
   cp /home/louis/whatsapp-bridge-go/main.go /home/louis/whatsapp-bridge-go/main.go.backup.$(date +%Y%m%d_%H%M%S)

3. Edit main.go and apply the changes above:
   nano /home/louis/whatsapp-bridge-go/main.go

4. Rebuild the bridge:
   cd /home/louis/whatsapp-bridge-go
   go build -o whatsapp-bridge main.go

5. Restart the service:
   echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart whatsapp-bridge.service

6. Check logs:
   tail -f /home/louis/whatsapp-bridge-go/bridge.log

7. Test by sending a DR with photo in Velo Test group:
   Send: "DR1234567" with attached image showing ONT+UPS serials

8. Verify photo was saved:
   ls -la /home/louis/whatsapp-bridge-go/store/120363421664266245@g.us/

9. Verify database entry:
   psql $DATABASE_URL -c "SELECT * FROM wa_photos WHERE drop_number = 'DR1234567'"
*/
