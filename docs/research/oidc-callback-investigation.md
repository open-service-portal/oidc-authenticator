# OIDC Callback URL Investigation

## The Mystery

- **kubectl oidc-login**: ✅ Works with localhost callback
- **Our script**: ❌ Fails with "redirect_uri is not in the list of allowed callback URLs"
- **Same client ID**: Both use `mwG3lUMV8KyeMqHe4fJ5Bb3nM1vBvRNa`

## Key Finding

kubectl uses the SAME client ID but it works. This means the client **MUST have localhost configured** in Auth0, but possibly with a specific format.

## Possible Explanations

### 1. Different Callback Port

kubectl oidc-login might use a different port than :8000

Common ports for OIDC CLI tools:
- `:8000` (our script)
- `:8080`
- `:18000` (kubectl oidc-login default in some versions)
- `:28080`

### 2. Different Callback Path

Possible formats:
- `http://localhost:8000/callback` (our script)
- `http://localhost:8000/` (root path)
- `http://localhost:8000/oidc/callback`
- `http://127.0.0.1:8000/callback` (IP instead of localhost)

### 3. Wildcard in Auth0

Auth0 might have configured:
- `http://localhost:*` (wildcard port)
- `http://localhost:*/callback` (wildcard port with path)
- Multiple specific URLs

## How to Check Auth0 Configuration

### Method 1: Auth0 Dashboard (Preferred)

1. Log in to Auth0 Dashboard: https://login.spot.rackspace.com/
2. Navigate to: **Applications** → **Applications**
3. Find: **mwG3lUMV8KyeMqHe4fJ5Bb3nM1vBvRNa**
4. Go to: **Settings** tab
5. Look at: **Allowed Callback URLs**

This will show EXACTLY what callback URLs are configured.

### Method 2: Auth0 Management API

```bash
# Get Management API token first
curl -X POST https://login.spot.rackspace.com/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "MANAGEMENT_API_CLIENT_ID",
    "client_secret": "MANAGEMENT_API_CLIENT_SECRET",
    "audience": "https://login.spot.rackspace.com/api/v2/",
    "grant_type": "client_credentials"
  }' | jq -r '.access_token'

# Get client details
curl https://login.spot.rackspace.com/api/v2/clients/mwG3lUMV8KyeMqHe4fJ5Bb3nM1vBvRNa \
  -H "Authorization: Bearer YOUR_MANAGEMENT_API_TOKEN" \
  | jq '.callbacks'
```

### Method 3: Try Different Ports

Update our script to try different ports:

```bash
# Try port 18000 (kubectl oidc-login default in newer versions)
sed -i '' 's/callbackPort: 8000/callbackPort: 18000/' test-oidc-login.js
node test-oidc-login.js

# Try port 8080
sed -i '' 's/callbackPort: 18000/callbackPort: 8080/' test-oidc-login.js
node test-oidc-login.js
```

## kubectl oidc-login Default Ports

According to kubectl oidc-login documentation:

### Version 1.25+
Default port: **18000**
Callback URL: `http://localhost:18000`

### Older Versions
Default port: **8000** or **8080**

## Recommended Next Steps

### Step 1: Check Auth0 Dashboard

This is the fastest way to know for sure what's configured:

```
Expected to find something like:
  ✅ http://localhost:18000
  ✅ http://localhost:8000
  ✅ http://127.0.0.1:18000
  OR
  ✅ http://localhost:*  (wildcard)
```

### Step 2: Update Our Script to Match

Once we know the correct URL, update our script:

```javascript
const CONFIG = {
  // ...
  callbackPort: 18000,  // Change from 8000 to 18000
  callbackPath: '/',     // Or change to root if that's what's configured
};
```

### Step 3: Test with Correct Port

```bash
node test-oidc-login.js
```

## Quick Test: Try Port 18000

Let's test if port 18000 is configured:

```bash
# Create a quick test
cat > /tmp/test-port-18000.js << 'EOF'
const http = require('http');
const { exec } = require('child_process');

const server = http.createServer((req, res) => {
  console.log('Received callback:', req.url);
  res.end('OK');
  server.close();
  process.exit(0);
});

server.listen(18000, () => {
  const url = 'https://login.spot.rackspace.com/authorize?' +
    'client_id=mwG3lUMV8KyeMqHe4fJ5Bb3nM1vBvRNa&' +
    'response_type=code&' +
    'redirect_uri=http://localhost:18000&' +
    'scope=openid&' +
    'organization=org_zOuCBHiyF1yG8d1D';

  console.log('Opening browser to test port 18000...');
  exec(`open "${url}"`);
});
EOF

node /tmp/test-port-18000.js
```

If this works → Port 18000 is configured
If this fails → Try other ports or check Auth0 dashboard

## kubectl oidc-login Source Code Reference

The kubectl oidc-login tool uses these defaults:

```go
// From kubectl oidc-login source
const (
    DefaultListenAddress = "127.0.0.1:18000"
    DefaultCallbackPath  = "/"
)
```

So kubectl uses:
- **Address**: `127.0.0.1:18000` (not `localhost`)
- **Callback**: `http://127.0.0.1:18000/` (root path, not `/callback`)

## Updated Test Script with Correct Defaults

```javascript
const CONFIG = {
  issuer: 'https://login.spot.rackspace.com',
  authorizationEndpoint: 'https://login.spot.rackspace.com/authorize',
  tokenEndpoint: 'https://login.spot.rackspace.com/oauth/token',
  clientId: 'mwG3lUMV8KyeMqHe4fJ5Bb3nM1vBvRNa',
  organizationId: 'org_zOuCBHiyF1yG8d1D',
  scopes: 'openid profile email',
  callbackPort: 18000,  // ← Changed from 8000
  callbackPath: '/',    // ← Changed from '/callback'
  callbackHost: '127.0.0.1',  // ← Changed from 'localhost'
};

// Build redirect URI
const redirectUri = `http://${CONFIG.callbackHost}:${CONFIG.callbackPort}${CONFIG.callbackPath}`;
// Results in: http://127.0.0.1:18000/
```

## Action Items

- [ ] Check Auth0 dashboard for allowed callback URLs
- [ ] Update script to use port 18000 instead of 8000
- [ ] Update script to use `127.0.0.1` instead of `localhost`
- [ ] Update script to use `/` instead of `/callback`
- [ ] Test updated script
- [ ] Document the working configuration

## Expected Result

After using the correct callback URL (likely `http://127.0.0.1:18000/`):

```
✅ Local callback server started on http://127.0.0.1:18000
✅ Authorization URL opened in browser
✅ User authenticates
✅ Callback received with authorization code
✅ Tokens exchanged successfully
```

## References

- [kubectl oidc-login GitHub](https://github.com/int128/kubelogin)
- [kubectl oidc-login Configuration](https://github.com/int128/kubelogin/blob/master/docs/setup.md)
- [Auth0 Native Applications](https://auth0.com/docs/get-started/applications/application-types#native-applications)
