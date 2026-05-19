#!/usr/bin/env bash
# Builds native binary versions of a Stripe CLI plugin for one or more
# targets. This uses https://bun.sh/ (bun build --compile).
#
# Usage: stripe-cli-build-binaries [output_dir] [targets]
#   output_dir: Optional. Output directory for binaries (default: ./bin)
#   targets:    Optional. Comma-separated list of targets
#               (default: all supported platforms). Target tokens use the
#               existing `node18-<os>-<arch>` shape for backwards
#               compatibility; they are mapped internally to Bun's
#               `bun-<os>-<arch>` target identifiers.
#
# Called from a plugin package, expects to be run from the plugin root
# directory. The plugin must have a `bin` entry in its `package.json`
# pointing at the JS entry point (typically an esbuild bundle at
# `./dist/bundle.js`) and a `build` script that produces it.
#
# If the plugin declares `bun.assets` globs in package.json, this script
# generates an embedded manifest entrypoint (dist/bun-compile-entrypoint.js)
# that uses Bun's `import ... with { type: "file" }` to embed all assets
# directly in the binary, producing a single self-contained executable.

set -euo pipefail

# Minimum Bun version required to build binaries. This is kept in sync with
# the `bun` entry in `.tool-versions` at the repo root. Bun is the binary
# compiler this script invokes. It is NOT required to build the JS bundle,
# run tests, or lint.
REQUIRED_BUN_VERSION="1.3.13"

require_bun() {
  if ! command -v bun >/dev/null 2>&1; then
    cat >&2 <<EOF
ERROR: 'bun' was not found on PATH.

stripe-cli-build-binaries uses Bun (https://bun.sh) to compile standalone
plugin binaries. Bun ${REQUIRED_BUN_VERSION} or newer is required.

Install Bun by one of:

  # Official installer (recommended):
  curl -fsSL https://bun.sh/install | bash

  # Homebrew:
  brew install oven-sh/bun/bun

  # mise / asdf (reads .tool-versions in this repo):
  mise install bun
  # or: asdf install bun ${REQUIRED_BUN_VERSION}

Bun is only needed for the binary-compile path. 'pnpm build', 'pnpm test',
and 'pnpm lint' continue to run on Node without Bun.
EOF
    exit 1
  fi

  local bun_version_raw bun_version lowest
  bun_version_raw=$(bun --version 2>/dev/null || echo "")
  # Strip pre-release/build suffixes (e.g. "1.3.13-canary.5" -> "1.3.13") so
  # canary builds of the required version are not treated as older than the
  # corresponding stable release.
  bun_version="${bun_version_raw%%[-+]*}"

  if [[ ! "$bun_version" =~ ^[0-9]+(\.[0-9]+){0,2}$ ]]; then
    cat >&2 <<EOF
ERROR: could not determine a usable Bun version from 'bun --version'
       (got: '${bun_version_raw}').

Bun ${REQUIRED_BUN_VERSION} or newer is required by stripe-cli-build-binaries.
EOF
    exit 1
  fi

  lowest=$(printf '%s\n%s\n' "$REQUIRED_BUN_VERSION" "$bun_version" | sort -V | head -n1)
  if [ "$lowest" != "$REQUIRED_BUN_VERSION" ]; then
    cat >&2 <<EOF
ERROR: Bun ${bun_version_raw} is older than the required ${REQUIRED_BUN_VERSION}.

Upgrade Bun by one of:

  # Official installer (recommended):
  curl -fsSL https://bun.sh/install | bash

  # Homebrew:
  brew upgrade bun

  # mise / asdf (reads .tool-versions in this repo):
  mise install bun
  # or: asdf install bun ${REQUIRED_BUN_VERSION}
EOF
    exit 1
  fi

  echo "Using Bun ${bun_version_raw} (from $(command -v bun))"
}

require_bun

# Supported target tokens. Canonical names are `<os>-<arch>`; the old
# `node18-<os>-<arch>` aliases remain accepted for backwards-compatibility so
# existing call sites do not have to change. Internally we map to Bun's
# `bun-<os>-<arch>` targets. These platforms match the Go plugin build targets
# win-x86 is not supported.
default_targets="macos-arm64,macos-x64,linux-x64,linux-arm64,win-x64"

# Accept and ignore the `-d` / `--debug` flag and the `DEBUG_MODE=true`
# environment variable for backwards-compat. These will either be wired to
# `bun build --verbose` or dropped in a later migration leaf. See PLAN.md.
if [[ "${1:-}" == "-d" || "${1:-}" == "--debug" ]]; then
  shift
fi

# Parse arguments
out_dir="${1:-$PWD/bin}"
targets="${2:-$default_targets}"

# Get the binary name and entry point from package.json
binary_name=$(jq -r '.bin | to_entries | .[0].key' package.json)
entry_point=$(jq -r '.bin | to_entries | .[0].value' package.json)

if [ "$binary_name" = "null" ] || [ -z "$binary_name" ]; then
  echo "ERROR: No bin entry found in package.json" >&2
  exit 1
fi

if [ "$entry_point" = "null" ] || [ -z "$entry_point" ]; then
  echo "ERROR: No bin entry point found in package.json" >&2
  exit 1
fi

echo "Building $binary_name binaries for target(s): $targets into $out_dir"
echo "Entry point: $entry_point"

if [ -e "$out_dir" ];
then
  rm -rf "$out_dir"
fi

mkdir -p "$out_dir"

# Ensure the plugin is built (detect package manager from lock file).
# This produces the JS bundle that Bun will compile into a standalone
# executable.
if [ -f "pnpm-lock.yaml" ]; then
  pnpm build
elif [ -f "yarn.lock" ]; then
  yarn build
else
  npm run build
fi

# Generate embedded asset manifest if bun.assets is declared.
# This creates dist/bun-compile-entrypoint.js which becomes the Bun compile
# entrypoint — it imports every asset with { type: "file" } so Bun embeds
# them directly in the binary.
# Resolve symlinks so SCRIPT_DIR points to the real scripts/ directory even
# when invoked via an npm .bin/ symlink (BASH_SOURCE[0] is the literal
# symlink path on Linux, not the target).
_source="${BASH_SOURCE[0]}"
while [ -L "$_source" ]; do
  _dir="$(cd "$(dirname "$_source")" && pwd)"
  _source="$(readlink "$_source")"
  # Handle relative symlink targets
  [[ "$_source" != /* ]] && _source="$_dir/$_source"
done
SCRIPT_DIR="$(cd "$(dirname "$_source")" && pwd)"
"$SCRIPT_DIR/generate-embedded-manifest.sh"

# Use the embedded manifest entrypoint if it was generated, otherwise
# fall back to the declared entry point (for plugins with no assets).
if [ -f "dist/bun-compile-entrypoint.js" ]; then
  compile_entry="./dist/bun-compile-entrypoint.js"
  echo "Using embedded asset entrypoint: $compile_entry"
else
  compile_entry="$entry_point"
fi

# Map an incoming target token to four fields separated by `|`:
#   <bun-target>|<os-token>|<arch-token>|<exe-suffix>
# Returns non-zero for unknown tokens.
map_target() {
  case "$1" in
    macos-arm64|node18-macos-arm64) echo "bun-darwin-arm64|macos|arm64|" ;;
    macos-x64|node18-macos-x64)     echo "bun-darwin-x64|macos|x64|" ;;
    linux-x64|node18-linux-x64)     echo "bun-linux-x64|linux|x64|" ;;
    linux-arm64|node18-linux-arm64) echo "bun-linux-arm64|linux|arm64|" ;;
    win-x64|node18-win-x64)         echo "bun-windows-x64|win|x64|.exe" ;;
    *) return 1 ;;
  esac
}

# Split comma-separated targets into an array.
IFS=',' read -r -a target_array <<< "$targets"
target_count=${#target_array[@]}

for target in "${target_array[@]}"; do
  mapping=$(map_target "$target") || {
    echo "ERROR: unsupported target '$target'. Supported: $default_targets" >&2
    exit 1
  }
  IFS='|' read -r bun_target os_tok arch_tok exe_suffix <<< "$mapping"

  # When only one target is built, emit the binary directly at
  # `<out_dir>/<binary_name>`. When multiple targets are built, suffix with
  # `-<os>-<arch>` to disambiguate. This naming convention is preserved for
  # backwards-compatibility with existing consumers.
  if [ "$target_count" -eq 1 ]; then
    out_path="$out_dir/${binary_name}${exe_suffix}"
  else
    out_path="$out_dir/${binary_name}-${os_tok}-${arch_tok}${exe_suffix}"
  fi

  echo "==> bun build --compile --target=${bun_target} --outfile=${out_path} ${compile_entry}"
  bun build --compile --target="$bun_target" --outfile="$out_path" "$compile_entry"
done

echo "Binaries built successfully in $out_dir"
