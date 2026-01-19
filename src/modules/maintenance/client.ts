// 🟢 WORKING: FibreFlow Ticketing Module - Client-Safe Exports
// Following FibreFlow Universal Module Structure
//
// This file exports ONLY client-safe code (no server-side dependencies).
// Use this in client components with 'use client' directive.

// ============================================================================
// CLIENT-SAFE TYPES
// ============================================================================
// All types are client-safe and will be exported from types/index.ts

// ============================================================================
// CLIENT-SAFE COMPONENTS
// ============================================================================
// React components will be exported from components/index.ts
// Note: Components should use 'use client' directive if they have client-side state

// ============================================================================
// CLIENT-SAFE HOOKS
// ============================================================================
// React hooks will be exported from hooks/index.ts
// All hooks are client-safe by nature (React hooks only run in browser)

// ============================================================================
// CLIENT-SAFE CONSTANTS
// ============================================================================
// Constants are client-safe (no server dependencies)

// Re-export client-safe modules
export * from './types';
export * from './components';
export * from './hooks';
export * from './constants';

// NOTE: Do NOT export:
// - services (may contain server-side database code)
// - utils (may contain server-side utilities like db.ts)
