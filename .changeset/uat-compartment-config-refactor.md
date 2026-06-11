---
'@stripe/stripe-cli-plugin-bootstrap': minor
---

Refactor UAT and compartment config to match the Go CLI storage model. Rename `UATName` to `UATKeychainItemKey` and remove `LiveContextName` and `TestWorkspaceIDName`. Add `Compartment` and `UserInfo` interfaces. `getLiveContext` and `getTestWorkspaceID` now read from `UserInfo.compartments` instead of direct config keys; `getUAT` uses a top-level keychain key instead of a profile-prefixed value.
