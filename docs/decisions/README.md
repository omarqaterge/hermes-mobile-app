# Decisions the owner made

One file per decision: what was decided, when, why, and what that means for the code (**So:**). They are the answers
to "should I change this?" that already exist; **don't undo one** without asking the owner.

- **Before changing a screen or a behaviour, read the decisions that touch it** (file names say the topic).
- **When the owner decides something,** add `docs/decisions/<short-name>.md` in the same PR: a title, **Decided:** (the
  date, or the app version when only that is known), the reason, and **So:** what to do or not do.
- The spec may repeat a rule next to the screen it shapes; this folder is the source, and the spec links here.
- A decision that changes: edit its file and say what changed and when; don't delete the history.
- No personal data: this repository is public.
