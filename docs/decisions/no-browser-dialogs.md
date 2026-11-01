# No browser dialogs

**Decided:** by the owner, with app 0.7.50.

`confirm()`, `prompt()` and `alert()` show a foreign "The page at file:// says" box on Android that the owner called hideous. Use `confirmDialog` / `promptDialog` from `web/src/dialog.tsx` (bottom-sheet look, `<DialogHost/>` in `App.tsx`; `match` makes a type-the-name delete).

**So:** Never call the browser dialogs; `AGENTS.md` repeats the rule.
