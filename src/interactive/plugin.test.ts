import { describe, it, expect, vi, beforeEach } from 'vitest'
import yargs from 'yargs'
import { InteractiveMode } from './plugin.js'
import { InteractiveModeCancelledError } from './interactive-mode.js'

// Mock the interactive-mode module so prompts don't run
vi.mock('./interactive-mode.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./interactive-mode.js')>()
  return {
    ...actual,
    runInteractiveMode: vi.fn(),
  }
})

// Mock tty — default to TTY available
vi.mock('./tty.js', () => ({
  isTTY: vi.fn(() => true),
  requireTTY: vi.fn(),
}))

// Mock getPluginYargs for subcommand detection
vi.mock('../index.js', async () => {
  const yargsLib = await import('yargs')
  return {
    getPluginYargs: vi.fn(() => {
      // Return a bare yargs instance with just global flags (no commands)
      return yargsLib
        .default()
        .option('config', { type: 'string' })
        .option('api-key', { type: 'string' })
        .option('log-level', { type: 'string' })
    }),
  }
})

/**
 * Creates a minimal InteractiveMode with a yargs instance that has a 'deploy' command.
 */
function createInteractiveMode(opts?: { defaultWhenNoSubcommand?: boolean }) {
  const globalFlags = new Set(['config', 'api-key', 'log-level', 'help', 'version'])
  const im = new InteractiveMode({
    pluginName: 'generate',
    globalFlags,
    defaultWhenNoSubcommand: opts?.defaultWhenNoSubcommand ?? false,
  })

  const createYargs = () =>
    yargs()
      .command(
        'deploy <target>',
        'Deploy to target',
        y => y.positional('target', { type: 'string', demandOption: true }),
        () => {},
      )
      .exitProcess(false)

  const y = createYargs()
  im.install(y, createYargs)
  return im
}

describe('InteractiveMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('shouldIntercept (tested via run())', () => {
    it('intercepts for -i flag', async () => {
      const { runInteractiveMode } = await import('./interactive-mode.js')
      const mockRun = vi.mocked(runInteractiveMode)
      mockRun.mockResolvedValue(['deploy', 'web'])

      const im = createInteractiveMode()
      await im.run(['-i'])

      expect(mockRun).toHaveBeenCalled()
    })

    it('intercepts for --interactive flag', async () => {
      const { runInteractiveMode } = await import('./interactive-mode.js')
      const mockRun = vi.mocked(runInteractiveMode)
      mockRun.mockResolvedValue(['deploy', 'web'])

      const im = createInteractiveMode()
      await im.run(['--interactive'])

      expect(mockRun).toHaveBeenCalled()
    })

    it('intercepts for --interactive=true form', async () => {
      const { runInteractiveMode } = await import('./interactive-mode.js')
      const mockRun = vi.mocked(runInteractiveMode)
      mockRun.mockResolvedValue(['deploy', 'web'])

      const im = createInteractiveMode()
      await im.run(['--interactive=true'])

      expect(mockRun).toHaveBeenCalled()
    })

    it('does not intercept for --interactive=false', async () => {
      const { runInteractiveMode } = await import('./interactive-mode.js')
      const mockRun = vi.mocked(runInteractiveMode)

      const im = createInteractiveMode()
      await im.run(['--interactive=false', 'deploy', 'web'])

      expect(mockRun).not.toHaveBeenCalled()
    })

    it('does not intercept for normal args', async () => {
      const { runInteractiveMode } = await import('./interactive-mode.js')
      const mockRun = vi.mocked(runInteractiveMode)

      const im = createInteractiveMode()
      // 'deploy web' is a normal command invocation — should parse normally
      await im.run(['deploy', 'web'])

      expect(mockRun).not.toHaveBeenCalled()
    })

    it('does not intercept for -i --help (help takes priority)', async () => {
      const { runInteractiveMode } = await import('./interactive-mode.js')
      const mockRun = vi.mocked(runInteractiveMode)

      const im = createInteractiveMode()
      // --help takes priority over -i
      try {
        await im.run(['-i', '--help'])
      } catch {
        // yargs may throw or exit for --help; that's fine
      }

      expect(mockRun).not.toHaveBeenCalled()
    })

    it('does not intercept for -i --version (version takes priority)', async () => {
      const { runInteractiveMode } = await import('./interactive-mode.js')
      const mockRun = vi.mocked(runInteractiveMode)

      const im = createInteractiveMode()
      try {
        await im.run(['-i', '--version'])
      } catch {
        // yargs may throw or exit for --version; that's fine
      }

      expect(mockRun).not.toHaveBeenCalled()
    })
  })

  describe('shouldIntercept with defaultWhenNoSubcommand', () => {
    it('returns true when no subcommand provided', async () => {
      const { runInteractiveMode } = await import('./interactive-mode.js')
      const mockRun = vi.mocked(runInteractiveMode)
      mockRun.mockResolvedValue(['deploy', 'web'])

      const im = createInteractiveMode({ defaultWhenNoSubcommand: true })
      await im.run([])

      expect(mockRun).toHaveBeenCalled()
    })

    it('returns false when subcommand is present', async () => {
      const { runInteractiveMode } = await import('./interactive-mode.js')
      const mockRun = vi.mocked(runInteractiveMode)

      const im = createInteractiveMode({ defaultWhenNoSubcommand: true })
      await im.run(['deploy', 'web'])

      expect(mockRun).not.toHaveBeenCalled()
    })

    it('--config foo does NOT count as subcommand', async () => {
      const { runInteractiveMode } = await import('./interactive-mode.js')
      const mockRun = vi.mocked(runInteractiveMode)
      mockRun.mockResolvedValue(['deploy', 'web'])

      const im = createInteractiveMode({ defaultWhenNoSubcommand: true })
      // --config foo is a global flag, not a subcommand
      await im.run(['--config', 'foo'])

      expect(mockRun).toHaveBeenCalled()
    })
  })

  describe('pre-filled args (tested via run())', () => {
    it('passes command name as preFilled.command when present', async () => {
      const { runInteractiveMode } = await import('./interactive-mode.js')
      const mockRun = vi.mocked(runInteractiveMode)
      mockRun.mockResolvedValue(['deploy', 'web'])

      const im = createInteractiveMode()
      await im.run(['deploy', '-i'])

      expect(mockRun).toHaveBeenCalledWith(
        'generate',
        expect.any(Array),
        expect.objectContaining({ command: 'deploy' }),
      )
    })

    it('passes positional args as preFilled.positionals in order', async () => {
      const { runInteractiveMode } = await import('./interactive-mode.js')
      const mockRun = vi.mocked(runInteractiveMode)
      mockRun.mockResolvedValue(['deploy', 'web'])

      const im = createInteractiveMode()
      await im.run(['deploy', 'web', '-i'])

      expect(mockRun).toHaveBeenCalledWith(
        'generate',
        expect.any(Array),
        expect.objectContaining({
          command: 'deploy',
          positionals: ['web'],
        }),
      )
    })

    it('passes empty preFilled when only -i is given', async () => {
      const { runInteractiveMode } = await import('./interactive-mode.js')
      const mockRun = vi.mocked(runInteractiveMode)
      mockRun.mockResolvedValue(['deploy', 'web'])

      const im = createInteractiveMode()
      await im.run(['-i'])

      expect(mockRun).toHaveBeenCalledWith(
        'generate',
        expect.any(Array),
        expect.not.objectContaining({ command: expect.anything() }),
      )
    })

    it('separates global flags from command-specific options', async () => {
      const { runInteractiveMode } = await import('./interactive-mode.js')
      const mockRun = vi.mocked(runInteractiveMode)
      mockRun.mockResolvedValue(['deploy', 'web'])

      const im = createInteractiveMode()
      // --config is global, --force is command-specific
      await im.run(['deploy', '-i', '--config', 'myconfig', '--force'])

      const preFilled = mockRun.mock.calls[0][2]
      expect(preFilled).toMatchObject({
        command: 'deploy',
        options: { force: true },
      })
      // --config should NOT be in preFilled.options (it's a global flag)
      expect(preFilled?.options).not.toHaveProperty('config')
    })

    it('strips --interactive and --no-interactive correctly', async () => {
      const { runInteractiveMode } = await import('./interactive-mode.js')
      const mockRun = vi.mocked(runInteractiveMode)

      const im = createInteractiveMode()
      // --no-interactive means interactive=false, so should NOT intercept
      await im.run(['--no-interactive', 'deploy', 'web'])

      expect(mockRun).not.toHaveBeenCalled()
    })
  })

  describe('constructor', () => {
    it('adds interactive and i to global flags set', () => {
      // We can verify this indirectly: if 'interactive' is in globalFlags,
      // extractCommands won't include it as an option on any command.
      // This is tested via the extractCommands filtering in introspect.test.ts.
      // Here we just verify construction doesn't throw.
      const globalFlags = new Set(['config'])
      const im = new InteractiveMode({ pluginName: 'generate', globalFlags })
      expect(im).toBeDefined()
      // The original set should not be mutated
      expect(globalFlags.has('interactive')).toBe(false)
    })
  })

  describe('run() error handling', () => {
    it('throws if install() was not called', async () => {
      const globalFlags = new Set(['config'])
      const im = new InteractiveMode({ pluginName: 'generate', globalFlags })
      // Don't call install()
      await expect(im.run([])).rejects.toThrow('InteractiveMode not installed')
    })

    it('silently returns when user cancels interactive mode', async () => {
      const { runInteractiveMode } = await import('./interactive-mode.js')
      const mockRun = vi.mocked(runInteractiveMode)
      mockRun.mockRejectedValue(new InteractiveModeCancelledError())

      const im = createInteractiveMode()
      // Should not throw — cancellation is handled gracefully
      await expect(im.run(['-i'])).resolves.toBeUndefined()
    })
  })
})
