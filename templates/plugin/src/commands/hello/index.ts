import type { GlobalFlags } from '@stripe/stripe-cli-plugin-bootstrap'
import type { Argv } from 'yargs'

export const helloCommand = {
  connect(yargs: Argv<GlobalFlags>): Argv<GlobalFlags> {
    return yargs.command(
      'hello [name]',
      'Say hello',
      y =>
        y.positional('name', {
          type: 'string',
          description: 'Name to greet',
          default: 'world',
        }),
      async args => {
        console.log(`Hello, ${args.name}!`)
      },
    )
  },
}
