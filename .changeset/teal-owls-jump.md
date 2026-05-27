---
'@stripe/stripe-cli-plugin-bootstrap': patch
---

Fix ReferenceError when using getPluginEsbuildConfig from an ESM context by replacing bare require and __dirname with createRequire and fileURLToPath equivalents
