#!/usr/bin/env node
/**
 * OIDC Authenticator CLI
 *
 * Client-side OIDC authentication helper for Backstage
 * Runs on user's laptop, sends tokens to Backstage server
 *
 * Architecture:
 *   1. Run as daemon: oidc-authenticator --daemon
 *   2. Daemon listens on http://localhost:8000
 *   3. Backstage frontend shows login button → opens localhost:8000
 *   4. User is redirected to OIDC provider
 *   5. After login, tokens are sent to Backstage backend
 *
 * Usage:
 *   oidc-authenticator --daemon [options]
 *
 * Options:
 *   -d, --daemon            Run as daemon (browser-initiated auth)
 *   --issuer <url>          OIDC issuer URL (required)
 *   --client-id <id>        OAuth client ID (required)
 *   --backend-url <url>     Backstage backend URL (required)
 *   --organization <id>     Organization ID (optional)
 *   --scopes <scopes>       Space-separated scopes (default: "openid profile email")
 *   --port <port>           Callback port (default: 8000)
 *   --output <file>         Save tokens to file (optional, for debugging)
 *   -v, --verbose           Show detailed output
 *   --help                  Show this help message
 */

const { OIDCAuthenticator } = require('../lib/index.js');
const path = require('path');
const fs = require('fs');

// Load config from config.json
function loadConfig() {
  const configPath = path.join(__dirname, '..', 'config.json');

  if (fs.existsSync(configPath)) {
    try {
      const configData = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(configData);
    } catch (error) {
      console.error(`Warning: Failed to load config.json: ${error.message}`);
      return {};
    }
  }

  return {};
}

// Parse arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const fileConfig = loadConfig();

  const config = {
    issuer: fileConfig.issuer || null,
    clientId: fileConfig.clientId || null,
    organizationId: fileConfig.organizationId || null,
    scopes: fileConfig.scopes || 'openid profile email',
    port: fileConfig.callbackPort || 8000,
    output: null,
    verbose: false,
    daemon: false,
    backendUrl: fileConfig.backendUrl || null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (arg === '--issuer') {
      config.issuer = args[++i];
    } else if (arg === '--client-id') {
      config.clientId = args[++i];
    } else if (arg === '--organization') {
      config.organizationId = args[++i];
    } else if (arg === '--scopes') {
      config.scopes = args[++i];
    } else if (arg === '--port') {
      config.port = parseInt(args[++i], 10);
    } else if (arg === '--output' || arg === '-o') {
      config.output = args[++i];
    } else if (arg === '--verbose' || arg === '-v') {
      config.verbose = true;
    } else if (arg === '--daemon' || arg === '-d') {
      config.daemon = true;
    } else if (arg === '--backend-url') {
      config.backendUrl = args[++i];
    } else {
      console.error(`Unknown option: ${arg}`);
      console.error('Use --help for usage information');
      process.exit(1);
    }
  }

  // Check for environment variables
  if (!config.issuer) config.issuer = process.env.OIDC_ISSUER_URL;
  if (!config.clientId) config.clientId = process.env.OIDC_CLIENT_ID;
  if (!config.organizationId) config.organizationId = process.env.OIDC_ORGANIZATION_ID;

  // Validate required options
  if (!config.issuer) {
    console.error('Error: --issuer is required (or set OIDC_ISSUER_URL)');
    process.exit(1);
  }

  if (!config.clientId) {
    console.error('Error: --client-id is required (or set OIDC_CLIENT_ID)');
    process.exit(1);
  }

  return config;
}

function showHelp() {
  console.log(`
oidc-authenticator - Client-side OIDC authentication for Backstage

Architecture:
  This tool runs on your laptop and sends authentication tokens to your
  Backstage server. Similar to kubectl oidc-login, it operates silently
  by default and only shows output when using --verbose.

Usage:
  oidc-authenticator [options]

Options:
  --issuer <url>          OIDC issuer URL (required unless in config.json)
  --client-id <id>        OAuth client ID (required unless in config.json)
  --organization <id>     Organization ID (optional)
  --backend-url <url>     Backend URL (required for normal operation)
  --scopes <scopes>       Space-separated scopes (default: "openid profile email")
  --port <port>           Callback port (default: 8000)
  -d, --daemon            Run as daemon server (browser-initiated auth)
  --output <file>         Save tokens to file (optional, for debugging)
  -v, --verbose           Show detailed output
  --help                  Show this help message

Configuration File:
  config.json             Place in the same directory as the CLI tool
                          All options can be set in config.json to avoid
                          typing them every time. CLI args override config.

Environment Variables:
  OIDC_ISSUER_URL         OIDC issuer URL
  OIDC_CLIENT_ID          OAuth client ID
  OIDC_ORGANIZATION_ID    Organization ID

Examples:
  # Daemon mode (recommended) - browser-initiated authentication
  # User opens http://localhost:8000 to authenticate
  oidc-authenticator --daemon --verbose

  # Daemon with custom port
  oidc-authenticator --daemon --port 8080 --verbose

  # One-time authentication (legacy mode)
  oidc-authenticator \\
    --issuer https://login.spot.rackspace.com/ \\
    --client-id YOUR_CLIENT_ID \\
    --backend-url https://backstage.example.com \\
    --verbose

  # Using config.json (recommended)
  cat > config.json <<EOF
  {
    "issuer": "https://login.spot.rackspace.com/",
    "clientId": "YOUR_CLIENT_ID",
    "organizationId": "org_xxxxx",
    "backendUrl": "https://backstage.example.com"
  }
  EOF
  oidc-authenticator --daemon --verbose

Integration with Backstage:
  1. Run the daemon: oidc-authenticator --daemon
  2. In Backstage frontend, show login button that opens http://localhost:8000
  3. Check if daemon is running: fetch('http://localhost:8000/health')
  4. If not running, show message: "Please start oidc-authenticator"

Exit Codes:
  0   Success - tokens obtained and sent
  1   Error - authentication failed
  2   Error - user cancelled
`);
}

// Main execution
async function main() {
  const config = parseArgs();

  const authenticator = new OIDCAuthenticator({
    issuer: config.issuer,
    clientId: config.clientId,
    organizationId: config.organizationId,
    scopes: config.scopes,
    callbackPort: config.port,
    verbose: config.verbose,
    backendUrl: config.backendUrl,
  });

  try {
    // Daemon mode - run persistent server
    if (config.daemon) {
      await authenticator.startDaemon();
      // Server runs forever, handle graceful shutdown
      return;
    }

    // One-time authentication mode (legacy)
    const tokens = await authenticator.authenticate();

    // Send to backend if configured
    if (config.backendUrl) {
      try {
        await authenticator.sendTokensToBackend(tokens);
        if (config.verbose) {
          console.log(`✅ Tokens sent to backend: ${config.backendUrl}`);
        }
      } catch (error) {
        console.error(`⚠️  Failed to send tokens to backend: ${error.message}`);
        console.error('   Continuing anyway...');
      }
    }

    // Save to file if specified
    if (config.output) {
      const fs = require('fs');
      fs.writeFileSync(config.output, JSON.stringify(tokens, null, 2));
      if (config.verbose) {
        console.log(`✅ Tokens saved to: ${config.output}`);
      }
    }

    // Silent success (no stdout output of tokens)
    process.exit(0);
  } catch (error) {
    console.error('❌ Authentication failed:', error.message);
    process.exit(1);
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n\n⚠️  Authentication cancelled by user');
  process.exit(2);
});

// Run
main();
