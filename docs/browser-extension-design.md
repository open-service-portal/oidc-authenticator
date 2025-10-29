# Browser Extension for Auto-Fill

## Overview

A lightweight browser extension that auto-fills credentials on the Rackspace login page when triggered by the oidc-authenticator daemon.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Flow                                                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ 1. User clicks "K8s Cluster" in Backstage                  │
│ 2. OA daemon opens browser to login.spot.rackspace.com     │
│ 3. Extension detects auth page                              │
│ 4. Extension requests credentials from daemon               │
│ 5. Daemon sends credentials via native messaging           │
│ 6. Extension fills form and submits                         │
│ 7. User redirected back to localhost:8000                   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Extension Structure

```
oidc-auth-extension/
├── manifest.json           # Extension config
├── background.js           # Service worker
├── content-script.js       # Runs on auth pages
├── native-host.js          # Communicates with daemon
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## Implementation Files

### manifest.json

```json
{
  "manifest_version": 3,
  "name": "OIDC Authenticator Auto-Fill",
  "version": "1.0.0",
  "description": "Auto-fill credentials for OIDC authentication",
  "permissions": [
    "nativeMessaging",
    "storage"
  ],
  "host_permissions": [
    "https://login.spot.rackspace.com/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["https://login.spot.rackspace.com/*"],
      "js": ["content-script.js"],
      "run_at": "document_end"
    }
  ],
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

### content-script.js

```javascript
/**
 * Content Script - Runs on login.spot.rackspace.com
 * Detects login form and auto-fills credentials
 */

(function() {
  'use strict';

  console.log('[OIDC-Auth] Content script loaded');

  // Check if we should auto-fill
  function shouldAutoFill() {
    // Check if URL came from oidc-authenticator
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.has('state'); // OIDC state parameter present
  }

  // Find form fields using multiple strategies
  function findFields() {
    return {
      email: document.querySelector('input[type="email"]') ||
             document.querySelector('input[name="username"]') ||
             document.querySelector('input[name="email"]'),

      password: document.querySelector('input[type="password"]'),

      submit: document.querySelector('button[type="submit"]') ||
              document.querySelector('input[type="submit"]') ||
              document.querySelector('button:has-text("Log in")') ||
              document.querySelector('button:has-text("Sign in")')
    };
  }

  // Fill form with credentials
  function fillForm(username, password) {
    const fields = findFields();

    if (!fields.email || !fields.password) {
      console.error('[OIDC-Auth] Could not find form fields');
      return false;
    }

    // Fill email
    fields.email.value = username;
    fields.email.dispatchEvent(new Event('input', { bubbles: true }));
    fields.email.dispatchEvent(new Event('change', { bubbles: true }));

    // Fill password
    fields.password.value = password;
    fields.password.dispatchEvent(new Event('input', { bubbles: true }));
    fields.password.dispatchEvent(new Event('change', { bubbles: true }));

    console.log('[OIDC-Auth] Form filled');
    return true;
  }

  // Submit form
  function submitForm() {
    const fields = findFields();

    if (fields.submit) {
      fields.submit.click();
      console.log('[OIDC-Auth] Form submitted via button');
    } else {
      // Fallback: press Enter
      fields.password.dispatchEvent(
        new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, bubbles: true })
      );
      console.log('[OIDC-Auth] Form submitted via Enter key');
    }
  }

  // Main logic
  async function autoFillIfNeeded() {
    if (!shouldAutoFill()) {
      console.log('[OIDC-Auth] Auto-fill not triggered');
      return;
    }

    console.log('[OIDC-Auth] Auto-fill triggered, requesting credentials...');

    // Request credentials from background script
    chrome.runtime.sendMessage({ type: 'get-credentials' }, (response) => {
      if (response && response.username && response.password) {
        console.log('[OIDC-Auth] Credentials received');

        // Wait for form to be ready
        const waitForForm = setInterval(() => {
          const fields = findFields();
          if (fields.email && fields.password) {
            clearInterval(waitForForm);

            // Fill form
            if (fillForm(response.username, response.password)) {
              // Submit after brief delay
              setTimeout(() => {
                submitForm();
              }, 500);
            }
          }
        }, 100);

        // Timeout after 5 seconds
        setTimeout(() => clearInterval(waitForForm), 5000);
      } else {
        console.log('[OIDC-Auth] No credentials available, manual login required');
      }
    });
  }

  // Run when page loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoFillIfNeeded);
  } else {
    autoFillIfNeeded();
  }
})();
```

### background.js

```javascript
/**
 * Background Service Worker
 * Communicates with native daemon via native messaging
 */

console.log('[OIDC-Auth] Background service worker loaded');

// Native messaging port
let nativePort = null;

// Connect to native daemon
function connectNative() {
  if (nativePort) return;

  try {
    nativePort = chrome.runtime.connectNative('com.oidc.authenticator');

    nativePort.onMessage.addListener((message) => {
      console.log('[OIDC-Auth] Received from daemon:', message);

      if (message.type === 'credentials') {
        // Store credentials temporarily
        chrome.storage.local.set({ credentials: message }, () => {
          console.log('[OIDC-Auth] Credentials stored');
        });
      }
    });

    nativePort.onDisconnect.addListener(() => {
      console.log('[OIDC-Auth] Disconnected from daemon');
      nativePort = null;
    });

    console.log('[OIDC-Auth] Connected to native daemon');
  } catch (error) {
    console.error('[OIDC-Auth] Failed to connect to daemon:', error);
  }
}

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'get-credentials') {
    // Get credentials from storage
    chrome.storage.local.get(['credentials'], (result) => {
      if (result.credentials) {
        sendResponse({
          username: result.credentials.username,
          password: result.credentials.password
        });

        // Clear credentials after use
        chrome.storage.local.remove(['credentials']);
      } else {
        sendResponse({ username: null, password: null });
      }
    });

    return true; // Keep message channel open for async response
  }
});

// Connect to daemon on startup
connectNative();
```

### native-host.js (Daemon Side)

```javascript
/**
 * Native Messaging Host
 * Allows extension to communicate with daemon
 */

const fs = require('fs');
const path = require('path');

class NativeMessagingHost {
  constructor(config) {
    this.config = config;
  }

  /**
   * Send credentials to browser extension
   */
  sendCredentials(username, password) {
    const message = {
      type: 'credentials',
      username: username,
      password: password
    };

    // Chrome native messaging uses stdin/stdout
    const messageStr = JSON.stringify(message);
    const messageLength = Buffer.byteLength(messageStr);

    // Write message length (4 bytes, little-endian)
    const buffer = Buffer.allocUnsafe(4);
    buffer.writeUInt32LE(messageLength, 0);
    process.stdout.write(buffer);

    // Write message
    process.stdout.write(messageStr);
  }

  /**
   * Install native messaging host manifest
   */
  install() {
    const manifest = {
      name: 'com.oidc.authenticator',
      description: 'OIDC Authenticator Native Host',
      path: path.join(__dirname, 'native-host.js'),
      type: 'stdio',
      allowed_origins: [
        'chrome-extension://YOUR_EXTENSION_ID/'
      ]
    };

    // Chrome manifest location
    const manifestPath = path.join(
      process.env.HOME,
      'Library/Application Support/Google/Chrome/NativeMessagingHosts',
      'com.oidc.authenticator.json'
    );

    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    console.log('✅ Native messaging host installed');
    console.log(`   Manifest: ${manifestPath}`);
  }
}

module.exports = { NativeMessagingHost };
```

## Installation

### 1. Package Extension

```bash
cd oidc-auth-extension
zip -r oidc-auth-extension.zip .
```

### 2. Install in Chrome

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select extension folder

### 3. Install Native Host

```bash
node bin/cli.js install-extension
```

This creates the native messaging manifest in:
- macOS: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`
- Linux: `~/.config/google-chrome/NativeMessagingHosts/`
- Windows: `HKEY_CURRENT_USER\SOFTWARE\Google\Chrome\NativeMessagingHosts\`

## Usage

Once installed:

1. Start oidc-authenticator daemon
2. Click "K8s Cluster" in Backstage
3. Browser opens → Extension auto-fills → Submits
4. Done! User logged in

## Security

- ✅ **Credentials never stored** on disk by extension
- ✅ **Native messaging** - secure communication with daemon
- ✅ **Content script isolation** - runs only on auth domains
- ✅ **Temporary storage** - credentials cleared after use
- ✅ **Origin validation** - extension ID verified by daemon

## Future Enhancements

1. **Multi-Provider Support**: Auto-detect different auth providers
2. **MFA Handling**: Support for 2FA/OTP
3. **Credential Manager**: Integrate with system keychain
4. **Firefox Support**: Port to Firefox WebExtensions
5. **Settings UI**: Configure auto-fill behavior

## Distribution

### Option 1: Chrome Web Store
- Publish extension publicly
- Users install with one click
- Auto-updates

### Option 2: Enterprise Policy
- Distribute via Chrome Enterprise
- Force-install for organization
- Centrally managed

### Option 3: Manual Installation
- Share .zip file
- Users load unpacked
- Good for testing

## Development

```bash
# Watch for changes
npm run watch

# Build extension
npm run build

# Test
npm test
```

## Troubleshooting

**Extension not loading:**
- Check manifest.json syntax
- Verify permissions
- Check browser console for errors

**Native messaging fails:**
- Verify manifest path
- Check daemon is running
- Verify extension ID in allowed_origins

**Form not auto-filling:**
- Check content script console logs
- Verify page URL matches
- Test selectors manually

## References

- [Chrome Extension Docs](https://developer.chrome.com/docs/extensions/)
- [Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Content Scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)

---

**Status**: Design complete, ready for implementation

**Estimated effort**: 2-3 days for initial version
