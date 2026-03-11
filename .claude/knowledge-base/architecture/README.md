# FibreFlow Architecture Documentation

Comprehensive architecture documentation with Mermaid diagrams for the FibreFlow Next.js application.

## Documentation Index

| Document | Description |
|----------|-------------|
| [System Overview](./system-overview.md) | High-level architecture, request flow, infrastructure |
| [Module Map](./module-map.md) | 38+ modules, relationships, import rules |
| [Client/Server Boundary](./client-server-boundary.md) | Bundling safety, Neon isolation |
| [External Integrations](./external-integrations.md) | VLM, WhatsApp, 1Map, Sage, QField |
| [Data Flow](./data-flow.md) | Key workflows, database schema |
| [Deployment](./deployment.md) | Servers, environments, deploy commands |

## Quick Reference

### Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│  CLIENT (Browser)                                           │
│  Pages → Components → Hooks → API Services (fetch)          │
├─────────────────────────────────────────────────────────────┤
│  SERVER (API Routes)                                        │
│  pages/api/*.ts → DB Services → Neon PostgreSQL             │
├─────────────────────────────────────────────────────────────┤
│  EXTERNAL SERVICES                                          │
│  VLM :8100 | WA :8081/:8083 | QField :8095 | 1Map | Sage    │
└─────────────────────────────────────────────────────────────┘
```

### Critical Rules

1. **Never import Neon from client code** - Use API services with fetch()
2. **Avoid barrel exports** - Use direct imports to prevent bundling issues
3. **Two drop tables** - `drops` (SOW) vs `qa_photo_reviews` (WhatsApp QA)
4. **All envs share prod DB** - Except dev uses `hein-dev` branch

### Environments

| Environment | URL | Port |
|-------------|-----|------|
| Production | app.fibreflow.app | 3000 |
| Dev | dev.fibreflow.app | 3005 |
| Local | localhost:3004 | 3004 |

> Staging retired 2026-03-11. `vf.fibreflow.app` redirects to production.

## Viewing Mermaid Diagrams

These documents contain Mermaid diagram syntax. To view rendered diagrams:

1. **GitHub** - Renders automatically in markdown preview
2. **VS Code** - Install "Mermaid Markdown Syntax Highlighting" extension
3. **Online** - Paste into [mermaid.live](https://mermaid.live)
4. **Claude Code** - Read the file and the diagrams are described in the text

## When to Reference

- **New feature development** → Start with Module Map
- **Debugging bundling errors** → Client/Server Boundary
- **External service issues** → External Integrations
- **Understanding workflows** → Data Flow
- **Deployment problems** → Deployment
- **Architecture overview** → System Overview
