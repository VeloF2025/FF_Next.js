# FibreFlow System Architecture

## High-Level Overview

```mermaid
graph TB
    subgraph "Client Layer"
        Browser[Browser/PWA]
        Mobile[Mobile App]
    end

    subgraph "Application Layer"
        Next[Next.js App<br/>Pages Router]
        API[API Routes<br/>/api/*]
    end

    subgraph "Data Layer"
        Neon[(Neon PostgreSQL<br/>Production DB)]
        Firebase[(Firebase Storage<br/>Legacy Files)]
    end

    subgraph "Velocity Server<br/>100.96.203.105"
        VLM[VLM Qwen3<br/>:8100]
        QField[QField Sync<br/>:8095]
        WAProxy[WA Feedback Proxy<br/>:8092]
        VFStorage[VF Storage<br/>:8091]
    end

    subgraph "VPS Server<br/>72.61.197.178"
        WAUnified[WA Unified Bridge<br/>:8083]
        WASender[WA Sender<br/>:8081]
        WABot[WA Command Bot<br/>:8086]
    end

    subgraph "External Services"
        OneMap[1Map GIS API]
        Sage[Sage ERP]
        Odoo[Odoo ERP]
        Resend[Resend Email]
        LiveKit[LiveKit Video]
    end

    Browser --> Next
    Mobile --> Next
    Next --> API
    API --> Neon
    API --> Firebase
    API --> VLM
    API --> QField
    API --> WAProxy
    WAProxy --> WAUnified
    API --> OneMap
    API --> Sage
    API --> Odoo
    API --> Resend
    Browser --> LiveKit
```

## Request Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant N as Next.js
    participant A as API Route
    participant S as Service Layer
    participant D as Neon DB

    C->>N: Page Request
    N->>C: SSR/CSR Page
    C->>A: API Call (fetch)
    A->>S: Service Method
    S->>D: SQL Query
    D->>S: Result
    S->>A: Formatted Response
    A->>C: JSON (ApiResponse)
```

## Key Infrastructure

| Component | Location | Port | Purpose |
|-----------|----------|------|---------|
| Next.js App | Velocity | 3000/3005/3006 | Main application |
| Neon PostgreSQL | Cloud | - | Primary database |
| VLM (Qwen3) | Velocity | 8100 | AI photo analysis |
| QField Sync | Velocity | 8095 | GIS sync webhook |
| WA Unified | VPS | 8083 | WhatsApp messaging |
| WA Sender | VPS | 8081 | Message sending |
| WA Command Bot | VPS | 8086 | Admin commands |

## Technology Stack

- **Frontend**: React 18, Next.js 14, TailwindCSS, Radix UI
- **State**: React Query (server), Zustand (client)
- **Database**: Neon PostgreSQL (serverless)
- **Auth**: Custom PostgreSQL-based (roles, permissions)
- **AI/ML**: Qwen3 VLM for photo extraction
- **Real-time**: LiveKit (video), HTTP polling (WhatsApp)
