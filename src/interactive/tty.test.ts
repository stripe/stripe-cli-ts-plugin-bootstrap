import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TerminalInfo } from '../grpc/index.js'
import { isTTY, requireTTY } from './tty.js'

// Mock the grpc module so we can control TerminalInfo values
vi.mock('../grpc/index.js', () => ({
  TerminalInfo: {
    hostStdinIsTerminal: true,
    hostStdoutIsTerminal: true,
    hostStderrIsTerminal: true,
  },
}))

describe('isTTY', () => {
  beforeEach(() => {
    // Reset to defaults
    TerminalInfo.hostStdinIsTerminal = true
    TerminalInfo.hostStdoutIsTerminal = true
  })

  it('returns true when both stdin and stdout are terminals', () => {
    expect(isTTY()).toBe(true)
  })

  it('returns false when stdin is not a terminal', () => {
    TerminalInfo.hostStdinIsTerminal = false
    expect(isTTY()).toBe(false)
  })

  it('returns false when stdout is not a terminal', () => {
    TerminalInfo.hostStdoutIsTerminal = false
    expect(isTTY()).toBe(false)
  })
})

describe('requireTTY', () => {
  beforeEach(() => {
    TerminalInfo.hostStdinIsTerminal = true
    TerminalInfo.hostStdoutIsTerminal = true
  })

  it('does not throw when TTY is available', () => {
    expect(() => requireTTY('generate')).not.toThrow()
  })

  it('throws when not a TTY', () => {
    TerminalInfo.hostStdinIsTerminal = false
    expect(() => requireTTY('generate')).toThrow(
      'Interactive mode requires a TTY terminal.',
    )
  })
})
