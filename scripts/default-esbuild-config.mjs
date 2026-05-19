#!/usr/bin/env node
import esbuild from 'esbuild'
import { getPluginEsbuildConfig } from '@stripe/stripe-cli-plugin-bootstrap'

const [entryPoint, outfile] = process.argv.slice(2)

if (!entryPoint || !outfile) {
  console.error('Usage: default-esbuild-config.mjs <entryPoint> <outfile>')
  process.exit(1)
}

esbuild
  .build({
    ...getPluginEsbuildConfig([entryPoint], outfile),
    loader: {
      '.node': 'file',
    },
  })
  .then(() => {
    console.log('✅ Bundle created successfully')
  })
  .catch(err => {
    console.error('❌ Build failed:', err)
    process.exit(1)
  })
