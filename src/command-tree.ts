/**
 * Utility for extracting a plugin's command tree from a yargs instance
 * for inclusion in the plugins.toml manifest. The CLI reads this metadata
 * to display plugin subcommands in --map output without launching the
 * plugin binary.
 */
import yargs, { type Argv } from 'yargs'

/**
 * Describes a plugin subcommand for manifest metadata.
 * @public
 */
export interface CommandInfo {
  name: string
  desc?: string
  commands?: CommandInfo[]
}

/**
 * Extract the command tree from a yargs instance.
 *
 * Yargs stores registered commands internally. This function retrieves
 * them and returns a serializable CommandInfo tree suitable for inclusion
 * in a plugins.toml manifest.
 *
 * @param yargsInstance - A configured yargs instance with commands registered
 * @returns Array of CommandInfo describing the top-level commands
 * @public
 */
export function extractCommandTree(yargsInstance: Argv): CommandInfo[] {
  // Access yargs internals to read registered command handlers.
  const internal = (yargsInstance as any).getInternalMethods?.()
  const cmdInstance = internal?.getCommandInstance?.()
  if (!cmdInstance) {
    return []
  }

  const handlers = cmdInstance.getCommandHandlers?.()
  if (!handlers || typeof handlers !== 'object') {
    return []
  }

  const result: CommandInfo[] = []
  for (const name of Object.keys(handlers)) {
    // Skip the default command ($0)
    if (name === '$0') continue

    const handler = handlers[name]
    const info: CommandInfo = { name }

    if (handler.description) {
      info.desc = handler.description
    }

    // If the handler has a builder that creates sub-commands, try to extract them
    if (typeof handler.builder === 'function') {
      try {
        const subYargs = yargs([]).exitProcess(false)
        handler.builder(subYargs)
        const subCommands = extractCommandTree(subYargs)
        if (subCommands.length > 0) {
          info.commands = subCommands
        }
      } catch {
        // Builder may have side effects; skip sub-command extraction on error
      }
    }

    result.push(info)
  }

  return result
}
