# How changes are verified here

Many agents work on this repository at once, and the owner can't read every line they write. What makes that safe
is not more review but checks that show a change works: a check an agent can run costs nothing the tenth time, and
it catches what a tired reader misses. So the checks are part of the product. This page says what they are, what
each one is good for, and the rules that keep them honest. The short rules are in [AGENTS.md](../AGENTS.md)
("Verify, and say how").

## What "done" means

A change is done when there is evidence it works, and the commit says what the evidence is:

1. **The checks pass:** `tools/check.sh` (what each one covers: spec [7.2](spec/07-02-every-tools-file.md),
   [7.3](spec/07-03-browser-e2e.md)), then CI on the pull request.
2. **The change was run,** not only its tests (next section).
3. **The checklist items it sets off were read** ([docs/review-checklist/](review-checklist/README.md)).
4. **The commit says how it was verified** (a `Verified:` line), including what could not be.

## Run the change

A passing test shows the test passes. Before calling a change finished, use the thing that changed:

| What changed | How to run it |
|---|---|
| The interface (`web/`) | `tools/web-e2e/run.sh --serve` builds it and leaves the page running against the mock Hermes; open the address it prints and use the feature, in both themes when it has colours. No phone needed. |
| The interface against a real Hermes | `adb forward tcp:9119 tcp:9119`, `python3 web/devserver.py`, open http://127.0.0.1:5180 (take the device lock first). |
| The plugin, the service, the event flow | `python3 tools/e2e.py` against a phone or emulator (device lock). |
| The Android shell | A build on a phone or emulator: `HM_DEVTOOLS=1 android/build.sh` makes one whose page can be driven from the computer. Reuse the installed release's build number. |
| Phone scripts (`phone/`) | Their `tools/test_*.sh`; the install itself only on a phone or emulator. |

What needs a phone and wasn't tried on one is said plainly ("not tried on a phone") in the commit, the pull request
and the workstream's status file, and goes in [docs/manual-tests.md](manual-tests.md) so someone with a phone can.

## Say how it was verified

Every commit's message has a `Verified:` line: what was run and looked at, and what could not be.

    Verified: tools/check.sh web (all passed); opened the sheet against the mock, both themes; not on a phone
    Verified: none (comment only)

`Verified: none` is an honest answer and better than no line: the reader then knows to look harder.
`tools/check-verified.sh` lists the commits of a branch without the line. Today it only reports
(`tools/check.sh` prints its list as a note); `--enforce` makes it fail, and it goes into CI only once the list of
what it would have stopped has been read and is short.

## The review checklist

Rules that no test enforces live in [docs/review-checklist/](review-checklist/README.md), one file each, with a
trigger read off the diff. `python3 tools/review_checklist.py` (and the end of `tools/check.sh`) prints only the
items a change sets off, usually none to three. Answer each in the pull request.

## When a check fails

- **Fix the cause.** Read the failure (the browser tests print the failed check's name, the mock keeps a call log),
  don't rerun until it passes.
- **Three rounds, then the owner.** A check that still fails after three attempts at a fix goes to the owner with
  what was tried and what was seen, in the pull request or the status file. Don't work around it.
- **A test that sometimes fails is a bug in the test or the code.** Never skip it, add a wait or a retry to get it
  green: every later agent learns from that to rerun instead of fix. Wait for a state, not for a time. When the
  cause can't be found, delete the test and say why in the commit; a test nobody trusts is worse than none.
- **Keep the checks fast.** A slow check gets run less. The heavier ones (the Hermes contract check, the release
  gate) run in CI or before a release, not on every edit.

## A change doesn't judge itself

- A change to a check, to CI or to the checklist goes in its own pull request, apart from code it would judge, and
  says what it now lets through that it didn't before.
- A change doesn't loosen or delete the test that fails on it, unless the behaviour changed on purpose: then the
  commit names the decision or the spec line.
- A review counts for the commit it read. After new commits, look again at what changed.

## When the checks miss something

A bug the owner finds, a revert, or the same remark on two pull requests means a check is missing. In that order:

1. **A test** that fails on the bug (a browser check for something users see), in the fix's pull request.
2. **A checklist item**, when no test can hold it and a diff can show it.
3. **A rule** in `AGENTS.md` or a decision in `docs/decisions/`, when neither can.

And prune: a rule a check now enforces, an item that never fires or always fires, a test that tests nothing. Rules
that are no longer true get deleted, not kept for safety.

## Which tests to write

- **Browser checks first** (`tools/web-e2e/checks/`). They follow what a user does, so they are hard to satisfy
  without the feature working, and a failure names the step. Every web change adds one.
- **Rules that must always hold** (property tests): instead of three examples, state the rule and run it over many
  generated inputs. Good for parsers, encoders and guards: text that goes through `scrub` never still holds a
  secret; a version turned into a build number and back is the same version; a queue never loses or doubles a
  message whatever the order of events. A fixed seed keeps a failure repeatable.
- **Two copies compared** (differential tests): when the same logic exists twice, run both on the same inputs and
  fail on any difference. The repository does this already: the Java, Python and shell copies of the local
  authentication agree through `tools/local-auth-vectors.json`, and `tools/hermes-contract/` compares the mock the
  browser tests use with the real pinned Hermes. Use the same shape for any rewrite: keep the old code until the
  new one gives the same answers.
