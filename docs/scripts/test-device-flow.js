#!/usr/bin/env node
/**
 * Proof of Concept: OAuth Device Authorization Flow
 *
 * Tests the device flow with Rackspace Auth0 IDP to validate
 * that we can obtain K8s cluster tokens without localhost callbacks.
 *
 * Usage:
 *   node test-device-flow.js
 *
 * This script demonstrates:
 * 1. Initiating device authorization
 * 2. Displaying user code and verification URL
 * 3. Polling for token completion
 * 4. Receiving and displaying tokens
 */

const https = require('https');
const { URL } = require('url');

// Configuration - Update these values
const CONFIG = {
  issuer: 'https://login.spot.rackspace.com',
  clientId: process.env.OIDC_CLIENT_ID || 'mwG3lUMV8KyeMqHe4fJ5Bb3nM1vBvRNa',
  // For device flow, client_secret is optional but may be required
  clientSecret: process.env.OIDC_CLIENT_SECRET || undefined,
  organizationId: process.env.OIDC_ORGANIZATION_ID || 'org_zOuCBHiyF1yG8d1D',
  scopes: 'openid profile email',
};

// ANSI color codes for pretty terminal output
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
 * Make an HTTPS request (Promise-based)
 */
function httpsRequest(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ status: res.statusCode, data: jsonData });
          } else {
            reject({ status: res.statusCode, data: jsonData });
          }
        } catch (e) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ status: res.statusCode, data: data });
          } else {
            reject({ status: res.statusCode, error: data });
          }
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Step 1: Initiate device authorization flow
 */
async function initiateDeviceFlow() {
  logSection('Step 1: Initiate Device Authorization Flow');

  const params = new URLSearchParams({
    client_id: CONFIG.clientId,
    scope: CONFIG.scopes,
  });

  // Add organization if configured (Rackspace multi-tenant)
  if (CONFIG.organizationId) {
    params.append('organization', CONFIG.organizationId);
  }

  // Add client_secret if provided
  if (CONFIG.clientSecret) {
    params.append('client_secret', CONFIG.clientSecret);
  }

  logInfo(`Requesting device code from: ${CONFIG.issuer}/oauth/device/code`);
  logInfo(`Client ID: ${CONFIG.clientId}`);
  logInfo(`Organization: ${CONFIG.organizationId || 'none'}`);
  logInfo(`Scopes: ${CONFIG.scopes}`);

  try {
    const response = await httpsRequest(
      `${CONFIG.issuer}/oauth/device/code`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
      params.toString()
    );

    logSuccess('Device authorization initiated successfully!');
    console.log('\nResponse:');
    console.log(JSON.stringify(response.data, null, 2));

    return response.data;
  } catch (error) {
    logError('Failed to initiate device flow');
    console.error(error);
    throw error;
  }
}

/**
 * Step 2: Display instructions to user
 */
function displayUserInstructions(deviceData) {
  logSection('Step 2: User Authentication Required');

  console.log('\n' + '┌' + '─'.repeat(58) + '┐');
  log('│' + ' '.repeat(58) + '│', colors.bright + colors.yellow);
  log('│  🔐 AUTHENTICATION REQUIRED' + ' '.repeat(29) + '│', colors.bright + colors.yellow);
  log('│' + ' '.repeat(58) + '│', colors.bright + colors.yellow);
  console.log('└' + '─'.repeat(58) + '┘');

  console.log('\n1️⃣  Open this URL in your browser:');
  log(`   ${deviceData.verification_uri_complete || deviceData.verification_uri}`, colors.bright + colors.blue);

  console.log('\n2️⃣  Enter this code when prompted:');
  log(`   ${deviceData.user_code}`, colors.bright + colors.green);

  console.log('\n3️⃣  Sign in with your Rackspace credentials');

  console.log('\n⏱️  This code expires in:', `${deviceData.expires_in} seconds`);
  console.log('⏳ Polling interval:', `${deviceData.interval || 5} seconds`);
  console.log();

  if (deviceData.verification_uri_complete) {
    logInfo('You can copy/paste the complete URL - it includes the code!');
  }
}

/**
 * Step 3: Poll for token
 */
async function pollForToken(deviceData) {
  logSection('Step 3: Polling for Token');

  const deviceCode = deviceData.device_code;
  const interval = (deviceData.interval || 5) * 1000; // Convert to milliseconds
  const expiresAt = Date.now() + (deviceData.expires_in * 1000);

  logInfo('Waiting for user to complete authentication...');
  logInfo('(This will automatically complete once you authenticate)');
  console.log();

  let attempts = 0;
  const maxAttempts = Math.ceil(deviceData.expires_in / (interval / 1000));

  while (Date.now() < expiresAt) {
    attempts++;
    const progress = Math.min(100, Math.floor((attempts / maxAttempts) * 100));
    process.stdout.write(`\r⏳ Polling... Attempt ${attempts}/${maxAttempts} [${progress}%]`);

    const params = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
      client_id: CONFIG.clientId,
    });

    // Add organization if configured
    if (CONFIG.organizationId) {
      params.append('organization', CONFIG.organizationId);
    }

    // Add client_secret if provided
    if (CONFIG.clientSecret) {
      params.append('client_secret', CONFIG.clientSecret);
    }

    try {
      const response = await httpsRequest(
        `${CONFIG.issuer}/oauth/token`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
        params.toString()
      );

      console.log(); // New line after progress
      logSuccess('Authentication completed! Tokens received.');
      return response.data;
    } catch (error) {
      if (error.data?.error === 'authorization_pending') {
        // Still waiting for user
        await sleep(interval);
        continue;
      } else if (error.data?.error === 'slow_down') {
        // Auth0 wants us to slow down
        logWarning('Slowing down polling rate...');
        await sleep(interval * 2);
        continue;
      } else if (error.data?.error === 'expired_token') {
        console.log(); // New line after progress
        logError('Device code expired! User took too long to authenticate.');
        throw new Error('Device code expired');
      } else if (error.data?.error === 'access_denied') {
        console.log(); // New line after progress
        logError('User denied the authentication request.');
        throw new Error('Access denied by user');
      } else {
        console.log(); // New line after progress
        logError('Unexpected error during token polling:');
        console.error(error);
        throw error;
      }
    }
  }

  console.log(); // New line after progress
  logError('Timeout: User did not complete authentication in time.');
  throw new Error('Authentication timeout');
}

/**
 * Step 4: Display tokens
 */
function displayTokens(tokens) {
  logSection('Step 4: Tokens Received');

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
    logSuccess(`Access Token: ${tokens.access_token.substring(0, 20)}...`);
  }
  if (tokens.id_token) {
    logSuccess(`ID Token: ${tokens.id_token.substring(0, 20)}...`);
  }
  if (tokens.refresh_token) {
    logSuccess(`Refresh Token: ${tokens.refresh_token.substring(0, 20)}...`);
  }

  console.log();
  logInfo(`Token Type: ${tokens.token_type}`);
  logInfo(`Expires In: ${tokens.expires_in} seconds`);
  if (tokens.scope) {
    logInfo(`Scopes: ${tokens.scope}`);
  }
}

/**
 * Step 5: Test token with userinfo endpoint
 */
async function testToken(tokens) {
  logSection('Step 5: Testing Token');

  logInfo('Fetching user info from userinfo endpoint...');

  try {
    const response = await httpsRequest(
      `${CONFIG.issuer}/userinfo`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
        },
      }
    );

    logSuccess('Successfully fetched user info!');
    console.log('\nUser Info:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    logError('Failed to fetch user info');
    console.error(error);
  }
}

/**
 * Utility: Sleep
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main execution
 */
async function main() {
  console.clear();

  logSection('🧪 OAuth Device Flow Proof of Concept');
  console.log();
  log('This script tests the device authorization flow with Rackspace Auth0.', colors.cyan);
  log('It simulates what Backstage will do to obtain K8s cluster tokens.', colors.cyan);
  console.log();

  // Validate configuration
  if (!CONFIG.clientId) {
    logError('Missing OIDC_CLIENT_ID environment variable!');
    logInfo('Usage: OIDC_CLIENT_ID=your-client-id node test-device-flow.js');
    process.exit(1);
  }

  try {
    // Step 1: Initiate device flow
    const deviceData = await initiateDeviceFlow();

    // Step 2: Display instructions
    displayUserInstructions(deviceData);

    // Give user time to read instructions
    await sleep(2000);

    // Step 3: Poll for token
    const tokens = await pollForToken(deviceData);

    // Step 4: Display tokens
    displayTokens(tokens);

    // Step 5: Test token
    await testToken(tokens);

    // Success!
    logSection('✅ SUCCESS');
    console.log();
    logSuccess('Device flow working correctly!');
    logInfo('This flow can be integrated into Backstage to obtain K8s cluster tokens.');
    console.log();

    // Save tokens to file for inspection
    const fs = require('fs');
    const tokensFile = '/tmp/device-flow-tokens.json';
    fs.writeFileSync(tokensFile, JSON.stringify(tokens, null, 2));
    logInfo(`Tokens saved to: ${tokensFile}`);

  } catch (error) {
    logSection('❌ FAILURE');
    console.log();
    logError('Device flow failed!');
    console.error(error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { initiateDeviceFlow, pollForToken };
