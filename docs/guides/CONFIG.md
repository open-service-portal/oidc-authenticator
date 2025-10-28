# Configuration Guide

## config.json

The `config.json` file stores default values for all CLI arguments, making it easy to use the tool without typing the same arguments every time.

### Location

Place `config.json` in the same directory as the CLI tool:
```
oidc-authenticator/
├── config.json          ← Your configuration here
├── config.example.json  ← Example template
├── bin/cli.js
└── lib/index.js
```

### Setup

1. Copy the example configuration:
```bash
cd oidc-authenticator
cp config.example.json config.json
```

2. Edit `config.json` with your values:
```json
{
  "issuer": "https://login.spot.rackspace.com/",
  "clientId": "mwG3lUMV8KyeMqHe4fJ5Bb3nM1vBvRNa",
  "organizationId": "org_zOuCBHiyF1yG8d1D",
  "scopes": "openid profile email",
  "callbackPort": 8000,
  "backstageBackendUrl": "http://localhost:7007",
  "sendToBackstage": true
}
```

3. Now you can run without arguments:
```bash
oidc-authenticator
# Uses all values from config.json!
```

## Configuration Options

### Required (in config.json or CLI args)

| Option | Config Key | CLI Argument | Description |
|--------|------------|--------------|-------------|
| **Issuer URL** | `issuer` | `--issuer` | OIDC provider issuer URL |
| **Client ID** | `clientId` | `--client-id` | OAuth client ID |

### Optional

| Option | Config Key | CLI Argument | Default | Description |
|--------|------------|--------------|---------|-------------|
| Organization | `organizationId` | `--organization` | none | Organization ID (multi-tenant) |
| Scopes | `scopes` | `--scopes` | `openid profile email` | OAuth scopes |
| Callback Port | `callbackPort` | `--port` | `8000` | Local server port |
| Backstage URL | `backstageBackendUrl` | `--backstage-url` | none | Backend URL to send tokens |
| Send to Backstage | `sendToBackstage` | `--no-send-backstage` | `true` | Auto-send tokens to backend |

## Priority Order

Configuration values are loaded in this order (later overrides earlier):

1. **config.json** - Default values from file
2. **Environment variables** - `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, etc.
3. **CLI arguments** - `--issuer`, `--client-id`, etc.

### Example

```json
// config.json
{
  "issuer": "https://login.spot.rackspace.com/",
  "clientId": "default-client-id"
}
```

```bash
# Uses config.json values
oidc-authenticator

# Override client ID from CLI
oidc-authenticator --client-id different-client-id

# Override from environment
OIDC_CLIENT_ID=env-client-id oidc-authenticator
```

## Backstage Integration

### Auto-send tokens to Backstage

When `sendToBackstage` is `true` and `backstageBackendUrl` is configured, tokens are automatically sent to the Backstage backend after successful authentication.

```json
{
  "backstageBackendUrl": "http://localhost:7007",
  "sendToBackstage": true
}
```

The tool will POST tokens to:
```
POST http://localhost:7007/api/cluster-auth/tokens
Content-Type: application/json

{
  "access_token": "...",
  "id_token": "...",
  "refresh_token": "...",
  "token_type": "Bearer",
  "expires_in": 86400,
  "scope": "openid profile email"
}
```

### Production Configuration

```json
{
  "issuer": "https://login.spot.rackspace.com/",
  "clientId": "mwG3lUMV8KyeMqHe4fJ5Bb3nM1vBvRNa",
  "organizationId": "org_zOuCBHiyF1yG8d1D",
  "backstageBackendUrl": "https://backstage.company.com",
  "sendToBackstage": true
}
```

### Development Configuration

```json
{
  "issuer": "https://login.spot.rackspace.com/",
  "clientId": "dev-client-id",
  "backstageBackendUrl": "http://localhost:7007",
  "sendToBackstage": true
}
```

## Usage Examples

### 1. Zero-config usage (with config.json)

```bash
# Everything from config.json
oidc-authenticator
```

### 2. Override specific values

```bash
# Use config.json but different port
oidc-authenticator --port 18000
```

### 3. Disable Backstage auto-send

```bash
# Authenticate but don't send to backend
oidc-authenticator --no-send-backstage --output tokens.json
```

### 4. Send to different Backstage instance

```bash
# Override backend URL
oidc-authenticator --backstage-url https://backstage-staging.company.com
```

## Security Notes

### Do NOT commit config.json

The `config.json` file is in `.gitignore` to prevent accidentally committing credentials.

**Safe to commit:**
- ✅ `config.example.json` - Template without real credentials

**NEVER commit:**
- ❌ `config.json` - Contains your real client ID and configuration

### Multiple Environments

Use different config files for different environments:

```bash
# Development
cp config.example.json config.dev.json
# Edit config.dev.json with dev credentials
ln -s config.dev.json config.json

# Production
cp config.example.json config.prod.json
# Edit config.prod.json with prod credentials
# When needed: ln -s config.prod.json config.json
```

## Troubleshooting

### Config not loading

**Problem**: Tool doesn't use values from config.json

**Solution**: Check that config.json is in the correct location:
```bash
cd oidc-authenticator
ls -la config.json  # Should exist
node bin/cli.js     # Should work without arguments
```

### Invalid JSON

**Problem**: Error parsing config.json

**Solution**: Validate JSON syntax:
```bash
cat config.json | jq .
# If error, check for:
# - Missing commas
# - Extra commas
# - Unquoted strings
# - Invalid escape sequences
```

### Backstage connection failed

**Problem**: "Failed to connect to Backstage backend"

**Solutions**:
1. Check Backstage is running: `curl http://localhost:7007/api/health`
2. Verify URL in config.json (include http:// or https://)
3. Check firewall/network settings
4. Try with `--no-send-backstage` flag to bypass

## Example Configurations

### Minimal (just authentication)

```json
{
  "issuer": "https://login.spot.rackspace.com/",
  "clientId": "mwG3lUMV8KyeMqHe4fJ5Bb3nM1vBvRNa"
}
```

### Full Backstage integration

```json
{
  "issuer": "https://login.spot.rackspace.com/",
  "clientId": "mwG3lUMV8KyeMqHe4fJ5Bb3nM1vBvRNa",
  "organizationId": "org_zOuCBHiyF1yG8d1D",
  "scopes": "openid profile email",
  "callbackPort": 8000,
  "backstageBackendUrl": "http://localhost:7007",
  "sendToBackstage": true
}
```

### Custom scopes and port

```json
{
  "issuer": "https://login.example.com/",
  "clientId": "custom-client-id",
  "scopes": "openid profile email groups offline_access",
  "callbackPort": 18000,
  "sendToBackstage": false
}
```
