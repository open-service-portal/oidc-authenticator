# OIDC Authenticator Documentation

Welcome to the oidc-authenticator documentation!

## Overview

OIDC Authenticator is a lightweight daemon that runs in user space (localhost) and handles OAuth2/OIDC authentication flows, eliminating the need for public callback URLs and client secrets.

## Documentation

### Getting Started

- **[Main README](../README.md)** - Quick start guide, features, and usage

### Concepts

- **[Product Concept](./product-concept.md)** - Vision for oidc-authenticator as a universal OAuth proxy
  - Problem statement
  - Solution architecture
  - Use cases (local dev, CLI tools, desktop apps, etc.)
  - Roadmap and business model

### Integration Guides

- **[Backstage Integration](./backstage-integration.md)** - Complete implementation guide
  - Secure session token flow
  - Step-by-step implementation
  - Security model and verification
  - Testing instructions

### Architecture

- **[OIDC Kubernetes Authentication](../../concepts/2025-10-23-oidc-kubernetes-authentication.md)** - Original architecture concept
  - Two approaches (standard OIDC vs daemon)
  - JWT token analysis
  - Kubernetes RBAC integration

## Key Features

✅ **PKCE Flow** - No client secret needed
✅ **Localhost Only** - No public callback URL required
✅ **Universal** - Works with any OIDC provider
✅ **Simple** - Backends only validate JWTs
✅ **Secure** - Cryptographically signed tokens

## Quick Example

**Start daemon:**
```bash
node bin/cli.js start --issuer https://auth.example.com --client-id xxx
```

**Trigger authentication:**
```javascript
window.open('http://localhost:8000');
```

**Receive tokens:**
```javascript
window.addEventListener('message', (event) => {
  if (event.origin === 'http://localhost:8000') {
    console.log('Session token:', event.data.backstageToken);
  }
});
```

## Use Cases

1. **Local Development** - Authenticate against production OAuth locally
2. **Private Networks** - OAuth without public callback URLs
3. **Desktop Apps** - Simple OAuth for Electron apps
4. **CLI Tools** - Browser-based OAuth for command-line tools
5. **Kubernetes** - Authenticate kubectl without exec plugins

## Architecture Benefits

### Traditional OAuth
```
Browser → Backend (needs public URL) → OAuth Provider
                ↓
            Callback (needs public URL)
```

### With oidc-authenticator
```
Browser → Daemon (localhost) → OAuth Provider
            ↓
         Backend (any URL) ← Tokens
```

**No public URL needed!**

## Contributing

This project is open for contributions! See the main README for:
- Development setup
- Testing guidelines
- Contribution process

## Support

- **GitHub Issues**: [Report bugs and request features](https://github.com/open-service-portal/oidc-authenticator/issues)
- **Discussions**: [Ask questions and share ideas](https://github.com/open-service-portal/oidc-authenticator/discussions)

## License

MIT - See [LICENSE](../LICENSE) for details.
