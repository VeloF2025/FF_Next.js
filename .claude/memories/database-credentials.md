# Database Credentials - ALWAYS USE THESE

**Last Updated:** January 2026

## Production Database (FF_React project, production branch)

```bash
DATABASE_URL='postgresql://neondb_owner:$NEON_DB_PASSWORD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require'
```

**Password:** `$NEON_DB_PASSWORD`
**Endpoint:** `ep-dry-night-a9qyh4sj-pooler`
**Required params:** `sslmode=require&channel_binding=require`

## Running Migration Scripts

ALWAYS source from .env.local or use the correct DATABASE_URL:

```bash
# Option 1: Source env first (preferred)
source .env.local && node scripts/run-migration.js

# Option 2: Inline with correct password (note: single quotes required!)
DATABASE_URL='postgresql://neondb_owner:$NEON_DB_PASSWORD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require' node scripts/run-migration.js

# Option 3: For psql direct connection
psql 'postgresql://neondb_owner:$NEON_DB_PASSWORD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require'
```

## WRONG Password (DO NOT USE)
- `npg_aRNLhZc1G2CD` - This is OLD/INCORRECT

## Development Branch
- Branch: `hein-dev`
- Endpoint: `ep-aged-poetry-a9bbd8e9`
- Same password: `$NEON_DB_PASSWORD`
- Full URL: `postgresql://neondb_owner:$NEON_DB_PASSWORD@ep-aged-poetry-a9bbd8e9.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require`
