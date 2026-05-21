# WA Mention Poller

Polls the WhatsApp bridge SQLite store on the VPS (`72.61.197.178`) and
re-emits new messages from monitored groups to FibreFlow's
`/api/noc/wa-message` webhook, so DR/ONT mentions in non-maintenance
groups (pre_provision, admin, civil, ...) still flow into the maintenance
pipeline.

The Go bridge already POSTs maintenance + dr_submission groups directly;
this poller skips those JIDs by parsing the bridge's reload log.

## Deploy

Run on the bridge VPS (`72.61.197.178`):

```bash
# 1. Copy files into place
sudo mkdir -p /opt/wa-mention-poller
sudo cp poll.py /opt/wa-mention-poller/poll.py
sudo chmod +x /opt/wa-mention-poller/poll.py

# 2. Environment file (matches WA_BRIDGE_SECRET on FibreFlow)
sudo tee /etc/wa-mention-poller.env >/dev/null <<'EOF'
WA_BRIDGE_SECRET=<paste matching secret>
WEBHOOK_URL=https://dev.fibreflow.app/api/noc/wa-message
EOF
sudo chmod 600 /etc/wa-mention-poller.env

# 3. Systemd units
sudo cp wa-mention-poll.service /etc/systemd/system/
sudo cp wa-mention-poll.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wa-mention-poll.timer

# 4. Sanity check
sudo systemctl status wa-mention-poll.timer
sudo journalctl -u wa-mention-poll.service -n 50
```

## Operations

* Cursor file: `/var/lib/wa-mention-poller/cursor` (single line, ISO8601 UTC).
  Delete to replay the last `LOOKBACK_SECONDS` window on next fire.
* Manual run: `sudo systemctl start wa-mention-poll.service`
* Live tail: `sudo journalctl -u wa-mention-poll.service -f`
* Disable: `sudo systemctl disable --now wa-mention-poll.timer`
