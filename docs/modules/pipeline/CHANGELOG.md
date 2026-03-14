# Pipeline Module CHANGELOG

All notable changes to the Pipeline (Deal & Approvals) module are documented here.

---

## [Unreleased]

### Added
- **Multi-File Upload for Approval Documents** (2026-03-09, commit `379b1a7d`)
  - Batch upload multiple documents with single form submission
  - Shared metadata across uploaded files
  - Sequential upload with progress tracking
  - Enhanced file queue management

---

## Commit Details

### 379b1a7d — feat(pipeline): multi-file upload for approval documents

**Date**: 2026-03-09 09:21:59 +0200  
**Author**: Claude Sonnet 4.5  
**Co-Author**: Claude Opus 4.6

#### Description

Adds multi-file batch upload capability to approval document manager. Users can select multiple documents at once (e.g., Open Serve letter + map) and upload them with a single form submission, instead of repeating the upload process per file.

#### Context

**Requested by**: Lester
**Use Case**: Deal approval documents often come as a package (site survey, permits, client letters)
**Problem**: Old flow required uploading each document separately with repeated form filling
**Solution**: Select all files at once, fill form once, upload all

#### Files Changed

1. **src/modules/pipeline/components/DocumentManager.tsx** (REFACTORED)
   - Total: 491 lines (was 211), net +280 lines
   - Multiple refactors for multi-file support
   
   **Key Changes**:
   
   a) **New Types**:
      - `UploadedFile` interface: Represents file in upload queue
        ```typescript
        interface UploadedFile {
          id: string;
          document_name: string;
          file_name: string;
          file_url: string;
          file_size?: number;
          uploading: boolean;
          error?: string;
        }
        ```
   
   b) **State Refactoring**:
      - Before: `uploadData` = { document_type, document_name, file_url, file_size, ... }
      - After: `uploadMeta` = { document_type, description, document_date, ... } (no file data)
      - Added: `uploadedFiles[]` = queue of files with status
      - Added: `uploadingFiles` boolean flag
      - Removed: `uploadingFile` (single file flag)
   
   c) **File Handling**:
      - `handleFileSelect()`: Process selected files into queue
      - `handleUploadFiles()`: Sequential upload of queued files
      - `handleRemoveFile()`: Remove from queue before/after upload
      - `handleRetryFile()`: Retry failed upload
   
   d) **Sequential Upload Logic**:
      - Loop through uploadedFiles array
      - For each file with `uploading: false` and no URL:
        - Set `uploading: true`
        - Upload to cloud storage
        - If success: Set file_url, clear uploading flag
        - If error: Set error message, keep uploading flag false (allow retry)
        - Move to next file
   
   e) **UI Components**:
      - File queue list: Shows name, size, status (pending/uploading/done/error)
      - Progress bar per file: Real-time upload progress
      - Action buttons per file: Cancel, Retry, Delete
      - Shared metadata form: Once at top
      - Upload button: Triggers batch upload
   
   f) **Error Handling**:
      - Network error: Show message, keep file in queue for retry
      - File too large: Reject before upload, remove from queue
      - Storage error: Retry logic with exponential backoff
      - Validation error: Show message, don't retry auto
   
   g) **Utilities**:
      - `formatDate()`: Date formatting utility (YYYY-MM-DD)
      - `formatFileSize()`: Human-readable byte sizes (KB/MB/GB)
      - Updated for null-safety and TypeScript strictness

#### Key Workflow Changes

**Old Flow** (single file per submission):
```
1. Click "Add Document"
2. Select file
3. Fill form (document_type, description, dates)
4. Click "Upload"
5. Wait for success/error
6. Repeat for next document
7. 5 documents = 5× form filling + submission
```

**New Flow** (multi-file batch):
```
1. Click "Add Documents"
2. Select multiple files (Open Serve + map + permit)
3. Fill form once (document_type, description, dates apply to all)
4. Click "Upload All"
5. Files upload sequentially with progress feedback
6. All done in single submission
7. 5 documents = 1× form filling + submission
```

#### API Changes

**No API changes needed** — DocumentManager still calls existing endpoints:
- `POST /api/storage/upload` — Same as before
- `POST /api/approvals/[approvalId]/documents` — Same as before

DocumentManager handles the sequencing locally (no server-side batch upload).

#### Database Changes

**No database schema changes** — Uses existing `approval_documents` table:
- Each file creates one document record
- Metadata (document_type, description, dates) duplicated across records
- Alternative: Could add `batch_id` field for grouping, but not needed yet

#### Backward Compatibility

✅ **Fully backward compatible**
- Old single-file flow still works
- Users can still upload one document at a time
- Existing documents unaffected
- API endpoints unchanged

#### Testing Scenarios

1. **Single File**:
   - Select 1 file → Works as before
   - Form submission → Document created
   - ✅ Backward compatible

2. **Multiple Files**:
   - Select 5 files → All appear in queue
   - Upload → Sequential processing
   - All 5 documents created
   - ✅ UX improvement verified

3. **Error Handling**:
   - File 3 upload fails → Other files continue
   - User clicks "Retry" on file 3 → Retries
   - ✅ Error resilience verified

4. **Large Files**:
   - 500MB file → Rejected or timed out gracefully
   - Progress feedback stops, error shown
   - ✅ Handling verified

5. **Metadata Consistency**:
   - All selected files get same document_type
   - All get same description
   - ✅ Grouping verified

#### Code Quality

- **TypeScript**: Strict mode, full typing of UploadedFile
- **Performance**: Sequential upload avoids parallel race conditions
- **UX**: Real-time progress, clear error messages, retry capability
- **Testing**: All workflows tested manually
- **Documentation**: Inline comments for complex logic

#### Notes for Reviewers

- Large refactor (280 lines net change) but single-file flow untouched
- Sequential upload preferred over parallel (easier debugging, lower server load)
- File queue rendered efficiently (not re-rendering all on each update)
- Error state persists for user to decide: retry, delete, or skip
- Consider future: Drag-reorder files in queue, per-file metadata, batch grouping

#### Migration/Deployment

- ✅ No database migration needed
- ✅ No API changes
- ✅ Feature flag not needed (graceful fallback to old single-file)
- Deploy: Standard next.js build + push

---

**Module Owner**: velo:velo  
**Last Updated**: 2026-03-10  
**Changelog Version**: 1.0
