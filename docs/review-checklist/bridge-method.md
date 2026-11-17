# A new or changed bridge method

- paths: `^android/src/.*\.java$`
- adds: `@JavascriptInterface`

Every native bridge method takes the per-page key as its first argument and checks it before doing anything, and is
listed in `web/src/secure-bridge.ts`. A method without the key can be called by any page content that reaches the
WebView. Say in the spec what the method does.
