---
'@stripe/stripe-cli-plugin-bootstrap': patch
---

Fix broker dial protocol to match go-plugin v1.7.0 non-mux mode used by the Stripe CLI host. The previous implementation sent a knock request and waited for an ack, but the host only announces services via ConnInfo (no knock). Announcements arriving before `dial()` was called were silently dropped and `dial()` would then time out after 5s, leaving `CoreCLIHelper` undefined for the plugin command. Plugins that used the keychain saw this surface as a misleading "Keychain not initialized" error.
