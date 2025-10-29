# OIDC Authenticator

Client-side OIDC authentication daemon for Kubernetes clusters and backend services.

## What is this?

OIDC Authenticator runs on your laptop and handles OIDC/OAuth authentication flows locally, similar to `kubectl oidc-login`. Instead of requiring your backend to have a public URL for OAuth callbacks, this tool:

- Runs as a daemon on `localhost:8000`
- Handles PKCE OAuth flow client-side
- Sends authentication tokens to your backend
- Works on private networks (no public URL needed)

Perfect for Backstage, Kubernetes clusters, and custom applications.

## Quick Start

### 1. Configure

Create `config.yaml`:

```yaml
# OIDC Provider Settings
issuer: "https://login.spot.rackspace.com/"
clientId: "YOUR_CLIENT_ID"
organizationId: "org_xxxxx"  # Optional

# Backend URL
backendUrl: "http://localhost:7007"
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

**Option A: From Browser/UI**
- Open http://localhost:8000
- Complete authentication
- Tokens sent to backend automatically

**Option B: One-Off CLI**
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
--backend-url <url>     Backend URL to send tokens to
--scopes <scopes>       OAuth scopes (default: "openid profile email")
--port <port>           Callback port (default: 8000)
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
# Start daemon
node bin/cli.js start --verbose

# Use from application
fetch('http://localhost:8000/health')  # Check if running
window.open('http://localhost:8000')   # Trigger authentication
```

**Logging:**
- Daemon mode automatically logs to `~/.oidc-authenticator.log`
- All HTTP requests and authentication flows are logged
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
  "expires_in": 3600,
  "scope": "openid profile email"
}
```

## Configuration File

All options are set in `config.yaml`:

```yaml
# OIDC Provider Settings
issuer: "https://login.spot.rackspace.com/"
clientId: "YOUR_CLIENT_ID"
organizationId: "org_xxxxx"  # Optional

# Backend URL
backendUrl: "http://localhost:7007"

# OAuth Scopes
scopes: "openid profile email"

# Callback Port
callbackPort: 8000
```

**Config Key Mapping:**

| Config File | CLI Argument | Environment Variable |
|-------------|--------------|---------------------|
| `issuer` | `--issuer` | `OIDC_ISSUER_URL` |
| `clientId` | `--client-id` | `OIDC_CLIENT_ID` |
| `organizationId` | `--organization` | `OIDC_ORGANIZATION_ID` |
| `backendUrl` | `--backend-url` | - |
| `scopes` | `--scopes` | - |
| `callbackPort` | `--port` | - |

**Priority:** CLI arguments > Environment variables > `config.yaml`

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
