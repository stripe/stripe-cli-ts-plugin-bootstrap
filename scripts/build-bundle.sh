#!/usr/bin/env bash
# Builds a JavaScript bundle for a Stripe CLI plugin using esbuild.
# This is an alternative to build_binaries.sh which creates native binaries.
#
# Usage: build-bundle.sh [output_dir]
#   output_dir: Optional. Output directory for bundle (default: ./dist)
#
# Called from a plugin package, expects to be run from the plugin root directory.
# The plugin can optionally have:
# - An esbuild.config.js that exports a build configuration
# - If not present, uses default configuration from @stripe/stripe-cli-plugin-bootstrap

set -euo pipefail

# Get the directory where bootstrap's scripts live
BOOTSTRAP_DIR=$(node -e "console.log(require.resolve('@stripe/stripe-cli-plugin-bootstrap/package.json').replace('/package.json', ''))")
SCRIPT_DIR="$BOOTSTRAP_DIR/scripts"

# Parse arguments
out_dir="${1:-$PWD/dist}"

# Get the binary name and entry point from package.json
binary_name=$(jq -r '.bin | to_entries | .[0].key' package.json)
main_entry=$(jq -r '.main' package.json)

if [ "$binary_name" = "null" ] || [ -z "$binary_name" ]; then
  echo "❌ ERROR: No bin entry found in package.json"
  exit 1
fi

# Determine entry point: prefer bin entry, fallback to main
if [ -f "src/main.ts" ]; then
  entry_point="src/main.ts"
elif [ -f "src/index.ts" ]; then
  entry_point="src/index.ts"
elif [ "$main_entry" != "null" ] && [ -n "$main_entry" ]; then
  entry_point="$main_entry"
else
  echo "❌ ERROR: Could not determine entry point. Expected src/main.ts or src/index.ts"
  exit 1
fi

echo "🏗️  Building $binary_name plugin bundle..."
echo "   Entry point: $entry_point"
echo "   Output directory: $out_dir"

mkdir -p "$out_dir"

# Check if plugin has custom esbuild config (support .mjs, .js, .ts)
if [ -f "esbuild.config.mjs" ]; then
  echo "   Using custom esbuild.config.mjs"
  node esbuild.config.mjs
elif [ -f "esbuild.config.js" ]; then
  echo "   Using custom esbuild.config.js"
  node esbuild.config.js
else
  echo "   Using default esbuild configuration"
  node "$SCRIPT_DIR/default-esbuild-config.mjs" "$entry_point" "$out_dir/bundle.js"
fi

bundle_path="$out_dir/bundle.js"

# Add shebang if it doesn't exist
if [ -f "$bundle_path" ]; then
  if ! head -n 1 "$bundle_path" | grep -q '^#!'; then
    echo "#!/usr/bin/env node" | cat - "$bundle_path" > "$bundle_path.tmp"
    mv "$bundle_path.tmp" "$bundle_path"
    echo "   ✓ Added shebang to bundle.js"
  fi
  chmod +x "$bundle_path"
else
  echo "❌ ERROR: Bundle not created at $bundle_path"
  exit 1
fi

echo "✅ Bundle created successfully at $bundle_path"
