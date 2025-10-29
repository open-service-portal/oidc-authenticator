/**
 * OIDC Authenticator Library
 *
 * Client-side authentication tool for Backstage
 * Runs on user's laptop, sends tokens to Backstage server
 * Operates silently by default (like kubectl oidc-login)
 *
 * Supports:
 * - OIDC/OAuth PKCE flow
 * - Direct token bypass (for development/CI)
 * - Kubeconfig token extraction
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

class OIDCAuthenticator {
  constructor(config) {
    this.config = {
      issuer: config.issuer,
      clientId: config.clientId,
      organizationId: config.organizationId || null,
      scopes: config.scopes || 'openid profile email',
      callbackHost: 'localhost',  // Must use 'localhost' (Auth0 rejects 127.0.0.1)
      callbackPort: config.callbackPort || 8000,
      callbackPath: '/',           // Root path (not /callback)
      verbose: config.verbose || false,
      backendUrl: config.backendUrl || null,
      // Token-based authentication (bypasses OIDC flow)
      tokens: config.tokens || null,
      // Logging (only for daemon mode)
      enableLogging: config.enableLogging || false,
      logFile: config.logFile || path.join(os.homedir(), '.oidc-authenticator.log'),
    };

    // Derive endpoints from issuer (only if not using token bypass)
    if (this.config.issuer) {
      const issuerBase = this.config.issuer.replace(/\/$/, '');
      this.endpoints = {
        authorization: `${issuerBase}/authorize`,
        token: `${issuerBase}/oauth/token`,
        userinfo: `${issuerBase}/userinfo`,
      };
    }
  }

  /**
   * Write to log file (only if logging is enabled - daemon mode)
   */
  writeToLogFile(message) {
    if (!this.config.enableLogging) {
      return;
    }

    try {
      const timestamp = new Date().toISOString();
      const logLine = `[${timestamp}] ${message}\n`;
      fs.appendFileSync(this.config.logFile, logLine, 'utf8');
    } catch (error) {
      // Silently fail if can't write to log file
    }
  }

  log(message, force = false) {
    // Write to log file if enabled (daemon mode)
    this.writeToLogFile(message);

    // Print to console if verbose or forced
    if (this.config.verbose || force) {
      console.log(message);
    }
  }

  logError(message) {
    // Write to log file if enabled (daemon mode)
    this.writeToLogFile(`ERROR: ${message}`);

    // Always print errors to console
    console.error(message);
  }

  /**
   * Get authentication tokens from configuration
   * Returns { access_token, id_token } if configured, null otherwise (use OIDC flow)
   */
  async getAuthTokens() {
    if (this.config.tokens) {
      const { accessToken, idToken } = this.config.tokens;

      if (!accessToken || !idToken) {
        this.logError('⚠️  Token bypass mode requires both accessToken and idToken');
        return null;
      }

      this.log('✅ Using provided tokens (bypass mode)');
      this.log(`   Access token: ${accessToken.substring(0, 30)}...`);
      this.log(`   ID token: ${idToken.substring(0, 30)}...`);

      return {
        access_token: accessToken,
        id_token: idToken,
        token_type: 'Bearer',
        scope: 'cluster-access',
      };
    }

    return null;
  }

  /**
   * Decode JWT token and return payload
   * Returns { type, payload } where type is 'jwt' or 'jwe'
   */
  decodeJWT(token) {
    try {
      const parts = token.split('.');

      // Check if it's a JWE (5 parts) or JWT (3 parts)
      if (parts.length === 5) {
        // JWE token - encrypted, can't decode without key
        return { type: 'jwe', payload: null };
      }

      if (parts.length !== 3) {
        return { type: 'unknown', payload: null };
      }

      // Decode the payload (middle part) from base64url
      const payload = parts[1];
      // Convert base64url to base64
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      // Decode from base64
      const jsonPayload = Buffer.from(base64, 'base64').toString('utf8');
      return { type: 'jwt', payload: JSON.parse(jsonPayload) };
    } catch (error) {
      this.log(`Warning: Failed to decode token: ${error.message}`);
      return { type: 'error', payload: null };
    }
  }

  /**
   * Format decoded token claims for display
   */
  formatTokenClaims(claims, indent = '     ') {
    if (!claims) return 'Unable to decode';

    const lines = [];

    // Show ALL claims
    for (const [key, value] of Object.entries(claims)) {
      let displayValue = value;

      // Format timestamps
      if (['exp', 'iat', 'nbf'].includes(key) && typeof value === 'number') {
        const date = new Date(value * 1000);
        displayValue = `${value} (${date.toISOString()})`;
      }

      // Format objects/arrays
      if (typeof value === 'object') {
        displayValue = JSON.stringify(value);
      }

      lines.push(`${indent}${key}: ${displayValue}`);
    }

    return lines.join('\n');
  }

  /**
   * Start daemon server (browser-initiated flow)
   * Server runs continuously, user opens localhost:8000 to start auth
   * If tokens are configured, sends them immediately without OIDC flow
   */
  async startDaemon() {
    // Log to file first to ensure logging is working
    if (this.config.enableLogging) {
      this.writeToLogFile('='.repeat(80));
      this.writeToLogFile('OIDC Authenticator Daemon Starting');
      this.writeToLogFile(`Log file: ${this.config.logFile}`);
      this.writeToLogFile(`Verbose mode: ${this.config.verbose}`);
      this.writeToLogFile(`Port: ${this.config.callbackPort}`);
      this.writeToLogFile(`Backend URL: ${this.config.backendUrl || 'not configured'}`);
      this.writeToLogFile(`Issuer: ${this.config.issuer || 'not configured (token bypass mode?)'}`);
      this.writeToLogFile(`Token bypass: ${this.config.tokens ? 'enabled' : 'disabled'}`);
      this.writeToLogFile('='.repeat(80));
    }

    this.log('🔐 Starting OIDC authenticator daemon...\n');

    // Check if we have tokens configured (bypass mode)
    const preConfiguredTokens = await this.getAuthTokens();
    if (preConfiguredTokens) {
      this.log('🎯 Token bypass mode enabled - skipping OIDC flow');

      // Send tokens immediately to backend if configured
      if (this.config.backendUrl) {
        try {
          const backendResponse = await this.sendTokensToBackend(preConfiguredTokens);
          this.log(`✅ Tokens sent to backend successfully`);

          // Parse backend response
          try {
            const responseData = JSON.parse(backendResponse.data);
            if (responseData.backstageToken) {
              this.log(`✅ Received Backstage session token`);
              this.log(`   Session token: ${responseData.backstageToken.substring(0, 30)}...`);
            }
          } catch (e) {
            this.log(`⚠️  Backend response: ${backendResponse.data}`);
          }
        } catch (error) {
          this.log(`⚠️  Could not send tokens to backend: ${error.message}`);
        }
      }

      this.log('\n💡 Token bypass mode active - daemon will respond with pre-configured tokens\n');
    }

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${this.config.callbackPort}`);

      // Log all incoming requests
      this.log(`📥 ${req.method} ${url.pathname}${url.search}`);

      // Health check endpoint
      if (url.pathname === '/health') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end(JSON.stringify({ status: 'running', issuer: this.config.issuer }));
        return;
      }

      // Root endpoint - initiate authentication
      if (url.pathname === '/' && !url.searchParams.has('code')) {
        // Check if frontend wants tokens returned via postMessage (new flow)
        const returnTokens = url.searchParams.get('mode') === 'return-tokens';

        // Check if we're in token bypass mode
        if (preConfiguredTokens) {
          this.log(`🌐 Browser requested authentication (bypass mode)`);
          this.log(`   Return mode: ${returnTokens ? 'postMessage to frontend' : 'send to backend'}`);

          // NEW FLOW: Return tokens to frontend via postMessage
          if (returnTokens) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <head><title>Authentication Successful</title></head>
                <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center;">
                  <h1 style="color: #4caf50;">✅ Authentication Successful!</h1>
                  <p style="font-size: 18px; color: #666;">Sending credentials to Backstage...</p>
                  <script>
                    // Send tokens to parent window (Backstage frontend)
                    // Frontend will send these to backend with proper authentication
                    if (window.opener) {
                      window.opener.postMessage({
                        type: 'cluster-tokens',
                        tokens: ${JSON.stringify(preConfiguredTokens)}
                      }, '*');
                      document.body.innerHTML = '<h1 style="color: #4caf50;">✅ Done!</h1><p>You can close this window.</p>';
                      setTimeout(() => window.close(), 2000);
                    } else {
                      document.body.innerHTML = '<h1 style="color: #f44336;">❌ Error</h1><p>Could not communicate with Backstage. Please close this window and try again.</p>';
                    }
                  </script>
                </body>
              </html>
            `);
            return;
          }

          // OLD FLOW: Send directly to backend (deprecated)
          let backstageToken = null;
          if (this.config.backendUrl) {
            try {
              const backstageCookies = url.searchParams.get('cookies') || req.headers.cookie || null;
              const backendResponse = await this.sendTokensToBackend(preConfiguredTokens, backstageCookies);
              const responseData = JSON.parse(backendResponse.data);
              backstageToken = responseData.backstageToken;
            } catch (error) {
              this.log(`⚠️  Could not send tokens to backend: ${error.message}`);
            }
          }

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <head><title>Authentication Successful</title></head>
              <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center;">
                <h1 style="color: #4caf50;">✅ Authentication Successful!</h1>
                <p style="font-size: 18px; color: #666;">Using pre-configured token (bypass mode).</p>
                <p style="color: #999;">You can close this window and return to Backstage.</p>
                <script>
                  // Send session token to parent window (Backstage frontend)
                  if (window.opener) {
                    window.opener.postMessage({
                      type: 'backstage-auth-complete',
                      backstageToken: ${JSON.stringify(backstageToken)},
                      success: true,
                      bypassMode: true
                    }, '*');
                  }
                  setTimeout(() => window.close(), 3000);
                </script>
              </body>
            </html>
          `);
          return;
        }

        // Normal OIDC flow
        // Generate fresh PKCE for this auth attempt
        const { codeVerifier, codeChallenge } = this.generatePKCE();
        const state = this.generateState();

        // Store in memory for this auth session
        this.pendingAuth = {
          codeVerifier,
          state,
          returnTokens  // Remember if frontend wants tokens via postMessage
        };

        // Build authorization URL
        const authUrl = this.buildAuthorizationUrl(codeChallenge, state);

        this.log(`🌐 Browser requested authentication, redirecting to OIDC provider`);

        // Redirect to OIDC provider
        res.writeHead(302, { 'Location': authUrl });
        res.end();
        return;
      }

      // Callback endpoint - handle OIDC redirect
      if (url.pathname === '/' && url.searchParams.has('code')) {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');
        const errorDescription = url.searchParams.get('error_description');

        if (error) {
          this.logError(`❌ Authentication error: ${error} - ${errorDescription}`);
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <head><title>Authentication Error</title></head>
              <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px;">
                <h1 style="color: #d32f2f;">❌ Authentication Failed</h1>
                <p><strong>Error:</strong> ${error}</p>
                <p><strong>Description:</strong> ${errorDescription || 'No description provided'}</p>
                <p>You can close this window and try again.</p>
              </body>
            </html>
          `);
          return;
        }

        if (!this.pendingAuth || state !== this.pendingAuth.state) {
          this.logError('❌ State mismatch - possible CSRF attack or expired session');
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>Error: Invalid or expired authentication session</h1>');
          return;
        }

        // Exchange code for tokens
        try {
          this.log('🔄 Exchanging authorization code for tokens...');
          const tokens = await this.exchangeCodeForTokens(code, this.pendingAuth.codeVerifier);

          const returnTokens = this.pendingAuth.returnTokens;

          // Clear pending auth
          delete this.pendingAuth;

          this.log('✅ Tokens obtained successfully');
          this.log(`   Return mode: ${returnTokens ? 'postMessage to frontend' : 'send to backend'}`);

          // NEW FLOW: Return tokens to frontend via postMessage
          if (returnTokens) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <head><title>Authentication Successful</title></head>
                <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center;">
                  <h1 style="color: #4caf50;">✅ Authentication Successful!</h1>
                  <p style="font-size: 18px; color: #666;">Sending credentials to Backstage...</p>
                  <script>
                    // Send tokens to parent window (Backstage frontend)
                    // Frontend will send these to backend with proper authentication
                    if (window.opener) {
                      window.opener.postMessage({
                        type: 'cluster-tokens',
                        tokens: ${JSON.stringify(tokens)}
                      }, '*');
                      document.body.innerHTML = '<h1 style="color: #4caf50;">✅ Done!</h1><p>You can close this window.</p>';
                      setTimeout(() => window.close(), 2000);
                    } else {
                      document.body.innerHTML = '<h1 style="color: #f44336;">❌ Error</h1><p>Could not communicate with Backstage. Please close this window and try again.</p>';
                    }
                  </script>
                </body>
              </html>
            `);
            return;
          }

          // OLD FLOW: Send directly to Backstage backend (deprecated)
          if (this.config.backendUrl) {
            try {
              const backstageCookies = url.searchParams.get('cookies') || req.headers.cookie || null;
              const backendResponse = await this.sendTokensToBackend(tokens, backstageCookies);
              this.log(`✅ Tokens sent to Backstage backend`);

              // Parse backend response to get Backstage session token
              let backstageToken = null;
              try {
                const responseData = JSON.parse(backendResponse.data);
                backstageToken = responseData.backstageToken;
                if (backstageToken) {
                  this.log(`✅ Received Backstage session token`);
                }
              } catch (e) {
                this.logError(`⚠️  Could not parse backend response: ${e.message}`);
              }

              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(`
                <html>
                  <head><title>Authentication Successful</title></head>
                  <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center;">
                    <h1 style="color: #4caf50;">✅ Authentication Successful!</h1>
                    <p style="font-size: 18px; color: #666;">Your credentials have been sent to Backstage.</p>
                    <p style="color: #999;">You can close this window and return to Backstage.</p>
                    <script>
                      // Send session token to parent window (Backstage frontend)
                      if (window.opener) {
                        window.opener.postMessage({
                          type: 'backstage-auth-complete',
                          backstageToken: ${JSON.stringify(backstageToken)},
                          success: true
                        }, '*');
                      }
                      setTimeout(() => window.close(), 3000);
                    </script>
                  </body>
                </html>
              `);
            } catch (error) {
              this.log(`⚠️  Could not send tokens to Backstage: ${error.message}`);
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(`
                <html>
                  <head><title>Authentication Completed</title></head>
                  <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center;">
                    <h1 style="color: #4caf50;">✅ Authentication Successful!</h1>
                    <p style="font-size: 18px; color: #666;">You have successfully authenticated.</p>
                    <p style="color: #999;">Note: Could not connect to backend - tokens saved locally.</p>
                  </body>
                </html>
              `);
            }
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <head><title>Authentication Successful</title></head>
                <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center;">
                  <h1 style="color: #4caf50;">✅ Authentication Successful!</h1>
                  <p style="font-size: 18px; color: #666;">You have successfully authenticated.</p>
                  <p style="color: #ff9800;">⚠️ No backend URL configured - tokens not sent.</p>
                </body>
              </html>
            `);
          }
        } catch (error) {
          this.logError(`❌ Token exchange failed: ${error.message}`);
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <head><title>Token Exchange Failed</title></head>
              <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px;">
                <h1 style="color: #d32f2f;">❌ Token Exchange Failed</h1>
                <p><strong>Error:</strong> ${error.message}</p>
                <p>Please try again.</p>
              </body>
            </html>
          `);
        }
        return;
      }

      // Unknown endpoint
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<h1>404 - Not Found</h1>');
    });

    return new Promise((resolve, reject) => {
      server.listen(this.config.callbackPort, '127.0.0.1', () => {
        this.log(`✅ OIDC authenticator daemon running on http://localhost:${this.config.callbackPort}`);
        this.log(`📋 Health check: http://localhost:${this.config.callbackPort}/health`);
        this.log(`🔗 To authenticate, open: http://localhost:${this.config.callbackPort}/`);
        if (this.config.backendUrl) {
          this.log(`📤 Tokens will be sent to: ${this.config.backendUrl}`);
        }
        this.log('');
        resolve(server);
      });

      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${this.config.callbackPort} is already in use. Try a different port with --port`));
        } else {
          reject(err);
        }
      });
    });
  }

  /**
   * Main authentication flow (legacy - for one-time auth)
   * Now supports token bypass mode
   */
  async authenticate() {
    this.log('\n🔐 Starting OIDC authentication...\n');

    // Check for token bypass mode
    const preConfiguredTokens = await this.getAuthTokens();
    if (preConfiguredTokens) {
      this.log('🎯 Token bypass mode enabled - skipping OIDC flow');
      this.log('✅ Tokens loaded successfully (bypass mode)');
      this.log('');

      return preConfiguredTokens;
    }

    // Normal OIDC flow
    this.log(`📍 Issuer: ${this.config.issuer}`);
    this.log(`🔑 Client ID: ${this.config.clientId}`);
    if (this.config.organizationId) {
      this.log(`🏢 Organization: ${this.config.organizationId}`);
    }
    this.log(`📋 Scopes: ${this.config.scopes}`);
    this.log(`🔌 Callback: http://${this.config.callbackHost}:${this.config.callbackPort}${this.config.callbackPath}`);
    if (this.config.backendUrl) {
      this.log(`📤 Backend: ${this.config.backendUrl}`);
    }
    this.log('');

    // Step 1: Generate PKCE
    const { codeVerifier, codeChallenge } = this.generatePKCE();
    const state = this.generateState();

    this.log('✅ PKCE challenge generated');
    this.log(`   Code challenge: ${codeChallenge.substring(0, 20)}...`);

    // Step 2: Build authorization URL
    const authUrl = this.buildAuthorizationUrl(codeChallenge, state);

    this.log('✅ Authorization URL built');
    this.log(`   ${authUrl}\n`);

    // Step 3: Start local callback server and wait for code
    const code = await this.startCallbackServerAndWaitForCode(authUrl, state);

    this.log('\n✅ Authorization code received');
    this.log(`   Code: ${code.substring(0, 20)}...`);

    // Step 4: Exchange code for tokens
    this.log('🔄 Exchanging code for tokens...');
    this.log(`   Token endpoint: ${this.endpoints.token}`);
    const tokens = await this.exchangeCodeForTokens(code, codeVerifier);

    this.log('\n✅ Tokens obtained successfully!');
    this.log(`   Token type: ${tokens.token_type || 'N/A'}`);
    this.log(`   Expires in: ${tokens.expires_in ? tokens.expires_in + ' seconds' : 'N/A'}`);
    this.log('');

    // Show raw tokens
    this.log('📝 Token Details:');
    if (tokens.access_token) {
      this.log(`   Access token:\n     ${tokens.access_token}`);
    }
    if (tokens.refresh_token) {
      this.log(`   Refresh token:\n     ${tokens.refresh_token}`);
    }
    if (tokens.id_token) {
      this.log(`   ID token:\n     ${tokens.id_token}`);
    }
    this.log('');

    // Decode and show ID token claims (access tokens are usually JWE encrypted and unreadable)
    if (tokens.id_token) {
      const decoded = this.decodeJWT(tokens.id_token);
      this.log('🔍 ID Token Claims:');
      if (decoded.type === 'jwt' && decoded.payload) {
        this.log(this.formatTokenClaims(decoded.payload));
      } else if (decoded.type === 'jwe') {
        this.log('     (JWE encrypted token - cannot decode without decryption key)');
      } else {
        this.log('     (Unable to decode)');
      }
      this.log('');
    }

    return tokens;
  }

  /**
   * Generate PKCE challenge
   */
  generatePKCE() {
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    return { codeVerifier, codeChallenge };
  }

  /**
   * Generate random state
   */
  generateState() {
    return crypto.randomBytes(16).toString('base64url');
  }

  /**
   * Build authorization URL
   */
  buildAuthorizationUrl(codeChallenge, state) {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: `http://${this.config.callbackHost}:${this.config.callbackPort}${this.config.callbackPath}`,
      scope: this.config.scopes,
      state: state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    if (this.config.organizationId) {
      params.append('organization', this.config.organizationId);
    }

    return `${this.endpoints.authorization}?${params.toString()}`;
  }

  /**
   * Open browser
   */
  openBrowser(url) {
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
        this.log('⚠️  Could not open browser automatically');
        this.log(`Please open this URL manually:\n${url}\n`, true);
      }
    });
  }

  /**
   * Start local callback server and wait for authorization code
   */
  startCallbackServerAndWaitForCode(authUrl, expectedState) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url, `http://localhost:${this.config.callbackPort}`);

        if (url.pathname === this.config.callbackPath) {
          const code = url.searchParams.get('code');
          const state = url.searchParams.get('state');
          const error = url.searchParams.get('error');
          const errorDescription = url.searchParams.get('error_description');

          if (error) {
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
                <p style="font-size: 18px; color: #666;">You have successfully authenticated.</p>
                <p style="color: #999;">You can close this window and return to the terminal.</p>
                <script>
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

      server.listen(this.config.callbackPort, '127.0.0.1', () => {
        this.log(`✅ Local callback server started on http://localhost:${this.config.callbackPort}`);
        this.log('🌐 Opening browser for authentication...\n');

        // Open browser after a short delay
        setTimeout(() => this.openBrowser(authUrl), 500);

        if (!this.config.verbose) {
          this.log(`If browser didn't open, visit:\n${authUrl}\n`, true);
        }
      });

      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${this.config.callbackPort} is already in use. Try a different port with --port`));
        } else {
          reject(err);
        }
      });

      // Timeout after 3 minutes
      setTimeout(() => {
        server.close();
        reject(new Error('Authentication timeout (3 minutes)'));
      }, 3 * 60 * 1000);
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(code, codeVerifier) {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.config.clientId,
      code: code,
      redirect_uri: `http://${this.config.callbackHost}:${this.config.callbackPort}${this.config.callbackPath}`,
      code_verifier: codeVerifier,
    });

    return new Promise((resolve, reject) => {
      const url = new URL(this.endpoints.token);
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
              reject(new Error(`Token exchange failed: ${jsonData.error || 'Unknown error'}`));
            }
          } catch (e) {
            reject(new Error(`Failed to parse token response: ${e.message}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Token exchange request failed: ${err.message}`));
      });

      req.write(body);
      req.end();
    });
  }

  /**
   * Send tokens to backend
   */
  async sendTokensToBackend(tokens, backstageCookies = null) {
    if (!this.config.backendUrl) {
      throw new Error('Backend URL not configured');
    }

    this.log('📤 Sending tokens to backend...');
    this.log(`   Endpoint: ${this.config.backendUrl}/api/cluster-auth/tokens`);
    this.log(`   Payload:`);
    this.log(`     access_token: ${tokens.access_token ? tokens.access_token.substring(0, 30) + '...' : 'null'}`);
    this.log(`     id_token: ${tokens.id_token ? tokens.id_token.substring(0, 30) + '...' : 'null'}`);
    this.log(`     token_type: ${tokens.token_type || 'Bearer'}`);
    this.log(`     expires_in: ${tokens.expires_in || 'N/A'}`);
    if (tokens.refresh_token) {
      this.log(`     refresh_token: ${tokens.refresh_token.substring(0, 30)}...`);
    }
    if (backstageCookies) {
      this.log(`   ✅ Including Backstage authentication cookies`);
    } else {
      this.log(`   ⚠️  No Backstage cookies provided - backend requires authentication!`);
    }
    this.log('');

    return new Promise((resolve, reject) => {
      const url = new URL('/api/cluster-auth/tokens', this.config.backendUrl);
      const body = JSON.stringify(tokens);

      const protocol = url.protocol === 'https:' ? https : http;

      const headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'oidc-authenticator/1.0.0',
      };

      // Forward Backstage session cookies if provided
      if (backstageCookies) {
        headers['Cookie'] = backstageCookies;
      }

      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers,
      };

      const req = protocol.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            this.log('✅ Tokens successfully sent to backend');
            resolve({ statusCode: res.statusCode, data });
          } else {
            reject(new Error(`Backend returned status ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Failed to connect to backend: ${err.message}`));
      });

      req.write(body);
      req.end();
    });
  }
}

module.exports = { OIDCAuthenticator };
