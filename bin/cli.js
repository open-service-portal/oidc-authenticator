#!/usr/bin/env node
/**
 * OIDC Authenticator CLI
 *
 * Client-side OIDC authentication helper for Backstage
 * Runs on user's laptop, sends tokens to Backstage server
 *
 * Architecture:
 *   1. Start daemon: oidc-authenticator start
 *   2. Daemon listens on http://localhost:8000
 *   3. Backstage frontend shows login button → opens localhost:8000
 *   4. User is redirected to OIDC provider
 *   5. After login, tokens are sent to Backstage backend
 *
 * Usage:
 *   oidc-authenticator start [options]   # Start the daemon
 *   oidc-authenticator stop              # Stop the daemon
 *   oidc-authenticator status            # Check if daemon is running
 *
 * Options:
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
const os = require('os');

// PID file location
function getPidFile() {
  return path.join(os.tmpdir(), 'oidc-authenticator.pid');
}

// Check if daemon is running
function isDaemonRunning() {
  const pidFile = getPidFile();
  if (!fs.existsSync(pidFile)) {
    return { running: false };
  }

  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    // Check if process is still running
    try {
      process.kill(pid, 0); // Signal 0 checks if process exists
      return { running: true, pid };
    } catch (err) {
      // Process not running, clean up stale PID file
      fs.unlinkSync(pidFile);
      return { running: false };
    }
  } catch (error) {
    return { running: false };
  }
}

// Write PID file
function writePidFile() {
  const pidFile = getPidFile();
  fs.writeFileSync(pidFile, process.pid.toString(), 'utf8');
}

// Remove PID file
function removePidFile() {
  const pidFile = getPidFile();
  if (fs.existsSync(pidFile)) {
    fs.unlinkSync(pidFile);
  }
}

// Load config from config.yaml
function loadConfig() {
  const yaml = require('js-yaml');
  const configPath = path.join(__dirname, '..', 'config.yaml');

  if (fs.existsSync(configPath)) {
    try {
      const configData = fs.readFileSync(configPath, 'utf8');
      return yaml.load(configData);
    } catch (error) {
      console.error(`Error: Failed to load config.yaml: ${error.message}`);
      process.exit(1);
    }
  }

  // No config file found
  return {};
}

// Parse arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const fileConfig = loadConfig();

  // First argument should be the command (unless it's an option)
  let command = args[0];
  let startIndex = 1;

  // If first arg starts with --, it's not a command, it's an option
  if (command && command.startsWith('--')) {
    startIndex = 0; // Parse from the beginning
  }

  // Support nested structure with backward compatibility
  const daemon = fileConfig.daemon || {};
  const cli = fileConfig.cli || {};
  const callback = fileConfig.callback || {};  // Legacy support
  const backend = fileConfig.backend || {};

  // Determine default port based on mode
  // Daemon mode (persistent) uses 8000, one-off mode uses 8001 to avoid conflicts
  const isDaemonMode = command === 'start' || command === '_internal_daemon';
  const defaultPort = isDaemonMode ? 8000 : 8001;

  // Priority: daemon.port/cli.port > callback.port (legacy) > callbackPort (legacy) > defaultPort
  let configPort;
  if (isDaemonMode) {
    configPort = daemon.port || callback.port || fileConfig.callbackPort;
  } else {
    configPort = cli.port || callback.port || fileConfig.callbackPort;
  }

  const config = {
    command: command,
    issuer: fileConfig.issuer || null,
    clientId: fileConfig.clientId || null,
    organizationId: fileConfig.organizationId || null,
    scopes: fileConfig.scopes || 'openid profile email',
    port: configPort || defaultPort,
    output: null,
    verbose: false,
    backendUrl: backend.url || fileConfig.backendUrl || null,
    backendEndpoint: backend.endpoint || '/api/cluster-auth/tokens',
    backendSecret: backend.secret || null,  // Auth secret for backend
    tokens: fileConfig.tokens || null,  // Token bypass configuration
  };

  // Parse options
  for (let i = startIndex; i < args.length; i++) {
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

  return config;
}

function showHelp() {
  console.log(`
oidc-authenticator - Client-side OIDC authentication for Backstage

Architecture:
  This tool runs on your laptop and handles OIDC authentication for Backstage.
  It returns tokens to the frontend via postMessage (default) or optionally
  sends them directly to the backend. Similar to kubectl oidc-login, it
  operates silently by default and only shows output when using --verbose.

Usage:
  oidc-authenticator [options]           # One-off authentication (opens browser)
  oidc-authenticator start [options]     # Start daemon in background
  oidc-authenticator stop                # Stop running daemon
  oidc-authenticator status              # Check daemon status
  oidc-authenticator --help              # Show this help

Commands:
  (no command)            Run one-off authentication (opens browser automatically)
  start                   Start the daemon in the background
  stop                    Stop the running daemon
  status                  Check if daemon is running

Options:
  --issuer <url>          OIDC issuer URL (required unless in config.yaml)
  --client-id <id>        OAuth client ID (required unless in config.yaml)
  --organization <id>     Organization ID (optional)
  --backend-url <url>     Backend URL (optional - for legacy direct-send mode)
  --scopes <scopes>       Space-separated scopes (default: "openid profile email")
  --port <port>           Callback port (default: 8000 for daemon, 8001 for one-off)
  --output <file>         Save tokens to file (optional, for debugging)
  -v, --verbose           Show detailed output
  --help                  Show this help message

Configuration File:
  config.yaml             Place in the same directory as the CLI tool
                          All options can be set in config.yaml to avoid
                          typing them every time. CLI args override config.

Port Configuration:
  daemon.port             Port for daemon mode (default: 8000)
  cli.port                Port for one-off mode (default: 8001)
                          Different ports prevent conflicts when testing both modes

Environment Variables:
  OIDC_ISSUER_URL         OIDC issuer URL
  OIDC_CLIENT_ID          OAuth client ID
  OIDC_ORGANIZATION_ID    Organization ID

Examples:
  # One-off authentication (opens browser automatically)
  oidc-authenticator --verbose

  # One-off with output to file
  oidc-authenticator --output /tmp/tokens.json --verbose

  # Start daemon (recommended for persistent use)
  oidc-authenticator start

  # Start with verbose output
  oidc-authenticator start --verbose

  # Start with custom port
  oidc-authenticator start --port 8080

  # Check status
  oidc-authenticator status

  # Stop daemon
  oidc-authenticator stop

  # Using config.yaml (recommended)
  cat > config.yaml <<EOF
  issuer: "https://login.spot.rackspace.com/"
  clientId: "YOUR_CLIENT_ID"
  organizationId: "org_xxxxx"
  backend:
    url: "https://backstage.example.com"
  daemon:
    port: 8000
  cli:
    port: 8001
  EOF
  oidc-authenticator              # One-off mode (uses port 8001)
  oidc-authenticator start        # Daemon mode (uses port 8000)

Integration with Backstage:
  1. Run the daemon: oidc-authenticator start
  2. In Backstage frontend, show login button that opens:
     http://localhost:8000/?mode=return-tokens
  3. Listen for postMessage event with type 'cluster-tokens':
     window.addEventListener('message', (event) => {
       if (event.data.type === 'cluster-tokens') {
         const tokens = event.data.tokens;
         // Send tokens to backend with authenticated session
       }
     });
  4. Check if daemon is running: fetch('http://localhost:8000/health')
  5. If not running, show message: "Please run 'oidc-authenticator start'"

Exit Codes:
  0   Success
  1   Error
`);
}

// Main execution
async function main() {
  const config = parseArgs();
  const command = config.command;

  // Handle help
  if (command === '--help' || command === '-h') {
    showHelp();
    process.exit(0);
  }

  // Handle daemon commands
  if (command === 'status') {
    const status = isDaemonRunning();
    if (status.running) {
      console.log(`✅ Daemon is running (PID: ${status.pid})`);
      console.log(`📋 Health check: http://localhost:${config.port}/health`);
      console.log(`🔗 To authenticate, open: http://localhost:${config.port}/`);
      const logFile = path.join(os.homedir(), '.oidc-authenticator.log');
      console.log(`📝 Log file: ${logFile}`);
      process.exit(0);
    } else {
      console.log('⚠️  Daemon is not running');
      console.log('Run "oidc-authenticator start" to start the daemon');
      process.exit(1);
    }
  }

  if (command === 'stop') {
    const status = isDaemonRunning();
    if (!status.running) {
      console.log('⚠️  Daemon is not running');
      process.exit(1);
    }

    try {
      process.kill(status.pid, 'SIGTERM');
      removePidFile();
      console.log('✅ Daemon stopped');
      process.exit(0);
    } catch (error) {
      console.error(`❌ Failed to stop daemon: ${error.message}`);
      process.exit(1);
    }
  }

  if (command === 'start') {
    // Check if already running
    const status = isDaemonRunning();
    if (status.running) {
      console.error(`❌ Daemon is already running (PID: ${status.pid})`);
      console.error('Run "oidc-authenticator stop" first to stop it');
      process.exit(1);
    }

    // Validate required options (unless using token bypass mode)
    const hasTokenBypass = config.tokens && config.tokens.accessToken && config.tokens.idToken;

    if (!hasTokenBypass) {
      if (!config.issuer) {
        console.error('Error: --issuer is required (or set OIDC_ISSUER_URL)');
        console.error('Alternatively, configure tokens bypass in config.yaml');
        process.exit(1);
      }

      if (!config.clientId) {
        console.error('Error: --client-id is required (or set OIDC_CLIENT_ID)');
        console.error('Alternatively, configure tokens bypass in config.yaml');
        process.exit(1);
      }
    }

    // Daemonize the process
    if (config.verbose) {
      console.log('🚀 Starting daemon...');
    }

    // Fork the process to run in background
    const { spawn } = require('child_process');

    // Build arguments list
    const daemonArgs = [__filename, '_internal_daemon'];

    // Only pass issuer and clientId if they exist (token bypass mode might not need them)
    if (config.issuer) {
      daemonArgs.push('--issuer', config.issuer);
    }
    if (config.clientId) {
      daemonArgs.push('--client-id', config.clientId);
    }
    if (config.organizationId) {
      daemonArgs.push('--organization', config.organizationId);
    }

    daemonArgs.push('--scopes', config.scopes);
    daemonArgs.push('--port', config.port.toString());

    if (config.backendUrl) {
      daemonArgs.push('--backend-url', config.backendUrl);
    }
    if (config.verbose) {
      daemonArgs.push('--verbose');
    }
    if (config.output) {
      daemonArgs.push('--output', config.output);
    }

    const subprocess = spawn(
      process.argv[0], // node executable
      daemonArgs,
      {
        detached: true,
        stdio: config.verbose ? 'inherit' : 'ignore',
      }
    );

    subprocess.unref();

    // Wait a bit to see if it starts successfully
    await new Promise(resolve => setTimeout(resolve, 1000));

    const newStatus = isDaemonRunning();
    if (newStatus.running) {
      console.log(`✅ Daemon started (PID: ${newStatus.pid})`);
      console.log(`📋 Health check: http://localhost:${config.port}/health`);
      console.log(`🔗 To authenticate, open: http://localhost:${config.port}/`);
      if (config.backendUrl) {
        console.log(`📤 Tokens will be sent to: ${config.backendUrl}`);
      }
      // Show log file location
      const logFile = path.join(os.homedir(), '.oidc-authenticator.log');
      console.log(`📝 Log file: ${logFile}`);
      process.exit(0);
    } else {
      console.error('❌ Failed to start daemon');
      process.exit(1);
    }
  }

  // Internal daemon command (not for user use)
  if (command === '_internal_daemon') {
    // Write PID file
    writePidFile();

    // Setup cleanup on exit
    process.on('SIGTERM', () => {
      removePidFile();
      process.exit(0);
    });

    process.on('SIGINT', () => {
      removePidFile();
      process.exit(0);
    });

    const authenticator = new OIDCAuthenticator({
      issuer: config.issuer,
      clientId: config.clientId,
      organizationId: config.organizationId,
      scopes: config.scopes,
      callbackPort: config.port,
      verbose: config.verbose,
      backendUrl: config.backendUrl,
      backendSecret: config.backendSecret,  // Auth secret for backend
      tokens: config.tokens,  // Pass tokens bypass configuration
      enableLogging: true,    // Enable logging for daemon mode
    });

    try {
      await authenticator.startDaemon();
      // Server runs forever
    } catch (error) {
      console.error('❌ Daemon failed:', error.message);
      removePidFile();
      process.exit(1);
    }
    return;
  }

  // One-off authentication mode (no command or unrecognized command)
  // This mode opens the browser automatically and completes authentication once
  if (!command || command.startsWith('--')) {
    // Validate required options (unless using token bypass mode)
    const hasTokenBypass = config.tokens && config.tokens.accessToken && config.tokens.idToken;

    if (!hasTokenBypass) {
      if (!config.issuer) {
        console.error('Error: --issuer is required (or set OIDC_ISSUER_URL)');
        console.error('Use --help for usage information');
        process.exit(1);
      }

      if (!config.clientId) {
        console.error('Error: --client-id is required (or set OIDC_CLIENT_ID)');
        console.error('Use --help for usage information');
        process.exit(1);
      }
    }

    const authenticator = new OIDCAuthenticator({
      issuer: config.issuer,
      clientId: config.clientId,
      organizationId: config.organizationId,
      scopes: config.scopes,
      callbackPort: config.port,
      verbose: config.verbose,
      backendUrl: config.backendUrl,
      backendSecret: config.backendSecret,  // Auth secret for backend
      tokens: config.tokens,  // Pass tokens bypass configuration
      enableLogging: false,   // Disable logging for one-off mode
    });

    try {
      // One-time authentication mode - opens browser automatically
      const tokens = await authenticator.authenticate();

      // Send to backend if configured
      if (config.backendUrl) {
        try {
          await authenticator.sendTokensToBackend(tokens);
          if (config.verbose) {
            console.log(`✅ Tokens sent to backend: ${config.backendUrl}`);
          }
        } catch (error) {
          if (config.verbose) {
            console.log(`⚠️  Could not send tokens to backend: ${error.message}`);
          }
        }
      }

      // Save to file if specified
      if (config.output) {
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

  // Unknown command
  console.error(`❌ Unknown command: ${command}`);
  console.error('Use --help for usage information');
  process.exit(1);
}

// Run
main();
