# Changelog

All notable changes to FibreFlow will be documented in this file.

## [RESET] - 2026-01-09

### 🔄 Complete Repository Reset to Clean Foundation

**BREAKING CHANGE**: Force pushed to remove all authentication systems

#### Removed
- **All Clerk authentication code** (169 files cleaned)
- **PostgreSQL JWT authentication** (incomplete implementation)  
- **Development bypass sign-in page**
- **All auth-related dependencies**

#### Changed
- Reset to December 2024 base (commit `07372867`)
- Deployed production build (no dev mode)
- Force pushed to GitHub master (`1400838b`)

#### Technical Details
- No authentication system present
- Production build eliminates WebSocket/HMR issues
- Stable deployment on VF Server port 3006
- See `CLEAN_FOUNDATION.md` for complete details

---

## Previous History

- December 2024: Staff management, documents, exit workflow
- Earlier: See git history before reset
