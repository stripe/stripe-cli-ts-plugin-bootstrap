# @stripe/stripe-cli-plugin-bootstrap

## 0.5.4

### Patch Changes

- [#13](https://github.com/stripe/stripe-cli-ts-plugin-bootstrap/pull/13) [`3518704`](https://github.com/stripe/stripe-cli-ts-plugin-bootstrap/commit/3518704124a44445fb888a5739577cede026734b) Thanks [@vcheung-stripe](https://github.com/vcheung-stripe)! - Fix XDG_CONFIG_HOME handling in addPluginToConfig and addPluginToManifest to use $XDG_CONFIG_HOME/stripe/ as the config directory. Also adds composite GitHub Actions for installing dependencies and the Stripe CLI.

## 0.5.3

### Patch Changes

- [#11](https://github.com/stripe/stripe-cli-ts-plugin-bootstrap/pull/11) [`c4c3380`](https://github.com/stripe/stripe-cli-ts-plugin-bootstrap/commit/c4c3380da214c54ac8c63a456fa2bb8bc2396c3a) Thanks [@vcheung-stripe](https://github.com/vcheung-stripe)! - Fix ReferenceError when using getPluginEsbuildConfig from an ESM context by replacing bare require and \_\_dirname with createRequire and fileURLToPath equivalents

## 0.5.2

### Patch Changes

- [#9](https://github.com/stripe/stripe-cli-ts-plugin-bootstrap/pull/9) [`7c15b54`](https://github.com/stripe/stripe-cli-ts-plugin-bootstrap/commit/7c15b5452793748e889b4574b8007e64b0025f6b) Thanks [@vcheung-stripe](https://github.com/vcheung-stripe)! - Fix install-plugin to work on Windows via Git Bash: get_platform_target now detects MINGW/MSYS/Cygwin and maps to win-x64, binary builds include the .exe suffix in build and install paths, and shasum is replaced with a Node.js crypto equivalent.

## 0.5.1

### Patch Changes

- [#7](https://github.com/stripe/stripe-cli-ts-plugin-bootstrap/pull/7) [`837951f`](https://github.com/stripe/stripe-cli-ts-plugin-bootstrap/commit/837951f1540dcb84ed43f952c4449f9aaa621e17) Thanks [@tomelm](https://github.com/tomelm)! - Fix broker dial protocol to match go-plugin v1.7.0 non-mux mode used by the Stripe CLI host. The previous implementation sent a knock request and waited for an ack, but the host only announces services via ConnInfo (no knock). Announcements arriving before `dial()` was called were silently dropped and `dial()` would then time out after 5s, leaving `CoreCLIHelper` undefined for the plugin command. Plugins that used the keychain saw this surface as a misleading "Keychain not initialized" error.

## 0.5.0

### Minor Changes

- [#4](https://github.com/stripe/stripe-cli-ts-plugin-bootstrap/pull/4) [`cf31aed`](https://github.com/stripe/stripe-cli-ts-plugin-bootstrap/commit/cf31aeddb932bef370d9639ea7b574ae66338cee) Thanks [@vcheung-stripe](https://github.com/vcheung-stripe)! - Add StripeClient with automatic credential resolution from config/keychain

## 0.4.1

### Patch Changes

- [`ed45699`](https://github.com/stripe/stripe-cli-ts-plugin-bootstrap/commit/ed4569928295bb2b8d9e38c0437181b083454836) Thanks [@jar-stripe](https://github.com/jar-stripe)! - Remove internal URLs, add LICENSE/CODE_OF_CONDUCT/CONTRIBUTING, and remove internal-only documentation files for open-source readiness.

## 0.4.0

### Minor Changes

- Thanks [@jar-stripe](https://github.com/jar-stripe)! - Export terminal color utilities via picocolors

### Patch Changes

- Thanks [@jar-stripe](https://github.com/jar-stripe)! - Fix build_binaries.sh failing on Linux when invoked via npm .bin/ symlink

- Thanks [@jar-stripe](https://github.com/jar-stripe)! - Rename generated `dist/embedded-assets.js` to `dist/bun-compile-entrypoint.js`

  The generated file is the Bun compile entrypoint, not an asset module. This
  distinguishes it from `src/runtime/embedded-assets.ts` which is the actual
  runtime API for reading embedded assets.

## 0.3.0

### Minor Changes

- Thanks [@jar-stripe](https://github.com/jar-stripe)! - Embed assets directly in compiled binaries. Plugins declaring `bun.assets` globs now produce a single self-contained binary with all assets embedded via Bun's `import ... with { type: "file" }`.

  New runtime API:
  - `getAssetDir()` — returns extracted asset root (binary) or repo root (dev)
  - `resolveAsset(...segments)` — convenience for resolving asset paths

  Removed `SOURCE_DIR`, `relativeFile()`, and `isEmbedded()` exports from `@stripe/stripe-cli-plugin-bootstrap/runtime`.

## 0.2.2

### Patch Changes

- Thanks [@tomer-stripe](https://github.com/tomer-stripe)! - Update `scripts/release` TypeScript dependency from 5.8.2 to 6.0.3 to match the tsconfig's `"ignoreDeprecations": "6.0"` setting.

## 0.2.1

### Patch Changes

- Thanks [@tomer-stripe](https://github.com/tomer-stripe)! - Fix `build-bundle.sh` to support ESM esbuild configs (`.mjs`) and convert the default fallback config from CJS to ESM, matching the package's ESM-only exports.

## 0.2.0

### Minor Changes

- Thanks [@tomer-stripe](https://github.com/tomer-stripe)! - Update all dependencies to latest and switch esbuild output to ESM with \_\_dirname/require shim banner. Enables yargs 18 and other ESM-only packages in Bun-compiled binaries.

- Thanks [@mbroshi-stripe](https://github.com/mbroshi-stripe)! - Migrate `stripe-cli-build-binaries` from Vercel `pkg` to `bun build --compile`. Bun is now a build-time prerequisite for anyone running `stripe-cli-build-binaries` (install via <https://bun.sh/> or `mise install` — the repo pins `bun 1.3.13` in `.tool-versions`). Produced binaries now ship the Bun runtime instead of Node 18 and are ~50–75% smaller per target. Public `bin` entries, argument shape, and the supported target list (`macos-arm64`, `macos-x64`, `linux-x64`, `linux-arm64`, `win-x64`) are unchanged, so downstream plugin repos do not need dependency spec changes. The `pkg`, `pkg-fetch`, `scripts/pkg-wrapper`, `scripts/get_pkg_fetch_binaries.sh`, and `.build/pkg-cache` tooling is removed. `GRPCStdio` now also wraps `console.log` / `console.info` / `console.warn` / `console.error` / `console.debug` (not just `process.stdout.write` / `process.stderr.write`) so plugin-side `console.*` output is forwarded to the host under Bun, where those methods bypass the `process.stdout.write` wrapper.

- Thanks [@mbroshi-stripe](https://github.com/mbroshi-stripe)! - Read `.changeset/bun-binaries-migration.md` first for the base `pkg` -> Bun binary-build migration. This follow-up change documents the sidecar-asset contract that Bun `--compile` requires.

  Plugins that used `pkg.assets` should move those globs to `bun.assets`. `stripe-cli-build-binaries` still accepts `pkg.assets` as a temporary back-compat shim, but new plugins should declare `bun.assets` directly.

  Plugins that read sidecar files via `path.join(__dirname, '../...')`, `fs.readFileSync(__dirname + ...)`, or similar `__dirname`-relative paths must switch to `@stripe/stripe-cli-plugin-bootstrap/runtime`'s `SOURCE_DIR` / `relativeFile` helper. See the new "Shipping sidecar assets" section in `README.md` for the supported pattern.

  Publish and install flows must now ship the compiled binary together with its sibling asset tree. If you previously copied only `stripe-cli-<plugin>` into `~/.config/stripe/plugins/<shortname>/<version>/`, update that flow to preserve the sibling files and directories emitted by `stripe-cli-build-binaries`.

### Patch Changes

- Thanks [@tomer-stripe](https://github.com/tomer-stripe)! - Add `prepare` script so consumers can install this package directly from a git ref (e.g. `npm install github:stripe/stripe-cli-ts-plugin-bootstrap#master`). Previously, git-based installs would fail because `dist/` was never built.

## 0.1.2

### Patch Changes

- Thanks [@vcheung-stripe](https://github.com/vcheung-stripe)! - Fix build_binaries.sh to use sh and node for improved portability across environments

## 0.1.1

### Patch Changes

- Thanks [@vcheung-stripe](https://github.com/vcheung-stripe)! - Fix build:package failure when bootstrap is installed from registry

  pnpm only sets the execute bit on scripts listed in the `bin` field. `get_pkg_fetch_binaries.sh` is not in `bin`, so it would install without `+x` and cause `Permission denied` when `build_binaries.sh` tried to run it. Fixed by invoking it with an explicit `bash` prefix.

## 0.1.0

### Minor Changes

- Thanks [@vcheung-stripe](https://github.com/vcheung-stripe)! - Add runPeerPlugin to CoreCLIHelper — allows plugins to invoke other Stripe CLI plugins by name, with arguments and a working directory

### Patch Changes

- Thanks [@jar-stripe](https://github.com/jar-stripe)! - Refactor RunCommand analytics setup into helper methods for improved readability

  Analytics events have changed: the previous implementation sent multiple per-command events (`plugin_command_started`, `plugin_command_completed`, `plugin_command_duration`, `plugin_command_error`) with a `{name}_{commandName}` label. The new implementation sends a single `Plugin invoked` event with a `{name}@{version}` label, fired in parallel with command execution.
