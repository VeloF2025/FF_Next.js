#!/bin/bash
# Cron wrapper: sync SharePoint photos to local storage
cd /home/hein/Workspace/FF_Next.js
/usr/bin/node scripts/sync-photos-to-local.js --limit 500
