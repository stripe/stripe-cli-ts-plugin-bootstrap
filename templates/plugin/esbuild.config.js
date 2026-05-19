const esbuild = require('esbuild')
const { getPluginEsbuildConfig } = require('@stripe/stripe-cli-plugin-bootstrap')

const shouldBuildJsBundle = process.env.BUILD_JS_BUNDLE === 'true'

esbuild
  .build({
    ...getPluginEsbuildConfig(['src/main.ts'], 'dist/bundle.js'),

    ...(shouldBuildJsBundle
      ? {
          banner: {
            js: '#!/usr/bin/env node',
          },
        }
      : {}),

    loader: {
      '.node': 'file',
    },
  })
  .then(() => {
    console.log('Bundle created successfully')
  })
  .catch(err => {
    console.error('Build failed:', err)
    process.exit(1)
  })
