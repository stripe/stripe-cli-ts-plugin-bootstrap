#!/usr/bin/env bash
# Shared functions for Stripe CLI plugin scripts.
#
# To source this file, first find the bootstrap directory:
#   BOOTSTRAP_DIR=$(find_bootstrap_dir)
#   source "$BOOTSTRAP_DIR/scripts/lib/common.sh"

# Detect package manager from lock file
detect_pm() {
  if [ -f "pnpm-lock.yaml" ]; then echo "pnpm"
  elif [ -f "yarn.lock" ]; then echo "yarn"
  else echo "npm"
  fi
}

# Generate UUID for magic cookie
# Uses uuidgen if available, otherwise falls back to /proc or node
generate_uuid() {
  if command -v uuidgen &> /dev/null; then
    uuidgen | tr '[:lower:]' '[:upper:]'
  elif [[ -f /proc/sys/kernel/random/uuid ]]; then
    tr '[:lower:]' '[:upper:]' < /proc/sys/kernel/random/uuid
  else
    node -e "console.log(require('crypto').randomUUID().toUpperCase())"
  fi
}

# Convert kebab-case to PascalCase
# Example: my-plugin -> MyPlugin
to_pascal_case() {
  echo "$1" | awk -F- '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2)}1' OFS=''
}

# Require .plugin file to exist, exit with error if not
require_plugin_file() {
  if [ ! -f .plugin ]; then
    echo "❌ No .plugin file found. Run 'npx stripe-cli-init-plugin' first." >&2
    exit 1
  fi
}

# Read plugin config from .plugin file
# Sets PLUGIN_NAME and PLUGIN_HANDSHAKE variables
read_plugin_config() {
  require_plugin_file
  read -r PLUGIN_NAME PLUGIN_HANDSHAKE < .plugin
  export PLUGIN_NAME PLUGIN_HANDSHAKE
}

# Get current platform target token for stripe-cli-build-binaries.
# Returns something like "node18-macos-arm64".
get_platform_target() {
  local os arch
  os=$(uname -s | tr '[:upper:]' '[:lower:]')
  arch=$(uname -m)

  case "$os" in
    darwin) os="macos" ;;
    linux) os="linux" ;;
    mingw*|msys*|cygwin*) os="win" ;;
    *) echo "Unsupported OS: $os" >&2; exit 1 ;;
  esac

  case "$arch" in
    x86_64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
  esac

  echo "node18-$os-$arch"
}

# Validate plugin name format
# Returns 0 if valid, 1 if invalid (with error message to stderr)
validate_plugin_name() {
  local name="$1"
  if [[ -z "$name" ]]; then
    echo "Plugin name is required" >&2
    return 1
  fi
  if [[ ! "$name" =~ ^[a-z]([a-z0-9-]*[a-z0-9])?$ ]]; then
    echo "Plugin name must be lowercase, start with a letter, and contain only letters, numbers, and hyphens" >&2
    return 1
  fi
  if [[ ${#name} -gt 50 ]]; then
    echo "Plugin name must be 50 characters or less" >&2
    return 1
  fi
  return 0
}

# Run a package manager command
# Usage: run_pm install | run_pm run build
run_pm() {
  local pm
  pm=$(detect_pm)

  case "$1" in
    install)
      if [[ "$pm" == "yarn" ]]; then
        yarn
      else
        $pm install
      fi
      ;;
    *)
      if [[ "$pm" == "yarn" ]]; then
        yarn "$@"
      else
        $pm "$@"
      fi
      ;;
  esac
}
