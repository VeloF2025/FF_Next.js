package main

// ack_local.go — Local DR acknowledgment generation (Layer 2)
// Generates ACK messages independently when FibreFlow API is unreachable.
// Queries Neon DB and BOSS API directly. Omits VLM serial verification.

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// --- Serial pattern detection (matches qaAutoFailService.ts) ---

var ontSerialPattern = regexp.MustCompile(`(?i)^ALC[LB][A-Z0-9]{7,10}$`)
var gizzuSerialPattern = regexp.MustCompile(`(?i)^GU18W[A-Z0-9]{10,16}$`)

func looksLikeOntSerialLocal(serial string) bool {
	return serial != "" && ontSerialPattern.MatchString(strings.TrimSpace(serial))
}

func looksLikeGizzuSerialLocal(serial string) bool {
	return serial != "" && gizzuSerialPattern.MatchString(strings.TrimSpace(serial))
}

type swapResult struct {
	swapped bool
	details string
}

func detectSwappedSerialsLocal(ontSerial, upsSerial string) swapResult {
	if ontSerial == "" && upsSerial == "" {
		return swapResult{false, "No serials to check"}
	}

	ontIsGizzu := looksLikeGizzuSerialLocal(ontSerial)
	upsIsOnt := looksLikeOntSerialLocal(upsSerial)

	if ontIsGizzu && upsIsOnt {
		return swapResult{true, fmt.Sprintf("Serials appear SWAPPED: ONT field has Gizzu serial (%s), UPS field has ONT serial (%s)", ontSerial, upsSerial)}
	}
	if ontIsGizzu {
		return swapResult{true, fmt.Sprintf("ONT field contains Gizzu serial (%s) - please swap in 1Map", ontSerial)}
	}
	if upsIsOnt {
		return swapResult{true, fmt.Sprintf("UPS field contains ONT serial (%s) - please swap in 1Map", upsSerial)}
	}
	return swapResult{false, "Serials appear correctly assigned"}
}

// --- ONT barcode extraction (matches dr-acknowledgment.ts extractOntSerial) ---

var ontBarcodePattern = regexp.MustCompile(`\(S\)([^(]+)`)

func extractOntSerialLocal(barcodeData string) string {
	if barcodeData == "" {
		return ""
	}
	match := ontBarcodePattern.FindStringSubmatch(barcodeData)
	if len(match) >= 2 {
		return strings.TrimSpace(match[1])
	}
	// If no (S) pattern, check if it's just a plain serial (no parentheses)
	if !strings.Contains(barcodeData, "(") {
		return strings.TrimSpace(barcodeData)
	}
	return ""
}

// --- DB query types ---

type existingSubmission struct {
	submissionCount int
	photoCount      int
	feedbackMessage sql.NullString
	qaDecision      sql.NullString
}

type duplicateHit struct {
	dropNumber string
	serialType string // "ont", "ups", "oes"
}

type dropsRecord struct {
	dropNumber  string
	poleNumber  sql.NullString
	projectName sql.NullString
	projectID   sql.NullString
}

// BOSS API response
type bossRecordResponse struct {
	DrNumber    string `json:"dr_number"`
	Site        string `json:"site"`
	SiteName    string `json:"site_name"`
	Status      string `json:"status"`
	PhotoCount  int    `json:"photo_count"`
	OntBarcode  string `json:"ont_barcode"`
	UpsSerial   string `json:"ups_serial"`
	LocalPhotos []struct {
		Filename string `json:"filename"`
		Type     string `json:"type"`
	} `json:"local_photos"`
}

// --- DB queries ---

func getNeonDB() (*sql.DB, error) {
	// Reuse the global neonDB connection from main.go
	if neonDB != nil {
		return neonDB, nil
	}
	db, err := sql.Open("postgres", NEON_DB_URL)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to Neon: %v", err)
	}
	neonDB = db
	return db, nil
}

func checkExistingSubmissionLocal(db *sql.DB, dropNumber string) (*existingSubmission, error) {
	var s existingSubmission
	err := db.QueryRow(
		`SELECT COALESCE(submission_count, 1), COALESCE(photo_count, 0), feedback_message, qa_decision
		 FROM dr_photo_unified_reviews WHERE drop_number = $1`, dropNumber,
	).Scan(&s.submissionCount, &s.photoCount, &s.feedbackMessage, &s.qaDecision)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func checkWAPhotosLocal(db *sql.DB, dropNumber string) (int, error) {
	var count int
	err := db.QueryRow(
		`SELECT COUNT(*) FROM wa_photos WHERE drop_number = $1 AND purpose = 'activation'`,
		dropNumber,
	).Scan(&count)
	if err != nil {
		return 0, err
	}
	return count, nil
}

func checkDuplicateSerialsLocal(db *sql.DB, dropNumber, ontSerial, upsSerial string) ([]duplicateHit, []duplicateHit, error) {
	var ontDups, upsDups []duplicateHit

	if ontSerial != "" {
		rows, err := db.Query(
			`SELECT drop_number, 'ont' as type FROM dr_photo_unified_reviews
			 WHERE UPPER(ont_serial_scanned) = UPPER($1) AND drop_number != $2
			 UNION
			 SELECT drop_number, 'oes' as type FROM dr_photo_unified_reviews
			 WHERE UPPER(oes_serial) = UPPER($1) AND drop_number != $2
			 LIMIT 5`, ontSerial, dropNumber,
		)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var h duplicateHit
				if rows.Scan(&h.dropNumber, &h.serialType) == nil {
					ontDups = append(ontDups, h)
				}
			}
		}
	}

	if upsSerial != "" {
		rows, err := db.Query(
			`SELECT drop_number, 'ups' as type FROM dr_photo_unified_reviews
			 WHERE UPPER(ups_serial_scanned) = UPPER($1) AND drop_number != $2
			 LIMIT 5`, upsSerial, dropNumber,
		)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var h duplicateHit
				if rows.Scan(&h.dropNumber, &h.serialType) == nil {
					upsDups = append(upsDups, h)
				}
			}
		}
	}

	return ontDups, upsDups, nil
}

func checkDropsTableLocal(db *sql.DB, dropNumber string) (*dropsRecord, error) {
	var r dropsRecord
	err := db.QueryRow(
		`SELECT d.drop_number, d.pole_number, d.project_id, p.project_name
		 FROM drops d LEFT JOIN projects p ON d.project_id = p.id
		 WHERE d.drop_number = $1 LIMIT 1`, dropNumber,
	).Scan(&r.dropNumber, &r.poleNumber, &r.projectID, &r.projectName)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// --- BOSS API ---

const bossAPIHost = "http://100.96.203.105:8003"

func fetchBossRecord(dropNumber string) (*bossRecordResponse, error) {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(fmt.Sprintf("%s/api/record/%s", bossAPIHost, dropNumber))
	if err != nil {
		return nil, fmt.Errorf("BOSS API request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 404 || resp.StatusCode == 422 {
		return nil, nil // DR not found in 1Map
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("BOSS API returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var record bossRecordResponse
	if err := json.Unmarshal(body, &record); err != nil {
		return nil, err
	}

	// Use local_photos length if photo_count not set
	if record.PhotoCount == 0 && len(record.LocalPhotos) > 0 {
		record.PhotoCount = len(record.LocalPhotos)
	}

	return &record, nil
}

// --- DB updates ---

func updateOneMapStatusLocal(db *sql.DB, dropNumber, status string) {
	_, err := db.Exec(
		`INSERT INTO dr_photo_unified_reviews (drop_number, onemap_status, onemap_checked_at, created_at, updated_at)
		 VALUES ($1, $2, NOW(), NOW(), NOW())
		 ON CONFLICT (drop_number) DO UPDATE SET
		   onemap_status = $2, onemap_checked_at = NOW(), updated_at = NOW()`,
		dropNumber, status,
	)
	if err != nil {
		fmt.Printf("[LOCAL ACK] Failed to update onemap_status for %s: %v\n", dropNumber, err)
	}
}

func markForReworkLocal(db *sql.DB, dropNumber string, newPhotoCount int) {
	_, err := db.Exec(
		`UPDATE dr_photo_unified_reviews SET
		   submission_history = COALESCE(submission_history, '[]'::jsonb) || jsonb_build_object(
		     'submission_number', COALESCE(submission_count, 1),
		     'snapshot_at', NOW(),
		     'photo_count', photo_count,
		     'qa_decision', qa_decision,
		     'qa_decision_at', qa_decision_at,
		     'feedback_sent', feedback_sent,
		     'feedback_sent_at', feedback_sent_at,
		     'feedback_message', feedback_message,
		     'qa_phase', qa_phase,
		     'vlm_categorization_status', vlm_categorization_status
		   ),
		   submission_count = COALESCE(submission_count, 1) + 1,
		   qa_phase = NULL, qa_decision = NULL, qa_decision_at = NULL,
		   feedback_sent = false, feedback_sent_at = NULL,
		   vlm_categorization_status = 'pending',
		   photo_count = $2, updated_at = NOW()
		 WHERE drop_number = $1`, dropNumber, newPhotoCount,
	)
	if err != nil {
		fmt.Printf("[LOCAL ACK] Failed to mark %s for rework: %v\n", dropNumber, err)
	}
}

// --- Message generation (matches dr-acknowledgment.ts templates) ---

func buildSerialWarningLinesLocal(ontSerial, upsSerial string, ontDups, upsDups []duplicateHit) []string {
	var lines []string

	// --- ONT Serial ---
	if ontSerial != "" {
		// No VLM in local mode, always show "please double-check"
		lines = append(lines, fmt.Sprintf("🔌 ONT Serial: %s", ontSerial))
		lines = append(lines, "   📷 Please double-check ONT serial")
	} else {
		lines = append(lines, "🔴 *ONT Serial: NOT SCANNED*")
		lines = append(lines, "   ⚠️ *Please scan ONT barcode in 1Map!*")
	}

	// ONT duplicate warning
	if len(ontDups) > 0 {
		drList := make([]string, len(ontDups))
		for i, d := range ontDups {
			drList[i] = d.dropNumber
		}
		lines = append(lines, fmt.Sprintf("🔴 *ONT Serial %s already used on %s!*", ontSerial, strings.Join(drList, ", ")))
		lines = append(lines, "   ⚠️ *Please verify this is the correct serial*")
	}

	// --- UPS Serial ---
	if upsSerial != "" {
		lines = append(lines, fmt.Sprintf("🔋 UPS Serial: %s", upsSerial))
		lines = append(lines, "   📷 Please double-check UPS serial")
	} else {
		lines = append(lines, "🔴 *UPS Serial: NOT SCANNED*")
		lines = append(lines, "   ⚠️ *Please scan UPS barcode in 1Map!*")
	}

	// UPS duplicate warning
	if len(upsDups) > 0 {
		drList := make([]string, len(upsDups))
		for i, d := range upsDups {
			drList[i] = d.dropNumber
		}
		lines = append(lines, fmt.Sprintf("🔴 *UPS Serial %s already used on %s!*", upsSerial, strings.Join(drList, ", ")))
		lines = append(lines, "   ⚠️ *Please verify this is the correct serial*")
	}

	return lines
}

func generateLocalAckMessage(dropNumber string, photoCount int, ontSerial, upsSerial string, waPhotoCount int, ontDups, upsDups []duplicateHit) string {
	swap := detectSwappedSerialsLocal(ontSerial, upsSerial)
	var lines []string

	lines = append(lines, fmt.Sprintf("📸 *%s Received!*", dropNumber))
	lines = append(lines, "")

	// Swapped serials warning
	if swap.swapped {
		lines = append(lines, "🔴 *ALERT: SERIALS APPEAR SWAPPED*")
		lines = append(lines, "")
		if looksLikeGizzuSerialLocal(ontSerial) {
			lines = append(lines, fmt.Sprintf("❌ ONT field has Gizzu serial: %s", ontSerial))
		}
		if looksLikeOntSerialLocal(upsSerial) {
			lines = append(lines, fmt.Sprintf("❌ UPS field has ONT serial: %s", upsSerial))
		}
		lines = append(lines, "")
		lines = append(lines, "*Please correct in 1Map:*")
		lines = append(lines, "• ONT should be ALCL/ALCB serial")
		lines = append(lines, "• UPS should be GU18W serial (Gizzu)")
		lines = append(lines, "")
	}

	// Photo count
	if photoCount > 0 {
		lines = append(lines, fmt.Sprintf("✅ Photos: %d", photoCount))
	} else {
		lines = append(lines, "⚠️ Photos: None found - please upload to 1Map")
	}

	// WA serial photo
	if waPhotoCount > 0 {
		lines = append(lines, "📷 Serial photo: ✅ Received")
	} else {
		lines = append(lines, "")
		lines = append(lines, "⚠️ *No serial photo received*")
		lines = append(lines, "Please send ONT & UPS sticker photo with DR")
	}

	// Serial lines
	if swap.swapped {
		lines = append(lines, fmt.Sprintf("⚠️ ONT field: %s", nullOr(ontSerial, "Not scanned")))
		lines = append(lines, fmt.Sprintf("⚠️ UPS field: %s", nullOr(upsSerial, "Not scanned")))
	} else {
		lines = append(lines, buildSerialWarningLinesLocal(ontSerial, upsSerial, ontDups, upsDups)...)
	}

	lines = append(lines, "")

	// Footer
	if swap.swapped {
		lines = append(lines, "⚠️ Please correct the swapped serials before QA review.")
	} else {
		lines = append(lines, "Thank you! QA review will follow shortly.")
	}

	// Offline mode indicator
	lines = append(lines, "⚠️ _Offline mode - serial verification pending_")

	return strings.Join(lines, "\n")
}

func generateLocalResubmissionAck(dropNumber string, newPhotoCount, previousPhotoCount, submissionNumber int, ontSerial, upsSerial string, ontDups, upsDups []duplicateHit) string {
	swap := detectSwappedSerialsLocal(ontSerial, upsSerial)
	var lines []string

	lines = append(lines, fmt.Sprintf("🔄 *%s Resubmitted!*", dropNumber))
	lines = append(lines, "")
	lines = append(lines, fmt.Sprintf("This is submission #%d for this DR.", submissionNumber))
	lines = append(lines, "")

	// Swapped serials warning
	if swap.swapped {
		lines = append(lines, "🔴 *ALERT: SERIALS APPEAR SWAPPED*")
		lines = append(lines, "")
		if looksLikeGizzuSerialLocal(ontSerial) {
			lines = append(lines, fmt.Sprintf("❌ ONT field has Gizzu serial: %s", ontSerial))
		}
		if looksLikeOntSerialLocal(upsSerial) {
			lines = append(lines, fmt.Sprintf("❌ UPS field has ONT serial: %s", upsSerial))
		}
		lines = append(lines, "")
		lines = append(lines, "*Please correct in 1Map:*")
		lines = append(lines, "• ONT should be ALCL/ALCB serial")
		lines = append(lines, "• UPS should be GU18W serial (Gizzu)")
		lines = append(lines, "")
	}

	lines = append(lines, fmt.Sprintf("📸 Photos: %d (was %d)", newPhotoCount, previousPhotoCount))

	if swap.swapped {
		lines = append(lines, fmt.Sprintf("⚠️ ONT field: %s", nullOr(ontSerial, "Not scanned")))
		lines = append(lines, fmt.Sprintf("⚠️ UPS field: %s", nullOr(upsSerial, "Not scanned")))
	} else {
		lines = append(lines, buildSerialWarningLinesLocal(ontSerial, upsSerial, ontDups, upsDups)...)
	}
	lines = append(lines, "")

	lines = append(lines, "⚠️ Marked for QA re-review.")
	lines = append(lines, "Previous feedback will be considered.")
	lines = append(lines, "⚠️ _Offline mode - serial verification pending_")

	return strings.Join(lines, "\n")
}

func generateLocalNotOnOneMapAck(dropNumber string, dr *dropsRecord, waPhotoCount int) string {
	var lines []string

	lines = append(lines, fmt.Sprintf("⚠️ *%s Received - NOT ON 1MAP*", dropNumber))
	lines = append(lines, "")
	lines = append(lines, "It looks like the home sign-up for this DR has not been completed.")
	lines = append(lines, "Please check that first.")
	lines = append(lines, "")

	if dr.projectName.Valid && dr.projectName.String != "" {
		lines = append(lines, fmt.Sprintf("📍 Project: %s", dr.projectName.String))
	}
	if dr.poleNumber.Valid && dr.poleNumber.String != "" {
		lines = append(lines, fmt.Sprintf("📍 Pole: %s", dr.poleNumber.String))
	}
	lines = append(lines, "")

	if waPhotoCount > 0 {
		lines = append(lines, "📷 Serial photo: ✅ Received")
	} else {
		lines = append(lines, "📷 Serial photo: ❌ Not received")
	}
	lines = append(lines, "")

	lines = append(lines, "⚠️ This DR will be tracked and checked again once 1Map is updated.")

	return strings.Join(lines, "\n")
}

func generateLocalNotFoundAck(dropNumber string) string {
	return strings.Join([]string{
		fmt.Sprintf("❌ *%s - Not Found*", dropNumber),
		"",
		"This DR number was not found in the system.",
		"Please check for typos and resubmit with the correct DR number.",
		"",
		"💡 _Common issues:_",
		"• Missing \"R\" — e.g. D1234 instead of DR1234",
		"• Extra/missing digits",
		"• Wrong project group",
	}, "\n")
}

// --- Main orchestrator ---

// generateLocalAck generates a full ACK message using direct DB + BOSS API access.
// Called as fallback when all FibreFlow API URLs are unreachable.
func generateLocalAck(dropNumber, project string) (string, error) {
	db, err := getNeonDB()
	if err != nil {
		return "", fmt.Errorf("DB connection failed: %v", err)
	}

	// 1. Resubmission detection
	existing, err := checkExistingSubmissionLocal(db, dropNumber)
	if err != nil {
		fmt.Printf("[LOCAL ACK] Warning: existing submission check failed for %s: %v\n", dropNumber, err)
	}

	isResubmission := existing != nil && (existing.qaDecision.Valid || existing.feedbackMessage.Valid)

	// 2. BOSS API lookup (1Map data)
	bossRecord, bossErr := fetchBossRecord(dropNumber)
	if bossErr != nil {
		fmt.Printf("[LOCAL ACK] BOSS API failed for %s: %v (continuing without 1Map data)\n", dropNumber, bossErr)
	}

	found := bossRecord != nil
	var photoCount int
	var ontSerial, upsSerial string

	if found {
		photoCount = bossRecord.PhotoCount
		ontSerial = extractOntSerialLocal(bossRecord.OntBarcode)
		upsSerial = bossRecord.UpsSerial
	}

	// 3. WA photo check
	waPhotoCount, waErr := checkWAPhotosLocal(db, dropNumber)
	if waErr != nil {
		fmt.Printf("[LOCAL ACK] WA photo check failed for %s: %v\n", dropNumber, waErr)
	}

	// 4. Duplicate serial check
	ontDups, upsDups, _ := checkDuplicateSerialsLocal(db, dropNumber, ontSerial, upsSerial)

	// 5. Generate message based on scenario
	var message string

	if isResubmission && found {
		submissionNumber := existing.submissionCount + 1
		previousPhotoCount := existing.photoCount
		message = generateLocalResubmissionAck(dropNumber, photoCount, previousPhotoCount, submissionNumber, ontSerial, upsSerial, ontDups, upsDups)
		// DB updates
		markForReworkLocal(db, dropNumber, photoCount)
		updateOneMapStatusLocal(db, dropNumber, "found")
	} else if !found {
		// Check drops table as fallback
		dr, drErr := checkDropsTableLocal(db, dropNumber)
		if drErr != nil {
			fmt.Printf("[LOCAL ACK] Drops table check failed for %s: %v\n", dropNumber, drErr)
		}

		if dr != nil {
			// DR exists in drops but NOT in 1Map
			message = generateLocalNotOnOneMapAck(dropNumber, dr, waPhotoCount)
			updateOneMapStatusLocal(db, dropNumber, "not_found")
		} else {
			// Truly unknown DR
			message = generateLocalNotFoundAck(dropNumber)
		}
	} else {
		// Normal first submission found in 1Map
		message = generateLocalAckMessage(dropNumber, photoCount, ontSerial, upsSerial, waPhotoCount, ontDups, upsDups)
		updateOneMapStatusLocal(db, dropNumber, "found")
	}

	fmt.Printf("🔧 [LOCAL ACK] Generated local acknowledgment for %s (found=%v, resubmission=%v, photos=%d)\n",
		dropNumber, found, isResubmission, photoCount)

	return message, nil
}

// Helper
func nullOr(val, fallback string) string {
	if val == "" {
		return fallback
	}
	return val
}
