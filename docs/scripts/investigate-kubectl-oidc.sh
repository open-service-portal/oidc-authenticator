#!/bin/bash
#
# Investigate how kubectl oidc-login works
#
# This script helps discover what kubectl oidc-login is actually doing
# so we can replicate it in Backstage.

set -e

echo "=================================================="
echo "🔍 Investigating kubectl oidc-login configuration"
echo "=================================================="
echo

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if kubectl is installed
if ! command -v kubectl &> /dev/null; then
    echo "❌ kubectl not found"
    echo "Please install kubectl first"
    exit 1
fi

echo "✅ kubectl found: $(kubectl version --client --short 2>/dev/null || kubectl version --client)"
echo

# Check for oidc-login plugin
if ! kubectl oidc-login --help &> /dev/null; then
    echo "❌ kubectl oidc-login plugin not found"
    echo
    echo "Install with:"
    echo "  brew install int128/kubelogin/kubelogin"
    echo "  # or"
    echo "  kubectl krew install oidc-login"
    exit 1
fi

echo "✅ kubectl oidc-login found"
kubectl oidc-login --version
echo

# Check kubeconfig for OIDC configuration
echo "=================================================="
echo "📋 Checking kubeconfig for OIDC configuration"
echo "=================================================="
echo

KUBECONFIG_PATH="${KUBECONFIG:-$HOME/.kube/config}"

if [ ! -f "$KUBECONFIG_PATH" ]; then
    echo "❌ kubeconfig not found at: $KUBECONFIG_PATH"
    exit 1
fi

echo "Kubeconfig: $KUBECONFIG_PATH"
echo

# Extract OIDC configuration
echo -e "${BLUE}Looking for OIDC configuration in kubeconfig...${NC}"
echo

# Check for oidc-login exec in users section
if grep -q "oidc-login" "$KUBECONFIG_PATH"; then
    echo -e "${GREEN}✅ Found oidc-login configuration${NC}"
    echo

    echo "OIDC User Configuration:"
    echo "------------------------"

    # Extract the oidc-login args
    yq eval '.users[] | select(.user.exec.command == "kubectl-oidc_login" or .user.exec.command == "kubectl" or .user.exec.args[0] == "oidc-login") | .user.exec.args' "$KUBECONFIG_PATH" 2>/dev/null || \
    grep -A 20 "oidc-login" "$KUBECONFIG_PATH" | head -30

    echo
else
    echo -e "${YELLOW}⚠️  No oidc-login configuration found in kubeconfig${NC}"
    echo
    echo "Example OIDC configuration:"
    cat <<'EOF'
users:
- name: oidc-user
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: kubectl
      args:
      - oidc-login
      - get-token
      - --oidc-issuer-url=https://login.spot.rackspace.com/
      - --oidc-client-id=DIFFERENT_CLIENT_ID_HERE
      - --oidc-extra-scope=email
      - --oidc-extra-scope=profile
EOF
    echo
fi

echo
echo "=================================================="
echo "🔍 Key Questions to Answer"
echo "=================================================="
echo
echo "1. What CLIENT_ID does kubectl oidc-login use?"
echo -e "   ${BLUE}Look for: --oidc-client-id=${NC}"
echo
echo "2. What ISSUER URL does kubectl use?"
echo -e "   ${BLUE}Look for: --oidc-issuer-url=${NC}"
echo
echo "3. What CALLBACK PORT does kubectl use?"
echo -e "   ${BLUE}Look for: --listen-address= or check default (usually :8000 or :18000)${NC}"
echo
echo "4. Are there any EXTRA SCOPES?"
echo -e "   ${BLUE}Look for: --oidc-extra-scope=${NC}"
echo
echo "5. Is there a SKIP-BROWSER flag?"
echo -e "   ${BLUE}Look for: --skip-open-browser${NC}"
echo

echo "=================================================="
echo "🧪 Test kubectl oidc-login with verbose output"
echo "=================================================="
echo
echo "To see exactly what kubectl oidc-login does, run:"
echo
echo -e "${GREEN}kubectl oidc-login get-token --v=1 \\${NC}"
echo -e "${GREEN}  --oidc-issuer-url=https://login.spot.rackspace.com/ \\${NC}"
echo -e "${GREEN}  --oidc-client-id=mwG3lUMV8KyeMqHe4fJ5Bb3nM1vBvRNa \\${NC}"
echo -e "${GREEN}  --oidc-extra-scope=email \\${NC}"
echo -e "${GREEN}  --oidc-extra-scope=profile${NC}"
echo
echo "This will show:"
echo "  - The exact authorization URL"
echo "  - The callback URL being used"
echo "  - The local server port"
echo

echo "=================================================="
echo "💡 Hypothesis"
echo "=================================================="
echo
echo "kubectl oidc-login likely uses a DIFFERENT client ID that:"
echo "  1. Is configured as a 'Native Application' in Auth0"
echo "  2. Has 'http://localhost:*' in allowed callback URLs"
echo "  3. OR uses a specific port like http://localhost:18000"
echo
echo "Our client (mwG3lUMV8KyeMqHe4fJ5Bb3nM1vBvRNa) might be:"
echo "  - Configured as a 'Single Page Application'"
echo "  - Not have localhost in allowed callbacks"
echo

echo "=================================================="
echo "🔧 Next Steps"
echo "=================================================="
echo
echo "1. Run kubectl oidc-login with --v=1 to see the actual URLs"
echo "2. Compare the client ID kubectl uses vs. ours"
echo "3. Check if there's a separate 'CLI' client in Auth0"
echo "4. Try using kubectl's client ID in our script"
echo
