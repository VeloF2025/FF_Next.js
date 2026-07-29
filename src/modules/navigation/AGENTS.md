<!-- GENERATED — do not edit. Canonical source: ./.claude.md -->
<!-- Regenerate: node scripts/mirror-agents-md.mjs -->
<!-- You are reading the AGENTS.md view of the Claude-facing docs. Prose
     below may refer to ".claude.md" when describing the canonical side;
     that is accurate — only PATH references are rewritten to AGENTS.md. -->
# navigation module

Centralized module registry, tab routing, and RBAC-gated tab visibility for all FibreFlow modules.

**API routes:** none — navigation is config-driven and has no module-specific API route
**DB table:** none — all config is in-memory (runtime Map)
**Key files:**
- `config/registry.ts` — in-memory `Map<ModuleId, ModuleNavigationConfig>`; `registerModuleConfig`, `getModuleConfig`, `getModuleConfigByPath`, `getActiveTabByPath`, `getActiveSubTabByPath`
- `config/index.ts` — imports and registers all 9 module configs on import; re-exports registry functions
- `config/modules/*.config.ts` — per-module tab definitions for: activate, analytics, assets, construction-qa, fleet, noc, procurement, projects, staff
- `hooks/useModuleTabs.ts` — derives `activeTab`/`activeSubTab` from URL via `usePathname`+`useSearchParams`; filters hidden tabs; wraps `usePermission` → `can(rbacKey, 'view')` for lock state
- `components/ModuleTabs.tsx` — horizontal tab bar; locked tabs render as disabled `<button>` with `Lock` icon, not `<Link>`
- `components/SubTabs.tsx` — pill-style secondary row; renders only when active tab has `subTabs`; returns null if empty

**Types:** `ModuleId` union, `TabConfig` (id/label/shortLabel/icon/path/rbacKey/subTabs/badge/hidden), `ModuleNavigationConfig` (moduleId/basePath/tabs/accentColor/showProjectSelector)

**Gotchas:**
- `config/index.ts` must be imported before any registry call — registration is a side-effect of import; missing import causes silent misses.
- `getActiveTabByPath` matches longest tab path first for nested routes; sub-tab matching also handles `?key=value` query-param paths.
- `hidden: true` tabs are silently excluded from `visibleTabs`; tabs with `rbacKey` the user fails are shown locked (not hidden).
- Default redirect on module base path (`/noc` → first tab) is the page component's responsibility, not this module.
- `useModuleTabs` takes a full `ModuleNavigationConfig` object, not a string moduleId — call `getModuleConfig(id)` first.
