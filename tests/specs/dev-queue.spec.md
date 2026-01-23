# Dev Queue Feature Test Specification

## Feature Overview
The dev-queue feature allows users to submit, vote on, and track feature requests through a Kanban board interface.

## Test Categories

### 1. Authentication Tests
- [ ] Unauthenticated users redirected to login
- [ ] Authenticated users can access dev-queue
- [ ] User permissions respected

### 2. Board Display Tests
- [ ] Columns display correctly
- [ ] Items grouped by status
- [ ] Vote counts accurate
- [ ] User vote status shown

### 3. Item Creation Tests
- [ ] Create new item with required fields
- [ ] Validation for empty title
- [ ] Priority levels work
- [ ] Item appears in Backlog column

### 4. Drag & Drop Tests
- [ ] Items draggable between columns
- [ ] Position saved correctly
- [ ] WIP limits enforced
- [ ] Optimistic updates work

### 5. Voting Tests
- [ ] Users can vote once per item
- [ ] Vote count updates immediately
- [ ] Cannot vote on own items
- [ ] Vote persists on refresh

### 6. API Tests
- [ ] GET /api/dev-queue returns board
- [ ] POST /api/dev-queue creates item
- [ ] PUT /api/dev-queue/[id] updates item
- [ ] POST /api/dev-queue/move changes position
- [ ] POST /api/dev-queue/vote toggles vote
