# OIDC Authenticator Documentation

This directory contains comprehensive documentation for the OIDC Authenticator tool - a client-side authentication daemon for Backstage that enables browser-initiated OIDC authentication flows.

## Quick Links

- **Main README**: [../README.md](../README.md) - User-facing documentation with quick start and examples
- **Architecture**: [architecture/](./architecture/) - Design documents and architectural decisions
- **Guides**: [guides/](./guides/) - Installation and configuration guides
- **Research**: [research/](./research/) - Investigation notes, POCs, and test results
- **Scripts**: [scripts/](./scripts/) - Helper scripts for development and troubleshooting

## Documentation Structure

### Architecture

Design documents explaining how the OIDC Authenticator works:

- **[architecture-local-oidc-client.md](./architecture/architecture-local-oidc-client.md)** - Detailed architecture of the local OIDC client approach
  - Client-server model
  - Authentication flow diagrams
  - Security considerations

- **[SOLUTION-oidc-kubectl-style.md](./architecture/SOLUTION-oidc-kubectl-style.md)** - Solution design inspired by kubectl oidc-login
  - Why browser-initiated auth
  - Comparison with traditional OAuth
  - Backstage integration strategy

### Guides

User guides for installation, configuration, and usage:

- **[INSTALL.md](./guides/INSTALL.md)** - Installation instructions
  - Prerequisites
  - Installation methods (npm, local)
  - Verification steps

- **[CONFIG.md](./guides/CONFIG.md)** - Configuration guide
  - Configuration file format
  - Environment variables
  - CLI arguments
  - OIDC provider setup

### Research

Investigation notes, proof-of-concepts, and test results:

- **[README-device-flow-poc.md](./research/README-device-flow-poc.md)** - Device flow proof of concept
  - Device flow investigation
  - Why it wasn't suitable
  - Lessons learned

- **[device-flow-test-results.md](./research/device-flow-test-results.md)** - Test results from device flow experiments
  - Auth0 device flow testing
  - Success/failure scenarios
  - Performance metrics

- **[oidc-callback-investigation.md](./research/oidc-callback-investigation.md)** - Callback URL investigation
  - Callback URL requirements
  - localhost vs 127.0.0.1
  - OIDC provider quirks

- **[oidc-auth/](./research/oidc-auth/)** - Detailed OIDC flow analysis
  - `oidc-authentication-setup.md` - Initial setup research
  - `oidc-flow-analysis.md` - Flow analysis v1
  - `oidc-flow-analysis-v2.md` - Updated flow analysis

### Scripts

Helper scripts for development and troubleshooting:

- **[find-working-callback.sh](./scripts/find-working-callback.sh)** - Test different callback URL configurations
- **[investigate-kubectl-oidc.sh](./scripts/investigate-kubectl-oidc.sh)** - Analyze how kubectl oidc-login works

## Getting Started

If you're new to OIDC Authenticator:

1. **Start here**: [Main README](../README.md) - Quick start and basic usage
2. **Installation**: [guides/INSTALL.md](./guides/INSTALL.md) - Install the tool
3. **Configuration**: [guides/CONFIG.md](./guides/CONFIG.md) - Set up your config
4. **Architecture**: [architecture/architecture-local-oidc-client.md](./architecture/architecture-local-oidc-client.md) - Understand how it works

## Key Concepts

### Browser-Initiated Authentication

Unlike traditional OAuth where the server redirects the user, OIDC Authenticator:
1. Runs as a daemon on the user's laptop
2. User opens `http://localhost:8000` to initiate auth
3. Daemon redirects to OIDC provider
4. After login, tokens are sent to Backstage server

### Why This Architecture?

- **Private networks**: Backstage doesn't need to be publicly accessible
- **Security**: Tokens never leave the user's machine except to go to Backstage
- **Flexibility**: Works with any OIDC provider
- **User experience**: Similar to kubectl oidc-login - familiar to developers

## Common Workflows

### For Users

```bash
# 1. Configure
cd oidc-authenticator
cp config.example.json config.json
# Edit config.json with your values

# 2. Run daemon
node bin/cli.js --daemon --verbose

# 3. Authenticate
# Open http://localhost:8000 in browser
# Or click login button in Backstage
```

### For Developers

```bash
# Test with mock backend
cd docs/scripts
node test-backend.js

# Run daemon
cd ../../
node bin/cli.js --daemon --backend-url http://localhost:7007 --verbose

# Test authentication
open http://localhost:8000
```

### For Integrators

See:
- [Main README - Integration with Backstage](../README.md#integration-with-backstage)
- [Architecture - Backstage Integration](./architecture/architecture-local-oidc-client.md#backstage-integration)

## Development

### Running Tests

```bash
# Check if daemon is running
curl http://localhost:8000/health

# Test authentication flow
open http://localhost:8000

# Monitor logs
# Run daemon with --verbose flag
```

### Documentation

To update documentation:

1. **User-facing**: Edit [../README.md](../README.md)
2. **Architecture**: Add/update files in [architecture/](./architecture/)
3. **Guides**: Add/update files in [guides/](./guides/)
4. **Research**: Add notes to [research/](./research/)

### Scripts

Helper scripts in [scripts/](./scripts/) can be used during development:

```bash
# Find working callback URL
./scripts/find-working-callback.sh

# Investigate kubectl oidc-login behavior
./scripts/investigate-kubectl-oidc.sh
```

## Troubleshooting

See [Main README - Troubleshooting](../README.md#troubleshooting) for common issues.

For development-specific issues, check:
- [research/oidc-callback-investigation.md](./research/oidc-callback-investigation.md) - Callback URL issues
- [research/device-flow-test-results.md](./research/device-flow-test-results.md) - Device flow issues

## Contributing

When adding new documentation:

1. **Architecture docs** → `architecture/` - Design decisions, flow diagrams
2. **User guides** → `guides/` - How-to guides, tutorials
3. **Research notes** → `research/` - Investigations, experiments, test results
4. **Helper scripts** → `scripts/` - Automation, testing, debugging tools

Update this README.md to link to new documentation.

## Related Projects

- [kubectl oidc-login](https://github.com/int128/kubelogin) - Inspiration for this tool
- [Backstage](https://backstage.io/) - Platform this tool integrates with
- [Auth0](https://auth0.com/docs/api/authentication) - OIDC provider documentation

## License

MIT - See [../package.json](../package.json) for details
