import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import {
  log,
  logError,
  setLogLevel,
  getLogLevel,
  clearLog,
  getLogPath,
  redactArgs,
  initLogger,
  setLogLevelFromArgs,
} from './logger.js'

// Mock fs to avoid actual file writes
vi.mock('fs', async importOriginal => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    appendFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  }
})

describe('logger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset to default (non-debug) level
    setLogLevel('info')
    // Initialize with a known plugin name so getLogPath() returns a stable value
    initLogger('test', [])
  })

  describe('initLogger()', () => {
    it('sets log file path based on plugin name', () => {
      initLogger('generate', [])
      expect(getLogPath()).toMatch(/stripe-generate-plugin\.log$/)
    })

    it('sets log file path for a different plugin name', () => {
      initLogger('apps', [])
      expect(getLogPath()).toMatch(/stripe-apps-plugin\.log$/)
    })

    it('extracts --log-level=debug from args', () => {
      const level = initLogger('test', ['--log-level=debug', 'deploy'])
      expect(level).toBe('debug')

      // Verify it actually enabled logging
      log('should write')
      expect(fs.appendFileSync).toHaveBeenCalled()
    })

    it('extracts --log-level debug from args (two tokens)', () => {
      const level = initLogger('test', ['--log-level', 'debug', 'deploy'])
      expect(level).toBe('debug')

      log('should write')
      expect(fs.appendFileSync).toHaveBeenCalled()
    })

    it('returns undefined when --log-level is not present', () => {
      const level = initLogger('test', ['deploy', '--config', 'foo'])
      expect(level).toBeUndefined()

      // Logging should still be disabled
      log('should not write')
      expect(fs.appendFileSync).not.toHaveBeenCalled()
    })

    it('handles non-debug levels', () => {
      const level = initLogger('test', ['--log-level=info'])
      expect(level).toBe('info')

      // info level should not enable debug logging
      log('should not write')
      expect(fs.appendFileSync).not.toHaveBeenCalled()
    })
  })

  describe('log()', () => {
    it('is a no-op when log level is not debug', () => {
      log('should not be written')
      expect(fs.appendFileSync).not.toHaveBeenCalled()
    })

    it('writes to file when log level is debug', () => {
      setLogLevel('debug')
      log('hello from debug')
      expect(fs.appendFileSync).toHaveBeenCalledTimes(1)

      const [filePath, content] = vi.mocked(fs.appendFileSync).mock.calls[0]
      expect(filePath).toBe(getLogPath())
      expect(content).toContain('hello from debug')
    })

    it('formats additional args with safeStringify', () => {
      setLogLevel('debug')
      log('values:', { a: 1 }, 42)
      expect(fs.appendFileSync).toHaveBeenCalledTimes(1)

      const content = vi.mocked(fs.appendFileSync).mock.calls[0][1] as string
      expect(content).toContain('values:')
      expect(content).toContain('{"a":1}')
      expect(content).toContain('42')
    })

    it('includes a timestamp', () => {
      setLogLevel('debug')
      log('timestamped')

      const content = vi.mocked(fs.appendFileSync).mock.calls[0][1] as string
      // ISO timestamp pattern: [2024-01-01T00:00:00.000Z]
      expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })
  })

  describe('logError()', () => {
    it('is a no-op when log level is not debug', () => {
      logError('should not be written', new Error('test'))
      expect(fs.appendFileSync).not.toHaveBeenCalled()
    })

    it('writes error with stack trace when debug', () => {
      setLogLevel('debug')
      const err = new Error('something broke')
      logError('operation failed', err)

      expect(fs.appendFileSync).toHaveBeenCalledTimes(1)
      const content = vi.mocked(fs.appendFileSync).mock.calls[0][1] as string
      expect(content).toContain('ERROR: operation failed')
      expect(content).toContain('something broke')
    })
  })

  describe('clearLog()', () => {
    it('is a no-op when log level is not debug', () => {
      clearLog()
      expect(fs.writeFileSync).not.toHaveBeenCalled()
    })

    it('clears the log file when debug', () => {
      setLogLevel('debug')
      clearLog()
      expect(fs.writeFileSync).toHaveBeenCalledWith(getLogPath(), '', { mode: 0o600 })
    })
  })

  describe('safeStringify (tested via log())', () => {
    it('handles circular references without throwing', () => {
      setLogLevel('debug')
      const obj: Record<string, unknown> = { a: 1 }
      obj.self = obj

      // Should not throw — falls back to String()
      expect(() => log('circular:', obj)).not.toThrow()
      expect(fs.appendFileSync).toHaveBeenCalled()
    })

    it('handles Error objects and preserves stack', () => {
      setLogLevel('debug')
      const err = new Error('test error')
      log('error obj:', err)

      const content = vi.mocked(fs.appendFileSync).mock.calls[0][1] as string
      expect(content).toContain('test error')
      // Stack trace should be present
      expect(content).toContain('at ')
    })
  })

  describe('setLogLevel()', () => {
    it('changes behavior from no-op to active', () => {
      log('before')
      expect(fs.appendFileSync).not.toHaveBeenCalled()

      setLogLevel('debug')
      log('after')
      expect(fs.appendFileSync).toHaveBeenCalledTimes(1)
    })

    it('can disable logging by switching back from debug', () => {
      setLogLevel('debug')
      log('active')
      expect(fs.appendFileSync).toHaveBeenCalledTimes(1)

      setLogLevel('info')
      log('inactive')
      expect(fs.appendFileSync).toHaveBeenCalledTimes(1) // still 1, no new call
    })
  })

  describe('getLogLevel()', () => {
    it('returns the current log level', () => {
      setLogLevel('debug')
      expect(getLogLevel()).toBe('debug')
    })

    it('returns default level before any explicit set', () => {
      // beforeEach resets to 'info'
      expect(getLogLevel()).toBe('info')
    })

    it('reflects changes from setLogLevelFromArgs', () => {
      setLogLevelFromArgs(['--log-level=debug'])
      expect(getLogLevel()).toBe('debug')
    })
  })

  describe('setLogLevelFromArgs()', () => {
    it('returns the detected log level', () => {
      expect(setLogLevelFromArgs(['--log-level', 'debug'])).toBe('debug')
    })

    it('returns undefined when --log-level is absent', () => {
      expect(setLogLevelFromArgs(['deploy', '--verbose'])).toBeUndefined()
    })
  })

  describe('redactArgs()', () => {
    it('redacts --api-key value in two-token form', () => {
      expect(redactArgs(['--api-key', 'sk_test_123', 'deploy'])).toEqual([
        '--api-key',
        '***',
        'deploy',
      ])
    })

    it('redacts --api-key=value form', () => {
      expect(redactArgs(['--api-key=sk_test_123', 'deploy'])).toEqual([
        '--api-key=***',
        'deploy',
      ])
    })

    it('redacts --secret-key', () => {
      expect(redactArgs(['--secret-key', 'rk_live_abc'])).toEqual(['--secret-key', '***'])
    })

    it('preserves non-sensitive args', () => {
      expect(redactArgs(['deploy', '--config', 'myconfig', '-i'])).toEqual([
        'deploy',
        '--config',
        'myconfig',
        '-i',
      ])
    })

    it('handles empty args', () => {
      expect(redactArgs([])).toEqual([])
    })
  })
})
