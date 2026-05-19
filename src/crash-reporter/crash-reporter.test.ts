import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  installCrashReporter,
  getCrashLogPath,
  setCommandArgs,
  logCommandError,
  _resetForTesting,
} from './index.js'

vi.mock('fs', async importOriginal => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    appendFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    statSync: vi.fn(() => ({ size: 0 })),
    readFileSync: vi.fn(() => ''),
  }
})

describe('crash-reporter', () => {
  let uncaughtHandler: ((err: Error) => void) | undefined
  let rejectionHandler: ((reason: unknown) => void) | undefined
  const originalProcessOn = process.on.bind(process)
  const originalProcessExit = process.exit
  const originalStderrWrite = process.stderr.write
  const originalReport = process.report

  beforeEach(() => {
    vi.clearAllMocks()
    _resetForTesting()
    uncaughtHandler = undefined
    rejectionHandler = undefined

    // Intercept process.on to capture the handlers without actually registering them
    vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      handler: (...args: unknown[]) => void,
    ) => {
      if (event === 'uncaughtException') {
        uncaughtHandler = handler as (err: Error) => void
      } else if (event === 'unhandledRejection') {
        rejectionHandler = handler as (reason: unknown) => void
      }
      return process
    }) as typeof process.on)

    // Mock process.exit to prevent actually exiting
    vi.spyOn(process, 'exit').mockImplementation((() => {}) as typeof process.exit)

    // Mock stderr.write to capture output
    vi.spyOn(process.stderr, 'write').mockImplementation(
      (() => true) as typeof process.stderr.write,
    )

    // Delete XDG override so tests use homedir
    delete process.env.XDG_CONFIG_HOME
  })

  afterEach(() => {
    process.on = originalProcessOn
    process.exit = originalProcessExit
    process.stderr.write = originalStderrWrite
    Object.defineProperty(process, 'report', {
      value: originalReport,
      writable: true,
      configurable: true,
    })
  })

  describe('installCrashReporter()', () => {
    it('registers uncaughtException and unhandledRejection handlers', () => {
      installCrashReporter('generate', '1.0.0')

      expect(process.on).toHaveBeenCalledWith('uncaughtException', expect.any(Function))
      expect(process.on).toHaveBeenCalledWith('unhandledRejection', expect.any(Function))
    })

    it('registers handlers only once but updates metadata on subsequent calls', () => {
      installCrashReporter('unknown')
      installCrashReporter('generate', '2.0.0')

      // Handlers registered only once
      const uncaughtCalls = vi
        .mocked(process.on)
        .mock.calls.filter(([event]) => event === 'uncaughtException')
      const rejectionCalls = vi
        .mocked(process.on)
        .mock.calls.filter(([event]) => event === 'unhandledRejection')
      expect(uncaughtCalls).toHaveLength(1)
      expect(rejectionCalls).toHaveLength(1)

      // But crash log path updated to the second call's name
      expect(getCrashLogPath()).toMatch(/generate-crash\.log$/)
    })

    it('uses updated metadata in crash entries after subsequent call', () => {
      installCrashReporter('unknown')
      installCrashReporter('generate', '3.0.0')

      uncaughtHandler!(new Error('crash'))

      const entry = vi.mocked(fs.appendFileSync).mock.calls[0][1] as string
      expect(entry).toContain('Plugin: generate v3.0.0')
    })

    it('sets crash log path based on plugin name', () => {
      installCrashReporter('generate')

      const expected = path.join(
        os.homedir(),
        '.config',
        'stripe',
        'logs',
        'generate-crash.log',
      )
      expect(getCrashLogPath()).toBe(expected)
    })

    it('respects XDG_CONFIG_HOME', () => {
      process.env.XDG_CONFIG_HOME = '/custom/config'
      installCrashReporter('apps')

      expect(getCrashLogPath()).toBe('/custom/config/stripe/logs/apps-crash.log')
    })

    it('enables process.report when available', () => {
      const mockReport = {
        reportOnFatalError: false,
        reportOnSignal: false,
        directory: '',
      }
      Object.defineProperty(process, 'report', {
        value: mockReport,
        writable: true,
        configurable: true,
      })

      installCrashReporter('generate', '1.0.0')

      expect(mockReport.reportOnFatalError).toBe(true)
      expect(mockReport.reportOnSignal).toBe(true)
      expect(mockReport.directory).toBe(
        path.join(os.homedir(), '.config', 'stripe', 'logs'),
      )
    })

    it('sanitizes plugin name to prevent path traversal', () => {
      installCrashReporter('../../../etc/evil')

      expect(getCrashLogPath()).toMatch(/_____etc_evil-crash\.log$/)
      // Should not contain raw path separators
      expect(getCrashLogPath()).not.toContain('../')
    })

    it('sanitizes plugin name with backslashes and colons', () => {
      installCrashReporter('foo\\bar:baz')

      expect(getCrashLogPath()).toMatch(/foo_bar_baz-crash\.log$/)
    })

    it('eagerly creates logs directory during installation', () => {
      installCrashReporter('generate')

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        path.join(os.homedir(), '.config', 'stripe', 'logs'),
        { recursive: true },
      )
    })
  })

  describe('getCrashLogPath()', () => {
    it('returns empty string before installCrashReporter is called', () => {
      expect(getCrashLogPath()).toBe('')
    })
  })

  describe('uncaughtException handler', () => {
    it('writes crash entry to log file', () => {
      installCrashReporter('generate', '2.1.0')
      expect(uncaughtHandler).toBeDefined()

      const err = new Error('something broke')
      uncaughtHandler!(err)

      expect(fs.appendFileSync).toHaveBeenCalledTimes(1)

      const [filePath, content] = vi.mocked(fs.appendFileSync).mock.calls[0]
      expect(filePath).toBe(getCrashLogPath())

      const entry = content as string
      expect(entry).toContain('UNCAUGHT EXCEPTION')
      expect(entry).toContain('something broke')
      expect(entry).toContain('Plugin: generate v2.1.0')
      expect(entry).toContain(`Node: ${process.version}`)
    })

    it('includes stack trace in crash entry', () => {
      installCrashReporter('generate')
      const err = new Error('with stack')
      uncaughtHandler!(err)

      const entry = vi.mocked(fs.appendFileSync).mock.calls[0][1] as string
      expect(entry).toContain('at ') // stack trace lines
    })

    it('writes stderr hint', () => {
      installCrashReporter('generate')
      uncaughtHandler!(new Error('crash'))

      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining('Plugin crashed unexpectedly'),
      )
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining(getCrashLogPath()),
      )
    })

    it('calls process.exit(1)', () => {
      installCrashReporter('generate')
      uncaughtHandler!(new Error('crash'))

      expect(process.exit).toHaveBeenCalledWith(1)
    })

    it('redacts sensitive args', () => {
      // Simulate args with a secret key
      const originalArgv = process.argv
      process.argv = ['node', 'plugin', 'deploy', '--api-key', 'sk_test_secret123']

      installCrashReporter('generate')
      uncaughtHandler!(new Error('crash'))

      const entry = vi.mocked(fs.appendFileSync).mock.calls[0][1] as string
      expect(entry).toContain('--api-key ***')
      expect(entry).not.toContain('sk_test_secret123')

      process.argv = originalArgv
    })

    it('handles plugin name without version', () => {
      installCrashReporter('apps')
      uncaughtHandler!(new Error('crash'))

      const entry = vi.mocked(fs.appendFileSync).mock.calls[0][1] as string
      expect(entry).toContain('Plugin: apps |')
      expect(entry).not.toContain('undefined')
    })
  })

  describe('unhandledRejection handler', () => {
    it('writes crash entry for rejected promise', () => {
      installCrashReporter('generate', '1.0.0')
      expect(rejectionHandler).toBeDefined()

      rejectionHandler!(new Error('promise failed'))

      const entry = vi.mocked(fs.appendFileSync).mock.calls[0][1] as string
      expect(entry).toContain('UNHANDLED REJECTION')
      expect(entry).toContain('promise failed')
    })

    it('handles non-Error rejection reasons', () => {
      installCrashReporter('generate')
      rejectionHandler!('string rejection')

      const entry = vi.mocked(fs.appendFileSync).mock.calls[0][1] as string
      expect(entry).toContain('string rejection')
    })

    it('handles null/undefined rejection reasons', () => {
      installCrashReporter('generate')
      rejectionHandler!(undefined)

      const entry = vi.mocked(fs.appendFileSync).mock.calls[0][1] as string
      expect(entry).toContain('UNHANDLED REJECTION')
      expect(entry).toContain('undefined')
    })

    it('calls process.exit(1)', () => {
      installCrashReporter('generate')
      rejectionHandler!(new Error('rejected'))

      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })

  describe('log truncation', () => {
    it('truncates crash log when it exceeds 512KB', () => {
      vi.mocked(fs.statSync).mockReturnValue({ size: 600_000 } as fs.Stats)
      const oldContent =
        '[old entry]\n'.repeat(1000) +
        '[2024-01-01T00:00:00Z] RECENT CRASH\nrecent error\n\n'
      vi.mocked(fs.readFileSync).mockReturnValue(oldContent)

      installCrashReporter('generate')
      uncaughtHandler!(new Error('new crash'))

      // Should have called writeFileSync to truncate before appending
      expect(fs.writeFileSync).toHaveBeenCalled()
      const truncatedContent = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string
      // Truncated content should be shorter than the original
      expect(truncatedContent.length).toBeLessThan(oldContent.length)
    })

    it('does not truncate when file is under 512KB', () => {
      vi.mocked(fs.statSync).mockReturnValue({ size: 1000 } as fs.Stats)

      installCrashReporter('generate')
      uncaughtHandler!(new Error('crash'))

      // writeFileSync should NOT have been called for truncation
      expect(fs.writeFileSync).not.toHaveBeenCalled()
    })
  })

  describe('setCommandArgs()', () => {
    it('overrides process.argv in crash entries', () => {
      const originalArgv = process.argv
      process.argv = ['node', 'plugin']

      installCrashReporter('generate', '1.0.0')
      setCommandArgs(['custom-object', '--name', 'Widget'])
      uncaughtHandler!(new Error('crash'))

      const entry = vi.mocked(fs.appendFileSync).mock.calls[0][1] as string
      expect(entry).toContain('Args: custom-object --name Widget')

      process.argv = originalArgv
    })

    it('redacts sensitive flags in overridden args', () => {
      installCrashReporter('generate')
      setCommandArgs(['deploy', '--api-key', 'sk_test_secret123'])
      uncaughtHandler!(new Error('crash'))

      const entry = vi.mocked(fs.appendFileSync).mock.calls[0][1] as string
      expect(entry).toContain('--api-key ***')
      expect(entry).not.toContain('sk_test_secret123')
    })

    it('falls back to process.argv when not called', () => {
      const originalArgv = process.argv
      process.argv = ['node', 'plugin', 'from-process-argv']

      installCrashReporter('generate')
      uncaughtHandler!(new Error('crash'))

      const entry = vi.mocked(fs.appendFileSync).mock.calls[0][1] as string
      expect(entry).toContain('Args: from-process-argv')

      process.argv = originalArgv
    })

    it('is cleared by _resetForTesting', () => {
      const originalArgv = process.argv
      process.argv = ['node', 'plugin', 'fallback-arg']

      installCrashReporter('generate')
      setCommandArgs(['overridden-arg'])
      _resetForTesting()

      // Re-install after reset
      installCrashReporter('generate')
      uncaughtHandler!(new Error('crash'))

      const entry = vi.mocked(fs.appendFileSync).mock.calls[0][1] as string
      expect(entry).toContain('Args: fallback-arg')
      expect(entry).not.toContain('overridden-arg')

      process.argv = originalArgv
    })
  })

  describe('logCommandError()', () => {
    it('writes COMMAND ERROR entry to crash log', () => {
      installCrashReporter('generate', '1.0.0')
      logCommandError(new Error('command failed'))

      expect(fs.appendFileSync).toHaveBeenCalledTimes(1)
      const entry = vi.mocked(fs.appendFileSync).mock.calls[0][1] as string
      expect(entry).toContain('COMMAND ERROR')
      expect(entry).toContain('command failed')
      expect(entry).toContain('Plugin: generate v1.0.0')
    })

    it('does not emit stderr hint', () => {
      installCrashReporter('generate')
      logCommandError(new Error('command failed'))

      expect(process.stderr.write).not.toHaveBeenCalled()
    })

    it('does not call process.exit', () => {
      installCrashReporter('generate')
      logCommandError(new Error('command failed'))

      expect(process.exit).not.toHaveBeenCalled()
    })

    it('no-ops when installCrashReporter has not been called', () => {
      logCommandError(new Error('orphan error'))

      expect(fs.appendFileSync).not.toHaveBeenCalled()
    })

    it('includes command args set via setCommandArgs', () => {
      installCrashReporter('generate')
      setCommandArgs(['custom-object', '--name', 'Widget'])
      logCommandError(new Error('failed'))

      const entry = vi.mocked(fs.appendFileSync).mock.calls[0][1] as string
      expect(entry).toContain('Args: custom-object --name Widget')
    })
  })

  describe('resilience', () => {
    it('does not throw when log directory creation fails', () => {
      vi.mocked(fs.mkdirSync).mockImplementation(() => {
        throw new Error('permission denied')
      })

      installCrashReporter('generate')

      // Should not throw — crash handler should be resilient
      expect(() => uncaughtHandler!(new Error('crash'))).not.toThrow()
      expect(process.exit).toHaveBeenCalledWith(1)
    })

    it('does not throw when stderr.write fails', () => {
      vi.mocked(process.stderr.write).mockImplementation(() => {
        throw new Error('broken pipe')
      })

      installCrashReporter('generate')

      expect(() => uncaughtHandler!(new Error('crash'))).not.toThrow()
      expect(process.exit).toHaveBeenCalledWith(1)
    })
  })
})
