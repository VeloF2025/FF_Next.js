# FibreFlow - Global Learnings

> Project-wide learnings that apply across all modules.

---

## 2026-01-22: Use Dev Mode for Local Development

**Issue:** Repeated `ChunkLoadError` and React error #423 when running production build locally (`npm run build && npm start`). After each rebuild, browser tries to load old cached chunk URLs that no longer exist.

**Symptoms:**
- `ChunkLoadError: Loading chunk XXXX failed`
- `React error #423` (hydration mismatch)
- Page stuck loading or shows stale content
- Must hard-refresh (Ctrl+Shift+R) after every rebuild

**Root Cause:** Production builds generate unique chunk hashes (e.g., `runtime-5044df1c70f18193.js`). Browser caches these URLs aggressively. After rebuild, hashes change but browser still requests old URLs → 400 errors.

**Solution:** Use `npm run dev` for local development instead of production mode.

```bash
# ✅ For local development
PORT=3004 npm run dev

# ❌ Avoid for rapid iteration (causes chunk caching issues)
npm run build && PORT=3005 npm start
```

**Benefits of Dev Mode:**
- Hot Module Replacement (HMR) - updates modules in place without full reload
- No chunk caching issues - dev server handles module updates
- Instant refresh on file changes - no manual rebuild needed
- Better error messages (not minified)
- Source maps for debugging

**When to Use Production Mode:**
- Final testing before deploy
- Performance testing
- Reproducing production-only bugs

**Affected Areas:** All modules - this is a Next.js/webpack behavior, not module-specific.
