# A new address the app talks to

- paths: `^(web/src/|android/src/|hermes-plugin/|phone/|relay/)(?!.*\.test\.)`
- adds: `^(?!\s*(//|#|\*|/\*)).*(https?://(?!127\.0\.0\.1|localhost|schemas\.android\.com|www\.w3\.org|[\w.-]*\.(example|test)\b)\w|HttpURLConnection|urlopen\(|\bcurl |\bwget )`

`docs/security.md` lists everything the phone connects to and `docs/privacy.md` what leaves the phone; both stay
complete. A new address goes in them in the same pull request, with what is sent and when, and nothing is sent that
the user didn't turn on.
