#!/usr/bin/env python3
"""
Drop Number Resubmission Handler
Handles resubmissions of the same drop number by updating existing QA reviews
instead of trying to create duplicates.
"""

import psycopg2
import logging
import os
from datetime import datetime
from typing import Dict, List, Optional

# Google Sheets imports
try:
    from google.oauth2.service_account import Credentials
    from googleapiclient.discovery import build
    GOOGLE_AVAILABLE = True
except ImportError:
    GOOGLE_AVAILABLE = False
    logging.warning("Google Sheets libraries not available")

# Configuration
NEON_DB_URL = "postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require"

# Google Sheets configuration
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
GSHEET_ID = os.getenv("GSHEET_ID", "1TYxDLyCqDHr0Imb5j7X4uJhxccgJTO0KrDVAD0Ja0Dk")
GOOGLE_APPLICATION_CREDENTIALS = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
SHEET_NAME = "Velo Test"

# Project to sheet mapping
SHEET_MAPPING = {
    'Velo Test': 'Velo Test',
    'Mohadin': 'Mohadin',
    'Lawley': None  # Lawley doesn't write to sheets
}

def setup_logging():
    """Set up logging configuration."""
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s'
    )
    return logging.getLogger(__name__)

logger = setup_logging()

def get_sheets_service():
    """Get Google Sheets service connection."""
    if not GOOGLE_AVAILABLE or not GSHEET_ID or not GOOGLE_APPLICATION_CREDENTIALS:
        return None

    try:
        # Try as file path first
        try:
            credentials = Credentials.from_service_account_file(
                GOOGLE_APPLICATION_CREDENTIALS, scopes=SCOPES
            )
        except (FileNotFoundError, OSError):
            # If file doesn't exist, try as JSON string
            import json
            try:
                credentials_info = json.loads(GOOGLE_APPLICATION_CREDENTIALS)
                credentials = Credentials.from_service_account_info(
                    credentials_info, scopes=SCOPES
                )
            except json.JSONDecodeError as je:
                raise Exception(f"Invalid JSON in credentials: {je}")

        return build("sheets", "v4", credentials=credentials, cache_discovery=False)
    except Exception as e:
        logger.error(f"Failed to create Google Sheets service: {e}")
        return None

def update_sheet_for_resubmission(drop_number: str, project_name: str) -> bool:
    """Update Google Sheets to notify QA agent of resubmission."""
    # Only update sheets for projects that use them
    sheet_name = SHEET_MAPPING.get(project_name)
    if not sheet_name:
        logger.info(f"📄 {project_name} doesn't use Google Sheets - skipping sheet update")
        return True  # Not an error, just not applicable
    
    try:
        service = get_sheets_service()
        if not service:
            logger.warning("⚠️  Google Sheets service unavailable - skipping sheet update")
            return False
        
        # Get all data to find the drop number row
        result = service.spreadsheets().values().get(
            spreadsheetId=GSHEET_ID,
            range=f"{sheet_name}!A:X"
        ).execute()
        
        values = result.get('values', [])
        target_row = None
        
        # Find the row with this drop number (Column B)
        for row_index, row in enumerate(values):
            if len(row) > 1 and row[1].strip() == drop_number:
                target_row = row_index + 1  # Convert to 1-based
                break
        
        if not target_row:
            logger.warning(f"⚠️  Drop {drop_number} not found in Google Sheets")
            return False
        
        # Update the specific cells: V=FALSE (Incomplete), W=TRUE (Resubmitted), X=FALSE (Completed)
        updates = [
            {
                "range": f"{sheet_name}!V{target_row}",
                "values": [[False]]  # Column V (Incomplete) = FALSE
            },
            {
                "range": f"{sheet_name}!W{target_row}",
                "values": [[True]]   # Column W (Resubmitted) = TRUE ← QA NOTIFICATION
            },
            {
                "range": f"{sheet_name}!X{target_row}",
                "values": [[False]]  # Column X (Completed) = FALSE
            }
        ]

        # Apply the updates
        service.spreadsheets().values().batchUpdate(
            spreadsheetId=GSHEET_ID,
            body={
                "valueInputOption": "USER_ENTERED",
                "data": updates
            }
        ).execute()

        # Get sheet ID for checkbox formatting
        sheet_metadata = service.spreadsheets().get(spreadsheetId=GSHEET_ID).execute()
        sheet_id = None
        for sheet in sheet_metadata['sheets']:
            if sheet['properties']['title'] == sheet_name:
                sheet_id = sheet['properties']['sheetId']
                break

        # Apply checkbox formatting to columns V, W, X if sheet found
        if sheet_id is not None:
            checkbox_requests = [
                # Column V (Incomplete)
                {
                    "repeatCell": {
                        "range": {
                            "sheetId": sheet_id,
                            "startRowIndex": target_row - 1,
                            "endRowIndex": target_row,
                            "startColumnIndex": 21,  # Column V (0-based)
                            "endColumnIndex": 22
                        },
                        "cell": {
                            "dataValidation": {
                                "condition": {"type": "BOOLEAN"}
                            }
                        },
                        "fields": "dataValidation"
                    }
                },
                # Column W (Resubmitted)
                {
                    "repeatCell": {
                        "range": {
                            "sheetId": sheet_id,
                            "startRowIndex": target_row - 1,
                            "endRowIndex": target_row,
                            "startColumnIndex": 22,  # Column W (0-based)
                            "endColumnIndex": 23
                        },
                        "cell": {
                            "dataValidation": {
                                "condition": {"type": "BOOLEAN"}
                            }
                        },
                        "fields": "dataValidation"
                    }
                },
                # Column X (Completed)
                {
                    "repeatCell": {
                        "range": {
                            "sheetId": sheet_id,
                            "startRowIndex": target_row - 1,
                            "endRowIndex": target_row,
                            "startColumnIndex": 23,  # Column X (0-based)
                            "endColumnIndex": 24
                        },
                        "cell": {
                            "dataValidation": {
                                "condition": {"type": "BOOLEAN"}
                            }
                        },
                        "fields": "dataValidation"
                    }
                }
            ]

            service.spreadsheets().batchUpdate(
                spreadsheetId=GSHEET_ID,
                body={"requests": checkbox_requests}
            ).execute()

            logger.info(f"✅ Applied checkbox formatting to columns V, W, X row {target_row}")
        
        logger.info(f"📊 ✅ Updated Google Sheets for resubmission: {drop_number} → Column W=TRUE (QA notification)")
        return True
        
    except Exception as e:
        logger.error(f"📊 ❌ Failed to update Google Sheets for {drop_number}: {e}")
        return False

def handle_drop_resubmission(drop_number: str, contractor_name: str, project_name: str, message_content: str) -> bool:
    """
    Handle resubmission of an existing drop number.
    Updates QA review status and creates resubmission log.
    """
    try:
        conn = psycopg2.connect(NEON_DB_URL)
        cursor = conn.cursor()
        
        # Check if drop already exists in installations
        cursor.execute("SELECT id FROM qa_photo_reviews WHERE drop_number = %s", (drop_number,))
        installation_exists = cursor.fetchone()
        
        if not installation_exists:
            logger.info(f"✅ {drop_number} is new - normal processing will handle it")
            cursor.close()
            conn.close()
            return False  # Let normal process handle new drops
        
        logger.info(f"🔄 {drop_number} RESUBMISSION detected - handling existing drop")
        
        # Only reset the incomplete flag and feedback_sent so QA can continue
        cursor.execute("""
            UPDATE qa_photo_reviews 
            SET 
                incomplete = FALSE,
                feedback_sent = NULL,
                resubmitted = TRUE,
                comment = COALESCE(comment, '') || %s,
                updated_at = CURRENT_TIMESTAMP
            WHERE drop_number = %s
        """, (
            f"\n--- PHOTOS UPDATED {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} ---\n"
            f"Agent updated photos in 1MAP. QA can continue review.\n",
            drop_number
        ))
        
        rows_updated = cursor.rowcount
        
        if rows_updated == 0:
            # QA review doesn't exist - create new one for today
            logger.info(f"📋 Creating new QA review for resubmitted {drop_number}")
            create_fresh_qa_review(cursor, drop_number, contractor_name, project_name)
        else:
            logger.info(f"🔄 Logged resubmission for {drop_number} - QA can continue existing review")
        
        conn.commit()
        cursor.close()
        conn.close()
        
        # ✅ NEW: Update Google Sheets to notify QA agent
        logger.info(f"📊 Updating Google Sheets for resubmission notification...")
        sheet_updated = update_sheet_for_resubmission(drop_number, project_name)
        
        if sheet_updated:
            logger.info(f"🔔 QA agent notification sent via Google Sheets Column W=TRUE")
        else:
            logger.warning(f"⚠️  Google Sheets notification failed - QA agent may need manual notification")
        
        return True  # Handled as resubmission
        
    except Exception as e:
        logger.error(f"❌ Error handling resubmission for {drop_number}: {e}")
        return False

def create_fresh_qa_review(cursor, drop_number: str, contractor_name: str, project_name: str):
    """Create a fresh QA review for resubmitted drop."""
    
    # Extract user name from contractor
    user_name = contractor_name.replace('WhatsApp-', '')[:20] if contractor_name.startswith('WhatsApp-') else contractor_name[:20]
    
    insert_query = """
    INSERT INTO qa_photo_reviews (
        drop_number, 
        review_date,
        user_name,
        project,
        step_01_property_frontage, step_02_location_before_install,
        step_03_outside_cable_span, step_04_home_entry_outside,
        step_05_home_entry_inside, step_06_fibre_entry_to_ont,
        step_07_patched_labelled_drop, step_08_work_area_completion,
        step_09_ont_barcode_scan, step_10_ups_serial_number,
        step_11_powermeter_reading, step_12_powermeter_at_ont,
        step_13_active_broadband_light, step_14_customer_signature,
        outstanding_photos_loaded_to_1map,
        comment,
        incomplete,
        completed
    ) VALUES (
        %s, CURRENT_DATE, %s, %s,
        FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE,
        FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE,
        FALSE,
        %s,
        FALSE,
        FALSE
    )
    ON CONFLICT (drop_number, review_date) 
    DO UPDATE SET
        user_name = EXCLUDED.user_name,
        project = EXCLUDED.project,
        comment = qa_photo_reviews.comment || E'\n' || EXCLUDED.comment,
        incomplete = FALSE,
        completed = FALSE,
        resubmitted = TRUE,
        feedback_sent = NULL,
        updated_at = CURRENT_TIMESTAMP
    """
    
    comment = f"Resubmitted - Photos updated by {contractor_name} on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
    
    cursor.execute(insert_query, (
        drop_number,
        user_name,
        project_name,
        comment
    ))

def get_resubmitted_drops_needing_notification() -> List[Dict]:
    """Get drops that were resubmitted and QA agents need to be notified."""
    try:
        conn = psycopg2.connect(NEON_DB_URL)
        cursor = conn.cursor()
        
        # Get resubmitted drops where QA review was reset but not yet reviewed
        query = """
        SELECT 
            i.drop_number,
            i.project_name,
            qa.assigned_agent,
            i.updated_at as resubmitted_at
        FROM installations i
        JOIN qa_photo_reviews qa ON i.drop_number = qa.drop_number
        WHERE i.status = 'resubmitted'
        AND qa.completed = FALSE
        AND qa.incomplete = FALSE
        AND qa.updated_at >= CURRENT_DATE
        ORDER BY i.updated_at DESC
        """
        
        cursor.execute(query)
        results = cursor.fetchall()
        
        resubmissions = []
        for row in results:
            resubmissions.append({
                'drop_number': row[0],
                'project_name': row[1],
                'assigned_agent': row[2],
                'resubmitted_at': row[3]
            })
        
        cursor.close()
        conn.close()
        
        return resubmissions
        
    except Exception as e:
        logger.error(f"❌ Error getting resubmitted drops: {e}")
        return []

if __name__ == "__main__":
    # Test the resubmission handler
    print("🔄 Testing resubmission handler...")
    
    # Get current resubmitted drops needing notification
    resubmissions = get_resubmitted_drops_needing_notification()
    print(f"📋 Found {len(resubmissions)} resubmitted drops needing QA attention:")
    
    for drop in resubmissions:
        print(f"  - {drop['drop_number']} ({drop['project_name']}) - Resubmitted: {drop['resubmitted_at']}")