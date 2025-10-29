# Token Bypass Mode

Skip the OIDC authentication flow entirely by providing an existing OIDC access token. This is useful for development, testing, CI/CD pipelines, or when you already have a valid token.

## Overview

**Token bypass mode** allows you to:
- Use an existing OIDC access token
- Skip the OAuth/OIDC browser flow completely
- Immediately send tokens to your Backstage backend

This is perfect for:
- **Local development** - reuse an existing token without re-authenticating
- **CI/CD pipelines** - automated testing with pre-obtained tokens
- **Testing** - quick authentication without browser interaction
- **Offline environments** - no need for external OIDC provider

## Important: Token Types

This feature is for **OIDC access tokens**, not Kubernetes service account tokens:

- ✅ **OIDC Access Token** (from OAuth flow): `eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIi...` (JWE encrypted)
- ✅ **OIDC ID Token** (JWT): `eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIs...`
- ❌ **Kubernetes Service Account Token**: These are different tokens used for K8s API access

## Configuration

Only one simple way to configure - provide the token directly as a string:

```yaml
# config.yaml
backendUrl: "http://localhost:7007"

# Provide your OIDC access token directly
token: "eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIiwiaXNzIjoiaHR0cHM6Ly9sb2dpbi5zcG90LnJhY2tzcGFjZS5jb20vIn0..."
```

That's it! No complex configuration needed.

## Usage

### Start Daemon with Token Bypass

```bash
# Configure token in config.yaml (any method above)
# Then start normally:
node bin/cli.js start --verbose
```

**Output:**
```
🔐 Starting OIDC authenticator daemon...

🎯 Token bypass mode enabled - skipping OIDC flow
   Token preview: eyJhbGciOiJSUzI1NiIsImtpZCI...
✅ Token sent to backend successfully
✅ Received Backstage session token

💡 Token bypass mode active - daemon will respond with pre-configured token

✅ OIDC authenticator daemon running on http://localhost:8000
📋 Health check: http://localhost:8000/health
🔗 To authenticate, open: http://localhost:8000/
📤 Tokens will be sent to: http://localhost:7007
```

### One-Time Authentication

```bash
# One-off mode also supports token bypass
node bin/cli.js --verbose
```

### Check Status

```bash
node bin/cli.js status
```

## Behavior in Token Bypass Mode

### At Startup
1. Daemon reads token from configuration
2. Immediately sends token to backend (if `backendUrl` is configured)
3. Receives and stores Backstage session token
4. Starts HTTP server

### When Browser Opens `http://localhost:8000`
1. No OIDC redirect occurs
2. Token is sent to backend again (or existing session reused)
3. Success page displayed immediately
4. Window auto-closes after 3 seconds

### Sent to Backend
The token is formatted to be compatible with OIDC flow:

```json
{
  "access_token": "eyJhbGci...",
  "id_token": "eyJhbGci...",
  "token_type": "Bearer",
  "scope": "cluster-access",
  "bypass_mode": true
}
```

The `bypass_mode: true` flag indicates this is not from OIDC.

## Getting an OIDC Access Token

You can obtain an OIDC access token by:

1. **Running normal OIDC flow first** with verbose mode:
   ```bash
   node bin/cli.js --verbose --output /tmp/tokens.json
   ```
   Then copy the `access_token` from the output.

2. **From browser developer tools** when authenticating with Backstage

3. **From your backend logs** if it logs received tokens

The token will look like:
- **JWE (encrypted)**: `eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIi...` (longer, 5-part structure)
- **JWT (plain)**: `eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIs...` (3-part structure)

## Security Considerations

### ⚠️ Important Security Notes

1. **Never commit tokens to git**
   - Add `config.yaml` to `.gitignore`
   - Use `config.example.yaml` as template

2. **Token expiration**
   - Tokens from kubeconfig can expire
   - Service account tokens may have limited lifetime
   - Restart daemon if token expires

3. **Use environment-specific configs**
   - Different configs for dev/staging/prod
   - Never use production tokens in development

4. **Backend validation**
   - Backend should validate all tokens
   - Check token signatures and expiration
   - Verify token has appropriate permissions

### Best Practices

```yaml
# Development
token:
  fromKubeconfig: true
  context: "rancher-desktop"

# CI/CD (use service account token)
token:
  value: "${CI_K8S_TOKEN}"  # From environment/secrets
```

## Troubleshooting

### Token Format Issues

**Error:**
```
⚠️  Token doesn't appear to be a valid JWT/JWE
```

**Solutions:**
1. Verify you're using an **OIDC token**, not a Kubernetes service account token
2. Check the token starts with `eyJ`
3. Ensure no line breaks or whitespace in the token string

### Backend Rejects Token

**Error:**
```
⚠️  Failed to send token to backend: Backend returned status 401
```

**Solutions:**
1. Verify backend URL is correct
2. Check backend logs for validation errors
3. Ensure backend accepts `bypass_mode` tokens
4. Verify token is valid and not expired

### Token Expired

**Symptoms:**
- Authentication succeeds but cluster access fails
- Backend returns 401 errors

**Solutions:**
1. Restart daemon (re-extracts fresh token)
2. Get new service account token
3. Use OIDC flow instead for auto-refresh

## Examples

### Development with Existing Token

```yaml
# config.yaml
backendUrl: "http://localhost:7007"

# Use a token you already obtained from OIDC flow
token: "eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIiwiaXNzIjoiaHR0cHM6Ly9sb2dpbi5zcG90LnJhY2tzcGFjZS5jb20vIn0..."
```

```bash
node bin/cli.js start --verbose
```

### CI/CD Pipeline

```yaml
# config.yaml
backendUrl: "https://backstage.company.com"

# Token from CI/CD secrets
token: "${OIDC_ACCESS_TOKEN}"
```

```bash
# In CI pipeline
export OIDC_ACCESS_TOKEN="eyJhbGci..."
node bin/cli.js start
```

### Quick Testing

First get a token:
```bash
# Run normal flow to get token
node bin/cli.js --verbose --output /tmp/tokens.json

# Extract access_token
cat /tmp/tokens.json | jq -r '.access_token'
```

Then use it:
```yaml
# config.yaml
backendUrl: "http://localhost:7007"
token: "eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIi..."
```

## Comparison: OIDC vs Token Bypass

| Feature | OIDC Flow | Token Bypass |
|---------|-----------|--------------|
| Setup complexity | Higher (OIDC provider required) | Lower (just need token) |
| Browser required | Yes | No (but UI works) |
| Token refresh | Automatic | Manual restart |
| Security | OAuth2 standard | Direct token |
| Best for | Production | Development/CI |
| Offline | No (needs OIDC provider) | Yes |

## Backend Integration

Your backend receives the same structure regardless of mode:

```typescript
// Backend endpoint: /api/cluster-auth/tokens
app.post('/api/cluster-auth/tokens', async (req, res) => {
  const { access_token, bypass_mode } = req.body;

  if (bypass_mode) {
    // Token bypass - validate token directly
    // May not have refresh_token
  } else {
    // OIDC flow - has refresh capability
  }

  // Validate and create session...
  const backstageToken = createSession(access_token);

  res.json({ backstageToken });
});
```

## Migration Guide

### From OIDC to Token Bypass

```yaml
# Before (OIDC)
issuer: "https://login.example.com/"
clientId: "abc123"
backendUrl: "http://localhost:7007"

# After (Token Bypass)
backendUrl: "http://localhost:7007"
token: "eyJhbGci..."
```

### From Token Bypass to OIDC

```yaml
# Before (Token Bypass)
backendUrl: "http://localhost:7007"
token: "eyJhbGci..."

# After (OIDC)
issuer: "https://login.example.com/"
clientId: "abc123"
backendUrl: "http://localhost:7007"
# Remove or comment out token
```

## See Also

- [Configuration Guide](../README.md#configuration-file)
- [Backstage Integration](./backstage-integration.md)
