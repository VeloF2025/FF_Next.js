# Toast Notifications Skill

## Overview
FibreFlow uses `react-hot-toast` with a centralized `NotificationService` for consistent user feedback across the application.

## Service Location
`src/services/core/NotificationService.ts`

## Usage

### Import
```typescript
import { notificationService } from '@/services/core/NotificationService';
```

### Basic Methods

```typescript
// Success - green checkmark
notificationService.success('Operation completed successfully');

// Error - red X, longer duration (6s)
notificationService.error('Failed to save changes');

// Warning - yellow triangle border
notificationService.warning('This action cannot be undone');

// Info - blue info border
notificationService.info('New updates available');

// Loading - spinner, stays until dismissed
const loadingId = notificationService.loading('Saving...');
notificationService.dismiss(loadingId); // Dismiss when done
```

### Promise-Based (Recommended for API calls)
```typescript
notificationService.promise(
  fetch('/api/data').then(res => res.json()),
  {
    loading: 'Saving...',
    success: 'Saved successfully',
    error: 'Failed to save',
  }
);
```

### Helper Methods
```typescript
// Common operation patterns
notificationService.operationSuccess('saved', 'Project');
// Output: "Project saved successfully"

notificationService.operationError('save', error, 'Project');
// Output: "Failed to save Project: [error message]"

notificationService.validationError('Email is required');
// Output: "Validation Error: Email is required"

notificationService.networkError();
// Output: "Network error. Please check your connection..."

notificationService.permissionError();
// Output: "You do not have permission to perform this action."
```

## Best Practices

### DO
- Use `success` for completed actions (create, update, delete)
- Use `error` for failed operations with actionable messages
- Use `warning` for important notices (anomalies, confirmations)
- Use `info` for passive notifications
- Use `promise` for async operations to show loading state

### DON'T
- Never use `alert()` - always use notificationService
- Never use `console.log` for user feedback
- Don't show technical error messages to users

## Message Guidelines

### Success Messages
- Keep brief: "Vehicle saved" not "The vehicle has been successfully saved to the database"
- Use past tense: "Saved" not "Saving complete"

### Error Messages
- Be specific but user-friendly
- Suggest action when possible: "Failed to save. Check your connection and try again."

### Warning Messages
- Be clear about the consequence: "3 fuel anomalies detected - review required"

## Configuration
Default settings in NotificationService:
- Position: `top-right`
- Duration: 4s (success/info), 6s (error)
- Style: White background, subtle border, shadow

## Examples from Codebase

### Fuel Analytics (anomaly detection)
```typescript
if (count === 0) {
  notificationService.success('No anomalies detected - all fuel transactions look normal');
} else {
  notificationService.warning(`${count} fuel anomalies detected - review required`);
}
```

### Vehicle Operations
```typescript
notificationService.success('Vehicle retired successfully');
notificationService.error('Failed to update vehicle');
```

### Status Updates
```typescript
notificationService.success(
  status === 'resolved' ? 'Anomaly marked as resolved' : 'Anomaly dismissed'
);
notificationService.info('Anomaly marked for investigation');
```
