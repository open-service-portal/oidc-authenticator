# Architecture: Local OIDC Client for Backstage

## The Challenge

- **Auth0 requires**: `http://localhost:8000/` callback (on user's machine)
- **Backstage backend runs**: On a remote server
- **Can't change**: Auth0 configuration

## The Solution: Local OIDC Helper

A small local client that runs on the user's machine and communicates with Backstage backend.

## Architecture Diagram

```mermaid
graph TB
    subgraph "User's Local Machine"
        Browser[Browser<br/>Backstage UI]
        LocalClient[Local OIDC Helper<br/>:8888]
    end

    subgraph "Remote Server"
        Backend[Backstage Backend<br/>:7007]
    end

    subgraph "External"
        Auth0[Rackspace Auth0]
        K8s[Kubernetes Cluster]
    end

    Browser -->|1. Click "Get K8s Access"| Backend
    Backend -->|2. Tell user to start local helper| Browser
    Browser -->|3. Start helper| LocalClient
    LocalClient -->|4. Register with backend| Backend
    Backend -->|5. Session token| LocalClient

    LocalClient -->|6. Start local server :8000| LocalClient
    LocalClient -->|7. Open browser| Browser
    Browser -->|8. Authorize| Auth0
    Auth0 -->|9. Redirect http://localhost:8000/?code=...| LocalClient
    LocalClient -->|10. Exchange code for tokens| Auth0
    Auth0 -->|11. id_token + access_token| LocalClient
    LocalClient -->|12. Send tokens| Backend
    Backend -->|13. Store in session| Backend

    Browser -->|14. Request K8s resources| Backend
    Backend -->|15. Use stored token| K8s
    K8s -->|16. Response| Backend
    Backend -->|17. Data| Browser
```

## Components

### 1. Local OIDC Helper (Runs on User's Machine)

A tiny CLI tool (similar to kubectl oidc-login):

```javascript
// backstage-oidc-helper.js
// Runs on user's machine via: node backstage-oidc-helper.js

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { exec } = require('child_process');

const CONFIG = {
  backstageUrl: process.env.BACKSTAGE_URL || 'http://localhost:7007',
  localPort: 8000,
  helperPort: 8888,
};

async function main() {
  console.log('🔐 Backstage OIDC Helper');
  console.log('========================');
  console.log();

  // Step 1: Register with backend
  const session = await registerWithBackend();

  // Step 2: Start local callback server
  const { authUrl } = await startCallbackServer(session);

  // Step 3: Open browser
  console.log('Opening browser for authentication...');
  exec(`open "${authUrl}"`);

  // Server will handle the rest...
}

async function registerWithBackend() {
  console.log('Registering with Backstage backend...');

  const response = await fetch(`${CONFIG.backstageUrl}/api/cluster-auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': process.env.BACKSTAGE_SESSION, // From browser
    },
  });

  const { sessionToken, authUrl } = await response.json();

  console.log('✅ Registered with backend');
  return { sessionToken, authUrl };
}

async function startCallbackServer(session) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>✅ Success! You can close this window.</h1>');

        server.close();

        // Send tokens to backend
        await sendTokensToBackend(session.sessionToken, code, state);

        console.log('✅ Authentication complete!');
        process.exit(0);
      }
    });

    server.listen(CONFIG.localPort, '127.0.0.1', () => {
      console.log(`✅ Local server started on http://localhost:${CONFIG.localPort}`);
      resolve({ authUrl: session.authUrl });
    });
  });
}

async function sendTokensToBackend(sessionToken, code, state) {
  await fetch(`${CONFIG.backstageUrl}/api/cluster-auth/exchange`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ code, state }),
  });
}

main();
```

### 2. Backstage Backend API

```typescript
// packages/backend/src/plugins/cluster-auth.ts

class ClusterAuthService {
  // Map of session tokens to PKCE data
  private sessions = new Map<string, {
    userId: string,
    codeVerifier: string,
    expires: number
  }>();

  async registerLocalClient(userId: string) {
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const { codeVerifier, codeChallenge } = this.generatePKCE();
    const state = crypto.randomBytes(16).toString('base64url');

    // Store PKCE data
    this.sessions.set(sessionToken, {
      userId,
      codeVerifier,
      expires: Date.now() + 5 * 60 * 1000 // 5 minutes
    });

    // Build authorization URL
    const authUrl = this.buildAuthUrl(codeChallenge, state);

    return { sessionToken, authUrl };
  }

  async exchangeCode(sessionToken: string, code: string) {
    const session = this.sessions.get(sessionToken);
    if (!session || session.expires < Date.now()) {
      throw new Error('Invalid or expired session');
    }

    // Exchange code for tokens
    const tokens = await this.exchangeWithAuth0(code, session.codeVerifier);

    // Store tokens for user
    await this.storeUserTokens(session.userId, tokens);

    this.sessions.delete(sessionToken);

    return { success: true };
  }

  private buildAuthUrl(codeChallenge: string, state: string) {
    const url = new URL('https://login.spot.rackspace.com/authorize');
    url.searchParams.set('client_id', process.env.OIDC_CLIENT_ID);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', 'http://localhost:8000/');
    url.searchParams.set('scope', 'openid profile email');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('organization', process.env.OIDC_ORGANIZATION_ID);
    return url.toString();
  }
}

// Routes
router.post('/api/cluster-auth/register', async (req, res) => {
  const userId = req.user.entity?.metadata.name;
  const { sessionToken, authUrl } = await clusterAuthService.registerLocalClient(userId);
  res.json({ sessionToken, authUrl });
});

router.post('/api/cluster-auth/exchange', async (req, res) => {
  const { sessionToken } = req.headers.authorization?.split(' ')[1];
  const { code, state } = req.body;

  await clusterAuthService.exchangeCode(sessionToken, code);

  res.json({ success: true });
});
```

### 3. Backstage Frontend UI

```typescript
// packages/app/src/components/ClusterAuthButton.tsx

export const ClusterAuthButton = () => {
  const [status, setStatus] = useState('idle');
  const api = useApi(identityApiRef);

  const handleAuth = async () => {
    setStatus('registering');

    // Register with backend
    const { sessionToken, authUrl } = await fetch('/api/cluster-auth/register', {
      method: 'POST',
    }).then(r => r.json());

    setStatus('ready');

    // Show instructions
    showInstructions(sessionToken, authUrl);
  };

  const showInstructions = (sessionToken: string, authUrl: string) => {
    return (
      <Dialog open>
        <DialogTitle>Authenticate with Kubernetes Cluster</DialogTitle>
        <DialogContent>
          <Typography variant="h6">Step 1: Run Local Helper</Typography>
          <Typography>Open a terminal and run:</Typography>
          <Code>
            BACKSTAGE_URL=http://localhost:7007 \
            BACKSTAGE_SESSION_TOKEN={sessionToken} \
            node backstage-oidc-helper.js
          </Code>

          <Typography variant="h6">Step 2: Authenticate</Typography>
          <Typography>
            The helper will open your browser for authentication.
          </Typography>

          <Typography variant="h6">Step 3: Done!</Typography>
          <Typography>
            After authentication, refresh this page to see your cluster resources.
          </Typography>
        </DialogContent>
      </Dialog>
    );
  };

  return (
    <Button onClick={handleAuth} disabled={status === 'authenticating'}>
      {status === 'idle' && 'Authenticate with Cluster'}
      {status === 'registering' && 'Preparing...'}
      {status === 'ready' && 'Follow Instructions'}
    </Button>
  );
};
```

## User Flow

```
1. User clicks "Get K8s Access" in Backstage UI
   ↓
2. Backstage shows instructions:
   "Run this command in your terminal:
    npx @backstage/oidc-helper"
   ↓
3. User runs command locally
   ↓
4. Helper connects to Backstage backend
   ↓
5. Helper starts local server on :8000
   ↓
6. Helper opens browser to Auth0
   ↓
7. User authenticates
   ↓
8. Auth0 redirects to http://localhost:8000/?code=...
   ↓
9. Helper receives callback
   ↓
10. Helper sends code to Backstage backend
   ↓
11. Backend exchanges code for tokens
   ↓
12. Backend stores tokens in user session
   ↓
13. User refreshes Backstage
   ↓
14. K8s resources now visible!
```

## Distribution Options

### Option 1: NPM Package (Recommended)

```bash
# Install globally
npm install -g @backstage/oidc-helper

# Use
backstage-oidc-helper --backend=https://backstage.company.com
```

### Option 2: Docker Container

```bash
# Run in container
docker run -p 8000:8000 backstage/oidc-helper
```

### Option 3: Binary (Go/Rust)

```bash
# Download binary
curl -o backstage-oidc-helper https://...
chmod +x backstage-oidc-helper

# Run
./backstage-oidc-helper
```

### Option 4: Browser Extension (Best UX)

A browser extension can:
- Run local server automatically
- No separate CLI needed
- Integrates seamlessly with Backstage UI

```
Chrome Extension: "Backstage OIDC Helper"
1. User clicks "Get K8s Access"
2. Extension starts local server
3. Extension opens Auth0 in new tab
4. Extension receives callback
5. Extension sends tokens to Backstage
6. Done! No terminal needed.
```

## Comparison

| Solution | UX | Complexity | Maintenance |
|----------|----|----|-------|
| **CLI Tool (NPM)** | ⭐⭐⭐ | ⭐⭐ | ⭐⭐ |
| **Browser Extension** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Docker Container** | ⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| **Binary (Go)** | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| **kubectl Passthrough** | ⭐⭐⭐⭐ | ⭐ | ⭐ |

## Recommendation

**Phase 1 (MVP)**: kubectl passthrough
- Read tokens from `~/.kube/cache/oidc-login/`
- Requires kubectl already installed
- Zero additional infrastructure

**Phase 2 (Production)**: Browser Extension
- Best user experience
- No terminal needed
- Seamless integration with Backstage UI

**Alternative**: CLI NPM package
- If extension is too complex
- Works cross-browser
- Familiar to developers

## Implementation Timeline

### Week 1: MVP (kubectl passthrough)
- Backend reads tokens from kubectl cache
- Works for users with kubectl already configured
- Zero changes needed to Auth0

### Week 2-3: CLI Tool
- NPM package `@backstage/oidc-helper`
- Works like kubectl oidc-login
- Distributable via npm

### Week 4-6: Browser Extension
- Chrome/Firefox extension
- Best UX
- No terminal needed

## Security Considerations

1. **Session Token**: Temporary, expires in 5 minutes
2. **HTTPS Required**: Backend must use HTTPS in production
3. **Token Storage**: Tokens encrypted at rest in backend
4. **Token Lifetime**: Honor Auth0 token expiration
5. **Refresh Tokens**: Support automatic token refresh

## Try It Now

The proof-of-concept script can be adapted as the CLI tool:

```bash
# Current working script
node /Users/felix/work/open-service-portal/portal-workspace/scripts/test-oidc-login.js

# Package as CLI
npm init @backstage/oidc-helper
```

## Next Steps

1. ✅ Test script works (DONE)
2. ✅ Architecture designed (DONE)
3. ⏭️  Decide: CLI tool vs Browser Extension vs kubectl passthrough
4. ⏭️  Implement chosen solution
5. ⏭️  Test with real K8s cluster
6. ⏭️  Document for users
