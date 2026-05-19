# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Principles

- **Start simple.** Choose the most straightforward approach first. Only add complexity when the simple solution demonstrably doesn't work.
- **Ask when uncertain.** If something looks inconsistent or unexpected (mismatched config values, unusual file states, questionable data), ask rather than assuming. There may be context you don't have.
- **Verify claims with evidence.** When reporting that something worked (caching, performance improvement, etc.), cite specific output that proves it. If the output contradicts the claim — downloading bytes, showing progress bars, long compile output — say so honestly.

## Project Overview

`@stripe/stripe-cli-plugin-bootstrap` is a foundation library for building TypeScript Stripe CLI plugins. It implements HashiCorp's go-plugin protocol over gRPC and provides utilities for plugin development:

- **gRPC Plugin Server**: Implements go-plugin handshake, health checks, GRPCStdio, GRPCController
- **Configuration Management**: Read/write Stripe CLI config files (`~/.config/stripe/config.toml`)
- **Telemetry Utilities**: Helpers for plugin telemetry integration
- **CLI Utilities**: Pre-configured yargs setup with global flags (`--api-key`, `--color`, `--config`, etc.)
- **Build Tools**: Scripts for building standalone binaries (via Bun), installing plugins locally, and managing plugin manifests
- **Interactive prompts**: Wrappers around `@clack/prompts` for consistent plugin UX

## Development Commands

```bash
pnpm build          # Compile TypeScript + release scripts + API docs
pnpm clean          # Remove dist, docs, temp, prebuilds
pnpm test           # Run tests (vitest)
pnpm lint           # ESLint + TypeScript type-check + Prettier check
pnpm fix            # Auto-fix ESLint + format with Prettier
```

## Architecture

### Plugin Communication Flow

1. The Stripe CLI launches the plugin binary
2. Plugin starts a gRPC server on an ephemeral port
3. Plugin prints handshake line to stdout: `CORE|APP|NETWORK|ADDR|grpc` (e.g., `1|2|tcp|127.0.0.1:54321|grpc`)
4. Stripe CLI parses handshake and connects to the gRPC server
5. CLI invokes `proto.Main.RunCommand` with arguments
6. Plugin uses yargs to parse arguments and dispatch to command handlers

### Key exports

- `servePlugin(options)` — Boot the gRPC server and print handshake
- `getPluginYargs(pluginName)` — Pre-configured yargs with global CLI flags
- `addTypedService(server, service, impl)` — Type-safe gRPC service registration
- `formatHandshake(...)` — Format the go-plugin handshake line
- `initializeConfig(profile)` — Read Stripe CLI config
- `withTelemetry(fn, pluginInfo)` — Wrap command with telemetry
- `TerminalInfo` — Host terminal detection (stdout/stderr is TTY)
- `resolveAsset(path)` — Resolve embedded assets in compiled binaries

### Protocol Buffers

Proto definitions live in `protos/`. Generated TypeScript is in `src/grpc/proto/`. Regenerate with:

```bash
pnpm exec stripe-cli-gen-proto src/grpc/proto
```

### Binary builds

`stripe-cli-build-binaries` uses Bun's `bun build --compile` to produce standalone executables. Targets: `macos-arm64`, `macos-x64`, `linux-x64`, `linux-arm64`, `win-x64`. Bun must be on PATH (minimum version pinned in `.tool-versions`).

Plugins declare assets to embed via `bun.assets` in their `package.json`. At runtime, `resolveAsset()` extracts them from the binary.

## TypeScript Conventions

- Prefer type guards over optimistic casting. No non-null assertions (`!`) outside tests.
- No `any` — use `unknown` with type guards or define proper interfaces.
- No empty catch blocks. Rethrow with context using `{ cause: err }`.
- Use explicit null/undefined checks for values that could be legitimately falsy (enums with `0`, empty strings, `false`). Avoid `!value` or `value || default` patterns for these cases.

## Dependencies

- **Package manager**: pnpm (see `packageManager` field in `package.json`)
- **TypeScript**: 6.x
- **Node runtime**: jiti for loading TypeScript modules dynamically
- **Key dependencies**: `@grpc/grpc-js`, `protobufjs`, `yargs`, `picocolors`, `@clack/prompts`
- **Build-time**: Bun (for `stripe-cli-build-binaries` only)
