# Minting a session for admin-only meeting endpoints

`/api/meetings/process/[id]`, `/api/meetings/extract-visual/[id]` and friends are
`admin`/`super_admin` only. To call them from the server, mint a short-lived
session, use it, then delete it.

## The trap

`withAuth` joins on **both** the session id and the token hash:

```sql
WHERE u.id = ${userId} AND s.id = ${sessionId} AND s.token_hash = ${tokenHash}
      AND s.expires_at > NOW() AND u.is_active = true
```

So `user_sessions.id` **must equal the JWT's `sessionId` claim**. Inserting the
row with `gen_random_uuid()` produces a valid-looking token that returns
`401 SESSION_INVALID` with no hint as to why.

## Where the secrets live (differs per environment)

| Env | `JWT_SECRET` | Hit |
|---|---|---|
| Production | `/home/velo/fibreflow-production/.env.local` | `http://localhost:3000` |
| Dev | `/home/velo/fibreflow-dev/.env.production` | `http://localhost:3005` |

Read the file directly. `JWT_SECRET` is **not** in `/proc/<pid>/environ` — Next.js
loads `.env*` at runtime, so it is absent from the launch environment.

Use `localhost`, not the public hostname: `app.fibreflow.app` sits behind
Cloudflare, which 403s non-browser user agents regardless of auth.

## Mint

```js
// mint.mjs — node built-ins only
import crypto from 'node:crypto';
const [secret, userId, email] = process.argv.slice(2);
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const sessionId = crypto.randomUUID();
const head = b64({ alg: 'HS256', typ: 'JWT' });
const body = b64({ sub: userId, email, role: 'super_admin', sessionId, iat: now, exp: now + 7200 });
const sig  = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
const token = `${head}.${body}.${sig}`;
console.log(JSON.stringify({
  token,
  hash: crypto.createHash('sha256').update(token).digest('hex'),
  sessionId,
}));
```

```bash
SECRET=$(grep -m1 '^JWT_SECRET=' /home/velo/fibreflow-production/.env.local | cut -d= -f2-)
DBURL=$(grep -m1 '^DATABASE_URL=postgresql.*localhost:5437' .claude/credentials.local.md | sed 's/^DATABASE_URL=//')
UID_=$(psql "$DBURL" -t -A -c "SELECT id FROM users WHERE role='super_admin' AND is_active=true LIMIT 1;")

node mint.mjs "$SECRET" "$UID_" "you@example.com" > /tmp/tok.json
H=$(python3 -c "import json;print(json.load(open('/tmp/tok.json'))['hash'])")
S=$(python3 -c "import json;print(json.load(open('/tmp/tok.json'))['sessionId'])")

# id = sessionId — this is the part that bites
psql "$DBURL" -q -c "INSERT INTO user_sessions (id,user_id,token_hash,expires_at,created_at,user_agent)
  VALUES ('$S','$UID_','$H', now()+interval '2 hours', now(), 'claude-video-review');"

TOKEN=$(python3 -c "import json;print(json.load(open('/tmp/tok.json'))['token'])")
curl -s -X POST "http://localhost:3000/api/meetings/process/<ID>" -H "Cookie: ff_auth_token=$TOKEN"
```

## Always clean up

```bash
psql "$DBURL" -q -c "DELETE FROM user_sessions WHERE user_agent='claude-video-review';"
```

Tag `user_agent` so the row is identifiable and the cleanup is precise. The
expiry is a safety net, not a cleanup strategy — a long-lived `super_admin`
session sitting in the table is a real credential.

**`kill -9` skips your cleanup trap.** If a long-running job is killed hard,
delete the row by hand afterwards.

Never echo the token or the secret into logs, PR bodies, or commit messages.
