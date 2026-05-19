import type { Argv } from 'yargs'

/**
 * Extracted positional argument info from a yargs command
 * @public
 */
export interface ExtractedPositional {
  name: string
  required: boolean
  variadic: boolean
  description?: string
  choices?: string[]
}

/**
 * Extracted option info from a yargs command
 * @public
 */
export interface ExtractedOption {
  name: string
  type: 'string' | 'boolean' | 'number' | 'array'
  description?: string
  default?: unknown
  choices?: string[]
  required: boolean
}

/**
 * Extracted command info from a yargs instance
 * @public
 */
export interface ExtractedCommand {
  name: string
  description: string
  positionals: ExtractedPositional[]
  options: ExtractedOption[]
  builder: (y: Argv) => Argv
}

/**
 * Base interface for yargs plugins that can hook into the parse lifecycle
 * @public
 */
export interface YargsPlugin<T = object> {
  /** Install the plugin onto a yargs instance (add flags, middleware, etc.) */
  install(yargsInstance: Argv<T>): Argv<T>
}
