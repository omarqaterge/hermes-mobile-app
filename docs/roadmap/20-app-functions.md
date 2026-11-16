# 20: Apps' own actions (AppFunctions): a spike

Read [README.md](README.md) first. **This is not a feature design.** It is a time-boxed investigation (one to two
days with a phone on Android 16 or later) that ends in a short research note and a yes or no. Don't build a feature
from this file.

**Effort:** S (spike). **Areas:** Java (`BgHost`), plugin. **Needs:** a real phone on Android 16+, the device lock.

## Why look at this

Hermux uses other apps by looking at their screen and tapping (`phone_app`). Newer Android lets an app **publish
its actions as functions** ("create a note", "add an event") that an assistant can call directly, on the phone, with
typed arguments and a typed result. Where an app offers them, calling a function is faster, cheaper in tokens and
far more reliable than finding a button on a screen.

What is publicly said about it (from press and developer posts read on 2026-11-16, **not verified on a device**):

- The framework is in Android 16 with a library on top; wider support is expected with the next Android.
- Calling other apps' functions needs a permission that, by default, only the system's own assistant holds.
- A separate framework lets a preinstalled assistant drive apps on a hidden display, with a per-app permission
  dialog and a hand-over to the user; it is for preinstalled assistants only. Hermux's hidden screen through Shizuku
  is the open equivalent, and designs 09 and 10 borrow its two good rules.

## Questions the spike must answer

1. **Can the shell user call functions?** Hermux's `BgHost` runs as Android's shell user through Shizuku. Does the
   shell hold the execute permission, or is there a shell command for it? Try, in this order, through `rish`:
   - `cmd -l` and look for a service whose name mentions app functions; then its `help`.
   - `dumpsys` for that service (the container can't run `dumpsys`, the shell user can).
   - From `BgHost` (Java, `app_process`): obtain the manager with `Context.getSystemService` and call its search or
     execute method; record the exact exception.
   - `pm list permissions -g | grep -i function`, and whether `pm grant` can give the permission to Hermux's package
     (it can for "development" permissions only).
2. **How are functions discovered?** Where the list of functions and their schemas lives (the platform indexes them;
   find out whether the shell can query that index) and what one entry looks like.
3. **Which apps on a normal phone offer any?** List them on the test phone. If the answer is "two system apps", the
   feature can wait.
4. **What does a call look like?** Arguments, result, errors, time-outs, and whether the target app comes to the
   front or stays in the background.
5. **Does it work on the hidden display's user and state?** Calls are not tied to a display, so they should not need
   one; confirm.

Write down commands and outputs exactly (with package names of the user's own apps removed) in the research note.

## Decision gates

- **Shell can't execute functions:** stop. Write the note, add a line to `docs/comparison.md` ("apps' own actions:
  system assistants only"), and re-check when the next Android is out.
- **Shell can, but fewer than about five useful apps offer functions:** stop, same note, re-check in six months.
- **Shell can and useful apps exist:** write a real design (as a new file here) along the lines below, and take it
  to the owner.

## Sketch of the design, if the gates pass

- `phone_app` gains two actions, served by `BgHost`: `functions` (for an app: names, descriptions, argument
  schemas, capped at 30 entries and 6,000 characters) and `call` (`app`, `function`, `args`).
- The same rules as opening the app: the app's rule from design 10 (`never`, `ask`, `always`), the sensitive-app
  refusal, the cap on apps per reply. A call counts as using the app.
- A function that changes or sends something is the kind of step design 09 hands to the user. Functions carry no
  reliable "this is destructive" flag, so: every `call` asks the first time **per function per chat**, with the
  function's name and the arguments shown in plain form; `COMMIT_WORDS` applied to the function's name and
  description forces `your_turn`-style confirmation even under Full access.
- Results are outside data: wrapped and marked like phone data. If a function returns the user's personal data
  (notes, events), the chat becomes a protected chat like after a `phone_data` read; that needs the app, not the
  plugin, to record it, which is the hard part of the real design.
- The prompt tells the model to prefer a function over the screen when the app offers one for the step.

## The reverse direction: Hermux offering its own functions

An app can also *publish* functions. Hermux could offer "start a chat with this text" to the phone's assistant. This
is the automation hook the research note warns about (any caller could start an agent), with one difference: only a
holder of the execute permission can call it. If ever built, it must do no more than Share does today: open a new
chat with the text in the composer, **unsent**. It needs an owner decision and is not part of this spike.

## What the spike delivers

1. `docs/research/app-functions.md`: the answers to the five questions, with commands and outputs, the Android
   version and patch level tested, and the gate reached. No phone model, serial or personal data.
2. If the gates pass: a design file in this folder and a row in the README's table.
3. Nothing in `android/`, `hermes-plugin/` or `web/` is merged from the spike. Throwaway code stays on its branch.

## Check first

- Read the current platform documentation for the framework before starting: names and permissions here come from
  secondary sources and may be out of date.
- Take the device lock (`tools/device-lock.sh hold SERIAL WHO`) and install only a test build that reuses the
  installed build number.
