import * as p from '@clack/prompts'
import type { ExtractedCommand, ExtractedOption, ExtractedPositional } from './types.js'

/**
 * Thrown when the user cancels an interactive prompt.
 * Caught at the top level of the interactive mode plugin for a clean early return.
 */
export class InteractiveModeCancelledError extends Error {
  constructor() {
    super('Operation cancelled.')
    this.name = 'InteractiveModeCancelledError'
  }
}

/**
 * Check if a prompt result is a cancellation and throw if so.
 */
function throwIfCancelled<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel('Operation cancelled.')
    throw new InteractiveModeCancelledError()
  }
  return value
}

/**
 * Format a name as a human-readable label: replace hyphens with spaces, capitalize first letter.
 * e.g. "my-object-name" → "My object name"
 */
function formatName(name: string): string {
  const words = name.split('-').join(' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * Build a prompt label, stripping trailing punctuation and appending a colon.
 * Uses description if available, otherwise formats the name.
 */
function formatPromptLabel(name: string, description?: string): string {
  if (description) {
    return description.replace(/[.:!?]+$/, '') + ':'
  }
  return `${formatName(name)}:`
}

/**
 * Display a pre-filled value in the same style as a completed prompt.
 * Renders with ◇ symbol and bar-indented value to match @clack/prompts output.
 */
function promptPreFilled(message: string, value: string): void {
  p.log.step(`${message}\n${value}`)
}

/**
 * Format a default value for display
 */
function formatDefault(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  return JSON.stringify(value)
}

/**
 * Pre-filled arguments from the command line, used when the user provides
 * partial args alongside -i (e.g. `stripe generate extension my-type -i`).
 * @public
 */
export interface PreFilledArgs {
  /** Command name already specified on the CLI */
  command?: string
  /** Positional values in order (index 0 = first positional, etc.) */
  positionals?: string[]
  /** Named options already specified on the CLI */
  options?: Record<string, unknown>
}

/**
 * Run the interactive mode flow.
 * Prompts the user to select a command and fill in arguments.
 * Skips prompts for any values already provided via `preFilled`.
 *
 * @param pluginName - Plugin name for display (e.g. "generate")
 * @param commands - Available commands extracted from yargs
 * @param preFilled - Values already provided on the command line
 * @returns Array of CLI arguments to pass to yargs
 * @throws InteractiveModeCancelledError if the user cancels
 * @public
 */
export async function runInteractiveMode(
  pluginName: string,
  commands: ExtractedCommand[],
  preFilled: PreFilledArgs = {},
): Promise<string[]> {
  p.intro(`stripe ${pluginName} - Interactive Mode`)

  // Step 1: Select command
  const selectedCommand = await promptForCommand(commands, preFilled.command)

  const collectedArgs: Record<string, unknown> = {}
  const preFilledPositionals = preFilled.positionals ?? []
  const preFilledOptions = preFilled.options ?? {}

  // Step 2: Collect positional arguments
  for (let i = 0; i < selectedCommand.positionals.length; i++) {
    const value = await promptForPositional(
      selectedCommand.positionals[i],
      preFilledPositionals[i],
    )
    if (value !== undefined) {
      collectedArgs[selectedCommand.positionals[i].name] = value
    }
  }

  // Step 3: Collect options
  for (const opt of selectedCommand.options) {
    const value = await promptForOption(opt, preFilledOptions[opt.name])
    if (value !== undefined) {
      collectedArgs[opt.name] = value
    }
  }

  // Step 4: Build args array and show preview
  const argsArray = buildArgsArray(selectedCommand, collectedArgs)
  const preview = `stripe ${pluginName} ${argsArray.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`

  p.note(preview, 'Command Preview')

  const confirmed = throwIfCancelled(
    await p.confirm({
      message: 'Run this command?',
      initialValue: true,
    }),
  )

  if (!confirmed) {
    throw new InteractiveModeCancelledError()
  }

  p.outro('Running command...')
  return argsArray
}

/**
 * Prompt for command selection, or display pre-filled command.
 */
async function promptForCommand(
  commands: ExtractedCommand[],
  preFilled?: string,
): Promise<ExtractedCommand> {
  const message = 'Which command would you like to run?'

  if (preFilled) {
    const cmd = commands.find(c => c.name === preFilled)
    if (cmd) {
      promptPreFilled(message, cmd.name)
      return cmd
    }
  }

  const commandChoice = throwIfCancelled(
    await p.select({
      message,
      options: commands.map(cmd => ({
        value: cmd.name,
        label: cmd.name,
        hint: cmd.description,
      })),
    }),
  )

  const selected = commands.find(c => c.name === commandChoice)
  if (!selected) {
    throw new Error(`Command not found: ${commandChoice}`)
  }
  return selected
}

/**
 * Prompt for a positional argument, or display pre-filled value.
 */
async function promptForPositional(
  pos: ExtractedPositional,
  preFilled?: string,
): Promise<string | undefined> {
  const message = formatPromptLabel(pos.name, pos.description)

  if (preFilled !== undefined) {
    promptPreFilled(message, preFilled)
    return preFilled
  }

  // If the positional has choices, use a select prompt
  if (pos.choices && pos.choices.length > 0) {
    const options = pos.choices.map(c => ({ value: c, label: c }))
    const value = throwIfCancelled(await p.select({ message, options }))
    return String(value)
  }

  const value = throwIfCancelled(
    await p.text({
      message,
      validate: val => {
        if (pos.required && !val?.trim()) {
          return `${pos.name} is required`
        }
      },
    }),
  )

  return value || undefined
}

/**
 * Prompt for an option based on its type, or display pre-filled value.
 */
async function promptForOption(
  opt: ExtractedOption,
  preFilled?: unknown,
): Promise<unknown> {
  const defaultStr = formatDefault(opt.default)
  const defaultHint = defaultStr ? ` [default: ${defaultStr}]` : ''
  const message = `${formatPromptLabel(opt.name, opt.description)}${defaultHint}`

  if (preFilled !== undefined) {
    promptPreFilled(message, formatDefault(preFilled))
    return preFilled
  }

  // Handle choices with select
  if (opt.choices && opt.choices.length > 0) {
    return promptForChoiceOption(opt, message)
  }

  // Handle boolean
  if (opt.type === 'boolean') {
    return promptForBooleanOption(opt, message)
  }

  // Handle string/number with text input
  return promptForTextOption(opt, message)
}

/**
 * Prompt for an option with predefined choices
 */
async function promptForChoiceOption(
  opt: ExtractedOption,
  message: string,
): Promise<string | undefined> {
  const defaultStr = formatDefault(opt.default)

  const choiceOptions = opt.choices?.map(c => ({ value: c, label: c })) ?? []
  // If the option is required and has no default, do not offer a skip option.
  if (opt.required && opt.default === undefined) {
    const value = throwIfCancelled(await p.select({ message, options: choiceOptions }))
    return String(value)
  }

  const options = [
    {
      value: '__skip__',
      label: defaultStr ? `(use default: ${defaultStr})` : '(skip)',
    },
    ...choiceOptions,
  ]

  const value = throwIfCancelled(await p.select({ message, options }))

  return value === '__skip__' ? undefined : String(value)
}

/**
 * Prompt for a boolean option
 */
async function promptForBooleanOption(
  opt: ExtractedOption,
  message: string,
): Promise<boolean | undefined> {
  const hasDefault = opt.default !== undefined
  const defaultBool = opt.default === true ? 'true' : 'false'
  const options: { value: string; label: string }[] = []

  if (hasDefault) {
    options.push({ value: 'skip', label: `(use default: ${defaultBool})` })
  }

  options.push({ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' })

  const value = throwIfCancelled(await p.select({ message, options }))

  if (value === 'skip') return undefined
  return value === 'true'
}

/**
 * Prompt for a text/number option
 */
async function promptForTextOption(
  opt: ExtractedOption,
  message: string,
): Promise<string | undefined> {
  const value = throwIfCancelled(
    await p.text({
      message,
      validate: val => {
        if (opt.required && opt.default === undefined && !val?.trim()) {
          return `${opt.name} is required`
        }
      },
    }),
  )

  // Return undefined for empty input with default (let yargs use default)
  if (!value && opt.default !== undefined) {
    return undefined
  }

  return value || undefined
}

/**
 * Build an args array from collected values
 * @public
 */
export function buildArgsArray(
  cmd: ExtractedCommand,
  args: Record<string, unknown>,
): string[] {
  const result: string[] = [cmd.name]

  // Add positionals in order
  for (const pos of cmd.positionals) {
    const val = args[pos.name]
    if (val !== undefined) {
      result.push(formatDefault(val))
    }
  }

  // Add options
  for (const opt of cmd.options) {
    const val = args[opt.name]
    if (val === undefined) continue

    const flagName = `--${opt.name}`

    if (opt.type === 'boolean') {
      if (val === true) result.push(flagName)
      else if (val === false) result.push(`--no-${opt.name}`)
    } else if (opt.type === 'array' || Array.isArray(val)) {
      const values = Array.isArray(val) ? val : [val]
      for (const v of values) {
        result.push(flagName, formatDefault(v))
      }
    } else {
      result.push(flagName, formatDefault(val))
    }
  }

  return result
}
