---
'@stripe/stripe-cli-plugin-bootstrap': patch
---

Fix install-plugin to work on Windows via Git Bash: get_platform_target now detects MINGW/MSYS/Cygwin and maps to win-x64, binary builds include the .exe suffix in build and install paths, and shasum is replaced with a Node.js crypto equivalent.
