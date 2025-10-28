# Device Flow Proof of Concept

This directory contains a proof-of-concept script to test OAuth Device Authorization Flow with the Rackspace Auth0 IDP.

## Purpose

Before implementing the device flow in Backstage, we need to validate that:
1. ✅ Rackspace IDP supports device authorization flow
2. ✅ We can obtain tokens without localhost callbacks
3. ✅ The flow works end-to-end with our client credentials
4. ✅ The ID token can be used for K8s cluster authentication

## What the Script Does

The script simulates the complete device flow:

```
1. Request device code from Auth0
   ↓
2. Display user code and verification URL
   ↓
3. Poll Auth0 every 5 seconds for completion
   ↓
4. Receive tokens when user completes authentication
   ↓
5. Test token by fetching user info
```

## Prerequisites

- Node.js installed
- Rackspace Auth0 client credentials
- Internet connection

## Running the Test

### Option 1: Using Default Client ID (from auth.yaml)

```bash
cd /Users/felix/work/open-service-portal/portal-workspace/scripts

# Run with default configuration
node test-device-flow.js
```

### Option 2: Using Custom Credentials

```bash
# Set environment variables
export OIDC_CLIENT_ID="your-client-id"
export OIDC_CLIENT_SECRET="your-client-secret"  # Optional
export OIDC_ORGANIZATION_ID="org_xxxxx"        # Optional

# Run the script
node test-device-flow.js
```

### Option 3: Make it Executable

```bash
chmod +x test-device-flow.js
./test-device-flow.js
```

## Expected Output

### Step 1: Device Authorization Initiated

```
============================================================
Step 1: Initiate Device Authorization Flow
============================================================
ℹ️  Requesting device code from: https://login.spot.rackspace.com/oauth/device/code
ℹ️  Client ID: mwG3lUMV8KyeMqHe4fJ5Bb3nM1vBvRNa
ℹ️  Organization: org_zOuCBHiyF1yG8d1D
ℹ️  Scopes: openid profile email
✅ Device authorization initiated successfully!

Response:
{
  "device_code": "x0ZXasdfqwer...",
  "user_code": "WDJB-MJHT",
  "verification_uri": "https://login.spot.rackspace.com/activate",
  "verification_uri_complete": "https://login.spot.rackspace.com/activate?user_code=WDJB-MJHT",
  "expires_in": 900,
  "interval": 5
}
```

### Step 2: User Instructions

```
============================================================
Step 2: User Authentication Required
============================================================

┌──────────────────────────────────────────────────────────┐
│                                                          │
│  🔐 AUTHENTICATION REQUIRED                             │
│                                                          │
└──────────────────────────────────────────────────────────┘

1️⃣  Open this URL in your browser:
   https://login.spot.rackspace.com/activate?user_code=WDJB-MJHT

2️⃣  Enter this code when prompted:
   WDJB-MJHT

3️⃣  Sign in with your Rackspace credentials

⏱️  This code expires in: 900 seconds
⏳ Polling interval: 5 seconds
```

### Step 3: Polling for Token

```
============================================================
Step 3: Polling for Token
============================================================
ℹ️  Waiting for user to complete authentication...
ℹ️  (This will automatically complete once you authenticate)

⏳ Polling... Attempt 12/180 [7%]
```

### Step 4: Tokens Received

```
✅ Authentication completed! Tokens received.

============================================================
Step 4: Tokens Received
============================================================
✅ Successfully obtained tokens!

📋 ID Token Claims:
{
  "iss": "https://login.spot.rackspace.com/",
  "sub": "auth0|507f1f77bcf86cd799439011",
  "aud": "mwG3lUMV8KyeMqHe4fJ5Bb3nM1vBvRNa",
  "exp": 1234567890,
  "iat": 1234564290,
  "email": "user@example.com",
  "email_verified": true,
  "org_id": "org_zOuCBHiyF1yG8d1D"
}

ℹ️  Subject (sub): auth0|507f1f77bcf86cd799439011
ℹ️  Email: user@example.com
ℹ️  Email Verified: true
ℹ️  Issued At: 2025-01-28T10:00:00.000Z
ℹ️  Expires At: 2025-01-28T11:00:00.000Z

🔑 Tokens received:
✅ Access Token: eyJhbGciOiJSUzI1NiI...
✅ ID Token: eyJhbGciOiJSUzI1NiI...
✅ Refresh Token: v1.MRrtnUKJPW...

ℹ️  Token Type: Bearer
ℹ️  Expires In: 3600 seconds
ℹ️  Scopes: openid profile email
```

### Step 5: Testing Token

```
============================================================
Step 5: Testing Token
============================================================
ℹ️  Fetching user info from userinfo endpoint...
✅ Successfully fetched user info!

User Info:
{
  "sub": "auth0|507f1f77bcf86cd799439011",
  "email": "user@example.com",
  "email_verified": true,
  "name": "John Doe",
  "nickname": "johndoe",
  "picture": "https://s.gravatar.com/avatar/...",
  "updated_at": "2025-01-28T10:00:00.000Z"
}
```

### Success!

```
============================================================
✅ SUCCESS
============================================================

✅ Device flow working correctly!
ℹ️  This flow can be integrated into Backstage to obtain K8s cluster tokens.

ℹ️  Tokens saved to: /tmp/device-flow-tokens.json
```

## What to Check

### ✅ Success Indicators

1. **Device code received**: Response contains `device_code`, `user_code`, `verification_uri`
2. **Polling works**: Script shows "Polling... Attempt X/Y"
3. **Authentication completes**: "✅ Authentication completed! Tokens received."
4. **ID token valid**: Claims show email, org_id, expiration
5. **Userinfo works**: Successfully fetched user profile

### ❌ Failure Scenarios

#### Error: Missing Client ID

```
❌ Missing OIDC_CLIENT_ID environment variable!
ℹ️  Usage: OIDC_CLIENT_ID=your-client-id node test-device-flow.js
```

**Fix**: Set the `OIDC_CLIENT_ID` environment variable.

#### Error: Invalid Client

```
❌ Failed to initiate device flow
{
  status: 401,
  data: {
    error: 'invalid_client',
    error_description: 'Client authentication failed'
  }
}
```

**Fix**:
- Check that client ID is correct
- Check if device flow is enabled for this client in Auth0
- Check if client_secret is required (add via `OIDC_CLIENT_SECRET`)

#### Error: Access Denied

```
❌ User denied the authentication request.
```

**Fix**: User clicked "Deny" on the authorization page. Run script again and click "Allow".

#### Error: Expired Token

```
❌ Device code expired! User took too long to authenticate.
```

**Fix**: Run script again and complete authentication within 900 seconds (15 minutes).

#### Error: Organization Not Allowed

```
{
  error: 'access_denied',
  error_description: 'Organization is not allowed'
}
```

**Fix**:
- Check `OIDC_ORGANIZATION_ID` is correct
- Check user is a member of the organization
- Check organization is configured in Auth0

## Inspecting Tokens

Tokens are saved to `/tmp/device-flow-tokens.json` for inspection:

```bash
# View saved tokens
cat /tmp/device-flow-tokens.json | jq

# Decode ID token (JWT)
cat /tmp/device-flow-tokens.json | jq -r '.id_token' | cut -d'.' -f2 | base64 -d | jq

# Check token expiration
cat /tmp/device-flow-tokens.json | jq -r '.id_token' | cut -d'.' -f2 | base64 -d | jq '.exp | todate'
```

## Testing with Kubernetes

Once you have a valid ID token, you can test it with Kubernetes:

```bash
# Extract ID token
ID_TOKEN=$(cat /tmp/device-flow-tokens.json | jq -r '.id_token')

# Test with kubectl (assuming your cluster is configured for OIDC)
kubectl --token="$ID_TOKEN" get pods

# Or set in kubeconfig temporarily
kubectl config set-credentials test-user --token="$ID_TOKEN"
kubectl config set-context --current --user=test-user
kubectl get pods
```

## Next Steps After Successful Test

Once the script works successfully:

1. ✅ **Confirmed**: Device flow works with Rackspace IDP
2. ✅ **Confirmed**: Can obtain ID token without localhost callback
3. ✅ **Confirmed**: ID token contains required claims (email, org_id)

Next, implement in Backstage:

1. **Backend Service**: `ClusterTokenService` (similar to this script)
2. **Frontend Modal**: Show user code and verification URL
3. **Token Storage**: Link tokens to Backstage user session
4. **Kubernetes Plugin**: Inject ID token into K8s API requests

## Troubleshooting

### Device Flow Not Supported

If you get an error about device flow not being supported:

```bash
# Check OIDC configuration
curl https://login.spot.rackspace.com/.well-known/openid-configuration | jq '.device_authorization_endpoint'

# Should return: "https://login.spot.rackspace.com/oauth/device/code"
```

### Cannot Poll Token Endpoint

If polling fails with CORS or network errors:

```bash
# Test token endpoint directly
curl -X POST https://login.spot.rackspace.com/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:device_code" \
  -d "device_code=YOUR_DEVICE_CODE" \
  -d "client_id=YOUR_CLIENT_ID"
```

### Script Hangs Forever

If the script polls indefinitely:

1. Check if you opened the verification URL in browser
2. Check if you entered the user code correctly
3. Check if you completed authentication
4. Check Auth0 logs for any errors

### Auth0 Dashboard

Check Auth0 dashboard for:
- **Logs**: Real-time authentication logs
- **Applications**: Client configuration
- **Organizations**: User membership
- **Connections**: Identity provider settings

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OIDC_CLIENT_ID` | No | From auth.yaml | OAuth client ID |
| `OIDC_CLIENT_SECRET` | No | None | OAuth client secret (if required) |
| `OIDC_ORGANIZATION_ID` | No | From auth.yaml | Rackspace organization ID |

## Files Created

- `/tmp/device-flow-tokens.json` - Tokens received from successful authentication
- Script uses no other files or databases

## Support

If you encounter issues:

1. Check this README for common errors
2. Review the script output for detailed error messages
3. Check Auth0 logs in the dashboard
4. Verify client configuration in Auth0
5. Test with `curl` to isolate issues

## References

- [RFC 8628: Device Authorization Grant](https://datatracker.ietf.org/doc/html/rfc8628)
- [Auth0 Device Flow Documentation](https://auth0.com/docs/get-started/authentication-and-authorization-flow/device-authorization-flow)
- [OIDC Discovery Specification](https://openid.net/specs/openid-connect-discovery-1_0.html)
