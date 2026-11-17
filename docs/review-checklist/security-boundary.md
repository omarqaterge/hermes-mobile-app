# The local security boundary

- paths: `^(android/src/com/omarqaterge/hermesmobile/(Local\w+|BridgeKey|IntentGate|ApprovalLock|RemoteGuard|DevTools|PhoneData\w*)\.java|hermes-plugin/hermes-mobile/(local_auth|dashboard/plugin_api)\.py|web/src/secure-bridge\.ts|phone/hm-local|tools/local-auth-vectors\.json)$`

These files decide who may talk to Hermes on the phone and what the agent may read. Read the decisions that cover
them first (`local-authentication`, `approval-needs-fingerprint`, `phone-data-read-only`,
`no-actions-from-locked-phone`). The Java, Python and shell copies of the local authentication agree through
`tools/local-auth-vectors.json`: change them together. Update "What we have done" or "What we are doing now" in the
README and `docs/security.md` in the same pull request.
