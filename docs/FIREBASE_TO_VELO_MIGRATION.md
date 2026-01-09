# Firebase to Velo Server Migration Plan

## Overview

Migrate file storage from Firebase Storage to the Velocity server to:
- Remove Firebase dependencies
- Reduce costs
- Keep all data on owned infrastructure
- Fix hydration errors caused by Firebase SDK

## Current State

### Files Using Firebase Storage:
1. `pages/api/staff-documents-upload.ts` - Staff document uploads
2. `pages/api/staff-documents/[documentId].ts` - Document retrieval
3. `src/app/api/ticketing/tickets/[id]/attachments/route.ts` - Ticket attachments
4. `src/app/api/ticketing/attachments/[id]/route.ts` - Attachment retrieval
5. `src/modules/ticketing/components/Verification/PhotoUpload.tsx` - Photo uploads

### Current Dependencies:
- `firebase` (client SDK)
- `firebase-admin` (server SDK)
- `@/config/firebase-admin` - Admin config

## Target State

### Velo Server File Structure:
```
/var/www/fibreflow/uploads/
├── staff-documents/{staffId}/{documentId}/
├── ticketing-attachments/{ticketId}/
└── profile-pictures/{userId}/
```

**IMPORTANT**: Confirm exact paths with Louis before implementation.

### New Environment Variables:
```env
# File Storage (Velo Server)
FILE_STORAGE_PATH=/var/www/fibreflow/uploads
FILE_STORAGE_URL=https://app.fibreflow.app/uploads
```

## Migration Steps

### Phase 1: Create File Storage Service
1. Create `/src/services/fileStorage.ts`:
   - `uploadFile(path, file)` - Upload to local filesystem
   - `getFileUrl(path)` - Generate public URL
   - `deleteFile(path)` - Remove file
   - `listFiles(directory)` - List files in directory

2. Create API endpoint `/api/files/upload`:
   - Handle multipart form data
   - Save to server filesystem
   - Return file URL

3. Create API endpoint `/api/files/[...path]`:
   - Serve files from uploads directory
   - Handle authentication if needed

### Phase 2: Update Existing APIs
1. Modify `staff-documents-upload.ts`:
   - Replace `getAdminStorage()` with local storage
   - Update file path generation

2. Modify ticketing attachment routes:
   - Use new file storage service
   - Update URLs in database

### Phase 3: Data Migration
1. Export existing files from Firebase Storage
2. Upload to Velo server via SCP/rsync
3. Update database URLs (staff_documents, ticket_attachments tables)

### Phase 4: Cleanup
1. Remove Firebase packages:
   ```bash
   npm uninstall firebase firebase-admin
   ```
2. Delete Firebase config files:
   - `src/config/firebase.ts`
   - `src/config/firebase-admin.ts`
3. Update `.env.local.example`
4. Remove Firebase type imports from `auth.types.ts`

## Server Configuration (Louis to Confirm)

### Nginx Configuration for /uploads:
```nginx
location /uploads {
    alias /var/www/fibreflow/uploads;
    autoindex off;
    expires 30d;
    add_header Cache-Control "public, immutable";
}
```

### Directory Permissions:
```bash
sudo mkdir -p /var/www/fibreflow/uploads/{staff-documents,ticketing-attachments,profile-pictures}
sudo chown -R www-data:www-data /var/www/fibreflow/uploads
sudo chmod -R 755 /var/www/fibreflow/uploads
```

## Benefits After Migration

| Before (Firebase) | After (Velo Server) |
|-------------------|---------------------|
| External dependency | Self-hosted |
| Monthly Firebase costs | No additional cost |
| Firebase SDK hydration issues | No SSR issues |
| External data location | Data on owned server |

## Timeline

1. **Phase 1**: 2-3 hours (create service + API)
2. **Phase 2**: 2-3 hours (update existing APIs)
3. **Phase 3**: 1-2 hours (data migration)
4. **Phase 4**: 30 mins (cleanup)

**Total**: ~1 day of work

## Notes

- Backup Firebase Storage before migration
- Test uploads in development first
- Update any client-side Firebase usage
- Consider CDN in future if needed for performance
