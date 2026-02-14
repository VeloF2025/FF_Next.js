# Test Scenario: WA Agent

## Test Objective
Validate that the wa-agent can correctly diagnose WhatsApp Monitor issues and provide accurate troubleshooting guidance WITHOUT executing database modifications or service restarts.

## Test Scenario 1: Missing Drop Investigation

**User Request**: "Drop DR9999999 was posted to Lawley group this morning but isn't showing in the dashboard. Please investigate."

### Expected Deliverables

- [ ] **Diagnosis plan**
  - Query to check qa_photo_reviews table
  - Query to check invalid_drop_submissions (rejection log)
  - Commands to check WhatsApp bridge logs
  - Commands to check monitor service logs

- [ ] **Database queries provided**
  ```sql
  SELECT * FROM qa_photo_reviews WHERE drop_number = 'DR9999999';
  SELECT * FROM invalid_drop_submissions WHERE drop_number = 'DR9999999';
  ```

- [ ] **VPS commands provided**
  ```bash
  sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "grep 'DR9999999' /opt/velo-test-monitor/logs/whatsapp-bridge.log"
  sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "grep 'DR9999999' /opt/wa-monitor/prod/logs/wa-monitor-prod.log"
  ```

- [ ] **Possible causes identified**
  - Drop was rejected by validation (Mohadin only)
  - WhatsApp bridge didn't capture the message
  - Monitor service is down or errored
  - Drop was posted to wrong group (not monitored)
  - LID resolution issue (sender identification)

- [ ] **Next steps guidance**
  - How to manually add drop if needed
  - How to check service status
  - How to restart services safely

## Test Scenario 2: Validation System Question

**User Request**: "How does drop validation work? Which projects have it enabled?"

### Expected Deliverables

- [ ] **Validation system explanation**
  - Currently enabled only for Mohadin project
  - Uses valid_drop_numbers table as master list
  - Rejects drops NOT in the master list
  - Auto-replies to WhatsApp group on rejection

- [ ] **Query to check valid drops**
  ```sql
  SELECT project, COUNT(*) as count
  FROM valid_drop_numbers
  GROUP BY project;
  ```

- [ ] **Status confirmation**
  - Mohadin: ~22,140 valid drops loaded
  - Other projects: Validation disabled (all drops accepted)

- [ ] **How to sync valid drops**
  - Script location: scripts/sync-mohadin-valid-drops.js
  - Command: `node scripts/sync-mohadin-valid-drops.js`

## Test Scenario 3: Adding New Project

**User Request**: "We need to add Centurion project to WA Monitor. The group JID is 120363999999999999@g.us. Walk me through the process."

### Expected Deliverables

- [ ] **5-minute process outlined**
  1. Test in DEV first
  2. Edit /opt/wa-monitor/dev/config/projects.yaml
  3. Add project in YAML format
  4. Restart wa-monitor-dev
  5. Verify in logs

- [ ] **YAML format provided**
  ```yaml
  - name: Centurion
    enabled: true
    group_jid: "120363999999999999@g.us"
    description: "Centurion project description"
  ```

- [ ] **Commands provided**
  ```bash
  # Edit dev config
  sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "nano /opt/wa-monitor/dev/config/projects.yaml"

  # Restart dev service
  sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "systemctl restart wa-monitor-dev"

  # Monitor logs
  sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "tail -f /opt/wa-monitor/dev/logs/wa-monitor-dev.log"
  ```

- [ ] **Production deployment**
  - After dev testing succeeds
  - Edit /opt/wa-monitor/prod/config/projects.yaml
  - Use SAFE restart script: /opt/wa-monitor/prod/restart-monitor.sh

- [ ] **Critical warning about Python cache**
  - ALWAYS use /opt/wa-monitor/prod/restart-monitor.sh for production
  - NEVER use systemctl restart wa-monitor-prod (keeps stale .pyc cache)

- [ ] **Documentation update reminder**
  - Update CLAUDE.md "Monitored Groups" section

## Test Scenario 4: LID Bug Question

**User Request**: "I see 'submitted_by' showing a long number instead of phone number. Is this a LID bug?"

### Expected Deliverables

- [ ] **LID bug explanation**
  - LID = WhatsApp's Long ID format
  - Should be resolved to phone numbers by monitor
  - Bug was fixed Nov 13, 2025
  - Python cache issue caused it to persist

- [ ] **Check for LIDs query**
  ```sql
  SELECT drop_number, submitted_by, LENGTH(submitted_by) as len
  FROM qa_photo_reviews
  WHERE submitted_by IS NOT NULL AND LENGTH(submitted_by) > 11;
  ```

- [ ] **How to fix manually (if found)**
  1. Look up LID in WhatsApp database on VPS
  2. Update qa_photo_reviews with phone number
  3. Verify monitor code has fix
  4. Restart monitor with safe script (clears cache)

- [ ] **Prevention reminder**
  - Always use /opt/wa-monitor/prod/restart-monitor.sh for production restarts

## Test Constraints
- **DO NOT execute database modifications** - Provide queries only
- **DO NOT restart VPS services** - Provide commands only
- **DO NOT modify configuration files** - Describe process only
- **Output location**: .agent-os/testing/sandbox/wa-agent-test.md

## Evaluation Criteria

| Criterion | Weight | Pass/Fail |
|-----------|--------|-----------|
| Diagnostic accuracy | 30% | |
| Database query correctness | 25% | |
| VPS command accuracy | 20% | |
| Troubleshooting logic | 15% | |
| Knowledge of WA Monitor architecture | 10% | |

**Pass threshold**: 80% overall score

## Success Indicators
- ✅ Agent understands WA Monitor architecture (bridge → monitor → database)
- ✅ Agent knows which projects have validation enabled (Mohadin only)
- ✅ Agent provides correct database queries
- ✅ Agent provides correct VPS commands (SSH, service management)
- ✅ Agent warns about Python cache issue for production restarts
- ✅ Agent does NOT execute commands, only provides guidance
- ✅ Agent references correct file paths on VPS
