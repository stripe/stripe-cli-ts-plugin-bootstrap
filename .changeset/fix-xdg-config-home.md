---
'@stripe/stripe-cli-plugin-bootstrap': patch
---

Fix XDG_CONFIG_HOME handling in addPluginToConfig and addPluginToManifest to use $XDG_CONFIG_HOME/stripe/ as the config directory
