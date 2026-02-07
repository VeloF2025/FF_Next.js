# Database Choice and Migration Strategy

## Executive Summary
We are migrating from Firebase/Firestore to Neon PostgreSQL for all data storage needs, keeping Firebase ONLY for the pole tracker offline sync functionality. This decision aligns with our in-house application requirements and provides better control, cost efficiency, and SQL capabilities.

## Current State
- **Firebase Dependencies**: 133 files using Firebase
- **Already on Neon**: 31 API endpoints (staff, clients, projects, SOW, procurement, analytics)
- **Authentication**: Currently Firebase, migrating to Clerk
- **Database URL**: `postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require`

## Why Neon PostgreSQL?

### Advantages
1. **Relational Data**: Better for structured business data with relationships
2. **SQL Power**: Complex queries, joins, aggregations, transactions
3. **Cost**: More predictable pricing for in-house apps
4. **Control**: Full data ownership and backup control
5. **Performance**: Better for analytical queries and reporting
6. **Integration**: Direct SQL access from Next.js API routes

### What We're Keeping in Firebase
- **Pole Tracker Sync ONLY**: For offline mobile app synchronization
- Everything else moves to Neon

## Migration Architecture

### Tech Stack After Migration
- **Authentication**: Clerk (replacing Firebase Auth)
- **Database**: Neon PostgreSQL (replacing Firestore)
- **Real-time**: WebSockets/SSE (replacing Firebase Realtime)
- **File Storage**: Local/MinIO (replacing Firebase Storage)
- **Framework**: Next.js 14+ (already in place)

## Migration Phases

### Phase 1: Authentication (Priority: HIGH)
- Remove Firebase Auth
- Implement Clerk authentication
- Migrate user profiles to Neon

### Phase 2: Core Services (Priority: HIGH)
- Contractors management
- Suppliers management
- RFQ/BOQ workflows
- Project phases

### Phase 3: Real-time Features (Priority: MEDIUM)
- Replace Firebase listeners with WebSockets
- Implement PostgreSQL LISTEN/NOTIFY

### Phase 4: File Storage (Priority: LOW)
- Implement local file storage
- Migrate existing Firebase Storage files

## Database Schema Strategy

### Neon Tables Structure
```sql
-- Users (managed by Clerk, profile in Neon)
CREATE TABLE users (
  id VARCHAR(255) PRIMARY KEY, -- Clerk user ID
  email VARCHAR(255) UNIQUE,
  name VARCHAR(255),
  role VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Contractors
CREATE TABLE contractors (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  status VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Suppliers
CREATE TABLE suppliers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  contact_email VARCHAR(255),
  rating DECIMAL(3,2),
  compliance_status VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

-- RFQ (Request for Quotation)
CREATE TABLE rfqs (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255),
  description TEXT,
  status VARCHAR(50),
  deadline TIMESTAMP,
  created_by VARCHAR(255) REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Project Phases
CREATE TABLE project_phases (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  phase_name VARCHAR(255),
  status VARCHAR(50),
  progress INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Implementation Plan

### Parallel Agent Tasks
We'll use multiple agents working simultaneously to speed up migration:

1. **Auth Agent**: Migrate authentication to Clerk
2. **Contractor Agent**: Migrate contractor services to Neon
3. **Supplier Agent**: Migrate supplier services to Neon
4. **RFQ Agent**: Migrate procurement workflows to Neon
5. **Project Agent**: Migrate project phases to Neon
6. **Realtime Agent**: Replace Firebase listeners with WebSockets
7. **Storage Agent**: Implement local file storage
8. **Cleanup Agent**: Remove unused Firebase imports

## Success Metrics
- ✅ All authentication through Clerk
- ✅ All CRUD operations using Neon
- ✅ No Firebase imports except pole tracker
- ✅ All tests passing
- ✅ Performance improvement in queries
- ✅ Cost reduction in database operations

## Rollback Plan
- Keep Firebase config but disabled
- Database exports before migration
- Feature flags for gradual rollout
- Parallel run period for validation

## Timeline
- **Day 1-2**: Authentication migration
- **Day 3-4**: Core services migration
- **Day 5**: Real-time features
- **Day 6**: File storage
- **Day 7**: Testing and validation

## Notes
- Keep pole tracker Firebase sync unchanged
- All new features use Neon exclusively
- Archive Firebase code for reference
- Document all API changes