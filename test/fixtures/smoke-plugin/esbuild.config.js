import esbuild from 'esbuild'
import { getPluginEsbuildConfig } from '@stripe/stripe-cli-plugin-bootstrap'

esbuild
  .build({
    ...getPluginEsbuildConfig(['src/main.ts'], 'dist/bundle.js'),
    loader: {
      '.node': 'file',
    },
  })
  .then(() => {
    console.log('smoke-plugin bundle created')
  })
  .catch(err => {
    console.error('smoke-plugin build failed:', err)
    process.exit(1)
  })
