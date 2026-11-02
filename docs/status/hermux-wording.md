# Hermux in every on-screen text

**State** (2026-11-02): the app's visible text says Hermux instead of Hermes: the web interface, the Android strings
(lock-screen shortcut, fingerprint prompt, clipboard labels), the plugin's messages that reach the app or a chat, and
the phone scripts' output. The spec, the browser checks and the unit tests follow the new wording. What stays Hermes,
and why, is in [hermux-where-it-shows.md](../decisions/hermux-where-it-shows.md).

**Next:** with the interface redo, decide whether the phone folder `Pictures/Hermes` moves (the app would need to keep
finding pictures saved there before) and redo README's top picture. Delete this file then.

**Needs a real phone:** a look through Setup, Settings, the approval prompt and the fingerprint sheet for any Hermes
left on screen.

**Links:** [hermux-name-update-path.md](../decisions/hermux-name-update-path.md), [changes entry](../../changes/2026-11-02-hermux-everywhere.md).
