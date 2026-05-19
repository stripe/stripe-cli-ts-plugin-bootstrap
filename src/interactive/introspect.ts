import yargs from 'yargs'
import type { Argv } from 'yargs'
import type { ExtractedCommand, ExtractedOption, ExtractedPositional } from './types.js'

/**
 * Internal yargs command handler structure
 */
interface CommandHandler {
  description: string
  builder: (y: Argv) => Argv
  demanded: Array<{ cmd: string[]; variadic: boolean }>
  optional: Array<{ cmd: string[]; variadic: boolean }>
}

/**
 * Internal yargs methods structure (not exported by yargs types)
 */
interface YargsInternalMethods {
  getCommandInstance(): { handlers: Record<string, CommandHandler> }
  getUsageInstance(): { getDescriptions(): Record<string, string | undefined> }
}

/**
 * Internal yargs options structure
 */
interface YargsOptionsInternal {
  key: Record<string, boolean>
  default: Record<string, unknown>
  choices: Record<string, string[] | undefined>
  boolean: string[]
  number: string[]
  array: string[]
}

/**
 * Extended yargs interface with internal methods (for type casting)
 */
interface YargsWithInternals {
  getInternalMethods(): YargsInternalMethods
  getOptions(): YargsOptionsInternal
  getDemandedOptions(): Record<string, unknown>
  getGroups(): Record<string, string[]>
}

/**
 * Extract all commands from a yargs instance.
 * Uses yargs internal APIs to introspect registered commands.
 * @public
 */
export function extractCommands(
  yargsInstance: Argv,
  globalFlags: Set<string>,
): ExtractedCommand[] {
  // Cast to access internal methods (not typed by yargs)
  const yargsWithInternals = yargsInstance as unknown as YargsWithInternals
  const internal = yargsWithInternals.getInternalMethods()
  const cmdInstance = internal.getCommandInstance()
  const commands: ExtractedCommand[] = []

  const handlers = cmdInstance.handlers

  for (const [name, handler] of Object.entries(handlers)) {
    // Skip default command
    if (name === '$0') continue

    try {
      const cmd = extractCommand(name, handler, globalFlags)
      commands.push(cmd)
    } catch (err) {
      // Skip commands that fail to extract (shouldn't happen, but be safe)
      console.warn(`Warning: Failed to extract command '${name}':`, err)
    }
  }

  return commands
}

/**
 * Extract metadata for a single command
 */
function extractCommand(
  name: string,
  handler: CommandHandler,
  globalFlags: Set<string>,
): ExtractedCommand {
  // Invoke builder on fresh yargs to get options (needed for positional metadata too)
  const freshYargs = yargs()
  const builtYargs = handler.builder(freshYargs) as unknown as YargsWithInternals

  // Access internal methods and options
  const opts = builtYargs.getOptions()
  const demanded = builtYargs.getDemandedOptions()
  const groups = builtYargs.getGroups()

  // Get descriptions via internal usage instance
  const builtInternal = builtYargs.getInternalMethods()
  const usageInstance = builtInternal.getUsageInstance()
  const descriptions = usageInstance.getDescriptions()

  // Extract positionals from handler metadata, enriched with description/choices from builder
  const positionals: ExtractedPositional[] = [
    ...handler.demanded.map(d => ({
      name: d.cmd[0],
      required: true,
      variadic: d.variadic,
      description: cleanDescription(descriptions[d.cmd[0]]),
      choices: opts.choices[d.cmd[0]],
    })),
    ...handler.optional.map(o => ({
      name: o.cmd[0],
      required: false,
      variadic: o.variadic,
      description: cleanDescription(descriptions[o.cmd[0]]),
      choices: opts.choices[o.cmd[0]],
    })),
  ]

  // Identify positional names (in 'Positionals:' group)
  const positionalNames = new Set<string>(groups['Positionals:'] ?? [])

  // Extract options, filtering globals and positionals
  const options: ExtractedOption[] = []
  for (const optName of Object.keys(opts.key)) {
    if (globalFlags.has(optName)) continue
    if (positionalNames.has(optName)) continue

    const option: ExtractedOption = {
      name: optName,
      type: getOptionType(optName, opts),
      description: cleanDescription(descriptions[optName]),
      default: opts.default[optName],
      choices: opts.choices[optName],
      required: optName in demanded,
    }
    options.push(option)
  }

  return {
    name,
    description: handler.description,
    positionals,
    options,
    builder: handler.builder,
  }
}

/**
 * Determine the type of an option from yargs options object
 */
function getOptionType(
  name: string,
  opts: YargsOptionsInternal,
): ExtractedOption['type'] {
  if (opts.boolean.includes(name)) return 'boolean'
  if (opts.number.includes(name)) return 'number'
  if (opts.array.includes(name)) return 'array'
  return 'string'
}

/**
 * Clean a description string, removing yargs i18n prefixes
 */
function cleanDescription(desc?: string): string | undefined {
  if (!desc) return undefined
  // Remove yargs i18n prefix if present
  if (desc.startsWith('__yargsString__:')) {
    return desc.substring('__yargsString__:'.length)
  }
  return desc
}
