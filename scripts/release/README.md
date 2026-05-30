# Release Scripts

> **Internal use only.** These scripts are part of Stripe's internal CI/CD release pipeline and are not intended for external use.

Scripts used during the automated release process (GitHub Actions).

## Setup

Install dependencies before running any scripts:

```bash
cd scripts/release
npm install
```

## updateManifest.ts

Updates the plugin manifest (plugins.toml) with new release entries for all built binaries.

### Usage

```bash
cd scripts/release
npm run update-manifest <version> <manifest-file> [bin-dir]
```

**Arguments:**

- `version` - Plugin version (e.g., 0.0.2 or v0.0.2 - the "v" prefix is automatically removed)
- `manifest-file` - Path to plugins.toml manifest file (relative to repository root)
- `bin-dir` - Optional: Directory containing binaries (default: ./bin from repo root)

### What it does

1. Reads the plugin name and magic cookie from the `.plugin` file
2. Checks if the plugin exists in the manifest, adds it if not (first-time publish)
3. Finds all built binaries in the bin/ directory
4. Computes SHA256 checksums for each binary
5. Calls `addPluginReleaseToManifest` (from `@stripe/stripe-cli-plugin-bootstrap`) for each platform/arch combination

**Note**: On first run for a new plugin, the script will automatically add the plugin entry to the manifest before adding releases.

### Example

```bash
# Build binaries first (from repo root)
npm run build:package

# Update manifest
cd scripts/release
npm run update-manifest 0.0.2 ../../dist/plugins-generate.toml
```

This will process all binaries matching the pattern `stripe-cli-generate-*` and add entries to the manifest for:

- darwin/arm64 (macOS Apple Silicon)
- darwin/amd64 (macOS Intel)
- linux/arm64 (Linux ARM64)
- linux/amd64 (Linux x64)
- windows/amd64 (Windows x64)

### Platform/Architecture Mapping

The script maps `stripe-cli-build-binaries` target tokens to go-plugin
OS/arch naming:

| build target | go-plugin OS | go-plugin arch |
| ------------ | ------------ | -------------- |
| macos        | darwin       | -              |
| linux        | linux        | -              |
| win          | windows      | -              |
| arm64        | -            | arm64          |
| x64          | -            | amd64          |

## TypeScript Release Scripts

### downloadManifest.ts

Downloads the plugin manifest from Artifactory.

**Usage:**

```bash
export ARTIFACTORY_HOST="your-host"
export ARTIFACTORY_SECRET="your-secret"
export ARTIFACTORY_REPO="stripe-cli-plugins"
npm run download-manifest
```

Downloads `plugins-<plugin-name>.toml` from Artifactory to `dist/` directory.

### publishPlugin.ts

Uploads plugin binaries and a manifest file to Artifactory.

**Usage:**

```bash
export ARTIFACTORY_HOST="your-host"
export ARTIFACTORY_SECRET="your-secret"
export ARTIFACTORY_REPO="stripe-cli-plugins"
npm run publish-plugin <version> <manifest-filename>
```

**Arguments:**

- `version` - Plugin version (e.g., 0.0.2 or v0.0.2)
- `manifest-filename` - Manifest filename to upload from `dist/`

**Environment Variables:**

- `ARTIFACTORY_HOST` - Artifactory hostname (required)
- `ARTIFACTORY_SECRET` - Bearer token for Artifactory authentication
- `ARTIFACTORY_REPO` - Artifactory repository name
- `DRYRUN_PUBLISH` - Set to any value to enable dry-run mode (no actual uploads)

**What it does:**

1. Reads plugin name from `.plugin` file
2. Finds all built binaries in `bin/` directory
3. Uploads binaries to `<plugin-name>/<version>/<os>/<arch>/stripe-cli-<plugin-name>`
   - All binaries are uploaded with the same name (`stripe-cli-<plugin-name>`)
   - Differentiated by their path (OS/arch)
   - Each binary is self-contained (assets are embedded at build time)
4. Uploads the manifest file to the Artifactory root using the provided manifest filename

**Example upload paths for version 0.0.2:**

- `generate/0.0.2/darwin/amd64/stripe-cli-generate`
- `generate/0.0.2/darwin/arm64/stripe-cli-generate`
- `generate/0.0.2/linux/amd64/stripe-cli-generate`
- `generate/0.0.2/linux/arm64/stripe-cli-generate`
- `generate/0.0.2/windows/amd64/stripe-cli-generate`

**Supported platforms:**

- darwin/amd64 (macOS Intel)
- darwin/arm64 (macOS Apple Silicon)
- linux/amd64 (Linux x64)
- linux/arm64 (Linux ARM64)
- windows/amd64 (Windows x64)

### CI Usage

In `.github/workflows/release.yml`:

```yaml
- name: Build binaries
  run: npm run build:package

- name: Install release script dependencies
  run: npm install
  working-directory: ./scripts/release

- name: Download manifest file
  run: npm run download-manifest
  working-directory: ./scripts/release
  env:
    ARTIFACTORY_HOST: ${{ secrets.ARTIFACTORY_HOST }}
    ARTIFACTORY_SECRET: ${{ secrets.ARTIFACTORY_SECRET }}
    ARTIFACTORY_REPO: stripe-cli-plugins

- name: Update manifest
  run: npm run update-manifest "${{ steps.bump-version.outputs.new_version }}" dist/plugins-generate.toml
  working-directory: ./scripts/release

- name: Publish plugin
  run: npm run publish-plugin ${{ steps.bump-version.outputs.new_version }} plugins-generate.toml
  working-directory: ./scripts/release
  env:
    ARTIFACTORY_HOST: ${{ secrets.ARTIFACTORY_HOST }}
    ARTIFACTORY_SECRET: ${{ secrets.ARTIFACTORY_SECRET }}
    ARTIFACTORY_REPO: stripe-cli-plugins
    DRYRUN_PUBLISH: ${{ vars.DRYRUN_PUBLISH }}
```

### publishPluginWithAdminApp.ts

Uploads plugin binaries to Artifactory and updates Stripe CLI plugin metadata via
the authenticated Stripe API.

**Usage:**

```bash
export ARTIFACTORY_HOST="your-host"
export ARTIFACTORY_SECRET="your-secret"
export ARTIFACTORY_REPO="stripe-cli-plugins"
export STRIPE_API_KEY="sk_live_..."
npm run publish-plugin-with-admin-app <version>
```

**Arguments:**

- `version` - Plugin version (e.g., 0.0.2 or v0.0.2)

**Environment Variables:**

- `ARTIFACTORY_HOST` - Artifactory hostname (required)
- `ARTIFACTORY_SECRET` - Bearer token for Artifactory authentication
- `ARTIFACTORY_REPO` - Artifactory repository name
- `STRIPE_API_KEY` - Stripe secret key with `stripecli_plugin_write` permission
- `PLUGIN_AVAILABILITY` - Optional override for release availability (`public` or `conditional`); defaults to `conditional` for `docs`, `generate`, `health`, and `spec`, otherwise `public`
- `DRYRUN_PUBLISH` - Set to any value to enable dry-run mode (no actual uploads)

**What it does:**

1. Reads plugin name from `.plugin` file
2. Finds all built binaries in `bin/` directory
3. Computes SHA256 checksums for each binary
4. Uploads binaries to `<plugin-name>/<version>/<os>/<arch>/stripe-cli-<plugin-name>`
   - All binaries are uploaded with the same name (`stripe-cli-<plugin-name>`)
   - Differentiated by their path (OS/arch)
   - Each binary is self-contained (assets are embedded at build time)
5. Calls `POST /v1/stripecli/update-plugin-metadata` for each uploaded platform
   to register the version, OS, arch, checksum, and availability in Stripe

### CI Usage

In `.github/workflows/release.yml`:

```yaml
- name: Build binaries
  run: npm run build:package

- name: Install release script dependencies
  run: npm install
  working-directory: ./scripts/release

- name: Publish plugin with Admin App
  run: npm run publish-plugin-with-admin-app ${{ steps.bump-version.outputs.new_version }}
  working-directory: ./scripts/release
  env:
    ARTIFACTORY_HOST: ${{ secrets.ARTIFACTORY_HOST }}
    ARTIFACTORY_SECRET: ${{ secrets.ARTIFACTORY_SECRET }}
    ARTIFACTORY_REPO: stripe-cli-plugins
    STRIPE_API_KEY: ${{ secrets.STRIPE_API_KEY }}
    # Optional for feature-gated plugins; omit for public releases.
    PLUGIN_AVAILABILITY: conditional
    DRYRUN_PUBLISH: ${{ vars.DRYRUN_PUBLISH }}
```
