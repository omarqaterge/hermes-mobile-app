# A permission or an exported component

- paths: `AndroidManifest\.xml$`
- adds: `uses-permission|android:exported="true"|<intent-filter|<provider|<receiver`

Each permission is in the permissions table of `docs/security.md` with its reason, and in the spec. An
exported activity, receiver or provider can be started by any app on the phone: check who may call it and what it
does with an intent it didn't expect (`IntentGate`).
