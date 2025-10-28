# Installation & Quick Start Guide

## ✅ The `oidc-authenticator` CLI tool is ready!

Location: `/Users/felix/work/open-service-portal/portal-workspace/oidc-authenticator`

## Quick Test

```bash
cd /Users/felix/work/open-service-portal/portal-workspace/oidc-authenticator

node bin/cli.js \
  --issuer https://login.spot.rackspace.com/ \
  --client-id mwG3lUMV8KyeMqHe4fJ5Bb3nM1vBvRNa \
  --organization org_zOuCBHiyF1yG8d1D \
  --output tokens.json
```

## Install Locally for Development

```bash
cd /Users/felix/work/open-service-portal/portal-workspace/oidc-authenticator

# Link globally (makes `oidc-authenticator` command available)
npm link

# Now use from anywhere
oidc-authenticator --help
```

## Install from NPM (Future)

Once published:

```bash
npm install -g oidc-authenticator
```

## Usage Examples

### 1. Get tokens and save to file

```bash
oidc-authenticator \
  --issuer https://login.spot.rackspace.com/ \
  --client-id mwG3lUMV8KyeMqHe4fJ5Bb3nM1vBvRNa \
  --organization org_zOuCBHiyF1yG8d1D \
  --output ~/.kube/oidc-tokens.json
```

### 2. Use environment variables

```bash
export OIDC_ISSUER_URL=https://login.spot.rackspace.com/
export OIDC_CLIENT_ID=mwG3lUMV8KyeMqHe4fJ5Bb3nM1vBvRNa
export OIDC_ORGANIZATION_ID=org_zOuCBHiyF1yG8d1D

oidc-authenticator --output tokens.json
```

### 3. Extract ID token for kubectl

```bash
# Authenticate and save
oidc-authenticator \
  --issuer https://login.spot.rackspace.com/ \
  --client-id mwG3lUMV8KyeMqHe4fJ5Bb3nM1vBvRNa \
  --organization org_zOuCBHiyF1yG8d1D \
  --output tokens.json

# Extract ID token
ID_TOKEN=$(cat tokens.json | jq -r '.id_token')

# Use with kubectl
kubectl --token="$ID_TOKEN" get pods
```

### 4. Silent mode (for scripts)

```bash
oidc-authenticator \
  --issuer https://login.spot.rackspace.com/ \
  --client-id mwG3lUMV8KyeMqHe4fJ5Bb3nM1vBvRNa \
  --silent \
  --output tokens.json

# Only errors will be printed
```

## Integration with Backstage

### Backend reads tokens

```typescript
// packages/backend/src/services/cluster-auth/TokenReader.ts
import fs from 'fs';
import os from 'homedir';
import path from 'path';

export class TokenReader {
  readTokensForUser(userId: string): Tokens | null {
    const tokenPath = path.join(os.homedir(), '.kube', 'oidc-tokens.json');

    if (!fs.existsSync(tokenPath)) {
      return null;
    }

    const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));

    // Check expiration
    const idToken = this.parseJWT(tokens.id_token);
    if (idToken.exp * 1000 < Date.now()) {
      return null; // Expired
    }

    return tokens;
  }
}
```

### Frontend shows instructions

```typescript
// packages/app/src/components/ClusterAuthButton.tsx
export const ClusterAuthButton = () => {
  const [showInstructions, setShowInstructions] = useState(false);

  return (
    <>
      <Button onClick={() => setShowInstructions(true)}>
        Authenticate with Cluster
      </Button>

      {showInstructions && (
        <Dialog open onClose={() => setShowInstructions(false)}>
          <DialogTitle>Authenticate with K8s Cluster</DialogTitle>
          <DialogContent>
            <Typography>Run this command in your terminal:</Typography>
            <Code>
              {`oidc-authenticator \\
  --issuer https://login.spot.rackspace.com/ \\
  --client-id YOUR_CLIENT_ID \\
  --organization YOUR_ORG_ID \\
  --output ~/.kube/oidc-tokens.json`}
            </Code>
            <Typography>
              After authentication, refresh this page to access K8s resources.
            </Typography>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};
```

## Tested & Working

✅ **Tested on**: 2025-10-28
✅ **Result**: Successfully authenticated
✅ **Tokens**: Saved to `/tmp/oidc-authenticator-test.json`
✅ **Token validity**: 24 hours (86400 seconds)
✅ **Scopes**: openid profile email

## File Structure

```
oidc-authenticator/
├── package.json          # NPM package configuration
├── bin/
│   └── cli.js           # CLI entry point (executable)
├── lib/
│   └── index.js         # Core authentication logic
├── README.md            # Full documentation
├── INSTALL.md           # This file
└── .gitignore          # Git ignore rules
```

## Next Steps

1. ✅ Tool is working
2. ⏭️ Test with kubectl integration
3. ⏭️ Integrate with Backstage backend
4. ⏭️ Publish to NPM (optional)
5. ⏭️ Create GitHub repository (optional)

## Support

For issues or questions:
- Check README.md for full documentation
- View source code in lib/index.js
- Test with: `node bin/cli.js --help`
