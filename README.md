# OIDC Authenticator

Client-side OIDC authentication daemon for Kubernetes clusters and backend services.

## What is this?

OIDC Authenticator runs on your laptop and handles OIDC/OAuth authentication flows locally, similar to `kubectl oidc-login`. Instead of requiring your backend to have a public URL for OAuth callbacks, this tool:

- Runs as a daemon on `localhost:8000`
- Handles PKCE OAuth flow client-side
- Returns tokens to frontend via `postMessage` (default) or optionally sends directly to backend
- Works on private networks (no public URL needed)

Perfect for Backstage, Kubernetes clusters, and custom applications.

## Quick Start

### 1. Configure

Create `config.yaml`:

```yaml
# OIDC Provider Settings (required)
issuer: "https://login.spot.rackspace.com/"
clientId: "YOUR_CLIENT_ID"
organizationId: "org_xxxxx"  # Optional

# Backend URL (optional - only needed for legacy direct-send mode)
backend:
  url: "http://localhost:7007"
  secret: "your-shared-secret-here"  # Required if using backend URL
  # Generate: openssl rand -hex 32
  # Backend must verify this in X-Auth-Secret header
```

Or use environment variables:

```bash
export OIDC_ISSUER_URL="https://login.spot.rackspace.com/"
export OIDC_CLIENT_ID="your_client_id"
export OIDC_ORGANIZATION_ID="org_xxxxx"
```

### 2. Start Daemon

```bash
node bin/cli.js start
```

Check if running:

```bash
node bin/cli.js status
```

Stop daemon:

```bash
node bin/cli.js stop
```

### 3. Authenticate

**Option A: From Browser/UI (Recommended - Frontend handover)**
- Open http://localhost:8000/?mode=return-tokens
- Complete authentication
- Tokens sent to frontend via `postMessage` to `window.opener`
- Frontend sends tokens to backend with authenticated session

**Option B: Legacy Direct-Send Mode (requires backend URL)**
- Open http://localhost:8000
- Complete authentication
- Tokens sent directly to backend

**Option C: One-Off CLI**
```bash
node bin/cli.js --verbose
```

## Commands

```
node bin/cli.js start [options]    # Start daemon in background
node bin/cli.js stop               # Stop running daemon
node bin/cli.js status             # Check if daemon is running
node bin/cli.js [options]          # One-off authentication (runs once)
node bin/cli.js --help             # Show help
```

## Options

```
--issuer <url>          OIDC issuer URL (required)
--client-id <id>        OAuth client ID (required)
--organization <id>     Organization ID (optional, for Auth0)
--backend-url <url>     Backend URL (optional - for legacy direct-send mode)
--scopes <scopes>       OAuth scopes (default: "openid profile email")
--port <port>           Callback port (default: 8000 for daemon, 8001 for one-off)
--output <file>         Save tokens to file (debugging)
-v, --verbose           Show detailed output
```

## Features

### Token Bypass Mode ⭐ NEW

Skip OIDC flow entirely with an existing OIDC access token:

```yaml
# config.yaml
backendUrl: "http://localhost:7007"

# Provide your OIDC access token directly
token: "eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIi..."
```

Perfect for development, testing, and CI/CD. See **[Token Bypass Documentation](./docs/token-bypass.md)**.

### Daemon Mode

Long-running background process for persistent authentication:

```bash
# Start daemon (no backend URL needed for frontend handover)
node bin/cli.js start --verbose
```

**Frontend Integration (Recommended):**

```javascript
// In your Backstage frontend or web app

// 1. Check if daemon is running
const checkDaemon = async () => {
  try {
    const response = await fetch('http://localhost:8000/health');
    return response.ok;
  } catch {
    return false;
  }
};

// 2. Open authentication popup with mode=return-tokens
const authenticate = () => {
  const authWindow = window.open(
    'http://localhost:8000/?mode=return-tokens',
    'OIDC Authentication',
    'width=500,height=600'
  );

  // 3. Listen for tokens from daemon
  window.addEventListener('message', async (event) => {
    if (event.data.type === 'cluster-tokens') {
      const tokens = event.data.tokens;

      // 4. Send tokens to YOUR backend with authenticated session
      await fetch('/api/cluster-auth/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Include cookies for session auth
        body: JSON.stringify(tokens)
      });

      authWindow.close();
    }
  });
};
```

**Benefits:**
- ✅ No backend URL needed in daemon config
- ✅ Frontend controls when/how tokens are sent
- ✅ Works with authenticated Backstage sessions
- ✅ Better security - tokens only sent by authenticated users

**Legacy Direct-Send Mode:**

If you configure `backend.url` in config.yaml, you can also use:

```yaml
backend:
  url: "http://localhost:7007"
  secret: "your-shared-secret-here"  # REQUIRED for security!
```

```javascript
window.open('http://localhost:8000')  # Sends directly to backend
```

**⚠️ Security Note:** If using legacy direct-send mode, you MUST configure `backend.secret` and verify it on the backend. The daemon will send this in the `X-Auth-Secret` header. Without this, anyone on localhost could send arbitrary tokens to your backend.

**Backend Implementation:**
```javascript
// In your backend endpoint
app.post('/api/cluster-auth/tokens', (req, res) => {
  const authSecret = req.headers['x-auth-secret'];
  const expectedSecret = process.env.OIDC_AUTH_SECRET;

  if (!authSecret || authSecret !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Process tokens...
});
```

**Logging:**
- Daemon mode automatically logs to `~/.oidc-authenticator.log`
- Startup info printed to stdout
- All HTTP requests and authentication flows logged to file only
- Check log location: `node bin/cli.js status`
- View logs: `tail -f ~/.oidc-authenticator.log`

### One-Off Mode

Single authentication that runs once and exits:

```bash
node bin/cli.js --verbose --output /tmp/tokens.json
```

### Verbose Mode

See detailed authentication flow including:

```bash
node bin/cli.js start --verbose
```

**Shows:**
- Configuration details (issuer, client ID, scopes)
- PKCE challenge generation
- Authorization URL
- Token exchange
- **Decoded JWT claims** (email, name, expiration, etc.)
- Access token type (JWT or JWE encrypted)

**Example output:**
```
🔐 Starting OIDC authentication...

📍 Issuer: https://login.spot.rackspace.com/
🔑 Client ID: mwG3lUMV8KyeMqHe4fJ5Bb3nM1vBvRNa
🏢 Organization: org_zOuCBHiyF1yG8d1D
📋 Scopes: openid profile email

✅ PKCE challenge generated
✅ Authorization URL built
✅ Tokens obtained successfully!

🔍 ID Token Claims:
     email: user@example.com
     name: John Doe
     sub: auth0|123456
     exp: 1761907570 (2025-10-31T10:46:10.000Z)
```

### JWT Token Decoding

Automatically decodes and displays JWT token claims:
- Subject (`sub`), Issuer (`iss`), Audience (`aud`)
- User info (email, name, preferred_username)
- Timestamps (issued at, expires, not before)
- Recognizes JWE encrypted tokens

## Use Cases

### Kubernetes Cluster Authentication

Authenticate with clusters using OIDC credentials:

```bash
# Start daemon
node bin/cli.js start

# Tokens available for kubectl/K8s API
# Backend receives tokens via POST /api/cluster-auth/tokens
```

### Backstage Integration

Enable cluster authentication in Backstage:

```typescript
// Check if daemon is running
const health = await fetch('http://localhost:8000/health');

// Trigger authentication
window.open('http://localhost:8000');

// Backend receives tokens automatically
```

### Custom Applications

Any backend service can use this for authentication:

```bash
# Configure backend URL
node bin/cli.js start --backend-url https://api.example.com

# Tokens POSTed to https://api.example.com/api/cluster-auth/tokens
```

## Architecture

```
┌─────────────┐        ┌──────────────┐        ┌─────────────┐
│   Browser   │───────>│     Daemon   │───────>│ OIDC        │
│             │        │ (localhost)  │        │ Provider    │
└─────────────┘        └──────────────┘        └─────────────┘
      │                       │                        │
      │                       │ PKCE Flow              │
      │                       │<───────────────────────│
      │                       │                        │
      │                       ▼                        │
      │              ┌──────────────┐                 │
      │              │   Backend    │                 │
      │              │   Service    │                 │
      │              └──────────────┘                 │
      │                                                │
      └────────── Uses tokens for K8s/API ────────────┘
```

## Security

- **PKCE Flow**: Secure public client authentication (no client secret needed)
- **Localhost Only**: Daemon binds to 127.0.0.1 (not accessible externally)
- **State Validation**: CSRF protection built-in
- **Token Validation**: Backend should verify JWT signatures
- **Private Networks**: Works without public URLs

## API Endpoints

### Daemon

```
GET  /health              - Health check
GET  /                    - Initiate authentication
```

**Health Response:**
```json
{
  "status": "running",
  "issuer": "https://login.spot.rackspace.com/"
}
```

### Backend (Expected)

Your backend should implement:

```
POST /api/cluster-auth/tokens    - Receive tokens from daemon
```

**Token Payload:**
```json
{
  "access_token": "eyJ...",
  "id_token": "eyJ...",
  "refresh_token": "v1.MRr...",
  "token_type": "Bearer",
  "scope": "openid profile email"
}
```

**Note:** The `expires_in` field is not included in the payload as it's inconsistent across OIDC providers. The backend should decode token expiration directly from the JWT claims (`exp` field).

## Configuration File

All options are set in `config.yaml`:

```yaml
# OIDC Provider Settings
issuer: "https://login.spot.rackspace.com/"
clientId: "YOUR_CLIENT_ID"
organizationId: "org_xxxxx"  # Optional

# Backend URL
backend:
  url: "http://localhost:7007"
  endpoint: "/api/cluster-auth/tokens"

# OAuth Scopes
scopes: "openid profile email"

# Port Configuration
# daemon.port: Port for persistent daemon mode (default: 8000)
# cli.port: Port for one-off CLI mode (default: 8001)
daemon:
  port: 8000
cli:
  port: 8001
```

**Config Key Mapping:**

| Config File | CLI Argument | Environment Variable | Notes |
|-------------|--------------|---------------------|-------|
| `issuer` | `--issuer` | `OIDC_ISSUER_URL` | |
| `clientId` | `--client-id` | `OIDC_CLIENT_ID` | |
| `organizationId` | `--organization` | `OIDC_ORGANIZATION_ID` | |
| `backend.url` | `--backend-url` | - | |
| `scopes` | `--scopes` | - | |
| `daemon.port` | `--port` | - | Daemon mode default: 8000 |
| `cli.port` | `--port` | - | One-off mode default: 8001 |

**Priority:** CLI arguments > Environment variables > `config.yaml` > built-in defaults

**Port Defaults:**
- **Daemon mode**: 8000 (persistent service for Backstage integration)
- **One-off mode**: 8001 (avoids conflict with running daemon)

## Troubleshooting

### Port Already in Use

```bash
# Find and kill process
lsof -ti :8000 | xargs kill -9

# Or use different port
node bin/cli.js start --port 8080
```

### Daemon Not Starting

```bash
# Check for errors
node bin/cli.js start --verbose

# Verify config
cat config.json

# Test health endpoint
curl http://localhost:8000/health
```

### Authentication Fails

```bash
# Run in verbose mode to see details
node bin/cli.js --verbose

# Check OIDC provider is accessible
# Verify client ID and issuer URL
# Review decoded JWT claims for issues
```

## Development

```bash
# Install dependencies
npm install

# Run tests (if available)
npm test

# Start in development mode
node bin/cli.js start --verbose
```

## Requirements

- Node.js 18+
- OIDC/OAuth2 provider (Auth0, Okta, Keycloak, etc.)
- OAuth application registered with provider

## Documentation

- **[Token Bypass Mode](./docs/token-bypass.md)** - Skip OIDC flow with pre-existing tokens (development/CI)
- **[Backstage Integration](./docs/backstage-integration.md)** - Complete implementation guide with secure session token flow
- **[Product Concept](./docs/product-concept.md)** - Vision for oidc-authenticator as a universal OAuth proxy
- **[OIDC Kubernetes Authentication](../concepts/2025-10-23-oidc-kubernetes-authentication.md)** - Original architecture concept

## License

MIT

## Related

- **kubectl oidc-login**: Similar tool for Kubernetes authentication
- **oauth2-proxy**: Reverse proxy for OAuth2 authentication
