# FibreFlow Deployment Guide - Created by Forge on 2026-02-14

## Safe Deployment Scripts

Three new scripts have been created to prevent the Feb 14 incident from recurring:

### 1. /scripts/safe-deploy.sh
Full deployment with atomic build swap, validation, and health checks.

### 2. /scripts/rollback.sh  
Emergency rollback to last known good build.

### 3. /scripts/verify-build.sh
Check build integrity independently.

## Usage

**Deploy:** `./scripts/safe-deploy.sh`
**Rollback:** `./scripts/rollback.sh`
**Verify:** `./scripts/verify-build.sh`

## Incident Report: Feb 14, 2026

**Timeline:** 19:37-19:41 (4 minutes)
**Cause:** .next directory deleted/corrupted
**Impact:** 18 restart cycles, complete outage
**Resolution:** Automated recovery + protective scripts

See full RCA in task #274.

