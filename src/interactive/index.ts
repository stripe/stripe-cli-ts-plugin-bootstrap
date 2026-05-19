// Types
export type {
  ExtractedCommand,
  ExtractedOption,
  ExtractedPositional,
  YargsPlugin,
} from './types.js'

// Plugin class
export { InteractiveMode } from './plugin.js'
export type { InteractiveModeOptions } from './plugin.js'

// Utilities (exported for testing or direct use)
export { extractCommands } from './introspect.js'
export { runInteractiveMode, buildArgsArray } from './interactive-mode.js'
export type { PreFilledArgs } from './interactive-mode.js'
export { isTTY, requireTTY } from './tty.js'
