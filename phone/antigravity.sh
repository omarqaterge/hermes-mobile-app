#!/data/data/com.termux/files/usr/bin/bash
# OPTIONAL: Gemini models through a Google Antigravity login (Google AI Pro/Ultra). Run it in TERMUX:
#   bash ~/hermes-mobile/phone/antigravity.sh
# Installs the antigravity-oauth proxy plugin and the "antigravity" model provider into Hermes (Debian), enables both and points
# Hermes at the local proxy (127.0.0.1:8999). Then: pick "antigravity" in the model picker, and log in once with
#   hermes antigravity login      (inside Debian; the link is printed and opened through Termux:API)
# or type /antigravity-login in a chat. Safe to run again. NOT part of the normal install: using Antigravity this way is
# against Google's terms and accounts have been banned (see hermes-plugin-extras/antigravity/README.md).
set -e
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$here/hermes-plugin-extras/antigravity"
[ -d "$src/antigravity-oauth" ] || { echo "ERROR: $src not found. Run this from a clone of the Hermes Mobile repo." >&2; exit 1; }
DEB="$HOME/bin/hermes-debian"; [ -x "$DEB" ] || DEB="$here/phone/hermes-debian"
"$DEB" --exists /root/.hermes || { echo "ERROR: Hermes is not set up in Debian yet." >&2; exit 1; }

echo "Antigravity logins break Google's terms of use; accounts have been banned. Use a spare account if you are unsure."
echo "1/3 Installing the plugins"
find "$src" -name __pycache__ -prune -exec rm -rf {} + 2>/dev/null || true
"$DEB" --put "$src/antigravity-oauth" /root/.hermes/plugins/antigravity-oauth
"$DEB" --put "$src/model-providers/antigravity" /root/.hermes/plugins/model-providers/antigravity

echo "2/3 Enabling them and pointing Hermes at the proxy"
"$DEB" bash -lc '
  export PATH="$HOME/.local/bin:$PATH"
  hermes plugins enable antigravity-oauth || echo "Could not enable antigravity-oauth: run  hermes plugins enable antigravity-oauth"
  hermes plugins enable model-providers/antigravity || echo "Could not enable the provider: run  hermes plugins enable model-providers/antigravity"
  hermes config set providers.antigravity.base_url http://127.0.0.1:8999/v1 >/dev/null
  touch ~/.hermes/.env
  grep -q "^ANTIGRAVITY_API_KEY=" ~/.hermes/.env || echo "ANTIGRAVITY_API_KEY=mock" >> ~/.hermes/.env   # placeholder, the login is OAuth
'

echo "3/3 Restarting Hermes so the plugins load"
"$DEB" --restart
echo
echo "Done. Log in once:  proot-distro login debian -- bash -lc 'hermes antigravity login'"
echo "(rooted phone with chroot-distro: ~/bin/hermes-debian bash -lc 'hermes antigravity login'). Then pick a gemini model under the antigravity provider."
