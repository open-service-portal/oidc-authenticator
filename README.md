# OIDC Authenticator

**A lightweight authentication daemon that runs on your laptop and handles OIDC login for backend services.**

## What is this?

OIDC Authenticator solves the problem of authenticating with backend services that aren't publicly accessible (e.g., on a private network). Instead of your backend needing a public URL for OAuth callbacks, this tool:

- Runs as a daemon on your laptop
- Opens `http://localhost:8000` when you want to log in
- Handles the OIDC flow locally
- Sends the tokens to your backend service

Think of it like `kubectl oidc-login` but for any backend service (Backstage, APIs, custom apps, etc.).

## Quick Start

### 1. Copy Configuration

```bash
cd oidc-authenticator
cp config.example.json config.json
```

Edit `config.json` with your OIDC provider and backend details:
```json
{
  "issuer": "https://login.spot.rackspace.com/",
  "clientId": "YOUR_CLIENT_ID",
  "organizationId": "org_xxxxx",
  "backendUrl": "https://your-backend.example.com"
}
```

### 2. Start Daemon

```bash
node bin/cli.js --daemon --verbose
```

You'll see:
```
✅ OIDC authenticator daemon running on http://localhost:8000
📤 Tokens will be sent to: https://your-backend.example.com
```

### 3. Log In

Open http://localhost:8000 in your browser and log in with your OIDC provider. Done!

## Usage

There are **two modes** of operation:

### 1. Daemon Mode (Recommended for Production)

**Use when:** You want the authenticator running continuously in the background.

```bash
# Start daemon
node bin/cli.js --daemon --verbose
```

**Behavior:**
- ✅ Server starts immediately and **doesn't block**
- ✅ Runs continuously, ready for multiple logins
- ✅ You manually open `http://localhost:8000` when you want to login
- ✅ Your app/frontend can trigger authentication via button/link
- ♾️ Stays running until you stop it (Ctrl+C)

**When to use:**
- Production integration with web apps
- Multiple authentication sessions
- Long-running development sessions

### 2. One-Time Mode (For Testing/Scripts)

**Use when:** You need a single authentication, then exit.

```bash
# One-time authentication (no --daemon flag)
node bin/cli.js \
  --issuer https://login.spot.rackspace.com/ \
  --client-id YOUR_CLIENT_ID \
  --backend-url https://backstage.example.com \
  --verbose
```

**Behavior:**
- ⏳ **Blocks** and waits for authentication to complete
- 🌐 **Automatically opens browser** to OIDC provider
- ✅ Completes authentication, outputs tokens
- 🚪 **Exits immediately** after success/failure
- ⏱️ Times out after 3 minutes

**When to use:**
- Testing authentication flow
- One-off token retrieval
- CI/CD pipelines
- Debugging

### Comparison

| Feature | Daemon Mode | One-Time Mode |
|---------|-------------|---------------|
| Command | `--daemon` | No `--daemon` flag |
| Blocks terminal? | ❌ No | ✅ Yes |
| Opens browser? | ❌ Manual | ✅ Auto |
| Multiple logins? | ✅ Yes | ❌ No |
| Timeout | None | 3 minutes |
| Use case | Production | Testing |

### Check if Daemon is Running

```bash
# Health check
curl http://localhost:8000/health

# Returns: {"status":"running","issuer":"https://..."}
```

### Without Configuration File

Both modes can use command-line arguments instead of `config.json`:

```bash
# Daemon mode
node bin/cli.js --daemon \
  --issuer https://login.spot.rackspace.com/ \
  --client-id YOUR_CLIENT_ID \
  --backend-url https://your-backend.example.com \
  --verbose

# One-time mode
node bin/cli.js \
  --issuer https://login.spot.rackspace.com/ \
  --client-id YOUR_CLIENT_ID \
  --backend-url https://your-backend.example.com \
  --verbose
```

## Backend Integration

### Overview

Your backend needs an endpoint to receive tokens from the OIDC Authenticator:

```
POST /api/auth/tokens
Content-Type: application/json

{
  "access_token": "eyJhbGci...",
  "id_token": "eyJhbGci...",
  "refresh_token": "v1.MRrt...",
  "token_type": "Bearer",
  "expires_in": 86400
}
```

### Frontend Integration

In your web frontend, add a login button that checks if the daemon is running:

```typescript
// Check if daemon is running
async function checkDaemonHealth(): Promise<boolean> {
  try {
    const response = await fetch('http://localhost:8000/health');
    const data = await response.json();
    return data.status === 'running';
  } catch {
    return false;
  }
}

// Trigger authentication
async function handleOIDCLogin() {
  const isDaemonRunning = await checkDaemonHealth();

  if (!isDaemonRunning) {
    // Show instructions to start daemon
    alert(
      'OIDC Authenticator is not running.\n\n' +
      'Please run:\n' +
      'oidc-authenticator --daemon'
    );
    return;
  }

  // Open authentication page in new window
  const authWindow = window.open('http://localhost:8000', '_blank');

  // Optional: Poll for completion and refresh page
  const pollInterval = setInterval(async () => {
    // Check if user is now authenticated
    const authenticated = await checkAuthStatus();
    if (authenticated) {
      clearInterval(pollInterval);
      window.location.reload();
    }
  }, 2000);
}
```

### Backend Implementation

Create an endpoint to receive tokens from the daemon:

```typescript
// Express example
import { Router } from 'express';

const router = Router();

router.post('/api/auth/tokens', async (req, res) => {
  const { access_token, id_token, refresh_token, expires_in } = req.body;

  // Store tokens associated with user
  // You might use the id_token to identify the user
  // and store in session or database

  try {
    // Example: Store in session
    req.session.oidcTokens = {
      accessToken: access_token,
      idToken: id_token,
      refreshToken: refresh_token,
      expiresAt: Date.now() + (expires_in * 1000)
    };

    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

### Example: Backstage Integration

For Backstage specifically, you would create a plugin endpoint:

```typescript
// packages/backend/src/plugins/cluster-auth.ts
export function createRouter(): Router {
  const router = Router();
  router.post('/api/cluster-auth/tokens', handleTokens);
  return router;
}
```

See `docs/` for more integration examples.

## How It Works

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   Your Laptop   │         │  OIDC Provider   │         │ Backend Server  │
│                 │         │ (Auth0/Okta/etc) │         │                 │
└─────────────────┘         └──────────────────┘         └─────────────────┘
        │                            │                            │
        │  1. Run daemon             │                            │
        │  (localhost:8000)          │                            │
        │                            │                            │
        │  2. Open localhost:8000    │                            │
        │─────────────┐              │                            │
        │             │              │                            │
        │  3. Redirect to OIDC       │                            │
        │────────────────────────────>                            │
        │                            │                            │
        │  4. User logs in           │                            │
        │<───────────────────────────>                            │
        │                            │                            │
        │  5. Redirect back          │                            │
        │<───────────────────────────│                            │
        │                            │                            │
        │  6. Exchange code for tokens                            │
        │─────────────┐              │                            │
        │             │              │                            │
        │  7. Send tokens to backend                              │
        │────────────────────────────────────────────────────────>│
        │                            │                            │
        │  8. Success!               │                            │
```

**Key Points:**
- Daemon runs on **your laptop** (not on backend server)
- Uses **PKCE** for security (no client secret needed)
- Works with **private backend** instances (no public URL required)
- Tokens sent directly to your backend service

## CLI Options

```
Options:
  --issuer <url>          OIDC issuer URL (required unless in config.json)
  --client-id <id>        OAuth client ID (required unless in config.json)
  --organization <id>     Organization ID (optional)
  --backend-url <url>     Backend URL (required for normal operation)
  --scopes <scopes>       Space-separated scopes (default: "openid profile email")
  --port <port>           Callback port (default: 8000)
  -d, --daemon            Run as daemon server (browser-initiated auth)
  --output <file>         Save tokens to file (optional, for debugging)
  -v, --verbose           Show detailed output
  --help                  Show this help message
```

## API Endpoints

### `GET /`
**Initiates authentication flow**

When browser hits this endpoint:
1. Generates fresh PKCE challenge
2. Creates state parameter
3. Redirects to OIDC provider authorization URL

**Response:** `302 Redirect` to OIDC provider

---

### `GET /?code=...&state=...`
**Callback endpoint**

Receives authorization code from OIDC provider:
1. Validates state parameter
2. Exchanges authorization code for tokens
3. Sends tokens to Backstage backend
4. Shows success page

**Response:** HTML success page (auto-closes after 3 seconds)

---

### `GET /health`
**Health check endpoint**

Returns daemon status. Used by Backstage frontend to check if daemon is running.

**Response:**
```json
{
  "status": "running",
  "issuer": "https://login.spot.rackspace.com/"
}
```

## Configuration

### Option 1: config.json (Recommended)

```json
{
  "issuer": "https://login.spot.rackspace.com/",
  "clientId": "YOUR_CLIENT_ID",
  "organizationId": "org_xxxxx",
  "backendUrl": "https://backstage.example.com",
  "callbackPort": 8000
}
```

### Option 2: Environment Variables

```bash
export OIDC_ISSUER_URL=https://login.spot.rackspace.com/
export OIDC_CLIENT_ID=YOUR_CLIENT_ID
export OIDC_ORGANIZATION_ID=org_xxxxx

oidc-authenticator --daemon --backend-url https://backstage.example.com
```

### Option 3: CLI Arguments

```bash
oidc-authenticator \
  --daemon \
  --issuer https://login.spot.rackspace.com/ \
  --client-id YOUR_CLIENT_ID \
  --organization org_xxxxx \
  --backend-url https://backstage.example.com \
  --verbose
```

## Examples

### Production: Daemon Mode

```bash
# 1. Start daemon (doesn't block)
cd oidc-authenticator
node bin/cli.js --daemon --verbose

# Output:
# ✅ OIDC authenticator daemon running on http://localhost:8000
# 📤 Tokens will be sent to: https://backstage.example.com

# 2. Terminal returns immediately - daemon runs in background
# 3. User opens http://localhost:8000 when ready to login
# 4. Daemon handles authentication and sends tokens to Backstage
# 5. Daemon stays running for next authentication
```

### Testing: One-Time Mode

```bash
# Run authentication (blocks until complete)
cd oidc-authenticator
node bin/cli.js \
  --issuer https://login.spot.rackspace.com/ \
  --client-id YOUR_CLIENT_ID \
  --backend-url https://your-backend.example.com \
  --verbose

# What happens:
# 1. Browser opens automatically to OIDC provider
# 2. You log in
# 3. Terminal shows: ✅ Tokens obtained successfully!
# 4. Script exits (tokens sent to backend)
```

### Debugging: Save Tokens to File

```bash
# One-time mode with file output
node bin/cli.js \
  --issuer https://login.spot.rackspace.com/ \
  --client-id YOUR_CLIENT_ID \
  --output /tmp/tokens.json \
  --verbose

# Tokens saved to /tmp/tokens.json instead of sent to backend
```

### Using Environment Variables

```bash
# Set once
export OIDC_ISSUER_URL=https://login.spot.rackspace.com/
export OIDC_CLIENT_ID=mwG3lUMV8KyeMqHe4fJ5Bb3nM1vBvRNa
export OIDC_ORGANIZATION_ID=org_xxxxx

# Then use without flags
node bin/cli.js --daemon --backend-url https://your-backend.example.com --verbose
```

### Custom Port

```bash
# If port 8000 is in use
node bin/cli.js --daemon --port 8080 --verbose

# Update your frontend to check http://localhost:8080/health
```

## Token Format

The daemon sends tokens to your backend in this format:

```json
{
  "access_token": "eyJhbGci...",
  "id_token": "eyJhbGci...",
  "refresh_token": "v1.MRrt...",
  "token_type": "Bearer",
  "expires_in": 86400,
  "scope": "openid profile email"
}
```

## Security Considerations

### 1. PKCE (Proof Key for Code Exchange)
- Protects against authorization code interception
- Uses SHA256 challenge method
- Fresh challenge generated for each authentication session
- No client secret needed

### 2. State Parameter
- Prevents CSRF attacks
- Random state generated per session
- Validated on callback

### 3. Localhost Only
- Server binds to `127.0.0.1`
- Not accessible from network
- OIDC provider must support `http://localhost:PORT` redirects

### 4. No Token Storage
- Tokens are never stored locally (unless `--output` used)
- Immediately sent to Backstage backend
- Kept in memory only during exchange process
- Cleared after successful transmission

### 5. Session Isolation
- Each authentication gets fresh PKCE/state
- Previous sessions don't interfere
- State mismatch blocks replay attacks

## Troubleshooting

### Port Already in Use

If port 8000 is already in use:

```bash
# Use different port
node bin/cli.js --daemon --port 8080 --verbose
```

Update your Backstage frontend to check `http://localhost:8080`.

### Daemon Not Running

From Backstage frontend, check health:

```javascript
fetch('http://localhost:8000/health')
  .then(r => r.json())
  .then(data => console.log(data))
  .catch(() => console.log('Daemon not running'));
```

Or from command line:

```bash
curl http://localhost:8000/health
```

Expected response:
```json
{"status":"running","issuer":"https://login.spot.rackspace.com/"}
```

### CORS Issues

**Good news:** No CORS configuration needed!

The daemon serves HTML pages directly - Backstage frontend only needs to:
1. Check `/health` endpoint (same-origin request from browser)
2. Open `/` in new window (navigation, not XHR - no CORS)

### Browser Didn't Open (Legacy Mode)

If using one-time auth mode and browser doesn't open automatically, the URL will be displayed in the terminal. Copy and paste it into your browser.

### Callback URL Mismatch

Ensure your OIDC provider has `http://localhost:8000` (or your custom port) in the allowed callback URLs list.

**Note:** Use `localhost`, not `127.0.0.1` - most OIDC providers require the `localhost` hostname.

### Token Exchange Failed

Check that:
1. Client ID is correct
2. OIDC issuer URL is correct (should end with `/`)
3. Network allows HTTPS connections to issuer
4. Organization ID is correct (if multi-tenant)

## Development

### Project Structure

```
oidc-authenticator/
├── bin/
│   └── cli.js              # CLI entry point
├── lib/
│   └── index.js            # Core OIDCAuthenticator class
├── docs/                   # Documentation
│   ├── README.md           # Documentation index
│   ├── architecture/       # Design documents
│   ├── guides/             # Installation & configuration
│   ├── research/           # Investigation notes & POCs
│   └── scripts/            # Helper scripts
├── config.json             # Configuration (gitignored)
├── config.example.json     # Configuration template
├── test-device-flow.js     # Device flow test script
├── test-oidc-login.js      # OIDC login test script (legacy)
├── package.json
└── README.md
```

### Testing Locally

#### Quick Test

```bash
# Terminal 1 - Start daemon
cd oidc-authenticator
node bin/cli.js --daemon --verbose

# Terminal 2 - Check health
curl http://localhost:8000/health

# Browser - Test authentication
open http://localhost:8000
```

#### Test Scripts

The project includes test scripts for different authentication flows:

```bash
# Test device flow (investigation script)
node test-device-flow.js

# Test OIDC login flow (legacy one-shot mode)
node test-oidc-login.js
```

**Note**: These test scripts were used during development to investigate different OIDC flows. The recommended production mode is daemon mode (see Quick Test above).

### Mock Backend Server

For testing without Backstage:

```javascript
// test-backend.js
const http = require('http');

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/cluster-auth/tokens') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      console.log('Received tokens:', JSON.parse(body));
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok' }));
    });
  }
}).listen(7007, () => {
  console.log('Mock backend on http://localhost:7007');
});
```

Then run daemon with:
```bash
node bin/cli.js --daemon --backend-url http://localhost:7007 --verbose
```

## Exit Codes

- `0` - Success (tokens obtained and sent)
- `1` - Error (authentication failed)
- `2` - User cancelled (Ctrl+C)

## Comparison with kubectl oidc-login

| Feature | oidc-authenticator | kubectl oidc-login |
|---------|-------------------|-------------------|
| **Purpose** | Backstage/general | Kubernetes-specific |
| **Mode** | Daemon + one-shot | One-shot only |
| **Language** | Node.js | Go |
| **Dependencies** | Node.js runtime | Standalone binary |
| **Output** | JSON → backend | Updates kubeconfig |
| **Browser-init** | ✅ Yes (daemon) | ❌ No |

## Workflow Comparison

### Traditional OAuth (Won't Work for Backstage on Private Network)

```
User → Backstage → OIDC Provider → Backstage (requires public URL)
```

### kubectl oidc-login Approach

```
User runs CLI → OIDC Provider → CLI → Update kubeconfig
```

### This Tool (Daemon Mode)

```
User runs daemon → User clicks button in Backstage →
Open localhost:8000 → OIDC Provider → localhost:8000 →
Send to Backstage backend
```

## License

MIT

## Links

- [GitHub Repository](https://github.com/open-service-portal/oidc-authenticator)
- [Issues](https://github.com/open-service-portal/oidc-authenticator/issues)

## Credits

Inspired by [kubectl oidc-login](https://github.com/int128/kubelogin).
