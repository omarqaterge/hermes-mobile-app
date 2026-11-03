# Hermux in every on-screen text

**State** (2026-11-02): the app's visible text says Hermux instead of Hermes: the web interface, the Android strings
(lock-screen shortcut, fingerprint prompt, clipboard labels), the plugin's messages that reach the app or a chat, and
the phone scripts' output. The spec, the browser checks and the unit tests follow the new wording. What stays Hermes,
and why, is in [hermux-where-it-shows.md](../decisions/hermux-where-it-shows.md).

Pictures saved with Save go to `Pictures/Hermux` (2026-11-02, the owner said "move it"). `PicturesFolder` moves the
pictures the app saved itself from `Pictures/Hermes` once after the update (Android 11+, MediaStore `RELATIVE_PATH`
update: a move, never a copy). On Android 10, and for any it can't move, pictures stay in `Pictures/Hermes`, as the
uninstall note says.

The Uninstall sheet describes the installer's files in plain words, and new backups are `hermux-backup-<date>.tar.gz`
(2026-11-03; nothing looks for a backup by name, and older backups keep theirs).

**Docs and README** (2026-11-03): the README and the docs now say Hermux too. What stays under the old name is the
repository and the file identifiers listed in [the glossary](../spec/09-glossary.md) (the repository
`hermes-mobile-app`, `hermes-mobile.apk`, the package ID, the plugin folder, and the like). The five README images
that showed the old name were retaken on 2026-11-03. Their chats are test data: the screens come from the web build on
the mock, and the two notifications from a test build on an Android 15 emulator, so they show its normal notification,
not an Android 16 Live Update. The demo video the README's preview links to, on X, still shows the old name.

**Next:** the phone checks below, then delete this file.

**Needs a real phone:** a look through Setup, Settings, the approval prompt and the fingerprint sheet for any Hermes
left on screen. The picture move on a real phone: save a picture with the old build, update, check it is in
`Pictures/Hermux` once and `Pictures/Hermes` is empty (use test pictures, not the owner's). On Android 10, check old
pictures stay put.

**Picture move tested** (2026-11-03): passed on an Android 15 (API 35) emulator, updating from a build before #87 to
one from `main`; results in [manual-tests.md](../manual-tests.md). **Not verified:** Android 11 (API 30), the oldest
version the move runs on, wasn't run for lack of disk space, and no real phone with old pictures was tried.

**Links:** [hermux-name-update-path.md](../decisions/hermux-name-update-path.md), [changes entry](../../changes/2026-11-02-hermux-everywhere.md).
