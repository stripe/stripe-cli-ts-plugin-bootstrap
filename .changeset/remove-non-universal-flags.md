---
'@stripe/stripe-cli-plugin-bootstrap': major
---

Remove non-universal flags from getPluginYargs default registration. Plugins now opt in to config-aware flags (--api-key, --config, --device-name, --project-name) via registerConfigFlags instead of getting them all by default.
