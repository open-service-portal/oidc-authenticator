#!/usr/bin/env node
/**
 * Proof of Concept: OIDC Login Like kubectl oidc-login
 *
 * This script mimics kubectl oidc-login behavior:
 * 1. Start local HTTP server on localhost:8000
 * 2. Generate PKCE challenge
 * 3. Open browser to Auth0 authorization URL
 * 4. Receive callback on local server
 * 5. Exchange authorization code for tokens
 *
 * Usage:
 *   node test-oidc-login.js
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');
const { exec } = require('child_process');

// Configuration
const CONFIG = {
  issuer: 'https://login.spot.rackspace.com',
  authorizationEndpoint: 'https://login.spot.rackspace.com/authorize',
  tokenEndpoint: 'https://login.spot.rackspace.com/oauth/token',
  clientId: process.env.OIDC_CLIENT_ID || 'mwG3lUMV8KyeMqHe4fJ5Bb3nM1vBvRNa',
  organizationId: process.env.OIDC_ORGANIZATION_ID || 'org_zOuCBHiyF1yG8d1D',
  scopes: 'openid profile email',
  callbackHost: 'localhost',  // Must use 'localhost' (Auth0 rejects 127.0.0.1)
  callbackPort: 8000,          // kubectl uses 8000 first, then 18000
  callbackPath: '/',           // Root path (not /callback)
};

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, colors.bright + colors.cyan);
  console.log('='.repeat(60));
}

function logSuccess(message) {
  log(`✅ ${message}`, colors.green);
}

function logError(message) {
  log(`❌ ${message}`, colors.red);
}

function logInfo(message) {
  log(`ℹ️  ${message}`, colors.blue);
}

function logWarning(message) {
  log(`⚠️  ${message}`, colors.yellow);
}

/**
 * Generate PKCE challenge
 */
function generatePKCE() {
  // Generate random code verifier (43-128 characters)
  const codeVerifier = crypto.randomBytes(32).toString('base64url');

  // Generate code challenge (SHA256 hash of verifier)
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  return { codeVerifier, codeChallenge };
}

/**
 * Generate random state
 */
function generateState() {
  return crypto.randomBytes(16).toString('base64url');
}

/**
 * Build authorization URL
 */
function buildAuthorizationUrl(codeChallenge, state) {
  const params = new URLSearchParams({
    client_id: CONFIG.clientId,
    response_type: 'code',
    redirect_uri: `http://${CONFIG.callbackHost}:${CONFIG.callbackPort}${CONFIG.callbackPath}`,
    scope: CONFIG.scopes,
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  // Add organization for Rackspace multi-tenant
  if (CONFIG.organizationId) {
    params.append('organization', CONFIG.organizationId);
  }

  return `${CONFIG.authorizationEndpoint}?${params.toString()}`;
}

/**
 * Open URL in browser
 */
function openBrowser(url) {
  const platform = process.platform;
  let command;

  if (platform === 'darwin') {
    command = `open "${url}"`;
  } else if (platform === 'win32') {
    command = `start "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }

  exec(command, (error) => {
    if (error) {
      logWarning('Could not open browser automatically');
      logInfo(`Please open this URL manually: ${url}`);
    }
  });
}

/**
 * Start local HTTP server to receive callback
 */
function startCallbackServer(expectedState) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${CONFIG.callbackPort}`);

      if (url.pathname === CONFIG.callbackPath) {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');
        const errorDescription = url.searchParams.get('error_description');

        if (error) {
          // Auth0 returned an error
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <head><title>Authentication Error</title></head>
              <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px;">
                <h1 style="color: #d32f2f;">❌ Authentication Failed</h1>
                <p><strong>Error:</strong> ${error}</p>
                <p><strong>Description:</strong> ${errorDescription || 'No description provided'}</p>
                <p>You can close this window and check the terminal.</p>
              </body>
            </html>
          `);
          server.close();
          reject(new Error(`Auth0 Error: ${error} - ${errorDescription}`));
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>Error: No authorization code received</h1>');
          server.close();
          reject(new Error('No authorization code received'));
          return;
        }

        if (state !== expectedState) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>Error: State mismatch (possible CSRF attack)</h1>');
          server.close();
          reject(new Error('State mismatch'));
          return;
        }

        // Success!
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <head><title>Authentication Successful</title></head>
            <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center;">
              <h1 style="color: #4caf50;">✅ Authentication Successful!</h1>
              <p style="font-size: 18px; color: #666;">You have successfully authenticated with Rackspace.</p>
              <p style="color: #999;">You can close this window and return to the terminal.</p>
              <script>
                // Auto-close after 3 seconds
                setTimeout(() => window.close(), 3000);
              </script>
            </body>
          </html>
        `);

        server.close();
        resolve(code);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    server.listen(CONFIG.callbackPort, CONFIG.callbackHost, () => {
      logSuccess(`Local callback server started on http://${CONFIG.callbackHost}:${CONFIG.callbackPort}`);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logError(`Port ${CONFIG.callbackPort} is already in use!`);
        logInfo('Try closing other applications or use a different port.');
      }
      reject(err);
    });
  });
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCodeForTokens(code, codeVerifier) {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CONFIG.clientId,
    code: code,
    redirect_uri: `http://${CONFIG.callbackHost}:${CONFIG.callbackPort}${CONFIG.callbackPath}`,
    code_verifier: codeVerifier,
  });

  return new Promise((resolve, reject) => {
    const url = new URL(CONFIG.tokenEndpoint);
    const body = params.toString();

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(jsonData);
          } else {
            reject({ status: res.statusCode, data: jsonData });
          }
        } catch (e) {
          reject({ status: res.statusCode, error: data });
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Display tokens
 */
function displayTokens(tokens) {
  logSection('Tokens Received');

  logSuccess('Successfully obtained tokens!');
  console.log();

  // Parse and display ID token claims
  if (tokens.id_token) {
    try {
      const [, payloadBase64] = tokens.id_token.split('.');
      const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString());

      console.log('📋 ID Token Claims:');
      console.log(JSON.stringify(payload, null, 2));
      console.log();

      logInfo(`Subject (sub): ${payload.sub}`);
      logInfo(`Email: ${payload.email || 'not included'}`);
      logInfo(`Email Verified: ${payload.email_verified || 'not included'}`);
      logInfo(`Organization: ${payload.org_id || 'not included'}`);
      logInfo(`Issued At: ${new Date(payload.iat * 1000).toISOString()}`);
      logInfo(`Expires At: ${new Date(payload.exp * 1000).toISOString()}`);
      console.log();
    } catch (e) {
      logWarning('Could not parse ID token');
    }
  }

  // Display token types received
  console.log('🔑 Tokens received:');
  if (tokens.access_token) {
    logSuccess(`Access Token: ${tokens.access_token.substring(0, 30)}...`);
  }
  if (tokens.id_token) {
    logSuccess(`ID Token: ${tokens.id_token.substring(0, 30)}...`);
  }
  if (tokens.refresh_token) {
    logSuccess(`Refresh Token: ${tokens.refresh_token.substring(0, 30)}...`);
  }

  console.log();
  logInfo(`Token Type: ${tokens.token_type}`);
  logInfo(`Expires In: ${tokens.expires_in} seconds`);
  if (tokens.scope) {
    logInfo(`Scopes: ${tokens.scope}`);
  }
}

/**
 * Test token with userinfo endpoint
 */
async function testToken(tokens) {
  logSection('Testing Token');

  logInfo('Fetching user info from userinfo endpoint...');

  return new Promise((resolve, reject) => {
    const url = new URL(`${CONFIG.issuer}/userinfo`);

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            logSuccess('Successfully fetched user info!');
            console.log('\nUser Info:');
            console.log(JSON.stringify(jsonData, null, 2));
            resolve(jsonData);
          } else {
            reject({ status: res.statusCode, data: jsonData });
          }
        } catch (e) {
          reject({ status: res.statusCode, error: data });
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

/**
 * Main execution
 */
async function main() {
  console.clear();

  logSection('🔐 OIDC Login Test (kubectl oidc-login style)');
  console.log();
  log('This script mimics kubectl oidc-login behavior:', colors.cyan);
  log('1. Start local HTTP server on localhost:8000', colors.cyan);
  log('2. Generate PKCE challenge', colors.cyan);
  log('3. Open browser to Auth0 authorization URL', colors.cyan);
  log('4. Receive callback with authorization code', colors.cyan);
  log('5. Exchange code for tokens', colors.cyan);
  console.log();

  try {
    // Step 1: Generate PKCE and state
    logSection('Step 1: Generate PKCE Challenge');
    const { codeVerifier, codeChallenge } = generatePKCE();
    const state = generateState();

    logSuccess('PKCE challenge generated');
    logInfo(`Code Challenge: ${codeChallenge.substring(0, 20)}...`);
    logInfo(`State: ${state.substring(0, 20)}...`);

    // Step 2: Build authorization URL
    logSection('Step 2: Build Authorization URL');
    const authUrl = buildAuthorizationUrl(codeChallenge, state);

    logInfo('Authorization URL built:');
    console.log(authUrl);
    console.log();
    logInfo(`Redirect URI: http://${CONFIG.callbackHost}:${CONFIG.callbackPort}${CONFIG.callbackPath}`);
    logInfo(`Client ID: ${CONFIG.clientId}`);
    logInfo(`Organization: ${CONFIG.organizationId}`);

    // Step 3: Start local server
    logSection('Step 3: Start Local Callback Server');
    const serverPromise = startCallbackServer(state);

    // Step 4: Open browser
    logSection('Step 4: Open Browser for Authentication');
    logInfo('Opening browser...');
    openBrowser(authUrl);
    console.log();
    logWarning('If the browser did not open automatically, copy and paste this URL:');
    log(authUrl, colors.bright + colors.blue);
    console.log();
    logInfo('Waiting for authentication callback...');
    logInfo(`(The browser will redirect back to ${CONFIG.callbackHost}:${CONFIG.callbackPort} after you log in)`);

    // Step 5: Wait for callback
    const code = await serverPromise;

    logSection('Step 5: Authorization Code Received');
    logSuccess('Callback received!');
    logInfo(`Authorization Code: ${code.substring(0, 30)}...`);

    // Step 6: Exchange code for tokens
    logSection('Step 6: Exchange Code for Tokens');
    logInfo('Exchanging authorization code for tokens...');

    const tokens = await exchangeCodeForTokens(code, codeVerifier);

    // Step 7: Display tokens
    displayTokens(tokens);

    // Step 8: Test token
    await testToken(tokens);

    // Success!
    logSection('✅ SUCCESS');
    console.log();
    logSuccess('OIDC login flow completed successfully!');
    logInfo('This is exactly how kubectl oidc-login works.');
    logInfo('The same approach can be used in Backstage backend.');
    console.log();

    // Save tokens
    const fs = require('fs');
    const tokensFile = '/tmp/oidc-login-tokens.json';
    fs.writeFileSync(tokensFile, JSON.stringify(tokens, null, 2));
    logInfo(`Tokens saved to: ${tokensFile}`);

  } catch (error) {
    logSection('❌ FAILURE');
    console.log();
    logError('OIDC login failed!');
    console.error(error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { generatePKCE, startCallbackServer, exchangeCodeForTokens };
