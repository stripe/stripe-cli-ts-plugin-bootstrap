import { describe, it, expect } from 'vitest'
import yargs from 'yargs'
import { extractCommandTree, type CommandInfo } from '../src/command-tree'

describe('extractCommandTree', () => {
  it('extracts flat commands', () => {
    const y = yargs([])
      .exitProcess(false)
      .command('create', 'Create a resource', () => {})
      .command('list', 'List resources', () => {})

    const tree = extractCommandTree(y)

    expect(tree).toEqual([
      { name: 'create', desc: 'Create a resource' },
      { name: 'list', desc: 'List resources' },
    ])
  })

  it('extracts nested commands', () => {
    const y = yargs([])
      .exitProcess(false)
      .command('logs', 'View logs', sub => {
        sub.command('tail', 'Tail logs in real-time', () => {})
      })

    const tree = extractCommandTree(y)

    expect(tree).toEqual([
      {
        name: 'logs',
        desc: 'View logs',
        commands: [{ name: 'tail', desc: 'Tail logs in real-time' }],
      },
    ])
  })

  it('returns empty array for no commands', () => {
    const y = yargs([]).exitProcess(false)

    const tree = extractCommandTree(y)

    expect(tree).toEqual([])
  })

  it('skips the default $0 command', () => {
    const y = yargs([])
      .exitProcess(false)
      .command('$0', 'default handler', () => {})
      .command('real', 'A real command', () => {})

    const tree = extractCommandTree(y)

    expect(tree.map((c: CommandInfo) => c.name)).toEqual(['real'])
  })

  it('omits desc when command has no description', () => {
    const y = yargs([])
      .exitProcess(false)
      .command('nodesc', false as any, () => {})

    const tree = extractCommandTree(y)

    expect(tree).toEqual([{ name: 'nodesc' }])
    expect(tree[0]).not.toHaveProperty('desc')
  })

  it('still includes command when builder throws', () => {
    const y = yargs([])
      .exitProcess(false)
      .command('fragile', 'Fragile command', () => {
        throw new Error('builder exploded')
      })

    const tree = extractCommandTree(y)

    expect(tree).toEqual([{ name: 'fragile', desc: 'Fragile command' }])
  })

  it('extracts 3+ levels of nesting', () => {
    const y = yargs([])
      .exitProcess(false)
      .command('resources', 'Resource commands', sub1 => {
        sub1.command('events', 'Event commands', sub2 => {
          sub2.command('list', 'List events', () => {})
        })
      })

    const tree = extractCommandTree(y)

    expect(tree).toEqual([
      {
        name: 'resources',
        desc: 'Resource commands',
        commands: [
          {
            name: 'events',
            desc: 'Event commands',
            commands: [{ name: 'list', desc: 'List events' }],
          },
        ],
      },
    ])
  })
})
