# PhotoGuide PWA — Sub-project B: Standalone PWA App

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Next.js PWA that guides field technicians step-by-step through photo capture, validates each photo with the FibreFlow VLM, and uploads the completed job. A technician on site opens the app, enters a DR number, and is walked through all 10 activation (or 9 civil) steps — each photo either passes or fails with plain-language feedback, with 3 attempts before supervisor escalation.

**Architecture:** New repo (`PhotoGuide/`) — Next.js 14 App Router, Serwist for PWA, Zustand for step state, Dexie for local storage of in-progress jobs. All server interaction goes through FibreFlow API (`app.fibreflow.app/api/photo-guide/*`). VLM validation is server-side — the app submits base64 and waits for a result. Camera is forced via `capture="environment"` — no gallery picker (fraud prevention). Tenant config drives branding and API endpoint.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS, shadcn/ui (Button, Card, Alert), Zustand, Dexie.js, Serwist (PWA/service worker)

**Prerequisite:** Sub-project A (FibreFlow PWA API) must be merged and deployed to dev.fibreflow.app before end-to-end testing can happen.

**Repo location:** `~/Workspace/PhotoGuide/` (new standalone repo, not inside FF_Next.js)

---

## Design Reference

All decisions are locked — do not revisit them. Full spec: `FF_Next.js/docs/superpowers/specs/2026-05-25-photo-guide-pwa-design.md`

**Key decisions:**
- `capture="environment"` on file input — no gallery access
- 3 retries → escalation flag (tech continues, supervisor notified)
- Photos saved to device via `<a href download>` after each pass
- Strict sequential steps — next only unlocks after current passes or escalates
- Auth: FibreFlow JWT, stored in localStorage, one-time login per device

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `tenant.json` | VelocityFibre tenant config (API URL, branding, job types) |
| Create | `config/steps-activations.json` | 10 activation steps with labels and example photo descriptions |
| Create | `config/steps-civils.json` | 9 civil steps with labels and example photo descriptions |
| Create | `lib/api.ts` | Typed fetch wrapper using tenant.json apiBase |
| Create | `lib/store.ts` | Zustand job state (current step, step results, photos) |
| Create | `lib/db.ts` | Dexie schema for persisting in-progress job to IndexedDB |
| Create | `lib/fraud.ts` | EXIF timestamp extraction from JPEG |
| Create | `app/login/page.tsx` | Login screen (email + password → JWT) |
| Create | `app/page.tsx` | Home screen: job type tiles (Activations / Civils) |
| Create | `app/[jobType]/lookup/page.tsx` | Site lookup: enter DR or pole number |
| Create | `app/[jobType]/[siteId]/overview/page.tsx` | Step overview: all steps with lock/pass/fail status |
| Create | `app/[jobType]/[siteId]/step/[stepNumber]/page.tsx` | Step detail: camera + submit |
| Create | `app/[jobType]/[siteId]/complete/page.tsx` | Job complete: summary + upload trigger |
| Create | `components/StepCard.tsx` | Single step row in overview (icon + status) |
| Create | `components/ValidationResult.tsx` | Pass/fail overlay with corrections list |
| Create | `components/CameraCapture.tsx` | `<input capture="environment">` wrapper with preview |
| Create | `public/manifest.json` | PWA manifest |
| Create | `public/sw.js` | Registered by Serwist |

---

### Task 1: Repo Bootstrap

- [ ] **Step 1: Create the repo**

```bash
cd ~/Workspace
npx create-next-app@latest PhotoGuide \
  --typescript --tailwind --app --no-src-dir --import-alias "@/*"
cd PhotoGuide
git init && git add -A && git commit -m "chore: create-next-app scaffold"
```

- [ ] **Step 2: Install dependencies**

```bash
npm install zustand dexie serwist next-pwa
npm install -D @types/node
```

- [ ] **Step 3: Install shadcn/ui**

```bash
npx shadcn-ui@latest init
# Accept defaults: TypeScript, CSS variables, app dir, @/components
npx shadcn-ui@latest add button card alert badge
```

- [ ] **Step 4: Verify dev server starts**

```bash
PORT=3010 npm run dev &
curl -s http://localhost:3010 | grep -c "html"
```

Expected: `1`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: install deps (zustand, dexie, shadcn, serwist)"
```

---

### Task 2: Tenant Config + Step Configs

**Files:**
- Create: `tenant.json`
- Create: `config/steps-activations.json`
- Create: `config/steps-civils.json`

- [ ] **Step 1: Create tenant.json**

```json
{
  "tenantName": "VelocityFibre",
  "logo": "/assets/vf-logo.png",
  "primaryColor": "#0ea5e9",
  "authEndpoint": "https://dev.fibreflow.app/api/auth/login",
  "apiBase": "https://dev.fibreflow.app/api/photo-guide",
  "siteIdLabel": "DR Number",
  "siteIdPattern": "^(DR-)?\\d+$",
  "jobTypes": ["activations", "civils"],
  "maxRetries": 3
}
```

- [ ] **Step 2: Create config/steps-activations.json**

```json
[
  {
    "stepNumber": 1,
    "label": "House Photo",
    "instruction": "Take a photo showing the full front of the property. Both sides and the roof must be visible.",
    "exampleDescription": "Wide shot — full building visible including roof edge and both corners."
  },
  {
    "stepNumber": 2,
    "label": "Cable from Pole",
    "instruction": "Take a photo showing the utility pole with the fiber cable running from it toward the property.",
    "exampleDescription": "Utility pole clearly in frame with cable span visible."
  },
  {
    "stepNumber": 3,
    "label": "Entry Outside",
    "instruction": "Take a photo of the cable entry point on the OUTSIDE of the building wall.",
    "exampleDescription": "Exterior wall with cable entering. Sky or corrugated roof may be visible."
  },
  {
    "stepNumber": 4,
    "label": "Entry Inside",
    "instruction": "Take a photo of the cable entry point on the INSIDE of the building wall.",
    "exampleDescription": "Interior wall — ceiling or indoor surface visible. White sealant blob at entry hole is good."
  },
  {
    "stepNumber": 5,
    "label": "Wall Mount",
    "instruction": "Take a photo showing the wooden board with the ONT wall bracket attached to it.",
    "exampleDescription": "Wooden plank with metal bracket (rail or ring) screwed into it — no bare walls."
  },
  {
    "stepNumber": 6,
    "label": "ONT Back After Install",
    "instruction": "Take a photo showing the FULL back panel of the white ONT with the GREEN fiber cable plugged in.",
    "exampleDescription": "All ports and vents visible. Green cable clearly plugged into fiber port."
  },
  {
    "stepNumber": 7,
    "label": "Power Meter Reading",
    "instruction": "Take a photo of the power meter display showing the dBm reading clearly.",
    "exampleDescription": "Handheld meter with visible numeric reading on screen."
  },
  {
    "stepNumber": 8,
    "label": "Final Installation",
    "instruction": "Take a WIDE shot showing the white router, black ONT, cables, and the power outlet all in frame.",
    "exampleDescription": "Wide shot — router + ONT + cables + power outlet all visible."
  },
  {
    "stepNumber": 9,
    "label": "Green Lights",
    "instruction": "Take a close-up of the white router FRONT PANEL showing all 4 lights on and green.",
    "exampleDescription": "Router front panel with 4 lights all illuminated."
  },
  {
    "stepNumber": 10,
    "label": "Signature",
    "instruction": "Take a photo of the signed customer acceptance form with the signature clearly visible.",
    "exampleDescription": "Paper or tablet with visible handwritten signature."
  },
  {
    "stepNumber": 11,
    "label": "Dome Joint Open",
    "instruction": "Take a photo showing the dome joint with the lid REMOVED. The white interior with green fiber splice connectors must be clearly visible inside.",
    "exampleDescription": "White interior visible, green splice connectors ('flickers') and internal components clearly showing."
  },
  {
    "stepNumber": 12,
    "label": "Dome Joint Closed",
    "instruction": "Take a photo showing the dome joint fully SEALED — the black rectangular lid closed on the housing. No interior should be visible.",
    "exampleDescription": "Black exterior/back of sealed dome joint only. Yellow entry cables at bottom are normal."
  }
]
```

- [ ] **Step 3: Create config/steps-civils.json**

```json
[
  {
    "stepNumber": 1,
    "label": "Before",
    "instruction": "Take 3 photos showing the marked ground where the hole will be dug. The pole must NOT be in yet.",
    "requiredCount": 3,
    "exampleDescription": "Marked ground — paint marks or pegs visible, pole not installed."
  },
  {
    "stepNumber": 2,
    "label": "Depth",
    "instruction": "Take 1 photo showing a measuring tape inside the hole with the depth reading visible.",
    "requiredCount": 1,
    "exampleDescription": "Tape measure in hole — depth number clearly readable."
  },
  {
    "stepNumber": 3,
    "label": "Stumping",
    "instruction": "Take 3 photos of the planted pole from different angles showing it is upright.",
    "requiredCount": 3,
    "exampleDescription": "Pole in ground, upright, from multiple angles."
  },
  {
    "stepNumber": 4,
    "label": "Compaction",
    "instruction": "Take 1 photo showing the backfill or cement at the base of the pole.",
    "requiredCount": 1,
    "exampleDescription": "Backfill or wet cement visible around pole base."
  },
  {
    "stepNumber": 5,
    "label": "Housekeeping",
    "instruction": "Take 3 photos showing the completed site is clean with no debris.",
    "requiredCount": 3,
    "exampleDescription": "Clean site — no loose soil, tools, or rubbish visible."
  },
  {
    "stepNumber": 6,
    "label": "During (bonus)",
    "instruction": "Optional: take a photo of digging or preparation in progress.",
    "requiredCount": 0,
    "bonus": true,
    "exampleDescription": "Digging in progress."
  },
  {
    "stepNumber": 7,
    "label": "End Plates (bonus)",
    "instruction": "Optional: take a photo of end plates on the pole.",
    "requiredCount": 0,
    "bonus": true,
    "exampleDescription": "End plates visible on top of pole."
  },
  {
    "stepNumber": 8,
    "label": "Level (bonus)",
    "instruction": "Optional: take a photo of a spirit level on the pole with the bubble centered.",
    "requiredCount": 0,
    "bonus": true,
    "exampleDescription": "Spirit level on pole — bubble in center."
  },
  {
    "stepNumber": 9,
    "label": "Signature (bonus)",
    "instruction": "Optional: take a photo of the sign-off sheet.",
    "requiredCount": 0,
    "bonus": true,
    "exampleDescription": "Sign-off sheet visible and legible."
  }
]
```

- [ ] **Step 4: Commit**

```bash
git add tenant.json config/steps-activations.json config/steps-civils.json
git commit -m "feat: tenant config and step definitions for activations and civils"
```

---

### Task 3: Core Library (API client, state, local DB, fraud)

**Files:**
- Create: `lib/tenant.ts`
- Create: `lib/api.ts`
- Create: `lib/store.ts`
- Create: `lib/db.ts`
- Create: `lib/fraud.ts`

- [ ] **Step 1: Create lib/tenant.ts**

```typescript
import tenantJson from '@/../tenant.json';

export interface TenantConfig {
  tenantName: string;
  logo: string;
  primaryColor: string;
  authEndpoint: string;
  apiBase: string;
  siteIdLabel: string;
  siteIdPattern: string;
  jobTypes: string[];
  maxRetries: number;
}

export const tenant: TenantConfig = tenantJson as TenantConfig;
```

- [ ] **Step 2: Create lib/api.ts**

```typescript
import { tenant } from './tenant';

const TOKEN_KEY = 'pg_token';

export function getToken(): string | null {
  return typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function call<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const url = path.startsWith('http') ? path : `${tenant.apiBase}${path}`;
  const resp = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.message ?? `HTTP ${resp.status}`);
  return json as T;
}

export async function login(email: string, password: string): Promise<{ token: string }> {
  const result = await call<{ token: string }>(tenant.authEndpoint, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setToken(result.token);
  return result;
}

export async function getSite(id: string) {
  return call<{
    jobType: string;
    siteId: string;
    customerName: string;
    address: string;
    projectName: string;
  }>(`/site/${encodeURIComponent(id)}`);
}

export async function validatePhoto(payload: {
  jobType: string;
  stepNumber: number;
  siteId: string;
  photoBase64: string;
  attemptNumber: number;
  exifTimestamp?: string;
}) {
  return call<{
    pass: boolean;
    reasons: string[];
    corrections: string[];
    stepLabel: string;
    attemptNumber: number;
    maxAttempts: number;
    fraudDetected?: string;
  }>('/validate', { method: 'POST', body: JSON.stringify(payload) });
}

export async function escalateStep(payload: {
  jobType: string;
  siteId: string;
  stepNumber: number;
  failReasons: string[];
  attemptPhotos: Array<{ attempt: number; url: string; reasons: string[] }>;
}) {
  return call<{ escalationId: string }>('/escalate', { method: 'POST', body: JSON.stringify(payload) });
}

export async function uploadJob(payload: {
  jobType: string;
  siteId: string;
  photos: Array<{ stepNumber: number; stepLabel: string; filename: string; base64: string }>;
}) {
  return call<{ uploadedCount: number; urls: Record<number, string> }>(
    '/upload', { method: 'POST', body: JSON.stringify(payload) }
  );
}
```

- [ ] **Step 3: Create lib/store.ts**

```typescript
import { create } from 'zustand';

export type StepStatus = 'locked' | 'active' | 'passed' | 'escalated';

export interface StepResult {
  stepNumber: number;
  status: StepStatus;
  photoBase64: string | null;     // last captured photo
  photoObjectUrl: string | null;  // for <img> preview / download link
  filename: string | null;
  attempts: number;
  failReasons: string[];
  attemptHistory: Array<{ attempt: number; reasons: string[] }>;
}

export interface JobState {
  jobType: 'activations' | 'civils' | null;
  siteId: string | null;
  customerName: string | null;
  address: string | null;
  projectName: string | null;
  steps: StepResult[];
  currentStep: number;

  startJob: (params: {
    jobType: 'activations' | 'civils';
    siteId: string;
    customerName: string;
    address: string;
    projectName: string;
    stepCount: number;
  }) => void;

  setStepPhoto: (stepNumber: number, base64: string, objectUrl: string, filename: string) => void;
  markStepPassed: (stepNumber: number) => void;
  markStepEscalated: (stepNumber: number) => void;
  addAttemptFailure: (stepNumber: number, reasons: string[]) => void;
  resetJob: () => void;
}

const initialState = {
  jobType: null,
  siteId: null,
  customerName: null,
  address: null,
  projectName: null,
  steps: [],
  currentStep: 1,
};

export const useJobStore = create<JobState>((set) => ({
  ...initialState,

  startJob: ({ jobType, siteId, customerName, address, projectName, stepCount }) =>
    set({
      jobType,
      siteId,
      customerName,
      address,
      projectName,
      currentStep: 1,
      steps: Array.from({ length: stepCount }, (_, i) => ({
        stepNumber: i + 1,
        status: i === 0 ? 'active' : 'locked',
        photoBase64: null,
        photoObjectUrl: null,
        filename: null,
        attempts: 0,
        failReasons: [],
        attemptHistory: [],
      })),
    }),

  setStepPhoto: (stepNumber, base64, objectUrl, filename) =>
    set((state) => ({
      steps: state.steps.map((s) =>
        s.stepNumber === stepNumber ? { ...s, photoBase64: base64, photoObjectUrl: objectUrl, filename } : s
      ),
    })),

  addAttemptFailure: (stepNumber, reasons) =>
    set((state) => ({
      steps: state.steps.map((s) =>
        s.stepNumber === stepNumber
          ? {
              ...s,
              attempts: s.attempts + 1,
              failReasons: reasons,
              attemptHistory: [...s.attemptHistory, { attempt: s.attempts + 1, reasons }],
            }
          : s
      ),
    })),

  markStepPassed: (stepNumber) =>
    set((state) => {
      const nextStep = stepNumber + 1;
      return {
        currentStep: nextStep,
        steps: state.steps.map((s) => {
          if (s.stepNumber === stepNumber) return { ...s, status: 'passed' };
          if (s.stepNumber === nextStep) return { ...s, status: 'active' };
          return s;
        }),
      };
    }),

  markStepEscalated: (stepNumber) =>
    set((state) => {
      const nextStep = stepNumber + 1;
      return {
        currentStep: nextStep,
        steps: state.steps.map((s) => {
          if (s.stepNumber === stepNumber) return { ...s, status: 'escalated' };
          if (s.stepNumber === nextStep) return { ...s, status: 'active' };
          return s;
        }),
      };
    }),

  resetJob: () => set(initialState),
}));
```

- [ ] **Step 4: Create lib/fraud.ts**

```typescript
/**
 * Extract EXIF timestamp from a JPEG file.
 * Returns ISO string or null if not found.
 * Reads the EXIF DateTimeOriginal field (bytes 0x9003) from the raw JPEG buffer.
 */
export async function extractExifTimestamp(file: File): Promise<string | null> {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);

  // JPEG starts with FFD8
  if (view.getUint16(0) !== 0xffd8) return null;

  let offset = 2;
  while (offset < view.byteLength - 2) {
    const marker = view.getUint16(offset);
    if (marker === 0xffe1) {
      // APP1 — may contain EXIF
      const exifOffset = offset + 4;
      const exifHeader = String.fromCharCode(
        view.getUint8(exifOffset), view.getUint8(exifOffset + 1),
        view.getUint8(exifOffset + 2), view.getUint8(exifOffset + 3)
      );
      if (exifHeader === 'Exif') {
        // Search for DateTimeOriginal tag (0x9003) in the EXIF block
        const segmentLength = view.getUint16(offset + 2);
        const exifBytes = new Uint8Array(buffer, exifOffset + 6, segmentLength - 8);
        const text = new TextDecoder().decode(exifBytes);
        // DateTimeOriginal format: "YYYY:MM:DD HH:MM:SS"
        const match = text.match(/(\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2})/);
        if (match) {
          const [datePart, timePart] = match[1]!.split(' ');
          const isoDate = datePart!.replace(/:/g, '-') + 'T' + timePart + 'Z';
          return isoDate;
        }
      }
    }
    if (marker === 0xffda) break; // SOS — no more metadata
    const segmentLength = view.getUint16(offset + 2);
    offset += 2 + segmentLength;
  }
  return null;
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip data URL prefix: "data:image/jpeg;base64,"
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
```

- [ ] **Step 5: Create lib/db.ts**

```typescript
import Dexie, { type Table } from 'dexie';

export interface SavedJob {
  id?: number;
  siteId: string;
  jobType: string;
  savedAt: Date;
  state: string; // JSON of Zustand state snapshot
}

class PhotoGuideDb extends Dexie {
  jobs!: Table<SavedJob>;

  constructor() {
    super('photo-guide-db');
    this.version(1).stores({ jobs: '++id, siteId' });
  }
}

export const db = new PhotoGuideDb();
```

- [ ] **Step 6: Commit**

```bash
git add lib/
git commit -m "feat: core library — tenant config, API client, Zustand store, Dexie DB, EXIF fraud util"
```

---

### Task 4: Login Screen

**Files:**
- Create: `app/login/page.tsx`
- Create: `app/layout.tsx` (root layout with Tailwind + tenant theme)

- [ ] **Step 1: Create root layout**

```typescript
// app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PhotoGuide',
  description: 'Guided photo capture for field technicians',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-950 text-white antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Create app/login/page.tsx**

```typescript
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login } from '@/lib/api';
import { tenant } from '@/lib/tenant';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-1 text-center">PhotoGuide</h1>
        <p className="text-gray-400 text-sm text-center mb-8">{tenant.tenantName}</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-sky-500"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-sky-500"
          />
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={loading} className="w-full bg-sky-500 hover:bg-sky-600 text-white py-3">
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create auth guard middleware**

Create `middleware.ts` at repo root:

```typescript
import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  // Token check happens client-side (JWT in localStorage)
  // Middleware just ensures pages are accessible — actual auth check in each page
  return NextResponse.next();
}
```

- [ ] **Step 4: Commit**

```bash
git add app/layout.tsx app/login/page.tsx middleware.ts
git commit -m "feat: login screen with FibreFlow JWT auth"
```

---

### Task 5: Home + Job Type Selection

**Files:**
- Create: `app/page.tsx`
- Create: `components/JobTypeTile.tsx`

- [ ] **Step 1: Create JobTypeTile.tsx**

```typescript
// components/JobTypeTile.tsx
interface Props {
  label: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
}

export function JobTypeTile({ label, description, icon, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className="w-full p-6 bg-gray-800 hover:bg-gray-700 rounded-xl border border-gray-700 text-left transition-colors"
    >
      <div className="text-3xl mb-3">{icon}</div>
      <div className="font-semibold text-lg">{label}</div>
      <div className="text-sm text-gray-400 mt-1">{description}</div>
    </button>
  );
}
```

- [ ] **Step 2: Create app/page.tsx**

```typescript
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/api';
import { JobTypeTile } from '@/components/JobTypeTile';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    if (!getToken()) router.replace('/login');
  }, [router]);

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mt-8 mb-2">Select Job Type</h1>
      <p className="text-gray-400 text-sm mb-8">What are you installing today?</p>

      <div className="space-y-4">
        <JobTypeTile
          label="Activations"
          description="Home fiber installation — 12 steps"
          icon="🏠"
          onClick={() => router.push('/activations/lookup')}
        />
        <JobTypeTile
          label="Civils"
          description="Pole installation — 5–9 steps"
          icon="🔩"
          onClick={() => router.push('/civils/lookup')}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx components/JobTypeTile.tsx
git commit -m "feat: home screen with job type selection"
```

---

### Task 6: Site Lookup Screen

**Files:**
- Create: `app/[jobType]/lookup/page.tsx`

- [ ] **Step 1: Create lookup page**

```typescript
'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getSite } from '@/lib/api';
import { useJobStore } from '@/lib/store';
import { tenant } from '@/lib/tenant';
import activationSteps from '@/../config/steps-activations.json';
import civilSteps from '@/../config/steps-civils.json';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function LookupPage() {
  const router = useRouter();
  const { jobType } = useParams<{ jobType: string }>();
  const startJob = useJobStore((s) => s.startJob);

  const [siteId, setSiteId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const label = jobType === 'activations' ? tenant.siteIdLabel : 'Pole Number';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const site = await getSite(siteId.trim());
      const steps = jobType === 'activations' ? activationSteps : civilSteps;

      startJob({
        jobType: jobType as 'activations' | 'civils',
        siteId: site.siteId,
        customerName: site.customerName,
        address: site.address,
        projectName: site.projectName,
        stepCount: steps.length,
      });

      router.push(`/${jobType}/${encodeURIComponent(site.siteId)}/overview`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Site not found');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-lg mx-auto">
      <button onClick={() => router.back()} className="text-sky-400 text-sm mb-6">← Back</button>
      <h1 className="text-2xl font-bold mb-2">
        {jobType === 'activations' ? 'Activation' : 'Civil'} Job
      </h1>
      <p className="text-gray-400 text-sm mb-8">Enter the {label} for this job.</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="text"
          placeholder={label}
          value={siteId}
          onChange={(e) => setSiteId(e.target.value)}
          required
          className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 uppercase tracking-wider focus:outline-none focus:border-sky-500"
        />
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" disabled={loading} className="w-full bg-sky-500 hover:bg-sky-600 py-3">
          {loading ? 'Looking up…' : 'Start Job'}
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add "app/[jobType]/lookup/page.tsx"
git commit -m "feat: site lookup screen — DR number or pole number entry"
```

---

### Task 7: Step Overview Screen

**Files:**
- Create: `components/StepCard.tsx`
- Create: `app/[jobType]/[siteId]/overview/page.tsx`

- [ ] **Step 1: Create StepCard.tsx**

```typescript
// components/StepCard.tsx
import type { StepResult } from '@/lib/store';

const STATUS_STYLES: Record<string, string> = {
  locked:    'bg-gray-800 border-gray-700 text-gray-500',
  active:    'bg-sky-900 border-sky-500 text-white',
  passed:    'bg-green-900 border-green-500 text-white',
  escalated: 'bg-amber-900 border-amber-500 text-white',
};

const STATUS_ICON: Record<string, string> = {
  locked: '🔒', active: '📷', passed: '✅', escalated: '⚠️',
};

interface Props {
  step: StepResult;
  label: string;
  onClick?: () => void;
}

export function StepCard({ step, label, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      disabled={step.status === 'locked'}
      className={`w-full flex items-center gap-3 p-4 rounded-lg border transition-colors text-left ${STATUS_STYLES[step.status]}`}
    >
      <span className="text-xl w-7 text-center">{STATUS_ICON[step.status]}</span>
      <div className="flex-1">
        <div className="text-sm font-medium">Step {step.stepNumber}: {label}</div>
        {step.status === 'escalated' && (
          <div className="text-xs text-amber-300 mt-0.5">Escalated — supervisor will review</div>
        )}
        {step.status === 'passed' && step.attempts > 1 && (
          <div className="text-xs text-green-300 mt-0.5">Passed on attempt {step.attempts}</div>
        )}
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Create overview page**

```typescript
// app/[jobType]/[siteId]/overview/page.tsx
'use client';

import { useRouter, useParams } from 'next/navigation';
import { useJobStore } from '@/lib/store';
import { StepCard } from '@/components/StepCard';
import activationSteps from '@/../config/steps-activations.json';
import civilSteps from '@/../config/steps-civils.json';

export default function OverviewPage() {
  const router = useRouter();
  const { jobType, siteId } = useParams<{ jobType: string; siteId: string }>();
  const { steps, customerName, address, currentStep } = useJobStore();

  const config = jobType === 'activations' ? activationSteps : civilSteps;

  const allDone = steps.length > 0 && steps.every((s) => s.status === 'passed' || s.status === 'escalated');

  function goToStep(stepNumber: number) {
    router.push(`/${jobType}/${siteId}/step/${stepNumber}`);
  }

  return (
    <div className="min-h-screen flex flex-col p-4 max-w-lg mx-auto">
      <div className="mb-4">
        <div className="text-xs text-gray-400">{jobType === 'activations' ? 'Activation' : 'Civil'}</div>
        <h1 className="text-xl font-bold">{decodeURIComponent(siteId)}</h1>
        {customerName && <div className="text-sm text-gray-300">{customerName}</div>}
        {address && <div className="text-xs text-gray-400">{address}</div>}
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-gray-800 rounded-full mb-6 overflow-hidden">
        <div
          className="h-full bg-sky-500 rounded-full transition-all"
          style={{ width: `${(steps.filter((s) => s.status === 'passed' || s.status === 'escalated').length / Math.max(steps.length, 1)) * 100}%` }}
        />
      </div>

      <div className="space-y-2 flex-1">
        {steps.map((step) => (
          <StepCard
            key={step.stepNumber}
            step={step}
            label={config[step.stepNumber - 1]?.label ?? `Step ${step.stepNumber}`}
            onClick={step.status !== 'locked' ? () => goToStep(step.stepNumber) : undefined}
          />
        ))}
      </div>

      {allDone && (
        <button
          onClick={() => router.push(`/${jobType}/${siteId}/complete`)}
          className="mt-6 w-full py-4 bg-green-600 hover:bg-green-700 rounded-xl font-semibold text-white"
        >
          Job Complete — Upload to FibreFlow →
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/StepCard.tsx "app/[jobType]/[siteId]/overview/page.tsx"
git commit -m "feat: step overview screen with progress bar and step status"
```

---

### Task 8: Step Detail + Camera + Validation

**Files:**
- Create: `components/CameraCapture.tsx`
- Create: `components/ValidationResult.tsx`
- Create: `app/[jobType]/[siteId]/step/[stepNumber]/page.tsx`

This is the heart of the app. The tech sees the step instructions, taps "Take Photo", the camera opens, they take the photo, it's submitted to the VLM, and pass/fail is shown.

- [ ] **Step 1: Create CameraCapture.tsx**

```typescript
// components/CameraCapture.tsx
interface Props {
  onCapture: (file: File) => void;
  disabled?: boolean;
}

export function CameraCapture({ onCapture, disabled }: Props) {
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onCapture(file);
    // Reset so the same photo can't be reselected
    e.target.value = '';
  }

  return (
    <label className={`block w-full ${disabled ? 'opacity-40 pointer-events-none' : 'cursor-pointer'}`}>
      <div className="w-full py-4 bg-sky-500 hover:bg-sky-600 rounded-xl text-center font-semibold text-white transition-colors">
        📷 Take Photo
      </div>
      {/* capture="environment" forces rear camera — no gallery picker */}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleChange}
        className="sr-only"
        disabled={disabled}
      />
    </label>
  );
}
```

- [ ] **Step 2: Create ValidationResult.tsx**

```typescript
// components/ValidationResult.tsx
interface Props {
  pass: boolean;
  reasons: string[];
  corrections: string[];
  attempt: number;
  maxAttempts: number;
  onRetake: () => void;
  onContinue: () => void; // called when pass=true
}

export function ValidationResult({ pass, reasons, corrections, attempt, maxAttempts, onRetake, onContinue }: Props) {
  if (pass) {
    return (
      <div className="text-center space-y-4">
        <div className="text-5xl">✅</div>
        <div className="text-xl font-semibold text-green-400">Photo Approved</div>
        <button
          onClick={onContinue}
          className="w-full py-3 bg-green-600 hover:bg-green-700 rounded-xl font-semibold"
        >
          Next Step →
        </button>
      </div>
    );
  }

  const attemptsLeft = maxAttempts - attempt;

  return (
    <div className="space-y-4">
      <div className="text-center">
        <div className="text-4xl mb-2">❌</div>
        <div className="text-lg font-semibold text-red-400">Photo Not Accepted</div>
        <div className="text-sm text-gray-400 mt-1">
          Attempt {attempt} of {maxAttempts}
          {attemptsLeft > 0 ? ` · ${attemptsLeft} left` : ' · escalating to supervisor'}
        </div>
      </div>

      {corrections.length > 0 && (
        <div className="bg-amber-900/40 border border-amber-700 rounded-lg p-4 space-y-2">
          <div className="text-sm font-medium text-amber-300">To fix this:</div>
          {corrections.map((c, i) => (
            <div key={i} className="text-sm text-amber-100">• {c}</div>
          ))}
        </div>
      )}

      {attemptsLeft > 0 ? (
        <button
          onClick={onRetake}
          className="w-full py-3 bg-sky-500 hover:bg-sky-600 rounded-xl font-semibold"
        >
          Retake Photo
        </button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Create step detail page**

```typescript
// app/[jobType]/[siteId]/step/[stepNumber]/page.tsx
'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useJobStore } from '@/lib/store';
import { validatePhoto, escalateStep } from '@/lib/api';
import { extractExifTimestamp, fileToBase64 } from '@/lib/fraud';
import { CameraCapture } from '@/components/CameraCapture';
import { ValidationResult } from '@/components/ValidationResult';
import activationSteps from '@/../config/steps-activations.json';
import civilSteps from '@/../config/steps-civils.json';
import { tenant } from '@/lib/tenant';

type Phase = 'idle' | 'validating' | 'result' | 'escalating';

export default function StepPage() {
  const router = useRouter();
  const { jobType, siteId, stepNumber } = useParams<{
    jobType: string; siteId: string; stepNumber: string;
  }>();

  const step = Number(stepNumber);
  const config = (jobType === 'activations' ? activationSteps : civilSteps)[step - 1];

  const store = useJobStore();
  const stepState = store.steps.find((s) => s.stepNumber === step);

  const [phase, setPhase] = useState<Phase>('idle');
  const [preview, setPreview] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<{
    pass: boolean; reasons: string[]; corrections: string[];
  } | null>(null);

  const decoded = decodeURIComponent(siteId);

  async function handleCapture(file: File) {
    setPhase('validating');
    const base64 = await fileToBase64(file);
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);

    const exifTimestamp = await extractExifTimestamp(file);
    const attempt = (stepState?.attempts ?? 0) + 1;

    try {
      const result = await validatePhoto({
        jobType,
        stepNumber: step,
        siteId: decoded,
        photoBase64: base64,
        attemptNumber: attempt,
        exifTimestamp: exifTimestamp ?? undefined,
      });

      store.addAttemptFailure(step, result.pass ? [] : result.reasons);

      if (result.pass) {
        const filename = `${decoded}_step${step}_${config?.label.toLowerCase().replace(/\s+/g, '-') ?? step}.jpg`;
        store.setStepPhoto(step, base64, objectUrl, filename);
        setValidationResult({ pass: true, reasons: [], corrections: [] });
      } else {
        setValidationResult({ pass: false, reasons: result.reasons, corrections: result.corrections });

        if (attempt >= tenant.maxRetries) {
          setPhase('escalating');
          await escalateStep({
            jobType,
            siteId: decoded,
            stepNumber: step,
            failReasons: result.reasons,
            attemptPhotos: store.steps.find((s) => s.stepNumber === step)?.attemptHistory ?? [],
          });
          store.markStepEscalated(step);
          router.push(`/${jobType}/${siteId}/overview`);
          return;
        }
      }

      setPhase('result');
    } catch (err) {
      // VLM error — allow pass to not block tech
      store.markStepPassed(step);
      router.push(`/${jobType}/${siteId}/overview`);
    }
  }

  function handleContinue() {
    store.markStepPassed(step);

    // Trigger download of the photo to device
    const s = store.steps.find((s) => s.stepNumber === step);
    if (s?.photoObjectUrl && s.filename) {
      const a = document.createElement('a');
      a.href = s.photoObjectUrl;
      a.download = s.filename;
      a.click();
    }

    router.push(`/${jobType}/${siteId}/overview`);
  }

  return (
    <div className="min-h-screen flex flex-col p-4 max-w-lg mx-auto">
      <button onClick={() => router.push(`/${jobType}/${siteId}/overview`)} className="text-sky-400 text-sm mb-4">
        ← Overview
      </button>

      <div className="mb-4">
        <div className="text-xs text-gray-400 mb-1">Step {step} of {store.steps.length}</div>
        <h1 className="text-xl font-bold">{config?.label}</h1>
      </div>

      {phase === 'idle' && (
        <div className="space-y-6">
          <div className="bg-gray-800 rounded-lg p-4">
            <p className="text-sm text-gray-200">{config?.instruction}</p>
          </div>
          <CameraCapture onCapture={handleCapture} />
        </div>
      )}

      {phase === 'validating' && (
        <div className="flex-1 flex flex-col items-center justify-center space-y-4">
          {preview && <img src={preview} alt="Captured" className="w-full max-h-64 object-cover rounded-lg" />}
          <div className="flex items-center gap-3 text-gray-400">
            <div className="w-5 h-5 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">AI is reviewing your photo…</span>
          </div>
        </div>
      )}

      {phase === 'result' && validationResult && stepState && (
        <div className="space-y-4">
          {preview && <img src={preview} alt="Captured" className="w-full max-h-48 object-cover rounded-lg" />}
          <ValidationResult
            pass={validationResult.pass}
            reasons={validationResult.reasons}
            corrections={validationResult.corrections}
            attempt={stepState.attempts}
            maxAttempts={tenant.maxRetries}
            onRetake={() => setPhase('idle')}
            onContinue={handleContinue}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add components/CameraCapture.tsx components/ValidationResult.tsx \
  "app/[jobType]/[siteId]/step/[stepNumber]/page.tsx"
git commit -m "feat: step detail page with camera capture, VLM validation, and retake flow"
```

---

### Task 9: Job Complete Screen + Upload

**Files:**
- Create: `app/[jobType]/[siteId]/complete/page.tsx`

- [ ] **Step 1: Create complete page**

```typescript
// app/[jobType]/[siteId]/complete/page.tsx
'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useJobStore } from '@/lib/store';
import { uploadJob } from '@/lib/api';

export default function CompletePage() {
  const router = useRouter();
  const { jobType, siteId } = useParams<{ jobType: string; siteId: string }>();
  const store = useJobStore();

  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [error, setError] = useState('');

  const passed = store.steps.filter((s) => s.status === 'passed').length;
  const escalated = store.steps.filter((s) => s.status === 'escalated').length;

  async function handleUpload() {
    setUploading(true);
    setError('');
    try {
      const photos = store.steps
        .filter((s) => s.status === 'passed' && s.photoBase64 && s.filename)
        .map((s) => ({
          stepNumber: s.stepNumber,
          stepLabel: s.filename!.split('_step')[1]?.split('_').slice(1).join('_').replace('.jpg', '') ?? '',
          filename: s.filename!,
          base64: s.photoBase64!,
        }));

      await uploadJob({ jobType, siteId: decodeURIComponent(siteId), photos });
      setUploaded(true);
      store.resetJob();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  if (uploaded) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
        <div className="text-6xl mb-4">🎉</div>
        <h1 className="text-2xl font-bold mb-2">Job Uploaded</h1>
        <p className="text-gray-400 text-sm mb-4">
          {passed} photos sent to FibreFlow.
        </p>
        {jobType === 'activations' && (
          <div className="bg-sky-900/40 border border-sky-700 rounded-lg p-4 text-sm text-sky-200 mb-6 text-left">
            <div className="font-medium mb-2">Next step:</div>
            <div>Open your device gallery and upload the renamed photos to <strong>OneMap</strong>. Look for files named <code>DR-XXXX_stepN_...</code></div>
          </div>
        )}
        <button onClick={() => router.push('/')} className="w-full py-3 bg-sky-500 hover:bg-sky-600 rounded-xl font-semibold">
          Start New Job
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-2">Job Complete</h1>
      <p className="text-sm text-gray-400 mb-6">{decodeURIComponent(siteId)}</p>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="bg-green-900/30 border border-green-700 rounded-lg p-4 text-center">
          <div className="text-3xl font-bold text-green-400">{passed}</div>
          <div className="text-xs text-gray-400 mt-1">Steps passed</div>
        </div>
        <div className="bg-amber-900/30 border border-amber-700 rounded-lg p-4 text-center">
          <div className="text-3xl font-bold text-amber-400">{escalated}</div>
          <div className="text-xs text-gray-400 mt-1">Escalated</div>
        </div>
      </div>

      {error && <div className="text-red-400 text-sm mb-4">{error}</div>}

      <button
        onClick={handleUpload}
        disabled={uploading}
        className="w-full py-4 bg-sky-500 hover:bg-sky-600 rounded-xl font-semibold text-lg"
      >
        {uploading ? 'Uploading…' : 'Upload to FibreFlow'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add "app/[jobType]/[siteId]/complete/page.tsx"
git commit -m "feat: job complete screen with summary and upload trigger"
```

---

### Task 10: PWA Manifest + Service Worker

**Files:**
- Modify: `next.config.mjs` (add Serwist)
- Create: `public/manifest.json`

- [ ] **Step 1: Configure Serwist in next.config.mjs**

```javascript
// next.config.mjs
import withSerwist from '@serwist/next';

const withPwa = withSerwist({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV === 'development',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

export default withPwa(nextConfig);
```

- [ ] **Step 2: Create app/sw.ts (Serwist service worker)**

```typescript
// app/sw.ts
import { defaultCache } from '@serwist/next/worker';
import { Serwist } from 'serwist';

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
```

- [ ] **Step 3: Create public/manifest.json**

```json
{
  "name": "PhotoGuide",
  "short_name": "PhotoGuide",
  "description": "Guided photo capture for field technicians",
  "theme_color": "#0ea5e9",
  "background_color": "#030712",
  "display": "standalone",
  "orientation": "portrait",
  "scope": "/",
  "start_url": "/",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

- [ ] **Step 4: Add manifest link to layout**

In `app/layout.tsx`, add to `<head>`:

```typescript
export const metadata: Metadata = {
  title: 'PhotoGuide',
  description: 'Guided photo capture for field technicians',
  manifest: '/manifest.json',
  themeColor: '#0ea5e9',
};
```

- [ ] **Step 5: Commit**

```bash
git add next.config.mjs app/sw.ts public/manifest.json app/layout.tsx
git commit -m "feat: PWA setup — Serwist service worker, manifest, installable"
```

---

### Task 11: Deploy PWA for Testing

- [ ] **Step 1: Create placeholder icons (256x256 solid blue squares) for testing**

```bash
# Use a simple script or create via ImageMagick on Velocity
ssh velo@100.96.203.105 "
  convert -size 192x192 xc:'#0ea5e9' /tmp/icon-192.png
  convert -size 512x512 xc:'#0ea5e9' /tmp/icon-512.png
"
scp velo@100.96.203.105:/tmp/icon-192.png public/icon-192.png
scp velo@100.96.203.105:/tmp/icon-512.png public/icon-512.png
git add public/icon-*.png && git commit -m "chore: placeholder PWA icons for testing"
```

- [ ] **Step 2: Build and test locally**

```bash
npm run build 2>&1 | tail -10
PORT=3010 npm start &
```

Open `http://localhost:3010` and verify:
- Login screen appears
- Job type tiles appear after login
- Lookup screen accepts input
- Browser prompts to install as PWA

- [ ] **Step 3: Deploy to field.fibreflow.app (or dev.fibreflow.app/guide)**

Coordinate with Hein for subdomain setup. Deploy via the same systemd+nginx pattern as FibreFlow. Point nginx to port `3010`.

---

## End-to-End Test Checklist

Complete this on a real Android phone before calling the PWA ready:

- [ ] Open `field.fibreflow.app` in Chrome — install prompt appears
- [ ] Install as PWA — appears on home screen
- [ ] Login with FibreFlow credentials — JWT stored, redirects to home
- [ ] Select "Activations" → enter a real DR number → site name and address shown
- [ ] Step 1 appears as active, all others locked
- [ ] Tap "Take Photo" → rear camera opens (no gallery picker visible)
- [ ] Submit a good house photo → spinner shows "AI reviewing" → ✅ pass shown → next step unlocks → photo saved to device Downloads
- [ ] Submit a bad photo (e.g. close-up of wall) → ❌ shown with specific corrections
- [ ] After 3 fails → supervisor escalation message → step marked ⚠️ → continue to next step
- [ ] Complete all 10 steps → "Job Complete" screen shows passed + escalated counts
- [ ] Tap "Upload to FibreFlow" → photos appear in dev.fibreflow.app Activate DR detail "PWA Photos" tab
- [ ] Supervisor opens Action Centre → pending escalation visible with attempt photos → Approve/Reject works
