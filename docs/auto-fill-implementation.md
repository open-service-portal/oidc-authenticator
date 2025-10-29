# Auto-Fill Implementation Guide

## Recommended: Puppeteer-Core with Chrome DevTools Protocol

### Why This Approach?

- ✅ **No browser extension needed**
- ✅ **Full control** over browser automation
- ✅ **User sees browser** (visible mode for trust)
- ✅ **Can be headless** for CI/CD
- ✅ **Handles complex flows** (redirects, MFA, etc.)

### Installation

```bash
npm install puppeteer-core --save
```

**Note**: `puppeteer-core` doesn't download Chromium - uses your system Chrome.

### Implementation

```javascript
// lib/auto-fill.js
const puppeteer = require('puppeteer-core');
const { exec } = require('child_process');
const os = require('os');

class AutoFill {
  constructor(config) {
    this.config = config;
    this.verbose = config.verbose || false;
  }

  log(message) {
    if (this.verbose) {
      console.log(message);
    }
  }

  /**
   * Find Chrome executable path
   */
  findChrome() {
    const platform = os.platform();

    if (platform === 'darwin') {
      return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    } else if (platform === 'win32') {
      return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    } else {
      // Linux
      return '/usr/bin/google-chrome';
    }
  }

  /**
   * Auto-fill and submit authentication form
   * @param {string} authUrl - Authorization URL
   * @param {string} username - Email/username
   * @param {string} password - Password
   * @returns {Promise<string>} - Callback URL with code
   */
  async autoFillAndSubmit(authUrl, username, password) {
    this.log('🤖 Starting auto-fill...');

    let browser;
    try {
      browser = await puppeteer.launch({
        executablePath: this.findChrome(),
        headless: false, // User sees browser (more trustworthy)
        defaultViewport: { width: 600, height: 700 },
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--window-size=600,700'
        ]
      });

      const page = await browser.newPage();

      // Navigate to auth URL
      this.log(`🌐 Opening: ${authUrl}`);
      await page.goto(authUrl, { waitUntil: 'networkidle2' });

      // Wait for login form
      this.log('⏳ Waiting for login form...');
      await page.waitForSelector('input[type="email"], input[type="text"], input[type="password"]', {
        timeout: 10000
      });

      // Small delay to let page fully render
      await page.waitForTimeout(500);

      // Find and fill email field
      this.log('📝 Filling username...');
      const emailFilled = await page.evaluate((username) => {
        // Try multiple selectors
        const selectors = [
          'input[type="email"]',
          'input[name="username"]',
          'input[name="email"]',
          'input[placeholder*="email" i]',
          'input[placeholder*="username" i]'
        ];

        for (const selector of selectors) {
          const input = document.querySelector(selector);
          if (input) {
            input.value = username;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        }
        return false;
      }, username);

      if (!emailFilled) {
        throw new Error('Could not find email/username field');
      }

      // Find and fill password field
      this.log('🔑 Filling password...');
      const passwordFilled = await page.evaluate((password) => {
        const input = document.querySelector('input[type="password"]');
        if (input) {
          input.value = password;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        return false;
      }, password);

      if (!passwordFilled) {
        throw new Error('Could not find password field');
      }

      // Find and click submit button
      this.log('👆 Submitting form...');
      const submitted = await page.evaluate(() => {
        // Try multiple button selectors
        const selectors = [
          'button[type="submit"]',
          'input[type="submit"]',
          'button:has-text("Log in")',
          'button:has-text("Sign in")',
          'button:has-text("Continue")',
          'form button[type="button"]' // Some forms use button[type="button"]
        ];

        for (const selector of selectors) {
          const buttons = document.querySelectorAll(selector);
          for (const button of buttons) {
            // Check if button is visible
            const style = window.getComputedStyle(button);
            if (style.display !== 'none' && style.visibility !== 'hidden') {
              button.click();
              return true;
            }
          }
        }

        // Fallback: submit form directly
        const form = document.querySelector('form');
        if (form) {
          form.submit();
          return true;
        }

        return false;
      });

      if (!submitted) {
        this.log('⚠️  Could not find submit button, trying Enter key...');
        await page.keyboard.press('Enter');
      }

      // Wait for redirect to callback URL
      this.log('⏳ Waiting for callback...');
      await page.waitForFunction(
        (port) => {
          return window.location.href.includes('localhost:' + port) &&
                 window.location.href.includes('code=');
        },
        { timeout: 30000 },
        this.config.callbackPort
      );

      const callbackUrl = page.url();
      this.log('✅ Auto-fill successful!');

      await browser.close();
      return callbackUrl;

    } catch (error) {
      this.log(`❌ Auto-fill failed: ${error.message}`);
      if (browser) {
        await browser.close();
      }
      throw error;
    }
  }
}

module.exports = { AutoFill };
```

### Integration with OIDCAuthenticator

```javascript
// lib/index.js - Update authenticate() method

async authenticate() {
  // ... existing PKCE setup ...

  // Check if auto-fill is enabled
  if (this.config.autoLoginEnabled && this.config.username && this.config.password) {
    this.log('🤖 Auto-fill enabled, using automated login');

    const { AutoFill } = require('./auto-fill');
    const autoFill = new AutoFill(this.config);

    try {
      const callbackUrl = await autoFill.autoFillAndSubmit(
        authUrl,
        this.config.username,
        this.config.password
      );

      // Extract code from callback URL
      const url = new URL(callbackUrl);
      const code = url.searchParams.get('code');

      // Continue with token exchange...
      const tokens = await this.exchangeCodeForTokens(code, codeVerifier);
      return tokens;

    } catch (error) {
      this.log('⚠️  Auto-fill failed, falling back to manual login');
      // Fallback to normal browser flow
      return this.openBrowserAndWaitForCallback(authUrl);
    }
  }

  // Normal flow without auto-fill
  return this.openBrowserAndWaitForCallback(authUrl);
}
```

### Configuration

```yaml
# config.yaml
autoLogin:
  username: "felix@example.com"
  password: "your-password"
  # Auto-fill enabled automatically when both are provided
```

### Security Considerations

1. **Credentials in Memory**: Only stored in memory during authentication
2. **No Logging**: Credentials never logged (even in verbose mode)
3. **Browser Visibility**: User sees browser (trust)
4. **HTTPS Only**: Only works with HTTPS auth providers
5. **Local Only**: Browser runs locally, not remotely

### Troubleshooting

**Chrome not found:**
```bash
# Set custom Chrome path
export CHROME_PATH="/path/to/chrome"
```

**Form not detected:**
- Enable verbose mode: `--verbose`
- Check browser console for errors
- May need custom selectors for your IdP

**Timeout:**
- Increase timeout in config
- Check network connectivity
- Verify credentials are correct

### Alternative: Full Playwright

If you need more features:

```bash
npm install playwright --save
npx playwright install chromium
```

Playwright is heavier but more powerful (can handle downloads, PDFs, etc.).

## Other Options

### Browser Extension
- Pros: Clean, works everywhere
- Cons: One-time installation required
- Best for: Organizations with many users

### Bookmarklet
- Pros: No installation
- Cons: Manual action needed
- Best for: Occasional use

### CDP Direct
- Pros: Lightweight
- Cons: More complex code
- Best for: Advanced users

## Recommendation

**Start with Puppeteer-Core** - it's the sweet spot:
- Easy to implement
- Good user experience
- Can fallback to manual if needed
- Works for 90% of users
