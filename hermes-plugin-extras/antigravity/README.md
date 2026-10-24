# Antigravity provider (optional)

Gemini models through a Google Antigravity login (Google AI Pro/Ultra), as a model provider in Hermes. Not part of the normal
install; Hermes Mobile does not depend on it.

> **Warning:** using Antigravity like this is against Google's terms of use, and accounts have been banned or restricted.
> Use it at your own risk, ideally with a spare account.

Two Hermes plugins, taken from [mrhisyammm/hermes-antigravity-auth](https://github.com/mrhisyammm/hermes-antigravity-auth) (MIT,
see `LICENSE`) with our changes:

- `antigravity-oauth/`: the login and a local OpenAI-compatible proxy on `127.0.0.1:8999` (text, images, tools, reasoning effort).
- `model-providers/antigravity/`: the provider profile, so `antigravity` shows up in the model picker.

Our change: on a phone `hermes antigravity login` prints the Google link and also opens it through Termux:API
(`termux-open-url`), and waits 115 s instead of 60 s for you to finish.

## Install (phone, in Termux)

```bash
bash ~/hermes-mobile/phone/antigravity.sh
proot-distro login debian -- bash -lc 'hermes antigravity login'    # once; open the printed link, sign in
```

Then pick a `gemini-*` model under `antigravity` in the app's model picker. The script copies the plugins into Debian,
enables them, sets `providers.antigravity.base_url` and restarts Hermes. Run it again to update.

Login tokens are stored by the plugin in `~/AppData/Local/hermes/antigravity-accounts.json` inside Debian (not in this repo).
Proxy log: `~/.hermes/logs/antigravity-proxy.log`.

## Verified

Phone (Android 16, HyperOS): script re-run over an existing working install, then `hermes -z` with `gemini-3.8-flash`
answered through the proxy. Not verified: a first-time login on a fresh phone (the printed link / `termux-open-url` path),
other vendors, the AOSP emulator, Windows.
