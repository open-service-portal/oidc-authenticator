# OIDC Authentication Setup Guide

This document explains the OIDC authentication setup in the Backstage application and how to make custom authentication providers appear in the Settings page.

## Overview

The Backstage application is configured with OIDC (OpenID Connect) authentication support using a custom backend provider and frontend API integration.

## Components

### Backend Components

1. **OIDC PKCE Authenticator** (`packages/backend/src/auth-providers/oidc-pkce-authenticator.ts`)
   - Custom OAuth authenticator that supports PKCE (Proof Key for Code Exchange) for public clients
   - Allows OIDC authentication without requiring a client secret

2. **OIDC Sign-In Resolvers** (`packages/backend/src/auth-providers/oidc-pkce-resolvers.ts`)
   - Custom resolvers for matching OIDC claims to Backstage user entities
   - Includes `emailMatchingUserEntityProfileEmail` resolver

3. **OIDC PKCE Module** (`packages/backend/src/auth-providers/oidc-pkce-module.ts`)
   - Backend module that registers the custom OIDC provider
   - Loaded in `packages/backend/src/index.ts` via `backend.add(import('./auth-providers'))`

### Frontend Components

1. **OIDC Auth API Reference** (`packages/app/src/apis/oidcAuthApiRef.ts`)
   - Defines the API reference for OIDC authentication
   - Implements all required auth interfaces: `OAuthApi`, `OpenIdConnectApi`, `ProfileInfoApi`, `BackstageIdentityApi`, `SessionApi`

2. **OIDC Auth API Implementation** (`packages/app/src/modules/auth/oidcAuth.tsx`)
   - Creates the OIDC auth API using `OAuth2.create()` with the correct `ApiBlueprint` pattern
   - Uses `defineParams` pattern (not `createApiFactory` + `createExtensionBlueprintParams`)
   - Provides PKCE support automatically

3. **Custom Auth Module** (`packages/app/src/modules/auth/index.tsx`)
   - Frontend module that exports the OIDC auth API extension
   - Registered in `App.tsx` as `customAuthModule`

4. **Sign-In Page** (`packages/app/src/App.tsx`)
   - Custom sign-in page that includes OIDC provider alongside GitHub and Guest
   - Uses `SignInPageBlueprint` with explicit provider configuration

### Settings Page Integration

5. **Custom Auth Providers Component** (`packages/app/src/components/CustomAuthProviders.tsx`)
   - Lists authentication providers that should appear in Settings > Authentication Providers
   - Required because Backstage's default settings page only shows hardcoded providers (GitHub, Google, Okta, etc.)
   - Custom providers like OIDC must be explicitly added here

6. **User Settings Module** (`packages/app/src/modules/userSettings/index.tsx`)
   - Frontend module that customizes the user-settings plugin
   - Creates an extension that attaches to the `providerSettings` input of the `page:user-settings` extension
   - Provides the `CustomAuthProviders` component to the settings page

## Configuration

### Backend Configuration (`app-config/auth.yaml`)

```yaml
auth:
  environment: development
  providers:
    guest:
      userEntityRef: user:default/guest

    github:
      development:
        clientId: ${AUTH_GITHUB_CLIENT_ID}
        clientSecret: ${AUTH_GITHUB_CLIENT_SECRET}
        signIn:
          resolvers:
            - resolver: usernameMatchingUserEntityName

    oidc:
      development:
        metadataUrl: https://your-idp.example.com/.well-known/openid-configuration
        clientId: ${OIDC_CLIENT_ID}
        # No clientSecret needed - will use PKCE automatically
        prompt: auto
        additionalAuthParams:
          - key: organization
            value: ${OIDC_ORGANIZATION_ID}
        signIn:
          resolvers:
            - resolver: emailMatchingUserEntityProfileEmail
```

### Frontend Registration (`packages/app/src/App.tsx`)

```typescript
import { customAuthModule } from './modules/auth';
import { userSettingsModule } from './modules/userSettings';

const app = createApp({
  features: [
    // ... other plugins
    userSettingsPlugin,        // Base user-settings plugin
    userSettingsModule,        // Custom provider settings (includes OIDC)
    customAuthModule,          // OIDC auth provider API
    authModule,                // Sign-in page configuration
    // ... other features
  ],
});
```

## Why Custom Provider Settings Are Needed

### The Problem

Backstage's default Settings > Authentication Providers page uses a **hardcoded list** of known providers in `DefaultProviderSettings.tsx`:

```typescript
// Hardcoded checks in @backstage/plugin-user-settings
{configuredProviders.includes('google') && <ProviderSettingsItem ... />}
{configuredProviders.includes('github') && <ProviderSettingsItem ... />}
{configuredProviders.includes('okta') && <ProviderSettingsItem ... />}
// ... but NO check for 'oidc'!
```

Even if you configure `auth.providers.oidc` in your config, it won't appear in the settings page because it's not in this hardcoded list.

### The Solution

Use the New Frontend System's **extension input system** to provide custom provider settings:

1. **Create an extension** that outputs a React component listing your providers
2. **Attach it to the `providerSettings` input** of the `page:user-settings` extension
3. **Wrap it in a frontend module** with `pluginId: 'user-settings'`
4. **Register the module** in your app's `features` array

This leverages the extension tree architecture:

```
app (root)
└── page:user-settings (from @backstage/plugin-user-settings/alpha)
    └── inputs:
        └── providerSettings (input slot)
            └── extension:app/custom-provider-settings (your extension)
                └── output: <CustomAuthProviders /> component
```

## Key Differences: New Frontend System

### ApiBlueprint Pattern

**❌ WRONG (old pattern):**
```typescript
export const oidcAuthApi = ApiBlueprint.make({
  name: 'oidc',
  params: (apiFactory) => createExtensionBlueprintParams(
    createApiFactory({
      api: oidcAuthApiRef,
      deps: { ... },
      factory: ({ ... }) => OAuth2.create({ ... }),
    })
  ),
});
```

**✅ CORRECT (new pattern):**
```typescript
export const oidcAuthApi = ApiBlueprint.make({
  name: 'oidc',
  params: defineParams =>
    defineParams({
      api: oidcAuthApiRef,
      deps: { ... },
      factory: ({ ... }) => OAuth2.create({ ... }),
    }),
});
```

**Key Changes:**
- Use `defineParams` callback parameter (not `apiFactory`)
- Call `defineParams()` directly with factory parameters
- No need for `createExtensionBlueprintParams()` or `createApiFactory()` wrappers

## Testing

### Sign-In Page
1. Navigate to http://localhost:3000/
2. Verify three providers appear:
   - Guest
   - GitHub
   - OIDC ✅

### Settings Page
1. Navigate to http://localhost:3000/settings/auth-providers
2. Verify two providers appear:
   - GitHub
   - OIDC ✅

### Authentication Flow
1. Click "Sign in" next to OIDC provider
2. Should redirect to OIDC provider login page
3. After successful authentication, should redirect back to Backstage
4. User profile should be resolved using email claim

## Files Created/Modified

### Created Files
- `packages/app/src/components/CustomAuthProviders.tsx` - Custom provider list component
- `packages/app/src/modules/userSettings/index.tsx` - User settings extension module
- `docs/backstage/oidc-authentication-setup.md` - This documentation

### Modified Files
- `packages/app/src/modules/auth/oidcAuth.tsx` - Fixed ApiBlueprint pattern
- `packages/app/src/App.tsx` - Added `userSettingsModule` to features array

## References

- [Backstage New Frontend System](https://backstage.io/docs/frontend-system/)
- [Extension Overrides Documentation](https://backstage.io/docs/frontend-system/architecture/extension-overrides)
- [User Settings Plugin](https://github.com/backstage/backstage/tree/master/plugins/user-settings)
- [OIDC Authentication Guide](https://backstage.io/docs/auth/oidc/)

## Troubleshooting

### OIDC doesn't appear in settings
- Verify `userSettingsModule` is in `features` array in `App.tsx`
- Check browser console for extension loading errors
- Ensure `auth.providers.oidc` is configured in `app-config.yaml`

### Sign-in fails
- Check backend logs for authentication errors
- Verify OIDC provider metadata URL is accessible
- Confirm client ID is correct
- Check OIDC provider allows redirect URI: `http://localhost:7007/api/auth/oidc/handler/frame`

### Sign-out button missing
- Verify `oidcAuthApiRef` implements `SessionApi` interface
- Check that `OAuth2.create()` is used (automatically provides SessionApi)

## Security Notes

- **PKCE Support**: The OIDC implementation uses PKCE (Proof Key for Code Exchange) which is secure for public clients
- **No Client Secret**: PKCE eliminates the need to store client secrets in the frontend
- **Token Storage**: Access tokens are stored in browser storage managed by Backstage's auth framework
- **Token Refresh**: Automatic token refresh is handled by `OAuth2.create()`
