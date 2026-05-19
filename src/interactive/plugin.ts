import type { Argv } from 'yargs'
import yargsParser from 'yargs-parser'
import { getPluginYargs } from '../index.js'
import { extractCommands } from './introspect.js'
import {
  runInteractiveMode,
  InteractiveModeCancelledError,
  type PreFilledArgs,
} from './interactive-mode.js'
import { requireTTY } from './tty.js'
import type { YargsPlugin } from './types.js'

/**
 * Options for configuring InteractiveMode behavior
 * @public
 */
export interface InteractiveModeOptions {
  /** Plugin name used in intro, preview, and error messages */
  pluginName: string
  /** Global flag names to filter out of interactive prompts (derived from bootstrap) */
  globalFlags: Set<string>
  /** If true, trigger interactive mode when no subcommand provided */
  defaultWhenNoSubcommand?: boolean
}

/**
 * InteractiveMode plugin - adds -i/--interactive flag and handles
 * interactive command building when triggered.
 *
 * Usage:
 *
 * ```
 * const interactive = new InteractiveMode({ pluginName: 'generate', globalFlags })
 * yargsInstance = interactive.install(yargsInstance, yargsFactory)
 * await interactive.run(args)  // Instead of yargs.parseAsync(args)
 * ```
 *
 * @public
 */
export class InteractiveMode<T = object> implements YargsPlugin<T> {
  private yargsInstance: Argv<T> | null = null
  private yargsFactory: (() => Argv<T>) | null = null
  private options: Required<InteractiveModeOptions>

  constructor(options: InteractiveModeOptions) {
    // Add interactive/i to the global flags since we register them ourselves
    const globalFlags = new Set(options.globalFlags)
    globalFlags.add('interactive')
    globalFlags.add('i')

    this.options = {
      pluginName: options.pluginName,
      globalFlags,
      defaultWhenNoSubcommand: options.defaultWhenNoSubcommand ?? false,
    }
  }

  /**
   * Install interactive mode onto a yargs instance.
   * Also accepts a factory function to rebuild yargs (needed for clean re-parsing).
   */
  install(yargsInstance: Argv<T>, yargsFactory?: () => Argv<T>): Argv<T> {
    this.yargsFactory = yargsFactory ?? null

    // Add --interactive / -i flag
    const installed = yargsInstance.option('interactive', {
      alias: 'i',
      type: 'boolean',
      description: 'Run in interactive mode',
      default: false,
    }) as Argv<T>

    this.yargsInstance = installed
    return installed
  }

  /**
   * Run the command, intercepting for interactive mode if needed.
   * Call this instead of yargs.parseAsync() directly.
   */
  async run(args: string[]): Promise<void> {
    if (!this.yargsInstance) {
      throw new Error('InteractiveMode not installed. Call install() first.')
    }

    if (this.shouldIntercept(args)) {
      await this.runInteractive(args)
    } else {
      await this.yargsInstance.parseAsync(args)
    }
  }

  /**
   * Check if we should intercept and run interactive mode
   */
  private shouldIntercept(args: string[]): boolean {
    // Parse args so we correctly handle forms like --flag, --flag=true, --flag=false, etc.
    const parsed = yargsParser(args, {
      boolean: ['interactive', 'i', 'help', 'version'],
      alias: {
        i: ['interactive'],
      },
    })

    // --help and --version take priority over interactive mode when explicitly enabled
    if (parsed.help === true || parsed.version === true) {
      return false
    }

    // Check for explicit -i/--interactive flag (in any yargs-supported boolean form)
    if (parsed.interactive === true || parsed.i === true) {
      return true
    }

    // Check if no subcommand was provided (use a bare yargs with only global
    // flags to parse — avoids triggering command handlers and correctly
    // distinguishes option values like --config foo from subcommands)
    if (this.options.defaultWhenNoSubcommand) {
      let hasSubcommand = false
      getPluginYargs(this.options.pluginName).parse(
        args,
        (_err: Error | undefined, argv: { _: string[] }) => {
          hasSubcommand = argv._.length > 0
        },
      )
      if (!hasSubcommand) {
        return true
      }
    }

    return false
  }

  /**
   * Run the interactive flow.
   * Parses originalArgs to extract any pre-filled values (command name,
   * positional args, named options) so interactive mode only prompts for
   * what's missing. Global flags are preserved and appended to the final args.
   */
  private async runInteractive(originalArgs: string[]): Promise<void> {
    requireTTY(this.options.pluginName)

    // Extract commands from yargs
    const commands = extractCommands(this.yargsInstance!, this.options.globalFlags)

    if (commands.length === 0) {
      console.error('No commands available.')
      throw new Error('No commands available.')
    }

    // Parse original args to separate pre-filled values from global flags
    const { preFilled, globalFlagArgs } = this.extractPreFilled(originalArgs, commands)

    // Run interactive prompts (skipping pre-filled values)
    let interactiveArgs: string[]
    try {
      interactiveArgs = await runInteractiveMode(
        this.options.pluginName,
        commands,
        preFilled,
      )
    } catch (error) {
      if (error instanceof InteractiveModeCancelledError) {
        return
      }
      throw error
    }

    // Combine interactive result with preserved global flags
    const finalArgs = [...interactiveArgs, ...globalFlagArgs]

    // Get a fresh yargs instance for clean parsing
    const freshYargs = this.getFreshYargs()
    await freshYargs.parseAsync(finalArgs)
  }

  /**
   * Parse the original args to extract pre-filled values for interactive mode.
   *
   * Positionals (parsed._) are split into:
   *   - command name (first positional matching a known command)
   *   - remaining positionals (pre-filled in order)
   *
   * Named flags are split into:
   *   - global flags (preserved for the final command, not shown in interactive prompts)
   *   - command-specific options (pre-filled, skipping their interactive prompts)
   */
  private extractPreFilled(
    args: string[],
    commands: { name: string }[],
  ): { preFilled: PreFilledArgs; globalFlagArgs: string[] } {
    const parsed = yargsParser(args, {
      boolean: ['interactive'],
      alias: { i: ['interactive'] },
    })

    // Identify command name and remaining positionals
    const positionals = [...parsed._].map(String)
    const commandNames = new Set(commands.map(c => c.name))

    let command: string | undefined
    let preFilledPositionals: string[] = []

    const cmdIndex = positionals.findIndex(p => commandNames.has(p))
    if (cmdIndex >= 0) {
      command = positionals[cmdIndex]
      preFilledPositionals = positionals.slice(cmdIndex + 1)
    }

    // Separate global flags from command-specific options
    const globalFlagArgs: string[] = []
    const preFilledOptions: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(parsed)) {
      if (key === '_' || key === 'interactive' || key === 'i') continue

      if (this.options.globalFlags.has(key)) {
        // Reconstruct as CLI args for the final command
        if (typeof value === 'boolean') {
          globalFlagArgs.push(value ? `--${key}` : `--no-${key}`)
        } else if (Array.isArray(value)) {
          for (const v of value) {
            globalFlagArgs.push(`--${key}`, String(v))
          }
        } else {
          globalFlagArgs.push(`--${key}`, String(value))
        }
      } else {
        preFilledOptions[key] = value
      }
    }

    const preFilled: PreFilledArgs = {}
    if (command) preFilled.command = command
    if (preFilledPositionals.length > 0) preFilled.positionals = preFilledPositionals
    if (Object.keys(preFilledOptions).length > 0) preFilled.options = preFilledOptions

    return { preFilled, globalFlagArgs }
  }

  /**
   * Get a fresh yargs instance (uses factory if provided, otherwise returns current)
   */
  private getFreshYargs(): Argv<T> {
    if (this.yargsFactory) {
      const fresh = this.yargsFactory()
      // Re-install interactive mode on fresh instance
      return fresh.option('interactive', {
        alias: 'i',
        type: 'boolean',
        description: 'Run in interactive mode',
        default: false,
      }) as Argv<T>
    }
    return this.yargsInstance!
  }
}
