#!/usr/bin/env node
/**
 * Tier 1 smoke gate for the binary-production pipeline.
 *
 * Builds a host-arch binary via `stripe-cli-build-binaries` from the
 * `test/fixtures/smoke-plugin` fixture, then:
 *
 *   1. Asserts the output directory contains only the binary.
 *   2. Spawns the binary as a subprocess from a foreign cwd.
 *   3. Asserts a well-formed go-plugin handshake line appears on stdout
 *      within HANDSHAKE_TIMEOUT_MS.
 *   4. Connects via gRPC and verifies console.log forwarding and embedded
 *      asset reading.
 *   5. Sends SIGTERM and asserts the process exits within SHUTDOWN_TIMEOUT_MS.
 *
 * The smoke is intentionally decoupled from the `stripe` CLI, generate-plugin,
 * and acceptance harness. It exists so every leaf touching the binary-build
 * pipeline can gate on "does the binary still boot?" cheaply.
 *
 * Invoke via `pnpm test:smoke`. Exit 0 = pass, non-zero = fail.
 */

import { spawn, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as grpc from '@grpc/grpc-js'

import {
  MainService,
  RunCommandRequest,
  RunCommandResponse,
} from '../src/grpc/proto/proto/main'
import {
  GRPCStdioService,
  StdioData,
  StdioData_Channel,
} from '../src/grpc/proto/plugin/grpc_stdio'
import { Empty } from '../src/grpc/proto/google/protobuf/empty'

const BOOTSTRAP_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const FIXTURE_DIR = path.join(BOOTSTRAP_ROOT, 'test', 'fixtures', 'smoke-plugin')
const FIXTURE_BIN_DIR = path.join(FIXTURE_DIR, 'bin')

const HANDSHAKE_RE = /^\d+\|\d+\|tcp\|127\.0\.0\.1:\d+\|grpc$/m
const HANDSHAKE_ADDR_RE = /^\d+\|\d+\|tcp\|(127\.0\.0\.1:\d+)\|grpc$/m
const HANDSHAKE_TIMEOUT_MS = 15_000
const SHUTDOWN_TIMEOUT_MS = 5_000
const CONSOLE_FORWARD_TIMEOUT_MS = 5_000

// Must match POST_HANDSHAKE_MARKER in test/fixtures/smoke-plugin/src/main.ts
const POST_HANDSHAKE_MARKER = 'SMOKE_POST_HANDSHAKE_MARKER'
// Must match the sentinel in test/fixtures/smoke-plugin/data.txt
const EMBEDDED_ASSET_MARKER = 'SMOKE_EMBEDDED_ASSET_MARKER'

function die(msg: string): never {
  process.stderr.write(`[smoke] FAIL: ${msg}\n`)
  process.exit(1)
}

function log(msg: string): void {
  process.stdout.write(`[smoke] ${msg}\n`)
}

function hostTarget(): string {
  const platform = os.platform()
  const arch = os.arch()
  let osToken: string
  switch (platform) {
    case 'darwin':
      osToken = 'macos'
      break
    case 'linux':
      osToken = 'linux'
      break
    case 'win32':
      osToken = 'win'
      break
    default:
      die(`unsupported host platform: ${platform}`)
  }
  let archToken: string
  switch (arch) {
    case 'arm64':
      archToken = 'arm64'
      break
    case 'x64':
      archToken = 'x64'
      break
    default:
      die(`unsupported host arch: ${arch}`)
  }
  return `node18-${osToken}-${archToken}`
}

function hostBinaryName(): string {
  const suffix = os.platform() === 'win32' ? '.exe' : ''
  return `stripe-cli-smoke${suffix}`
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

function buildFixtureBinary(): string {
  const target = hostTarget()
  log(`building fixture binary for target=${target}`)

  const r = spawnSync('pnpm', ['exec', 'stripe-cli-build-binaries', './bin', target], {
    cwd: FIXTURE_DIR,
    stdio: 'inherit',
  })
  if (r.status !== 0) {
    die(`stripe-cli-build-binaries exited ${r.status}`)
  }
  const binaryPath = path.join(FIXTURE_BIN_DIR, hostBinaryName())
  if (!fs.existsSync(binaryPath)) {
    die(`expected binary at ${binaryPath} not found after build`)
  }
  const stat = fs.statSync(binaryPath)
  log(`built binary: ${binaryPath} (${(stat.size / 1024 / 1024).toFixed(1)} MiB)`)
  return binaryPath
}

/**
 * Assert the output directory contains only the binary.
 */
function assertSingleBinary(): void {
  const entries = fs.readdirSync(FIXTURE_BIN_DIR)
  const binaryName = hostBinaryName()
  const unexpected = entries.filter(e => e !== binaryName)
  if (unexpected.length > 0) {
    die(
      `expected only the binary in ${FIXTURE_BIN_DIR}, but found extra files: ` +
        `${unexpected.join(', ')}. The build should produce a single self-contained binary.`,
    )
  }
  log('output directory contains only the binary')
}

/**
 * Connect a gRPC client to the running plugin, subscribe to streamStdio,
 * invoke RunCommand, and assert that plugin-side `console.log` output arrives
 * over the gRPC channel — including the embedded asset content.
 */
async function verifyConsoleForwarding(addr: string): Promise<void> {
  log(`connecting gRPC client to ${addr} for console-forwarding check`)
  const client = new grpc.Client(addr, grpc.credentials.createInsecure())

  const emptyReq = Empty.encode(Empty.create()).finish()
  const stdioStream = client.makeServerStreamRequest(
    GRPCStdioService.streamStdio.path,
    () => Buffer.from(emptyReq),
    (value: Buffer) => StdioData.decode(value),
    Empty.create(),
  )

  const collected: string[] = []
  stdioStream.on('data', (msg: StdioData) => {
    const label =
      msg.channel === StdioData_Channel.STDOUT
        ? 'stdout'
        : msg.channel === StdioData_Channel.STDERR
          ? 'stderr'
          : `channel=${msg.channel}`
    collected.push(`[${label}] ${Buffer.from(msg.data).toString('utf8')}`)
  })
  stdioStream.on('error', () => {
    // Stream errors are expected on shutdown
  })

  await new Promise(r => setTimeout(r, 200))

  const runRequest: RunCommandRequest = {
    args: ['smoke', 'test'],
    additionalInfo: undefined,
    coreCliHelperId: 0,
  }

  await new Promise<void>((resolve, reject) => {
    client.makeUnaryRequest(
      MainService.runCommand.path,
      (value: RunCommandRequest) => Buffer.from(RunCommandRequest.encode(value).finish()),
      (value: Buffer) => RunCommandResponse.decode(value),
      runRequest,
      (err: grpc.ServiceError | null) => {
        if (err) {
          reject(new Error(`RunCommand failed: ${err.message}`))
        } else {
          resolve()
        }
      },
    )
  })

  const deadline = Date.now() + CONSOLE_FORWARD_TIMEOUT_MS
  let sawStdoutMarker = false
  let sawStderrMarker = false
  let sawEmbeddedAssetMarker = false
  while (Date.now() < deadline) {
    const joined = collected.join('')
    sawStdoutMarker = joined.includes(`[stdout] ${POST_HANDSHAKE_MARKER} stdout`)
    sawStderrMarker = joined.includes(`[stderr] ${POST_HANDSHAKE_MARKER} stderr`)
    sawEmbeddedAssetMarker = joined.includes(
      `EMBEDDED_ASSET_CONTENT ${EMBEDDED_ASSET_MARKER}`,
    )
    if (sawStdoutMarker && sawStderrMarker && sawEmbeddedAssetMarker) break
    await new Promise(r => setTimeout(r, 50))
  }

  try {
    stdioStream.cancel()
  } catch {
    // ignore
  }
  try {
    client.close()
  } catch {
    // ignore
  }

  if (!sawStdoutMarker || !sawStderrMarker) {
    const joined = collected.join('')
    throw new Error(
      `console forwarding check FAILED: stdout-marker=${sawStdoutMarker} ` +
        `stderr-marker=${sawStderrMarker}\n` +
        `--- gRPC-forwarded stdio (${collected.length} chunks) ---\n${joined}`,
    )
  }
  log('console.log/error forwarding over streamStdio: OK')

  if (!sawEmbeddedAssetMarker) {
    const joined = collected.join('')
    throw new Error(
      `embedded-asset check FAILED: expected 'EMBEDDED_ASSET_CONTENT ${EMBEDDED_ASSET_MARKER}' ` +
        `in forwarded stdio but it was missing.\n` +
        `This means the Bun-compiled binary failed to read its embedded data.txt ` +
        `via resolveAsset(). Either the manifest generation did not embed the asset, ` +
        `or the runtime extraction failed.\n` +
        `--- gRPC-forwarded stdio (${collected.length} chunks) ---\n${joined}`,
    )
  }
  log(`embedded-asset read: OK (saw '${EMBEDDED_ASSET_MARKER}')`)
}

async function runSmoke(binaryPath: string, spawnCwd: string): Promise<void> {
  log(`spawning ${binaryPath} (cwd=${spawnCwd})`)
  const child = spawn(binaryPath, [], {
    cwd: spawnCwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdoutBuf = ''
  let stderrBuf = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    stdoutBuf += chunk
  })
  child.stderr.on('data', chunk => {
    stderrBuf += chunk
  })

  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    resolve => {
      child.on('exit', (code, signal) => resolve({ code, signal }))
    },
  )

  const handshakeDeadline = Date.now() + HANDSHAKE_TIMEOUT_MS
  while (Date.now() < handshakeDeadline) {
    if (HANDSHAKE_RE.test(stdoutBuf)) break
    await new Promise(r => setTimeout(r, 50))
  }
  if (!HANDSHAKE_RE.test(stdoutBuf)) {
    child.kill('SIGKILL')
    die(
      `no handshake line within ${HANDSHAKE_TIMEOUT_MS}ms\n` +
        `--- stdout ---\n${stdoutBuf}\n--- stderr ---\n${stderrBuf}`,
    )
  }
  const match = stdoutBuf.match(HANDSHAKE_RE)
  log(`handshake observed: ${match?.[0]}`)

  const addrMatch = stdoutBuf.match(HANDSHAKE_ADDR_RE)
  if (!addrMatch) {
    child.kill('SIGKILL')
    die(`could not parse address from handshake: ${match?.[0]}`)
  }
  const addr = addrMatch[1]

  try {
    await verifyConsoleForwarding(addr)
  } catch (err) {
    child.kill('SIGKILL')
    const msg = err instanceof Error ? err.message : String(err)
    die(`${msg}\n--- stdout ---\n${stdoutBuf}\n--- stderr ---\n${stderrBuf}`)
  }

  log('sending SIGTERM')
  const sigtermSent = child.kill('SIGTERM')
  if (!sigtermSent) {
    die('kill(SIGTERM) returned false')
  }

  const shutdownTimer = new Promise<'timeout'>(resolve => {
    setTimeout(() => resolve('timeout'), SHUTDOWN_TIMEOUT_MS)
  })
  const result = await Promise.race([exited, shutdownTimer])
  if (result === 'timeout') {
    child.kill('SIGKILL')
    await exited
    die(
      `process did not exit within ${SHUTDOWN_TIMEOUT_MS}ms after SIGTERM\n` +
        `--- stdout ---\n${stdoutBuf}\n--- stderr ---\n${stderrBuf}`,
    )
  }
  const { code, signal } = result
  const okSignal = signal === 'SIGTERM'
  const okCode = code === 0 || code === 143
  if (!okSignal && !okCode) {
    die(
      `process exited with code=${code} signal=${signal} (expected 0, 143, or SIGTERM)\n` +
        `--- stdout ---\n${stdoutBuf}\n--- stderr ---\n${stderrBuf}`,
    )
  }
  log(`clean exit on SIGTERM (code=${code} signal=${signal})`)
}

async function main(): Promise<void> {
  if (!fs.existsSync(FIXTURE_DIR)) {
    die(`fixture dir missing: ${FIXTURE_DIR}`)
  }
  ensureBootstrapBuilt()
  const binaryPath = buildFixtureBinary()
  assertSingleBinary()

  // Run the binary from a foreign cwd (a fresh tempdir). The binary must
  // work without any source tree files — all assets are embedded.
  const spawnCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'stripe-cli-smoke-cwd-'))
  try {
    log(`foreign spawn cwd=${spawnCwd}`)
    await runSmoke(binaryPath, spawnCwd)
  } finally {
    try {
      fs.rmSync(spawnCwd, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
  log('PASS')
}

main().catch(err => {
  if (err instanceof Error) {
    die(`unhandled error: ${err.message}\n${err.stack ?? ''}`)
  }
  die(`unhandled error: ${String(err)}`)
})
