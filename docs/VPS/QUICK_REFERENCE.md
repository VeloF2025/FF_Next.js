# VPS Quick Reference

**Server:** 72.60.17.245
**URL:** https://app.fibreflow.app
**SSH:** `ssh root@72.60.17.245`

---

## Most Common Commands

### Quick Deploy Update
```bash
ssh root@72.60.17.245 "cd /var/www/fibreflow && git pull && npm ci && npm run build && pm2 restart fibreflow"
```

### View App Status
```bash
ssh root@72.60.17.245 "pm2 list"
```

### View Recent Logs
```bash
ssh root@72.60.17.245 "pm2 logs fibreflow --lines 50"
```

### Restart App
```bash
ssh root@72.60.17.245 "pm2 restart fibreflow"
```

### Check if App is Responding
```bash
curl https://app.fibreflow.app
```

---

## File Locations

| What | Where |
|------|-------|
| App Code | `/var/www/fibreflow/` |
| Environment | `/var/www/fibreflow/.env.production` |
| PM2 Config | `/var/www/fibreflow/ecosystem.config.js` |
| Nginx Config | `/etc/nginx/sites-available/fibreflow` |
| PM2 Logs | `/var/log/pm2/fibreflow-*.log` |
| Nginx Logs | `/var/log/nginx/fibreflow-*.log` |
| SSL Cert | `/etc/letsencrypt/live/app.fibreflow.app/` |

---

## Emergency Troubleshooting

### App is Down
```bash
ssh root@72.60.17.245
pm2 restart fibreflow
pm2 logs fibreflow
```

### 502 Bad Gateway
```bash
ssh root@72.60.17.245
pm2 list                    # Check if app is running
curl http://localhost:3005  # Test local port
pm2 restart fibreflow       # Restart if needed
systemctl restart nginx     # Restart nginx
```

### High Memory
```bash
ssh root@72.60.17.245
pm2 show fibreflow          # Check memory usage
pm2 restart fibreflow       # Restart to free memory
```

### Check Disk Space
```bash
ssh root@72.60.17.245
df -h
```

---

## Environment Differences

| | Vercel (www) | VPS (app) |
|---|---|---|
| **Domain** | www.fibreflow.app | app.fibreflow.app |
| **Provider** | Vercel | Hostinger VPS |
| **Management** | Automatic | Manual |
| **SSL** | Auto | Let's Encrypt |
| **Deployment** | Git push | SSH + commands |
| **Use Case** | Production | Testing/Staging |

---

## Password & Access

**SSH Password:** $VPS_SSH_PASSWORD
**Server:** root@72.60.17.245

*Keep this secure. Consider using SSH keys instead of passwords.*

---

## Support

Full documentation: `/docs/VPS/DEPLOYMENT.md`

Deployment date: November 3, 2025
