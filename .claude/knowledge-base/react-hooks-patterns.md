# React Hooks Patterns

## Optional Context Hook Pattern

**Problem**: Components that need to work both inside and outside a context provider.

**Anti-pattern** (causes rules-of-hooks violation):
```typescript
// WRONG - try-catch makes hook call conditional
let context = null;
try {
  context = useMyContext();
} catch {
  // Context not available
}
```

**Solution**: Create an optional variant of the hook:

```typescript
// In provider file
const MyContext = createContext<MyContextType | undefined>(undefined);

// Standard hook - throws if no provider
export function useMyContext() {
  const context = useContext(MyContext);
  if (context === undefined) {
    throw new Error('useMyContext must be used within MyProvider');
  }
  return context;
}

// Optional hook - returns null if no provider
export function useMyContextOptional() {
  return useContext(MyContext) ?? null;
}
```

**Usage in flexible component**:
```typescript
function MyComponent({ propValue }: Props) {
  const context = useMyContextOptional();

  // Fallback chain: props → context → default
  const value = propValue ?? context?.value ?? 'default';

  return <div>{value}</div>;
}
```

**Applied in**: `src/modules/procurement/context/ProcurementPortalProvider.tsx`

---

## Hook Naming Convention

Functions that call hooks MUST:
1. Start with `use` prefix
2. Be called at component top level

**Anti-pattern**:
```typescript
// WRONG - not a hook name, but calls hooks
function getResponsiveConfig() {
  const { isMobile } = useScreenSize();
  return isMobile ? mobile : desktop;
}
```

**Solution**:
```typescript
// CORRECT - proper hook name
function useResponsiveConfig() {
  const { isMobile } = useScreenSize();
  return isMobile ? mobile : desktop;
}
```

**Applied in**: `src/modules/procurement/utils/responsive.ts`

---

## Hooks in Render Helpers

**Anti-pattern**:
```typescript
// WRONG - hook inside non-component function
const renderDropzone = (side: 'front' | 'back') => {
  const { getRootProps } = useDropzone({ onDrop });
  return <div {...getRootProps()} />;
};

return (
  <>
    {renderDropzone('front')}
    {renderDropzone('back')}
  </>
);
```

**Solution**: Call hooks at top level, pass state to helpers:

```typescript
// CORRECT - hooks at top level
const frontDropzone = useDropzone({ onDrop: handleFront });
const backDropzone = useDropzone({ onDrop: handleBack });

const renderDropzone = (dropzone: DropzoneState) => {
  return <div {...dropzone.getRootProps()} />;
};

return (
  <>
    {renderDropzone(frontDropzone)}
    {renderDropzone(backDropzone)}
  </>
);
```

**Applied in**: `src/components/staff/DriversLicenseUpload.tsx`

---

## References

- React Rules of Hooks: https://react.dev/reference/rules/rules-of-hooks
- Commit: `754ea249`
