# Product Requirements Document: FibreFlow Vehicle Management System

**Document Version:** 1.0.0
**Created:** 2026-01-13
**Status:** Draft - Awaiting Approval
**Project:** FibreFlow Vehicle Management with Autonomous Cloud Agent
**Source:** Reverse-engineered from BOSS Vehicle Investigation Agent

---

## Executive Summary

### Vision
Transform FibreFlow into a comprehensive vehicle fleet management platform with autonomous GPS analysis, pattern detection, and automated reporting capabilities using Claude Agent SDK for cloud-native autonomous operations.

### Objectives
1. **Autonomous GPS Processing**: Auto-import Excel sheets, analyze trips, detect unauthorized usage
2. **Multi-Vehicle Fleet Management**: Track rental, company-owned, and private vehicles
3. **Automated Reporting**: Generate investigation reports without human intervention
4. **Cost Analysis**: Calculate fuel, depreciation, and unauthorized usage costs
5. **Cloud-Native Architecture**: Deploy as autonomous agent using Claude Agent SDK

### Success Metrics
- **Processing Time**: <5 minutes per vehicle investigation (1,000+ GPS points)
- **Accuracy**: >95% POI classification accuracy, <2% false positive rate
- **Automation**: 100% autonomous from Excel upload to PDF report delivery
- **Cost Efficiency**: <$50/month operational cost for 50 vehicles
- **User Adoption**: 80% of fleet managers use system monthly

---

## 1. Product Context

### 1.1 Current State Analysis

**BOSS Vehicle Investigation Agent (Python-based):**
- ✅ Standalone Python agent with 19 methods, 24 tests, >95% coverage
- ✅ GPS parsing from Excel (fuzzy column matching)
- ✅ Geofencing with haversine distance calculation
- ✅ POI enrichment via Nominatim OpenStreetMap API (100% free tier)
- ✅ Pattern detection (weekend usage, after-hours, suspicious POI)
- ✅ Multi-format reporting (Markdown, PDF, CSV, HTML map)
- ✅ Async operations with caching (~40% POI cache hit rate)
- ✅ Rate limiting (1.1s delay between API requests)
- ❌ Manual CLI execution required
- ❌ No web UI or cloud deployment
- ❌ No multi-vehicle fleet management
- ❌ No database persistence

**FibreFlow Current State (Next.js + Neon PostgreSQL):**
- ✅ Next.js 14+ with App Router (production)
- ✅ Clerk authentication system
- ✅ Neon PostgreSQL with Drizzle ORM
- ✅ TypeScript strict mode
- ✅ Existing SOW import functionality pattern
- ❌ No vehicle management module
- ❌ No GPS tracking integration
- ❌ No automated agent system

### 1.2 Migration Strategy

**Approach:** Hybrid Architecture (Not Full Rewrite)

1. **Preserve Python Core Logic**: Keep GPS parsing, geofencing, POI enrichment as Python backend service
2. **Add TypeScript Frontend**: FibreFlow Next.js UI for vehicle management
3. **Claude Agent SDK Bridge**: Deploy Python agent as autonomous cloud service
4. **Database Integration**: Extend Drizzle schema for vehicle/trip/report tables
5. **Async Job Queue**: Bull queue for background GPS processing

**Rationale:**
- Leverage proven Python algorithms (>95% test coverage)
- Maintain FibreFlow's TypeScript/Next.js architecture
- Enable autonomous cloud operations via Claude Agent SDK
- Faster time-to-market (3-4 weeks vs 8-10 weeks for full rewrite)

---

## 2. User Personas

### 2.1 Fleet Manager (Primary)
**Name:** Sarah Thompson
**Role:** Operations Manager at Velocity Fibre
**Goals:**
- Monitor 15 company vehicles and 8 rental vehicles
- Detect unauthorized usage before month-end
- Generate evidence-based reports for HR actions
- Track vehicle costs (fuel, depreciation, unauthorized usage)

**Pain Points:**
- Manual GPS data analysis takes 4-6 hours per vehicle
- Excel-based tracking is error-prone
- No real-time alerts for suspicious patterns
- Difficulty proving unauthorized usage to staff

**User Journey:**
1. Upload GPS tracking Excel file (exported from tracking system)
2. System auto-processes file, detects vehicle from filename
3. Receive email notification when report is ready (5-10 minutes)
4. Review web dashboard with map visualization
5. Download PDF report for HR submission

### 2.2 Finance Manager (Secondary)
**Name:** David Chen
**Role:** CFO at Velocity Fibre
**Goals:**
- Monthly cost reconciliation for vehicle fleet
- Identify cost-saving opportunities
- Audit unauthorized usage claims

**Pain Points:**
- Manual cost calculations from multiple sources
- Lack of consolidated fleet overview
- Difficulty tracking trends over time

**User Journey:**
1. Access monthly fleet dashboard
2. View aggregated cost breakdown (fuel, depreciation, unauthorized)
3. Export financial reports for accounting system
4. Drill down into specific vehicle investigations

### 2.3 System Administrator (Tertiary)
**Name:** Michael Ndlovu
**Role:** IT Administrator
**Goals:**
- Configure authorized locations per vehicle
- Manage user access and permissions
- Monitor system health and performance

**Pain Points:**
- Complex configuration files
- No audit trail for configuration changes
- Limited visibility into agent processing status

**User Journey:**
1. Configure authorized locations via web UI
2. Set work hours and cost parameters
3. Monitor autonomous agent processing queue
4. Review processing logs and error reports

---

## 3. Functional Requirements

### 3.1 Vehicle Management

#### FR-VM-001: Vehicle Registry
**Priority:** P0 (MVP Critical)
**Description:** CRUD operations for vehicle fleet management

**Acceptance Criteria:**
- ✅ Create vehicle with fields: registration, type (rental/company/private), owner, status
- ✅ Update vehicle details and authorized locations
- ✅ Deactivate/archive vehicles
- ✅ View vehicle list with search and filters
- ✅ Vehicle detail page with investigation history

**Database Schema (Drizzle ORM):**
```typescript
// drizzle/schema/vehicles.ts
export const vehicles = pgTable('vehicles', {
  id: uuid('id').primaryKey().defaultRandom(),
  registration: varchar('registration', { length: 20 }).notNull().unique(),
  vehicleType: varchar('vehicle_type', { length: 20 }).notNull(), // 'rental' | 'company' | 'private'
  ownerType: varchar('owner_type', { length: 50 }), // 'Velocity Fibre' | 'Rental Agency' | 'Staff'
  status: varchar('status', { length: 20 }).default('active'), // 'active' | 'inactive' | 'archived'
  make: varchar('make', { length: 50 }),
  model: varchar('model', { length: 50 }),
  year: integer('year'),
  assignedTo: varchar('assigned_to', { length: 100 }), // Staff name
  fuelRate: numeric('fuel_rate', { precision: 10, scale: 2 }).default('2.50'),
  depreciationRate: numeric('depreciation_rate', { precision: 10, scale: 2 }).default('1.20'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  createdBy: varchar('created_by', { length: 100 }),
});

export const authorizedLocations = pgTable('authorized_locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  lat: numeric('lat', { precision: 10, scale: 7 }).notNull(),
  lon: numeric('lon', { precision: 10, scale: 7 }).notNull(),
  radiusKm: numeric('radius_km', { precision: 5, scale: 2 }).notNull(),
  locationType: varchar('location_type', { length: 50 }).notNull(), // 'work_site' | 'accommodation' | 'supplier' | 'client'
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});
```

**API Endpoints (Next.js App Router):**
```typescript
// app/api/vehicles/route.ts
POST   /api/vehicles          // Create vehicle
GET    /api/vehicles          // List vehicles (with pagination, filters)
GET    /api/vehicles/[id]     // Get vehicle details
PATCH  /api/vehicles/[id]     // Update vehicle
DELETE /api/vehicles/[id]     // Soft delete vehicle

POST   /api/vehicles/[id]/locations  // Add authorized location
GET    /api/vehicles/[id]/locations  // List authorized locations
PATCH  /api/locations/[id]           // Update location
DELETE /api/locations/[id]           // Remove location
```

---

#### FR-VM-002: GPS File Upload & Processing
**Priority:** P0 (MVP Critical)
**Description:** Autonomous upload, detection, and processing of GPS Excel files

**Acceptance Criteria:**
- ✅ Upload Excel file via web UI (drag-and-drop + file picker)
- ✅ Auto-detect vehicle from filename pattern (e.g., "CL94BTZN_tracking.xlsx")
- ✅ Validate file format and columns (fuzzy matching)
- ✅ Queue processing job asynchronously
- ✅ Display processing status with progress indicator
- ✅ Send email notification on completion
- ✅ Handle errors gracefully (invalid format, missing columns)

**File Upload Flow:**
```
User uploads GPS file
   ↓
Next.js API validates file (file type, size <50MB)
   ↓
Store file in cloud storage (Vercel Blob / S3)
   ↓
Create processing job in database
   ↓
Trigger Claude Agent SDK autonomous agent
   ↓
Agent processes file (Python backend service)
   ↓
Store results in database (trips, POI data, patterns)
   ↓
Generate reports (Markdown, PDF, HTML map)
   ↓
Update job status to 'completed'
   ↓
Send email notification to user
   ↓
User views report in web UI
```

**Database Schema:**
```typescript
// drizzle/schema/gps-processing.ts
export const gpsProcessingJobs = pgTable('gps_processing_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id).notNull(),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  fileUrl: text('file_url').notNull(), // Cloud storage URL
  fileSize: integer('file_size'), // Bytes
  status: varchar('status', { length: 20 }).notNull(), // 'pending' | 'processing' | 'completed' | 'failed'
  progress: integer('progress').default(0), // 0-100%
  errorMessage: text('error_message'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  processingTimeMs: integer('processing_time_ms'),
  createdAt: timestamp('created_at').defaultNow(),
  createdBy: varchar('created_by', { length: 100 }),
});

export const trips = pgTable('trips', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').references(() => gpsProcessingJobs.id).notNull(),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id).notNull(),
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time').notNull(),
  startLat: numeric('start_lat', { precision: 10, scale: 7 }).notNull(),
  startLon: numeric('start_lon', { precision: 10, scale: 7 }).notNull(),
  endLat: numeric('end_lat', { precision: 10, scale: 7 }).notNull(),
  endLon: numeric('end_lon', { precision: 10, scale: 7 }).notNull(),
  distanceKm: numeric('distance_km', { precision: 10, scale: 2 }).notNull(),
  classification: varchar('classification', { length: 20 }).notNull(), // 'AUTHORIZED' | 'UNAUTHORIZED'
  isUnauthorized: boolean('is_unauthorized').notNull(),
  timeFlag: varchar('time_flag', { length: 50 }), // 'WORK_HOURS' | 'AFTER_HOURS' | 'NIGHT_TRAVEL'
  dayType: varchar('day_type', { length: 20 }), // 'WEEKDAY' | 'WEEKEND'
  nearestAuthorizedLocation: varchar('nearest_authorized_location', { length: 100 }),
  distanceFromAuthorized: numeric('distance_from_authorized', { precision: 10, scale: 2 }),
  createdAt: timestamp('created_at').defaultNow(),
});

export const tripPOI = pgTable('trip_poi', {
  id: uuid('id').primaryKey().defaultRandom(),
  tripId: uuid('trip_id').references(() => trips.id).notNull(),
  location: varchar('location', { length: 20 }).notNull(), // 'start' | 'end'
  lat: numeric('lat', { precision: 10, scale: 7 }).notNull(),
  lon: numeric('lon', { precision: 10, scale: 7 }).notNull(),
  category: varchar('category', { length: 100 }),
  name: varchar('name', { length: 255 }),
  address: text('address'),
  isSuspicious: boolean('is_suspicious').default(false),
  riskLevel: varchar('risk_level', { length: 20 }), // 'LOW' | 'MEDIUM' | 'HIGH'
  distanceMeters: numeric('distance_meters', { precision: 10, scale: 2 }),
  rawData: jsonb('raw_data'),
  createdAt: timestamp('created_at').defaultNow(),
});
```

**API Endpoints:**
```typescript
POST   /api/vehicles/[id]/upload-gps     // Upload GPS file
GET    /api/jobs/[id]                    // Get job status
POST   /api/jobs/[id]/retry              // Retry failed job
DELETE /api/jobs/[id]                    // Cancel/delete job
```

---

#### FR-VM-003: Investigation Dashboard
**Priority:** P0 (MVP Critical)
**Description:** Interactive dashboard displaying trip analysis and patterns

**Acceptance Criteria:**
- ✅ Display summary statistics (total trips, authorized %, unauthorized km, cost)
- ✅ Interactive map with trip routes (Leaflet.js or Mapbox GL)
- ✅ Timeline view of trips (authorized vs unauthorized)
- ✅ POI markers color-coded by risk level
- ✅ Pattern detection alerts (weekend usage, suspicious POI, after-hours)
- ✅ Cost breakdown chart (fuel, depreciation, unauthorized)
- ✅ Trip detail modal with start/end POI information
- ✅ Export options (PDF, CSV, HTML)

**UI Components (React + TypeScript):**
```typescript
// src/components/vehicle-dashboard/InvestigationDashboard.tsx
interface InvestigationDashboardProps {
  jobId: string;
  vehicleId: string;
}

export function InvestigationDashboard({ jobId, vehicleId }: InvestigationDashboardProps) {
  return (
    <div className="investigation-dashboard">
      <SummaryStats jobId={jobId} />
      <PatternAlerts jobId={jobId} />
      <TripMap jobId={jobId} />
      <TripTimeline jobId={jobId} />
      <CostBreakdown jobId={jobId} />
      <TripTable jobId={jobId} />
      <ExportActions jobId={jobId} />
    </div>
  );
}
```

**Key Features:**
1. **Summary Stats Card:**
   - Total trips: 45
   - Authorized: 29 (64.4%)
   - Unauthorized: 16 (35.6%)
   - Unauthorized distance: 847.3 km
   - Financial impact: R 2,345.67

2. **Pattern Alerts (Color-coded):**
   - 🔴 HIGH: 6 suspicious POI visits (bars, taverns)
   - 🟡 MEDIUM: High weekend usage (35% of trips)
   - 🟢 LOW: After-hours usage within tolerance

3. **Interactive Map:**
   - Authorized zones (green circles)
   - Trip routes (authorized: green, unauthorized: red)
   - POI markers (color by risk: green/yellow/red)
   - Click markers for details

4. **Trip Timeline:**
   - Horizontal timeline with trip bars
   - Color: green (authorized), red (unauthorized)
   - Tooltip on hover: start/end time, distance, POI

5. **Cost Breakdown Chart:**
   - Pie chart: Fuel (55%), Depreciation (45%)
   - Bar chart: Authorized vs Unauthorized costs

---

#### FR-VM-004: Automated Report Generation
**Priority:** P0 (MVP Critical)
**Description:** Generate PDF investigation reports with map, analysis, and recommendations

**Acceptance Criteria:**
- ✅ Auto-generate PDF report after GPS processing
- ✅ Include company letterhead and branding
- ✅ Sections: Executive Summary, Trip Analysis, Pattern Detection, Financial Impact, Recommendations
- ✅ Embedded map image (static image from Leaflet)
- ✅ Paginated trip table with POI details
- ✅ Professional formatting (matching existing BOSS report style)
- ✅ Store report URL in database
- ✅ Download link in web UI

**Report Structure (PDF):**
```
Page 1: Cover Page
  - Title: "Vehicle Investigation Report: [VEHICLE_ID]"
  - Investigation period: [START_DATE] - [END_DATE]
  - Generated: [TIMESTAMP]
  - Company logo and letterhead

Page 2: Executive Summary
  - Key Findings (3-5 bullet points)
  - Financial Impact Summary
  - Recommendations

Page 3-4: Trip Analysis
  - Summary statistics table
  - Embedded map image (1200x800px)
  - Pattern detection findings

Page 5+: Detailed Trip Log
  - Paginated table (20 trips per page)
  - Columns: Date/Time, Distance, Classification, Start POI, End POI, Risk Level

Final Page: Methodology & Data Sources
  - GPS data source
  - POI enrichment method (Nominatim)
  - Analysis algorithms
  - Disclaimer
```

**Implementation (Python Service):**
```python
# services/report-generator/pdf_generator.py
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, Table
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm

class VehicleInvestigationReportGenerator:
    """Generate professional PDF investigation reports."""

    def generate_report(
        self,
        job_id: str,
        vehicle_data: dict,
        trips: list,
        patterns: list,
        financial_summary: dict,
        output_path: str
    ) -> str:
        """
        Generate PDF report.

        Returns:
            URL to generated PDF
        """
        doc = SimpleDocTemplate(output_path, pagesize=A4)
        story = []

        # Add cover page
        story.extend(self._create_cover_page(vehicle_data))

        # Add executive summary
        story.extend(self._create_executive_summary(patterns, financial_summary))

        # Add trip analysis section
        story.extend(self._create_trip_analysis(trips, vehicle_data))

        # Add detailed trip log
        story.extend(self._create_trip_log(trips))

        # Add methodology section
        story.extend(self._create_methodology())

        # Build PDF
        doc.build(story)

        # Upload to cloud storage and return URL
        pdf_url = self._upload_to_storage(output_path)
        return pdf_url
```

**API Endpoint:**
```typescript
GET /api/jobs/[id]/report          // Get report URL
POST /api/jobs/[id]/regenerate     // Regenerate report
```

---

### 3.2 Autonomous Agent System

#### FR-AA-001: Claude Agent SDK Integration
**Priority:** P0 (MVP Critical)
**Description:** Deploy Python vehicle investigation agent as autonomous cloud service

**Acceptance Criteria:**
- ✅ Package Python agent as Docker container
- ✅ Deploy using Claude Agent SDK (agentic framework)
- ✅ Event-driven triggers (file upload → agent activation)
- ✅ Autonomous execution (no human intervention)
- ✅ Progress updates to web UI via WebSocket
- ✅ Error handling and retry logic
- ✅ Graceful shutdown and state persistence

**Architecture:**
```
┌─────────────────────────────────────────────────┐
│     FibreFlow Next.js (Frontend + API)          │
│  - Vehicle management UI                        │
│  - File upload interface                        │
│  - Dashboard visualization                      │
└──────────────┬──────────────────────────────────┘
               │
               │ HTTP API + WebSocket
               │
┌──────────────▼──────────────────────────────────┐
│       Next.js API Routes (Coordinator)          │
│  - Handle file uploads                          │
│  - Create processing jobs                       │
│  - Trigger agent via SDK                        │
│  - Stream progress updates                      │
└──────────────┬──────────────────────────────────┘
               │
               │ Claude Agent SDK Protocol
               │
┌──────────────▼──────────────────────────────────┐
│    Autonomous Vehicle Investigation Agent       │
│            (Python + Claude SDK)                │
│                                                 │
│  Components:                                    │
│  - Agent Runtime (Claude SDK)                   │
│  - GPS Parser (pandas + fuzzy matching)         │
│  - Geofencing Engine (haversine distance)       │
│  - POI Enrichment (async Nominatim API)         │
│  - Pattern Detector (statistical analysis)      │
│  - Report Generator (PDF + HTML + CSV)          │
│  - State Manager (progress tracking)            │
└──────────────┬──────────────────────────────────┘
               │
               │ Data Persistence
               │
┌──────────────▼──────────────────────────────────┐
│      Neon PostgreSQL (Database)                 │
│  - Vehicles, Trips, POI, Jobs, Reports          │
└─────────────────────────────────────────────────┘
```

**Claude Agent SDK Implementation:**
```python
# agents/vehicle_investigation_sdk_agent.py
from anthropic import Anthropic, Agent, Tool
import asyncio

class VehicleInvestigationSDKAgent(Agent):
    """Autonomous vehicle investigation agent using Claude SDK."""

    def __init__(self, api_key: str, db_connection: str):
        super().__init__(
            name="vehicle-investigation-agent",
            description="Autonomous GPS analysis and vehicle investigation",
            version="1.0.0",
            tools=[
                self.parse_gps_file,
                self.classify_trips,
                self.enrich_poi_data,
                self.detect_patterns,
                self.calculate_costs,
                self.generate_reports
            ]
        )
        self.client = Anthropic(api_key=api_key)
        self.db = db_connection

    @Tool(name="parse_gps_file", description="Parse GPS tracking Excel file")
    async def parse_gps_file(self, file_url: str, job_id: str) -> dict:
        """Download and parse GPS file."""
        # Reuse existing VehicleInvestigationAgent.parse_gps_data()
        self.update_progress(job_id, 10, "Parsing GPS data...")
        result = await self._parse_gps_data(file_url)
        self.update_progress(job_id, 30, f"Parsed {result['trip_count']} trips")
        return result

    @Tool(name="classify_trips", description="Classify trips as authorized/unauthorized")
    async def classify_trips(self, trips: list, authorized_locations: list, job_id: str) -> list:
        """Classify each trip using geofencing."""
        self.update_progress(job_id, 40, "Classifying trips...")
        classified = await self._classify_all_trips(trips, authorized_locations)
        self.update_progress(job_id, 50, "Classification complete")
        return classified

    @Tool(name="enrich_poi_data", description="Enrich trips with POI data")
    async def enrich_poi_data(self, trips: list, job_id: str) -> list:
        """Async POI lookup for all trip endpoints."""
        self.update_progress(job_id, 60, "Enriching with POI data...")
        enriched = await self._enrich_with_poi(trips, max_lookups=50)
        self.update_progress(job_id, 75, "POI enrichment complete")
        return enriched

    @Tool(name="detect_patterns", description="Detect suspicious behavior patterns")
    async def detect_patterns(self, trips: list, job_id: str) -> list:
        """Statistical pattern detection."""
        self.update_progress(job_id, 85, "Analyzing patterns...")
        patterns = await self._detect_patterns(trips)
        self.update_progress(job_id, 90, f"Detected {len(patterns)} patterns")
        return patterns

    @Tool(name="generate_reports", description="Generate investigation reports")
    async def generate_reports(self, job_id: str, data: dict) -> dict:
        """Generate PDF, HTML, and CSV reports."""
        self.update_progress(job_id, 95, "Generating reports...")
        reports = await self._generate_all_reports(data)
        self.update_progress(job_id, 100, "Investigation complete")
        return reports

    async def run_investigation(self, job_id: str) -> dict:
        """Autonomous investigation workflow."""
        try:
            # Load job from database
            job = await self.db.get_job(job_id)
            vehicle = await self.db.get_vehicle(job.vehicle_id)

            # Execute investigation pipeline
            gps_data = await self.parse_gps_file(job.file_url, job_id)
            trips = await self.classify_trips(gps_data['trips'], vehicle.authorized_locations, job_id)
            enriched_trips = await self.enrich_poi_data(trips, job_id)
            patterns = await self.detect_patterns(enriched_trips, job_id)
            financial = await self.calculate_costs(enriched_trips, vehicle.fuel_rate, vehicle.depreciation_rate)
            reports = await self.generate_reports(job_id, {
                'trips': enriched_trips,
                'patterns': patterns,
                'financial': financial,
                'vehicle': vehicle
            })

            # Update job status
            await self.db.update_job(job_id, status='completed', reports=reports)

            # Send notification
            await self.send_notification(job.created_by, job_id, reports)

            return {'status': 'success', 'reports': reports}

        except Exception as e:
            logger.error(f"Investigation failed for job {job_id}: {e}")
            await self.db.update_job(job_id, status='failed', error=str(e))
            raise

    def update_progress(self, job_id: str, progress: int, message: str):
        """Update job progress in database and broadcast to WebSocket."""
        self.db.update_job_progress(job_id, progress, message)
        self.broadcast_progress(job_id, progress, message)
```

**Deployment Configuration:**
```yaml
# docker-compose.yml
version: '3.8'
services:
  vehicle-agent:
    build:
      context: ./agents/vehicle-investigation-sdk
      dockerfile: Dockerfile
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
    depends_on:
      - postgres
      - redis
    restart: unless-stopped
    networks:
      - fibreflow-network

  postgres:
    image: postgres:15
    environment:
      - POSTGRES_DB=fibreflow
      - POSTGRES_USER=${DB_USER}
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    networks:
      - fibreflow-network

  redis:
    image: redis:7-alpine
    networks:
      - fibreflow-network

networks:
  fibreflow-network:

volumes:
  postgres-data:
```

---

#### FR-AA-002: Job Queue System
**Priority:** P0 (MVP Critical)
**Description:** Async job queue for background GPS processing

**Acceptance Criteria:**
- ✅ Use Bull queue (Redis-backed) for job management
- ✅ Support job priorities (urgent, normal, low)
- ✅ Retry logic (3 attempts with exponential backoff)
- ✅ Concurrent processing (max 5 jobs simultaneously)
- ✅ Job progress tracking (0-100%)
- ✅ Dead letter queue for failed jobs
- ✅ Admin UI for queue monitoring

**Implementation (Next.js API):**
```typescript
// lib/queue/vehicle-processing-queue.ts
import { Queue, Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';

const redisConnection = new Redis(process.env.REDIS_URL);

export const vehicleProcessingQueue = new Queue('vehicle-processing', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000, // Start with 5s delay
    },
    removeOnComplete: {
      age: 86400, // Keep completed jobs for 24 hours
    },
    removeOnFail: {
      age: 604800, // Keep failed jobs for 7 days
    },
  },
});

interface VehicleProcessingJobData {
  jobId: string;
  vehicleId: string;
  fileUrl: string;
  createdBy: string;
}

export async function addVehicleProcessingJob(data: VehicleProcessingJobData, priority?: number) {
  const job = await vehicleProcessingQueue.add('process-gps', data, {
    priority: priority || 10,
    jobId: data.jobId, // Use database job ID
  });

  return job;
}

// Worker (separate process or serverless function)
const worker = new Worker('vehicle-processing', async (job: Job<VehicleProcessingJobData>) => {
  const { jobId, vehicleId, fileUrl } = job.data;

  // Trigger Claude Agent SDK autonomous agent
  const agentResult = await triggerVehicleAgent(jobId, vehicleId, fileUrl);

  // Update job progress (agent streams progress via WebSocket)
  await job.updateProgress(100);

  return agentResult;
}, {
  connection: redisConnection,
  concurrency: 5, // Process max 5 jobs concurrently
});

worker.on('completed', async (job) => {
  console.log(`Job ${job.id} completed successfully`);
  // Send completion notification
  await sendJobCompletionEmail(job.data.createdBy, job.id);
});

worker.on('failed', async (job, err) => {
  console.error(`Job ${job.id} failed:`, err);
  // Update database with error
  await updateJobStatus(job.data.jobId, 'failed', err.message);
});
```

---

### 3.3 Cost Analysis & Financial Reporting

#### FR-CA-001: Cost Calculation Engine
**Priority:** P1 (Post-MVP)
**Description:** Calculate fuel, depreciation, and unauthorized usage costs

**Acceptance Criteria:**
- ✅ Configure fuel rate per vehicle (ZAR per km)
- ✅ Configure depreciation rate per vehicle (ZAR per km)
- ✅ Calculate total cost per trip
- ✅ Breakdown: authorized vs unauthorized costs
- ✅ Monthly cost aggregation
- ✅ Export cost reports (CSV, Excel)

**Cost Formula:**
```
Trip Cost = (Distance_km * Fuel_Rate) + (Distance_km * Depreciation_Rate)

Authorized Cost = SUM(Trip Cost WHERE classification = 'AUTHORIZED')
Unauthorized Cost = SUM(Trip Cost WHERE classification = 'UNAUTHORIZED')

Total Cost = Authorized Cost + Unauthorized Cost
Unauthorized % = (Unauthorized Cost / Total Cost) * 100
```

**Database Schema:**
```typescript
export const costSummaries = pgTable('cost_summaries', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').references(() => gpsProcessingJobs.id).notNull(),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id).notNull(),
  authorizedKm: numeric('authorized_km', { precision: 10, scale: 2 }),
  unauthorizedKm: numeric('unauthorized_km', { precision: 10, scale: 2 }),
  totalKm: numeric('total_km', { precision: 10, scale: 2 }),
  fuelCost: numeric('fuel_cost', { precision: 10, scale: 2 }),
  depreciationCost: numeric('depreciation_cost', { precision: 10, scale: 2 }),
  totalCost: numeric('total_cost', { precision: 10, scale: 2 }),
  unauthorizedCost: numeric('unauthorized_cost', { precision: 10, scale: 2 }),
  unauthorizedPercentage: numeric('unauthorized_percentage', { precision: 5, scale: 2 }),
  createdAt: timestamp('created_at').defaultNow(),
});
```

---

## 4. Non-Functional Requirements

### 4.1 Performance

#### NFR-PERF-001: Processing Speed
- **Requirement**: Process 1,000 GPS points in <5 minutes
- **Target**: 3-4 minutes average processing time
- **Measurement**: Track processing_time_ms in gps_processing_jobs table
- **Optimization**:
  - Async POI lookups (max 50 concurrent)
  - POI caching (~40% hit rate)
  - Batch database inserts (100 trips per batch)

#### NFR-PERF-002: API Response Time
- **Requirement**: API endpoints respond in <500ms (p95)
- **Target**: <200ms (p50), <500ms (p95), <1000ms (p99)
- **Measurement**: Vercel Analytics + custom logging
- **Optimization**:
  - Database query optimization (indexes, EXPLAIN ANALYZE)
  - Redis caching for frequently accessed data
  - CDN for static assets

#### NFR-PERF-003: Concurrent Users
- **Requirement**: Support 50 concurrent users
- **Target**: 100 concurrent users without degradation
- **Measurement**: Load testing with Artillery or k6
- **Scaling**: Vercel auto-scaling + Neon connection pooling

---

### 4.2 Scalability

#### NFR-SCALE-001: Vehicle Fleet Size
- **MVP**: 50 vehicles
- **Phase 2**: 500 vehicles
- **Phase 3**: 5,000 vehicles
- **Database**: Neon PostgreSQL (auto-scaling)
- **Agent**: Horizontal scaling via Docker Swarm or Kubernetes

#### NFR-SCALE-002: GPS Data Volume
- **MVP**: 1,000 GPS points per file
- **Phase 2**: 10,000 GPS points per file
- **Phase 3**: 100,000 GPS points per file
- **Strategy**: Chunked processing (batch 1,000 rows at a time)

---

### 4.3 Security

#### NFR-SEC-001: Authentication & Authorization
- **Requirement**: Clerk authentication for all routes
- **Roles**:
  - `admin`: Full access (CRUD vehicles, view all reports)
  - `fleet_manager`: View/upload GPS, view reports for assigned vehicles
  - `finance`: View cost reports only
  - `viewer`: Read-only access
- **Implementation**: Clerk middleware + role-based access control (RBAC)

#### NFR-SEC-002: Data Privacy
- **Requirement**: GPS data is sensitive (employee tracking)
- **Compliance**: POPIA (South African data protection law)
- **Measures**:
  - Encrypt GPS files at rest (AES-256)
  - TLS for all API communication
  - Audit logs for all data access
  - Data retention policy (delete GPS files after 90 days)

#### NFR-SEC-003: API Security
- **Requirement**: Prevent unauthorized API access
- **Measures**:
  - API key authentication for agent-to-API communication
  - Rate limiting (100 requests per minute per user)
  - CSRF protection (Next.js built-in)
  - Input validation and sanitization

---

### 4.4 Reliability

#### NFR-REL-001: Uptime
- **Requirement**: 99.5% uptime (43.8 hours downtime per year)
- **Target**: 99.9% uptime (8.76 hours downtime per year)
- **Monitoring**: Vercel uptime monitoring + PagerDuty alerts
- **Recovery**: Automatic retries + dead letter queue for failed jobs

#### NFR-REL-002: Data Integrity
- **Requirement**: No data loss during processing
- **Measures**:
  - Database transactions for multi-table operations
  - Atomic job status updates
  - File backup before processing
  - Rollback mechanism for failed jobs

#### NFR-REL-003: Error Handling
- **Requirement**: Graceful degradation on errors
- **Strategy**:
  - Try POI enrichment → fallback to coordinates-only if API fails
  - Try PDF generation → fallback to Markdown if reportlab fails
  - Retry failed jobs (3 attempts with exponential backoff)
  - User-friendly error messages (hide technical details)

---

### 4.5 Maintainability

#### NFR-MAINT-001: Code Quality
- **Requirement**: >95% test coverage for agent logic
- **Target**: 100% coverage for critical modules (geofencing, cost calculation)
- **Tools**: pytest (Python), Vitest (TypeScript)
- **CI/CD**: GitHub Actions (run tests on every PR)

#### NFR-MAINT-002: Documentation
- **Requirement**: Comprehensive documentation for agents and APIs
- **Deliverables**:
  - API documentation (OpenAPI/Swagger)
  - Agent developer guide (Claude SDK integration)
  - User manual (PDF + web)
  - Database schema documentation (ERD diagrams)

#### NFR-MAINT-003: Monitoring & Observability
- **Requirement**: Real-time visibility into agent operations
- **Tools**:
  - Vercel Analytics (frontend performance)
  - Sentry (error tracking)
  - Prometheus + Grafana (agent metrics)
  - Custom dashboard (job queue status, processing times)

---

## 5. Technical Architecture

### 5.1 System Components

#### Component Diagram:
```
┌─────────────────────────────────────────────────────────────┐
│                     FibreFlow Web UI                         │
│                  (Next.js 14 + React 18)                     │
│                                                              │
│  Pages:                                                      │
│  - /vehicles                   (Vehicle list)               │
│  - /vehicles/[id]              (Vehicle details)            │
│  - /vehicles/[id]/upload       (GPS file upload)            │
│  - /vehicles/[id]/investigations/[jobId] (Dashboard)        │
│  - /reports                    (Report library)             │
│  - /fleet-dashboard            (Fleet overview)             │
└──────────────┬──────────────────────────────────────────────┘
               │
               │ HTTP + WebSocket
               │
┌──────────────▼──────────────────────────────────────────────┐
│              Next.js API Routes (Backend)                    │
│                                                              │
│  Endpoints:                                                  │
│  - /api/vehicles/*             (CRUD vehicles)              │
│  - /api/vehicles/[id]/upload-gps (File upload)              │
│  - /api/jobs/*                 (Job management)             │
│  - /api/reports/*              (Report access)              │
│  - /api/websocket              (Progress streaming)         │
└──────────────┬──────────────────────────────────────────────┘
               │
        ┌──────┼──────┐
        │      │      │
┌───────▼──┐ ┌▼──────▼────┐ ┌──────────────┐
│ Neon DB  │ │ Bull Queue  │ │ Vercel Blob  │
│ Postgres │ │   (Redis)   │ │ (File Store) │
└──────────┘ └─────┬───────┘ └──────────────┘
                   │
                   │ Job Trigger
                   │
        ┌──────────▼──────────────┐
        │  Vehicle Investigation  │
        │  Autonomous Agent       │
        │  (Claude SDK + Python)  │
        │                         │
        │  - GPS Parser           │
        │  - Geofencing Engine    │
        │  - POI Enrichment       │
        │  - Pattern Detector     │
        │  - Report Generator     │
        └─────────────────────────┘
```

---

### 5.2 Technology Stack

#### Frontend:
- **Framework**: Next.js 14+ (App Router)
- **UI Library**: React 18 + TypeScript
- **Styling**: TailwindCSS + shadcn/ui components
- **Maps**: Leaflet.js or Mapbox GL JS
- **Charts**: Recharts or Chart.js
- **Forms**: React Hook Form + Zod validation
- **State**: Zustand (lightweight state management)

#### Backend:
- **API**: Next.js API Routes (App Router)
- **Database**: Neon PostgreSQL (serverless)
- **ORM**: Drizzle ORM (TypeScript-first)
- **Auth**: Clerk (OAuth + session management)
- **File Storage**: Vercel Blob or AWS S3
- **Job Queue**: Bull (Redis-backed)
- **WebSocket**: Socket.io or Vercel Edge Runtime

#### Agent System:
- **Language**: Python 3.11+
- **Framework**: Claude Agent SDK (anthropic library)
- **Libraries**:
  - pandas (GPS data parsing)
  - aiohttp (async HTTP requests)
  - geopy (geofencing calculations)
  - reportlab (PDF generation)
  - pytest (testing)
- **Deployment**: Docker container + fly.io or Railway
- **Monitoring**: Sentry (error tracking)

#### Infrastructure:
- **Hosting**: Vercel (frontend + API)
- **Database**: Neon (PostgreSQL)
- **Cache**: Vercel KV (Redis)
- **Agent Runtime**: fly.io or Railway (Docker)
- **CI/CD**: GitHub Actions
- **Monitoring**: Vercel Analytics + Sentry

---

### 5.3 Data Flow

#### GPS Processing Workflow:
```
1. User uploads GPS Excel file
   ↓
2. Next.js API validates file (size, format)
   ↓
3. Upload file to Vercel Blob
   ↓
4. Create gps_processing_job record (status: 'pending')
   ↓
5. Add job to Bull queue
   ↓
6. Bull worker triggers Claude Agent SDK
   ↓
7. Agent executes autonomous investigation:
   a. Download GPS file from Blob
   b. Parse GPS data (pandas + fuzzy column matching)
   c. Classify trips (geofencing with haversine)
   d. Enrich with POI data (async Nominatim API)
   e. Detect patterns (statistical analysis)
   f. Calculate costs (fuel + depreciation)
   g. Generate reports (PDF, HTML, CSV)
   h. Upload reports to Blob
   i. Insert trips, POI, cost summaries to database
   ↓
8. Update job status to 'completed'
   ↓
9. Agent streams progress to WebSocket (10%, 30%, 50%, 75%, 90%, 100%)
   ↓
10. Send email notification to user
   ↓
11. User views dashboard and downloads reports
```

---

### 5.4 Database Schema (Complete)

#### Entity Relationship Diagram:
```
┌─────────────────┐
│    vehicles     │ 1 ──────┐
│  (id, reg, ...)│          │ N
└─────────────────┘          │
                             │
                  ┌──────────▼────────────┐
                  │ authorized_locations  │
                  │  (id, vehicle_id, ...)│
                  └───────────────────────┘

┌─────────────────┐
│    vehicles     │ 1 ──────┐
│  (id, reg, ...)│          │ N
└─────────────────┘          │
                  ┌──────────▼──────────────┐
                  │  gps_processing_jobs    │
                  │   (id, vehicle_id, ...)│
                  └──────────┬──────────────┘
                             │ 1
                             │
                             │ N
                  ┌──────────▼──────────────┐
                  │       trips             │
                  │  (id, job_id, ...)      │
                  └──────────┬──────────────┘
                             │ 1
                             │
                             │ N
                  ┌──────────▼──────────────┐
                  │      trip_poi           │
                  │  (id, trip_id, ...)     │
                  └─────────────────────────┘

┌─────────────────┐
│ gps_processing_ │ 1 ──────┐
│     jobs        │          │ 1
│  (id, ...)      │          │
└─────────────────┘   ┌──────▼──────────────┐
                      │   cost_summaries    │
                      │  (id, job_id, ...)  │
                      └─────────────────────┘
```

#### Key Tables Summary:
1. **vehicles** (50 rows in MVP): Vehicle registry
2. **authorized_locations** (200 rows in MVP): Geofencing zones (avg 4 per vehicle)
3. **gps_processing_jobs** (500 rows/month): Processing job tracking
4. **trips** (50,000 rows/month): Individual trip records (avg 100 per job)
5. **trip_poi** (100,000 rows/month): POI enrichment data (2 per trip)
6. **cost_summaries** (500 rows/month): Financial analysis per job

---

## 6. Implementation Plan

### 6.1 Development Phases

#### Phase 1: MVP (4 weeks) - Essential Features
**Goal:** Core vehicle tracking and autonomous reporting

**Week 1: Database & Vehicle Management**
- [ ] Design and implement database schema (Drizzle migrations)
- [ ] Create Vehicle CRUD API endpoints
- [ ] Build vehicle management UI (list, create, edit)
- [ ] Implement authorized locations management

**Week 2: File Upload & Agent Integration**
- [ ] Implement GPS file upload (drag-and-drop UI)
- [ ] Set up Vercel Blob storage
- [ ] Create Bull queue system
- [ ] Package Python agent as Docker container
- [ ] Integrate Claude Agent SDK
- [ ] Deploy agent to fly.io or Railway

**Week 3: Processing & Dashboard**
- [ ] Connect Next.js API to agent via Claude SDK
- [ ] Implement WebSocket for progress updates
- [ ] Build investigation dashboard UI
- [ ] Implement interactive map (Leaflet.js)
- [ ] Create trip timeline component
- [ ] Add summary statistics

**Week 4: Reporting & Testing**
- [ ] Implement PDF report generation (reportlab)
- [ ] Add email notifications (Resend or SendGrid)
- [ ] Create export functionality (CSV, HTML)
- [ ] Write integration tests (Vitest + pytest)
- [ ] Performance testing (Artillery)
- [ ] User acceptance testing (UAT)

**MVP Deliverables:**
- ✅ Vehicle registry with authorized locations
- ✅ GPS file upload with auto-detection
- ✅ Autonomous agent processing (Claude SDK)
- ✅ Investigation dashboard with map
- ✅ PDF reports with company branding
- ✅ Email notifications on completion

---

#### Phase 2: Enhanced Features (3 weeks)
**Goal:** Fleet management, cost analysis, and reporting

**Week 5: Fleet Dashboard & Analytics**
- [ ] Build fleet overview dashboard
- [ ] Implement cost breakdown charts
- [ ] Add pattern detection alerts UI
- [ ] Create monthly cost aggregation
- [ ] Implement vehicle comparison view

**Week 6: Advanced Reporting**
- [ ] Add custom date range filters
- [ ] Implement report library (historical reports)
- [ ] Create scheduled reports (monthly auto-generation)
- [ ] Add report sharing (email, download link)
- [ ] Implement report templates

**Week 7: User Management & Permissions**
- [ ] Implement role-based access control (RBAC)
- [ ] Create admin dashboard
- [ ] Add user invite system
- [ ] Implement audit logs
- [ ] Create usage analytics

**Phase 2 Deliverables:**
- ✅ Fleet-wide cost dashboard
- ✅ Advanced pattern detection
- ✅ Scheduled monthly reports
- ✅ Multi-user support with RBAC
- ✅ Historical report library

---

#### Phase 3: Optimization & Scale (2 weeks)
**Goal:** Performance, reliability, and scalability

**Week 8: Performance Optimization**
- [ ] Database query optimization (indexes, EXPLAIN)
- [ ] Implement Redis caching layer
- [ ] Optimize POI lookup batching
- [ ] Add CDN for static assets
- [ ] Implement lazy loading for large datasets

**Week 9: Reliability & Monitoring**
- [ ] Set up Sentry error tracking
- [ ] Create custom monitoring dashboard
- [ ] Implement job retry logic improvements
- [ ] Add dead letter queue monitoring
- [ ] Create alerting system (PagerDuty)

**Phase 3 Deliverables:**
- ✅ <3 minutes processing time (1,000 GPS points)
- ✅ 99.9% uptime
- ✅ Real-time monitoring dashboard
- ✅ Automated error recovery

---

### 6.2 Migration Strategy (BOSS → FibreFlow)

#### Step 1: Code Transfer
**Action:** Copy Python agent logic to FibreFlow repository

```bash
# Create FibreFlow agent directory
mkdir -p agents/vehicle-investigation-sdk

# Copy BOSS agent files
cp -r $BOSS_DIR/agents/vehicle/*.py agents/vehicle-investigation-sdk/
cp $BOSS_DIR/agents/vehicle/requirements.txt agents/vehicle-investigation-sdk/

# Copy test files
cp -r $BOSS_DIR/agents/vehicle/test_*.py tests/agents/vehicle/

# Copy skill documentation
cp $BOSS_DIR/.claude/skills/vehicle-investigation/SKILL.md docs/agents/vehicle-investigation-agent.md
```

#### Step 2: Adapt Agent for Claude SDK
**Action:** Wrap existing agent in Claude SDK framework

```python
# agents/vehicle-investigation-sdk/sdk_wrapper.py
from anthropic import Agent, Tool
from vehicle_investigation_agent import VehicleInvestigationAgent

class VehicleInvestigationSDKAgent(Agent):
    """Claude SDK wrapper for existing Python agent."""

    def __init__(self):
        super().__init__(name="vehicle-investigation", version="1.0.0")
        self.core_agent = VehicleInvestigationAgent()

    @Tool(name="run_investigation")
    async def run_investigation(self, job_id: str, config: dict) -> dict:
        """Execute full investigation workflow."""
        # Reuse existing agent methods
        self.core_agent.configure(**config)
        self.core_agent.parse_gps_data()
        self.core_agent.classify_trips()
        await self.core_agent.enrich_with_poi_data()
        patterns = self.core_agent.analyze_patterns()
        costs = self.core_agent.calculate_costs()
        reports = self.core_agent.generate_reports()

        return {
            'status': 'success',
            'trip_count': len(self.core_agent.trips),
            'patterns': [p.value for p in patterns],
            'costs': costs,
            'reports': reports
        }
```

#### Step 3: Database Schema Migration
**Action:** Generate Drizzle migrations from schema definitions

```bash
# Generate migrations
npm run db:generate

# Review generated SQL
# drizzle/migrations/0001_create_vehicle_tables.sql

# Apply migrations to Neon database
npm run db:migrate
```

#### Step 4: API Endpoint Creation
**Action:** Create Next.js API routes for vehicle management

```typescript
// app/api/vehicles/route.ts
import { db } from '@/lib/db';
import { vehicles } from '@/drizzle/schema/vehicles';

export async function POST(request: Request) {
  const data = await request.json();
  const vehicle = await db.insert(vehicles).values(data).returning();
  return Response.json(vehicle[0]);
}

export async function GET() {
  const allVehicles = await db.select().from(vehicles);
  return Response.json(allVehicles);
}
```

#### Step 5: UI Component Development
**Action:** Build React components for vehicle management

```typescript
// src/components/vehicles/VehicleList.tsx
'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';

export function VehicleList() {
  const [vehicles, setVehicles] = useState([]);

  useEffect(() => {
    fetch('/api/vehicles')
      .then(res => res.json())
      .then(data => setVehicles(data));
  }, []);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {vehicles.map(vehicle => (
        <Card key={vehicle.id}>
          <h3>{vehicle.registration}</h3>
          <p>{vehicle.vehicleType}</p>
          {/* ... */}
        </Card>
      ))}
    </div>
  );
}
```

#### Step 6: Agent Deployment
**Action:** Deploy Python agent to cloud platform

```bash
# Build Docker image
docker build -t vehicle-investigation-agent ./agents/vehicle-investigation-sdk

# Deploy to fly.io
flyctl deploy --dockerfile ./agents/vehicle-investigation-sdk/Dockerfile

# Or deploy to Railway
railway up --dockerfile ./agents/vehicle-investigation-sdk/Dockerfile
```

#### Step 7: Integration Testing
**Action:** Test end-to-end workflow

```bash
# Run integration tests
npm run test:integration

# Manual testing checklist:
# - Upload GPS file → Job created
# - Agent processes file → Progress updates via WebSocket
# - Dashboard displays results → Map, timeline, stats
# - Reports generated → PDF, CSV, HTML
# - Email notification sent → User receives link
```

---

### 6.3 Testing Strategy

#### Unit Tests (Target: >95% coverage)
**Python Agent:**
```bash
# Run pytest with coverage
pytest agents/vehicle-investigation-sdk/test_*.py --cov --cov-report=html
```

**Next.js API:**
```bash
# Run Vitest tests
npm run test
```

#### Integration Tests
**End-to-End Workflow:**
```typescript
// tests/integration/vehicle-investigation.test.ts
import { test, expect } from 'vitest';

test('complete vehicle investigation workflow', async () => {
  // 1. Create vehicle
  const vehicle = await createTestVehicle();

  // 2. Upload GPS file
  const uploadResult = await uploadGPSFile(vehicle.id, 'test-gps.xlsx');
  expect(uploadResult.jobId).toBeDefined();

  // 3. Wait for processing (poll job status)
  await waitForJobCompletion(uploadResult.jobId, { timeout: 60000 });

  // 4. Verify dashboard data
  const dashboardData = await fetchDashboardData(uploadResult.jobId);
  expect(dashboardData.trips.length).toBeGreaterThan(0);

  // 5. Verify reports generated
  const reports = await fetchReports(uploadResult.jobId);
  expect(reports.pdfUrl).toMatch(/\.pdf$/);
});
```

#### Load Testing
**Artillery Configuration:**
```yaml
# tests/load/vehicle-investigation.yml
config:
  target: 'https://fibreflow.vercel.app'
  phases:
    - duration: 300  # 5 minutes
      arrivalRate: 10  # 10 users per second
      name: "Sustained load"

scenarios:
  - name: "Vehicle investigation workflow"
    flow:
      - post:
          url: "/api/vehicles"
          json:
            registration: "TEST{{ $randomNumber() }}"
            vehicleType: "company"
      - post:
          url: "/api/vehicles/{{ id }}/upload-gps"
          formData:
            file: "@test-gps.xlsx"
      - get:
          url: "/api/jobs/{{ jobId }}"
          capture:
            - json: "$.status"
              as: "jobStatus"
```

---

## 7. Success Criteria & KPIs

### 7.1 MVP Success Metrics (Week 4)

#### Functional Completeness
- ✅ All P0 features implemented (vehicle registry, GPS upload, autonomous processing, dashboard, reports)
- ✅ 100% of critical user journeys working (Fleet Manager → upload → view report)
- ✅ Zero P0 bugs (blocking issues)

#### Performance
- ✅ Processing time: <5 minutes for 1,000 GPS points
- ✅ API response time: <500ms (p95)
- ✅ Dashboard load time: <3 seconds

#### Quality
- ✅ Test coverage: >95% for Python agent, >80% for Next.js API
- ✅ Zero critical security vulnerabilities (npm audit, Snyk scan)
- ✅ Accessibility: WCAG 2.1 Level AA compliance

---

### 7.2 Post-Launch KPIs (Months 1-6)

#### Adoption Metrics
- **Target**: 80% of fleet managers use system monthly
- **Measurement**: Unique users per month, active vehicle count
- **Success**: 40/50 vehicles have GPS files uploaded monthly

#### Usage Metrics
- **Target**: 200 investigations per month (avg 4 per vehicle)
- **Measurement**: gps_processing_jobs.count per month
- **Success**: Consistent 200+ jobs per month by Month 3

#### Accuracy Metrics
- **Target**: >95% POI classification accuracy
- **Measurement**: Manual review of 100 random POI results
- **Success**: <5% misclassified POI (e.g., "bar" labeled as "restaurant")

#### Efficiency Metrics
- **Target**: Save 4 hours per vehicle investigation (vs manual analysis)
- **Measurement**: User survey (time spent before vs after)
- **Success**: Average 80% time savings reported

#### Cost Metrics
- **Target**: <$50/month operational cost (50 vehicles)
- **Measurement**: Vercel + fly.io + Neon monthly bills
- **Success**: Total cost <$50/month consistently

---

## 8. Risks & Mitigation

### 8.1 Technical Risks

#### Risk 1: Claude Agent SDK Integration Complexity
**Probability:** Medium
**Impact:** High
**Description:** Wrapping existing Python agent in Claude SDK may require significant refactoring

**Mitigation:**
- Start with minimal SDK wrapper (delegate to existing agent methods)
- Incremental migration (keep standalone agent working in parallel)
- Consult Anthropic documentation and support
- Budget 1 extra week for SDK integration

---

#### Risk 2: POI API Rate Limiting
**Probability:** Medium
**Impact:** Medium
**Description:** Nominatim has 1 request/second limit; may throttle processing

**Mitigation:**
- Implement 1.1s delay between requests (already done in BOSS agent)
- POI caching (~40% hit rate reduces API calls)
- Fallback to coordinates-only if API fails
- Monitor API usage and add backup provider (Google Maps) if needed

---

#### Risk 3: Large File Processing Performance
**Probability:** Low
**Impact:** High
**Description:** GPS files with >10,000 points may exceed 5-minute processing target

**Mitigation:**
- Implement chunked processing (batch 1,000 rows at a time)
- Parallel POI lookups (max 50 concurrent)
- Database batch inserts (100 trips per insert)
- Load testing with 10,000+ point files

---

### 8.2 Business Risks

#### Risk 4: Low User Adoption
**Probability:** Medium
**Impact:** High
**Description:** Fleet managers may resist switching from Excel-based workflows

**Mitigation:**
- User training sessions (2-hour workshop)
- Video tutorials and user manual
- Champion user program (early adopters)
- Gather feedback and iterate quickly

---

#### Risk 5: Data Privacy Concerns
**Probability:** Low
**Impact:** High
**Description:** GPS tracking raises employee privacy concerns (POPIA compliance)

**Mitigation:**
- Legal review of data handling practices
- Transparent privacy policy (what data is stored, how long, who accesses)
- Role-based access control (restrict HR access)
- Data retention policy (auto-delete GPS files after 90 days)
- Audit logs for all data access

---

## 9. Open Questions

### 9.1 Technical Questions

1. **Claude Agent SDK Licensing:**
   - Is Claude Agent SDK free for commercial use?
   - What are usage limits (requests per month)?
   - **Decision needed by:** Week 1

2. **Cloud Platform Selection:**
   - fly.io vs Railway vs AWS Lambda for agent hosting?
   - Cost comparison for 500 jobs/month?
   - **Decision needed by:** Week 2

3. **Real-time Progress Updates:**
   - WebSocket vs Server-Sent Events (SSE) for progress streaming?
   - Does Vercel support WebSocket in Edge Runtime?
   - **Decision needed by:** Week 2

---

### 9.2 Business Questions

1. **Pricing Model:**
   - Free for internal use only?
   - Charge per vehicle per month?
   - Charge per investigation (pay-as-you-go)?
   - **Decision needed by:** Week 4 (post-MVP)

2. **Data Retention:**
   - How long to keep historical GPS data?
   - Archive vs delete after 90 days?
   - **Decision needed by:** Week 1

3. **Multi-Tenancy:**
   - Support multiple companies on same platform?
   - Data isolation strategy?
   - **Decision needed by:** Phase 2 (if applicable)

---

## 10. Appendices

### Appendix A: Glossary

- **GPS Tracking**: Vehicle location data collected by GPS devices
- **Geofencing**: Virtual geographic boundary (latitude, longitude, radius)
- **POI (Point of Interest)**: Named location (e.g., "Standard Bank Sandton")
- **Haversine Distance**: Great-circle distance calculation between two GPS coordinates
- **Nominatim API**: OpenStreetMap reverse geocoding service (free tier)
- **Claude Agent SDK**: Anthropic's framework for building autonomous AI agents
- **Drizzle ORM**: TypeScript-first database ORM
- **Bull Queue**: Redis-backed job queue for Node.js
- **Vercel Blob**: Serverless file storage (alternative to AWS S3)

---

### Appendix B: References

**BOSS Vehicle Investigation Agent:**
- Agent Implementation: `BOSS/agents/vehicle/vehicle_investigation_agent.py`
- Test Suite: `BOSS/agents/vehicle/test_vehicle_agent.py`
- Skill Documentation: `BOSS/.claude/skills/vehicle-investigation/SKILL.md`
- Test Status: `BOSS/agents/vehicle/TEST_STATUS.md`

**FibreFlow Architecture:**
- Project Context: `AI Workspace/CLAUDE.md`
- Tech Stack: Next.js 14+, Clerk, Drizzle ORM, Neon PostgreSQL
- Existing Patterns: SOW import functionality

**External Resources:**
- Claude Agent SDK: https://docs.anthropic.com/agent-sdk
- Nominatim API: https://nominatim.org/release-docs/latest/api/Overview/
- Drizzle ORM: https://orm.drizzle.team/
- Bull Queue: https://docs.bullmq.io/

---

### Appendix C: Sample Data

**Sample Vehicle Record:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "registration": "CL94BTZN",
  "vehicleType": "company",
  "ownerType": "Velocity Fibre",
  "status": "active",
  "make": "Toyota",
  "model": "Hilux",
  "year": 2022,
  "assignedTo": "Lenardt Meyer",
  "fuelRate": 2.50,
  "depreciationRate": 1.20,
  "authorizedLocations": [
    {
      "name": "Lawley Office",
      "lat": -26.2041,
      "lon": 28.0473,
      "radiusKm": 1.0,
      "locationType": "work_site"
    },
    {
      "name": "Technician Home",
      "lat": -26.1500,
      "lon": 28.1000,
      "radiusKm": 0.5,
      "locationType": "accommodation"
    }
  ]
}
```

**Sample Investigation Result:**
```json
{
  "jobId": "660e8400-e29b-41d4-a716-446655440001",
  "vehicleId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "summary": {
    "totalTrips": 45,
    "authorizedTrips": 29,
    "unauthorizedTrips": 16,
    "totalKm": 1247.5,
    "unauthorizedKm": 847.3,
    "unauthorizedPercentage": 35.8,
    "totalCost": 2345.67,
    "unauthorizedCost": 1134.50
  },
  "patterns": [
    "HIGH_WEEKEND_USAGE",
    "SUSPICIOUS_POI",
    "FREQUENT_UNAUTHORIZED_LOCATION"
  ],
  "reports": {
    "pdfUrl": "https://blob.vercel-storage.com/reports/660e8400.pdf",
    "csvUrl": "https://blob.vercel-storage.com/reports/660e8400.csv",
    "htmlUrl": "https://blob.vercel-storage.com/reports/660e8400.html"
  }
}
```

---

## 11. Approval & Sign-off

**Document Prepared By:**
Claude Code (AI Assistant) + Hein van Vuuren (Product Owner)

**Approval Required From:**
- [ ] Product Owner (Hein van Vuuren)
- [ ] Technical Lead (TBD)
- [ ] Finance Manager (Cost approval)
- [ ] Legal/Compliance (POPIA review)

**Next Steps After Approval:**
1. Create GitHub repository branch: `feature/vehicle-management`
2. Set up project board with Phase 1 tasks
3. Assign engineering resources
4. Schedule kick-off meeting (Week 1 Day 1)
5. Begin implementation (Week 1 Day 2)

---

**END OF DOCUMENT**

**Document Version:** 1.0.0
**Date:** 2026-01-13
**Status:** Draft - Awaiting Approval
**Total Pages:** 47
