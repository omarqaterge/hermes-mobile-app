# Hermux in every on-screen text

**State** (2026-11-02): the app's visible text says Hermux instead of Hermes: the web interface, the Android strings
(lock-screen shortcut, fingerprint prompt, clipboard labels), the plugin's messages that reach the app or a chat, and
the phone scripts' output. The spec, the browser checks and the unit tests follow the new wording. What stays Hermes,
and why, is in [hermux-where-it-shows.md](../decisions/hermux-where-it-shows.md).

Pictures saved with Save go to `Pictures/Hermux` (2026-11-02, the owner said "move it"). `PicturesFolder` moves the
pictures the app saved itself from `Pictures/Hermes` once after the update (Android 11+, MediaStore `RELATIVE_PATH`
update: a move, never a copy). On Android 10, and for any it can't move, pictures stay in `Pictures/Hermes`, as the
uninstall note says.

**Next:** redo README's top picture with the interface redo. Delete this file then.

**Needs a real phone:** a look through Setup, Settings, the approval prompt and the fingerprint sheet for any Hermes
left on screen. The picture move on Android 11 or newer: save a picture with the old build, update, check it is in
`Pictures/Hermux` once and `Pictures/Hermes` is empty (use test pictures, not the owner's). On Android 10, check old
pictures stay put.

**Links:** [hermux-name-update-path.md](../decisions/hermux-name-update-path.md), [changes entry](../../changes/2026-11-02-hermux-everywhere.md).
