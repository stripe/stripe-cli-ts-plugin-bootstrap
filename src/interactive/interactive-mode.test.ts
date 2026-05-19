import { describe, it, expect } from 'vitest'
import { buildArgsArray, InteractiveModeCancelledError } from './interactive-mode.js'
import type { ExtractedCommand } from './types.js'

/**
 * Helper to make a minimal ExtractedCommand for buildArgsArray tests.
 */
function makeCommand(overrides: Partial<ExtractedCommand> = {}): ExtractedCommand {
  return {
    name: 'test-cmd',
    description: 'A test command',
    positionals: [],
    options: [],
    builder: y => y,
    ...overrides,
  }
}

describe('buildArgsArray', () => {
  it('includes command name first', () => {
    const cmd = makeCommand({ name: 'deploy' })
    const result = buildArgsArray(cmd, {})
    expect(result).toEqual(['deploy'])
  })

  it('includes positional values in order', () => {
    const cmd = makeCommand({
      name: 'greet',
      positionals: [
        { name: 'first', required: true, variadic: false },
        { name: 'second', required: false, variadic: false },
      ],
    })
    const result = buildArgsArray(cmd, { first: 'hello', second: 'world' })
    expect(result).toEqual(['greet', 'hello', 'world'])
  })

  it('emits --flag value for string options', () => {
    const cmd = makeCommand({
      options: [{ name: 'env', type: 'string', required: false }],
    })
    const result = buildArgsArray(cmd, { env: 'production' })
    expect(result).toEqual(['test-cmd', '--env', 'production'])
  })

  it('emits --flag for boolean true', () => {
    const cmd = makeCommand({
      options: [{ name: 'force', type: 'boolean', required: false }],
    })
    const result = buildArgsArray(cmd, { force: true })
    expect(result).toEqual(['test-cmd', '--force'])
  })

  it('emits --no-flag for boolean false', () => {
    const cmd = makeCommand({
      options: [{ name: 'force', type: 'boolean', required: false }],
    })
    const result = buildArgsArray(cmd, { force: false })
    expect(result).toEqual(['test-cmd', '--no-force'])
  })

  it('omits undefined values', () => {
    const cmd = makeCommand({
      positionals: [{ name: 'target', required: false, variadic: false }],
      options: [
        { name: 'env', type: 'string', required: false },
        { name: 'force', type: 'boolean', required: false },
      ],
    })
    const result = buildArgsArray(cmd, {})
    expect(result).toEqual(['test-cmd'])
  })

  it('handles mixed positionals and options', () => {
    const cmd = makeCommand({
      name: 'deploy',
      positionals: [{ name: 'target', required: true, variadic: false }],
      options: [
        { name: 'env', type: 'string', required: false },
        { name: 'force', type: 'boolean', required: false },
      ],
    })
    const result = buildArgsArray(cmd, {
      target: 'web',
      env: 'staging',
      force: true,
    })
    expect(result).toEqual(['deploy', 'web', '--env', 'staging', '--force'])
  })
})

describe('InteractiveModeCancelledError', () => {
  it('has correct name property', () => {
    const err = new InteractiveModeCancelledError()
    expect(err.name).toBe('InteractiveModeCancelledError')
  })

  it('is an instance of Error', () => {
    const err = new InteractiveModeCancelledError()
    expect(err).toBeInstanceOf(Error)
  })

  it('has the expected message', () => {
    const err = new InteractiveModeCancelledError()
    expect(err.message).toBe('Operation cancelled.')
  })
})
