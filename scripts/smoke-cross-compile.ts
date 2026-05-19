#!/usr/bin/env node
/**
 * Cross-compile smoke for the binary-production pipeline.
 *
 * Invokes `stripe-cli-build-binaries` with **all five supported targets**
 * against the `test/fixtures/smoke-plugin` fixture and asserts that each
 * resulting binary exists and has the expected executable format, using
 * `file(1)` to sniff magic bytes.
 *
 * Cross-compiled binaries for non-host targets cannot be executed on the
 * host, so this smoke intentionally stops at "is the output file shaped
 * like a $target executable?" — it does not spawn or handshake them. The
 * host-target runtime smoke lives in `smoke-binary.ts`.
 *
 * This pair of smokes together forms the Tier 1 gate for the Bun
 * migration:
 *
 *   - `smoke-binary.ts`          → host boots + handshake + clean SIGTERM
 *   - `smoke-cross-compile.ts`   → all five targets cross-compile to the
 *                                  correct binary format
 *
 * Invoke via `pnpm test:smoke:cross`. Exit 0 = pass, non-zero = fail.
 */

import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const BOOTSTRAP_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const FIXTURE_DIR = path.join(BOOTSTRAP_ROOT, 'test', 'fixtures', 'smoke-plugin')
const FIXTURE_BIN_DIR = path.join(FIXTURE_DIR, 'bin')

// All supported targets per build_binaries.sh. Keep this list in sync with
// `default_targets` there; a mismatch is a test bug, not a build-script bug.
interface TargetSpec {
  // Token accepted by stripe-cli-build-binaries.
  token: string
  // Suffix build_binaries.sh appends when building multiple targets:
  //   <binary_name>-<os>-<arch>[.exe]
  outputSuffix: string
  // A substring we expect to see in `file <binary>` output. Matched
  // case-insensitively, flexible enough to handle minor phrasing
  // differences across `file` versions but specific enough that
  // swapping two targets' outputs would fail.
  expectedFileSignature: RegExp
}

const TARGETS: ReadonlyArray<TargetSpec> = [
  {
    token: 'node18-macos-arm64',
    outputSuffix: '-macos-arm64',
    expectedFileSignature: /Mach-O 64-bit executable arm64/i,
  },
  {
    token: 'node18-macos-x64',
    outputSuffix: '-macos-x64',
    expectedFileSignature: /Mach-O 64-bit executable x86_64/i,
  },
  {
    token: 'node18-linux-x64',
    outputSuffix: '-linux-x64',
    expectedFileSignature: /ELF 64-bit LSB executable.*x86-64/i,
  },
  {
    token: 'node18-linux-arm64',
    outputSuffix: '-linux-arm64',
    expectedFileSignature: /ELF 64-bit LSB executable.*(aarch64|ARM aarch64)/i,
  },
  {
    token: 'node18-win-x64',
    outputSuffix: '-win-x64.exe',
    expectedFileSignature: /PE32\+ executable.*x86-64.*MS Windows/i,
  },
]

function die(msg: string): never {
  process.stderr.write(`[smoke:cross] FAIL: ${msg}\n`)
  process.exit(1)
}

function log(msg: string): void {
  process.stdout.write(`[smoke:cross] ${msg}\n`)
}

function ensureBootstrapBuilt(): void {
  const distIndex = path.join(BOOTSTRAP_ROOT, 'dist', 'index.js')
  if (fs.existsSync(distIndex)) {
    log('bootstrap dist present')
    return
  }
  log('bootstrap dist missing — running pnpm compile:ts')
  const r = spawnSync('pnpm', ['compile:ts'], {
    cwd: BOOTSTRAP_ROOT,
    stdio: 'inherit',
  })
  if (r.status !== 0) {
    die(`pnpm compile:ts exited ${r.status}`)
  }
}

function buildAllTargets(): void {
  const targetArg = TARGETS.map(t => t.token).join(',')
  log(`building fixture binaries for targets=${targetArg}`)
  const r = spawnSync('pnpm', ['exec', 'stripe-cli-build-binaries', './bin', targetArg], {
    cwd: FIXTURE_DIR,
    stdio: 'inherit',
  })
  if (r.status !== 0) {
    die(`stripe-cli-build-binaries exited ${r.status}`)
  }
}

function fileSignature(binaryPath: string): string {
  const r = spawnSync('file', ['-b', binaryPath], { encoding: 'utf8' })
  if (r.status !== 0) {
    die(`'file -b ${binaryPath}' exited ${r.status}\n` + `stderr: ${r.stderr ?? ''}`)
  }
  return (r.stdout ?? '').trim()
}

function verifyTarget(spec: TargetSpec, binaryName: string): void {
  // build_binaries.sh emits multi-target binaries at
  //   <out_dir>/<binary_name>-<os>-<arch>[.exe]
  const binaryPath = path.join(FIXTURE_BIN_DIR, `${binaryName}${spec.outputSuffix}`)
  if (!fs.existsSync(binaryPath)) {
    die(`expected binary at ${binaryPath} not found after build`)
  }
  const stat = fs.statSync(binaryPath)
  const sig = fileSignature(binaryPath)
  if (!spec.expectedFileSignature.test(sig)) {
    die(
      `${spec.token}: binary at ${binaryPath} has unexpected format.\n` +
        `  expected: ${spec.expectedFileSignature}\n` +
        `  actual:   ${sig}`,
    )
  }
  log(`${spec.token}: OK (${(stat.size / 1024 / 1024).toFixed(1)} MiB) — ${sig}`)
}

function main(): void {
  if (!fs.existsSync(FIXTURE_DIR)) {
    die(`fixture dir missing: ${FIXTURE_DIR}`)
  }
  ensureBootstrapBuilt()
  buildAllTargets()

  // binary_name comes from the fixture's package.json `bin` entry; see
  // build_binaries.sh. We read it the same way the script does.
  const pkg = JSON.parse(
    fs.readFileSync(path.join(FIXTURE_DIR, 'package.json'), 'utf8'),
  ) as { bin?: Record<string, string> }
  const binEntries = pkg.bin !== undefined ? Object.keys(pkg.bin) : []
  if (binEntries.length === 0) {
    die('smoke fixture package.json has no bin entries')
  }
  const binaryName = binEntries[0]

  for (const spec of TARGETS) {
    verifyTarget(spec, binaryName)
  }

  // The output directory should contain only binaries. Assets are embedded
  // directly in the binary, so no extra files should be present.
  const expectedFiles = new Set(TARGETS.map(t => `${binaryName}${t.outputSuffix}`))
  const actualFiles = fs.readdirSync(FIXTURE_BIN_DIR)
  const unexpected = actualFiles.filter(f => !expectedFiles.has(f))
  if (unexpected.length > 0) {
    die(
      `output directory ${FIXTURE_BIN_DIR} contains unexpected files: ` +
        `${unexpected.join(', ')}. All assets should be embedded in the binary.`,
    )
  }
  log('output directory contains only binaries')
  log(`PASS (${TARGETS.length} targets cross-compiled and verified)`)
}

try {
  main()
} catch (err: unknown) {
  if (err instanceof Error) {
    die(`unhandled error: ${err.message}\n${err.stack ?? ''}`)
  }
  die(`unhandled error: ${String(err)}`)
}
