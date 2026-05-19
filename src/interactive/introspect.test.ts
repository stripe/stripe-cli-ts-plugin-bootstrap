import { describe, it, expect } from 'vitest'
import yargs from 'yargs'
import { extractCommands } from './introspect.js'

/**
 * Helper to create a yargs instance with test commands registered.
 */
function createTestYargs() {
  return yargs()
    .command(
      'greet <name>',
      'Greet someone',
      y =>
        y
          .positional('name', { type: 'string', demandOption: true })
          .option('loud', { type: 'boolean', description: 'Shout the greeting' })
          .option('times', {
            type: 'number',
            description: 'Repeat count',
            default: 1,
          }),
      () => {},
    )
    .command(
      'deploy [target]',
      'Deploy to a target',
      y =>
        y
          .positional('target', { type: 'string' })
          .option('env', {
            type: 'string',
            description: 'Environment',
            choices: ['dev', 'staging', 'prod'],
          })
          .option('force', { type: 'boolean', description: 'Force deploy' })
          .option('tags', { type: 'array', description: 'Tags to apply' }),
      () => {},
    )
}

describe('extractCommands', () => {
  it('extracts commands with positionals and options', () => {
    const y = createTestYargs()
    const commands = extractCommands(y, new Set())

    expect(commands).toHaveLength(2)

    const greet = commands.find(c => c.name === 'greet')
    expect(greet).toBeDefined()
    expect(greet!.description).toBe('Greet someone')
    expect(greet!.positionals).toHaveLength(1)
    expect(greet!.positionals[0]).toMatchObject({
      name: 'name',
      required: true,
    })
  })

  it('identifies option types correctly', () => {
    const y = createTestYargs()
    const commands = extractCommands(y, new Set())

    const greet = commands.find(c => c.name === 'greet')!
    const loudOpt = greet.options.find(o => o.name === 'loud')
    const timesOpt = greet.options.find(o => o.name === 'times')

    expect(loudOpt?.type).toBe('boolean')
    expect(timesOpt?.type).toBe('number')
    expect(timesOpt?.default).toBe(1)

    const deploy = commands.find(c => c.name === 'deploy')!
    const envOpt = deploy.options.find(o => o.name === 'env')
    const tagsOpt = deploy.options.find(o => o.name === 'tags')

    expect(envOpt?.type).toBe('string')
    expect(tagsOpt?.type).toBe('array')
  })

  it('filters out global flags from extracted options', () => {
    const y = createTestYargs()
    const globalFlags = new Set(['loud', 'force'])
    const commands = extractCommands(y, globalFlags)

    const greet = commands.find(c => c.name === 'greet')!
    expect(greet.options.find(o => o.name === 'loud')).toBeUndefined()
    // 'times' is not global, so it should remain
    expect(greet.options.find(o => o.name === 'times')).toBeDefined()

    const deploy = commands.find(c => c.name === 'deploy')!
    expect(deploy.options.find(o => o.name === 'force')).toBeUndefined()
    expect(deploy.options.find(o => o.name === 'env')).toBeDefined()
  })

  it('filters out positional names from options', () => {
    const y = createTestYargs()
    const commands = extractCommands(y, new Set())

    // 'name' is a positional on greet — should NOT appear in options
    const greet = commands.find(c => c.name === 'greet')!
    expect(greet.options.find(o => o.name === 'name')).toBeUndefined()

    // 'target' is a positional on deploy — should NOT appear in options
    const deploy = commands.find(c => c.name === 'deploy')!
    expect(deploy.options.find(o => o.name === 'target')).toBeUndefined()
  })

  it('skips the $0 default command', () => {
    const y = yargs()
      .command(
        '$0',
        'Default',
        y => y,
        () => {},
      )
      .command(
        'real',
        'A real command',
        y => y,
        () => {},
      )
    const commands = extractCommands(y, new Set())

    expect(commands.find(c => c.name === '$0')).toBeUndefined()
    expect(commands.find(c => c.name === 'real')).toBeDefined()
  })

  it('handles commands with choices', () => {
    const y = createTestYargs()
    const commands = extractCommands(y, new Set())

    const deploy = commands.find(c => c.name === 'deploy')!
    const envOpt = deploy.options.find(o => o.name === 'env')

    expect(envOpt?.choices).toEqual(['dev', 'staging', 'prod'])
  })

  it('marks demanded and optional positionals correctly', () => {
    const y = createTestYargs()
    const commands = extractCommands(y, new Set())

    const greet = commands.find(c => c.name === 'greet')!
    expect(greet.positionals[0]).toMatchObject({ name: 'name', required: true })

    const deploy = commands.find(c => c.name === 'deploy')!
    expect(deploy.positionals[0]).toMatchObject({ name: 'target', required: false })
  })

  it('extracts positional descriptions', () => {
    const y = yargs().command(
      'create <name>',
      'Create something',
      y =>
        y.positional('name', {
          type: 'string',
          describe: 'The name to create',
          demandOption: true,
        }),
      () => {},
    )
    const commands = extractCommands(y, new Set())
    const create = commands.find(c => c.name === 'create')!
    expect(create.positionals[0].description).toBe('The name to create')
  })

  it('extracts positional choices', () => {
    const y = yargs().command(
      'set-env <env>',
      'Set environment',
      y =>
        y.positional('env', {
          type: 'string',
          choices: ['dev', 'staging', 'prod'],
          demandOption: true,
        }),
      () => {},
    )
    const commands = extractCommands(y, new Set())
    const setEnv = commands.find(c => c.name === 'set-env')!
    expect(setEnv.positionals[0].choices).toEqual(['dev', 'staging', 'prod'])
  })

  it('marks required options via demandOption', () => {
    const y = yargs().command(
      'send',
      'Send a message',
      y =>
        y
          .option('to', { type: 'string', demandOption: true, description: 'Recipient' })
          .option('subject', { type: 'string', description: 'Subject line' }),
      () => {},
    )
    const commands = extractCommands(y, new Set())
    const send = commands.find(c => c.name === 'send')!
    const toOpt = send.options.find(o => o.name === 'to')!
    const subjOpt = send.options.find(o => o.name === 'subject')!
    expect(toOpt.required).toBe(true)
    expect(subjOpt.required).toBe(false)
  })
})

/**
 * These tests verify that the yargs internal APIs we depend on continue to
 * return the expected structure. If a yargs upgrade changes these internals,
 * these tests will catch it.
 */
describe('yargs internal API contract', () => {
  it('exposes getInternalMethods().getCommandInstance().handlers', () => {
    const y = yargs().command(
      'test',
      'A test',
      y => y,
      () => {},
    )
    const internal = (y as any).getInternalMethods()
    expect(internal).toBeDefined()
    expect(typeof internal.getCommandInstance).toBe('function')

    const cmdInstance = internal.getCommandInstance()
    expect(cmdInstance.handlers).toBeDefined()
    expect(cmdInstance.handlers['test']).toBeDefined()
    expect(cmdInstance.handlers['test'].description).toBe('A test')
    expect(typeof cmdInstance.handlers['test'].builder).toBe('function')
  })

  it('handler has demanded/optional arrays for positionals', () => {
    const y = yargs().command(
      'cmd <required> [optional]',
      'A command',
      y =>
        y
          .positional('required', { type: 'string', demandOption: true })
          .positional('optional', { type: 'string' }),
      () => {},
    )
    const handler = (y as any).getInternalMethods().getCommandInstance().handlers['cmd']
    expect(handler.demanded).toEqual([{ cmd: ['required'], variadic: false }])
    expect(handler.optional).toEqual([{ cmd: ['optional'], variadic: false }])
  })

  it('builder result exposes getOptions() with key, default, choices, boolean, number, array', () => {
    const y = yargs()
    const built = y
      .option('name', { type: 'string', default: 'world' })
      .option('force', { type: 'boolean' })
      .option('count', { type: 'number' })
      .option('tags', { type: 'array' })
      .option('env', { type: 'string', choices: ['dev', 'prod'] })

    const opts = (built as any).getOptions()
    expect(opts.key).toBeDefined()
    expect(opts.key['name']).toBe(true)
    expect(opts.default['name']).toBe('world')
    expect(opts.boolean).toContain('force')
    expect(opts.number).toContain('count')
    expect(opts.array).toContain('tags')
    expect(opts.choices['env']).toEqual(['dev', 'prod'])
  })

  it('getGroups() puts positionals in Positionals: group', () => {
    const y = yargs()
    const built = y.positional('name', { type: 'string' })
    const groups = (built as any).getGroups()
    expect(groups['Positionals:']).toContain('name')
  })

  it('getUsageInstance().getDescriptions() returns option descriptions', () => {
    const y = yargs()
    const built = y.option('verbose', { type: 'boolean', description: 'Be verbose' })
    const internal = (built as any).getInternalMethods()
    const descs = internal.getUsageInstance().getDescriptions()
    expect(descs['verbose']).toBe('Be verbose')
  })
})
