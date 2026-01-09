# DGTS - Don't Game The System

**STATUS**: CRITICAL - CANNOT BE DISABLED
**LOAD WHEN**: Running validation, code review, test verification

---

## The Problem This Solves

Prevents fake implementations that claim completion without real functionality.

---

## Gaming Patterns (BLOCKED)

### Test Gaming
```typescript
// BLOCKED
expect(true).toBe(true);           // Meaningless
expect(1).toBe(1);                 // Tautological
it.skip('should work', () => {});  // Skipped tests

// CORRECT
expect(result.status).toBe(200);
expect(data.items.length).toBeGreaterThan(0);
```

### Code Gaming
```typescript
// BLOCKED
// validation_required           // Commented validation
if (false) { /* ... */ }         // Disabled code
catch { }                        // Empty catch
void _error;                     // Error silencing

// CORRECT
if (condition) { /* real logic */ }
catch (error: unknown) {
  log.error('Failed', error, 'component');
}
```

### Feature Faking
```typescript
// BLOCKED
return { fake: 'data' };         // Fake returns
return mockData;                 // Mock as real
async function process() { }     // Empty async

// CORRECT
const data = await db.query(...);
return apiResponse.success(res, data);
```

---

## FibreFlow Specific

### API Route Requirements
- Must connect to real database (Neon)
- Must use apiResponse helpers
- Must handle errors with logging
- Must validate input

### Component Requirements
- Must render real UI (not placeholders)
- Must connect to real data sources
- Must handle loading/error states

---

## Validation Commands

```bash
npm run lint          # Catches many gaming patterns
npm run type-check    # Ensures real types
npm run test          # Must have meaningful assertions
npm run build         # Full validation
```

---

**Gaming = BLOCKED. Implement real features or mark as TODO.**
