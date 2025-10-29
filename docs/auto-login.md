# Automatic Login with Username/Password

This guide explains how to configure automatic login so you can skip the browser-based authentication flow.

## ⚠️ Security Warning

Storing credentials in plaintext configuration files is **NOT RECOMMENDED** for production use. This feature is intended for:

- **Development environments** on your personal laptop
- **Testing and debugging** authentication flows
- **CI/CD pipelines** with proper secret management

For production, use one of these alternatives:
- **Environment variables** (`OIDC_AUTO_USERNAME` and `OIDC_AUTO_PASSWORD`)
- **Secret management tools** (Vault, AWS Secrets Manager, etc.)
- **OS Keychain integration** (coming in future release)

## Quick Setup

### 1. Copy Example Config

```bash
cp config.example.yaml config.yaml
```

### 2. Edit config.yaml

```yaml
# OIDC Provider Settings
issuer: "https://login.spot.rackspace.com/"
clientId: "mwG3lUMV8KyeMqHe4fJ5Bb3nM1vBvRNa"
organizationId: "org_zOuCBHiyF1yG8d1D"

# ... other settings ...

# Automatic Login
# Auto-login is enabled automatically if both username and password are provided
username: "felix@example.com"
password: "your-password-here"
```

### 3. Verify .gitignore

Make sure `config.yaml` is in `.gitignore`:

```bash
cat .gitignore | grep config.yaml
# Should show: config.yaml  # Contains credentials - DO NOT COMMIT!
```

### 4. Start Daemon

```bash
node bin/cli.js start --verbose
```

## User Experience

### Without Auto-Login (Default)

```
1. User opens Backstage
2. Clicks "Kubernetes Cluster" button
3. Popup opens to localhost:8000
4. Browser redirects to Auth0
5. User enters username/password in browser
6. Auth0 redirects back to daemon
7. Tokens sent to Backstage
8. User logged in ✅
```

**Time:** ~15-30 seconds with user interaction

### With Auto-Login (Enabled)

```
1. User opens Backstage
2. Clicks "Kubernetes Cluster" button
3. Daemon automatically submits credentials
4. Tokens sent to Backstage
5. User logged in ✅
```

**Time:** ~2-5 seconds with NO user interaction!

## Environment Variables (Recommended)

For better security, use environment variables instead of config file:

```bash
# Export credentials
export OIDC_AUTO_USERNAME="felix@example.com"
export OIDC_AUTO_PASSWORD="your-password"

# Start daemon
node bin/cli.js start --verbose
```

The environment variables will override values in `config.yaml`.

## How It Works

When `autoLogin.enabled = true` and credentials are provided:

1. **Browser Opens**: Normal OIDC flow starts
2. **Auto-Fill Form**: Daemon detects login form and fills credentials
3. **Auto-Submit**: Form is automatically submitted
4. **Silent Flow**: User sees brief browser flash, then success
5. **Token Exchange**: Rest of flow proceeds normally

## Limitations

Currently, automatic login is **NOT YET IMPLEMENTED** in the daemon. This requires:

1. **Headless browser automation** (Playwright or Puppeteer)
2. **Form detection** (find username/password fields)
3. **Credential injection** (fill and submit form)
4. **Error handling** (invalid credentials, MFA, etc.)

## Roadmap

### Phase 1: Basic Auto-Login (v0.2.0)
- ✅ YAML configuration with credentials
- ✅ Environment variable support
- ⏳ Headless browser automation
- ⏳ Form detection and submission
- ⏳ Error handling and retries

### Phase 2: Secure Storage (v0.3.0)
- OS Keychain integration (macOS, Windows, Linux)
- Encrypted credential storage
- Master password protection
- Credential rotation

### Phase 3: Advanced Features (v0.4.0)
- Multi-factor authentication (MFA) support
- Biometric authentication
- Hardware key support (YubiKey, etc.)
- Session persistence across restarts

## Alternative: Browser Profile

Until automatic login is implemented, you can use browser profiles to "remember" your login:

### Chrome/Chromium

```bash
# Create dedicated profile for auth
mkdir -p ~/.oidc-auth-profile

# Use profile when starting daemon
# (requires daemon modification to pass to browser)
```

This way, the browser session persists and you only need to log in once.

## Implementation Note

**Current Status**: Configuration is ready, but automatic form submission is **not implemented** due to OAuth2/OIDC security constraints.

### Why Can't We Skip the Browser?

OAuth2/OIDC with PKCE **requires** browser interaction for security:

1. **Authorization Code Flow**: User must authorize in their browser
2. **PKCE**: Designed for public clients (no client secret)
3. **Session Cookies**: Auth provider needs browser cookies/session
4. **No Password Grant**: Modern providers (Auth0, Okta) don't support ROPC (Resource Owner Password Credentials)

### What CAN Be Done?

**Option 1: Headless Browser** (Simple but heavy)
- Use Playwright/Puppeteer
- Detect `input[type="email"]` and `input[type="password"]`
- Fill and submit automatically
- User sees brief browser flash

**Option 2: Device Flow** (OAuth 2.0 Device Authorization Grant)
- No browser automation needed
- User enters code manually once
- Token refresh handles subsequent logins
- Requires provider support

**Option 3: Refresh Token Storage** (Best UX)
- Store refresh token after first login
- Use refresh token for subsequent authentications
- No browser needed after first time
- Requires secure storage (OS keychain)

We recommend **Option 3** for the best user experience.

## Security Best Practices

If you must use this feature:

1. ✅ **Use .gitignore** - Never commit config.yaml
2. ✅ **Use environment variables** - Better than file storage
3. ✅ **Rotate credentials** - Change passwords regularly
4. ✅ **Limit scope** - Use service account with minimal permissions
5. ✅ **Monitor access** - Check audit logs for unusual activity
6. ✅ **Encrypt disk** - Use full-disk encryption on your laptop
7. ✅ **Lock screen** - Always lock when stepping away

## FAQ

### Q: Is this secure?

**A:** No, storing plaintext credentials is inherently insecure. Use environment variables or wait for keychain integration.

### Q: Does this work with MFA?

**A:** Not yet. Multi-factor authentication support is planned for v0.4.0.

### Q: Can I use this in production?

**A:** Not recommended. Use service accounts with short-lived tokens instead.

### Q: What about my company's SSO?

**A:** If your IdP uses standard OIDC/OAuth forms, it should work. Custom SSO implementations may not be compatible.

### Q: Will you support OAuth device flow?

**A:** Yes! Device flow is planned and doesn't require credentials in config.

## Related Documentation

- [Product Concept](./product-concept.md) - Vision for oidc-authenticator
- [Backstage Integration](./backstage-integration.md) - Complete integration guide
- [README](../README.md) - Main documentation

---

**Status**: Configuration ready, automation implementation pending

**Next Step**: Add headless browser support for actual auto-login
