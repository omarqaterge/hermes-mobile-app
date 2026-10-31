# 10: Questions sheet: one question at a time, moving on by itself

Read [README.md](README.md) first.

## Goal

When Hermes asks several questions at once (a `clarify` request with a `questions` list), the sheet shows them one at
a time: `Question 2 of 3`, the question, its choices. Picking a choice in a single-choice question moves to the next
question by itself after a short pause. Back and Next move by hand. The last question has the **Answer** button.
A single question looks and works as today.

T3 Code: `apps/web/src/components/chat/ComposerPendingUserInputPanel.tsx` (one question at a time, auto-advance after
a single-select pick, digit shortcuts on desktop).

## What exists today

`web/src/components/RequestSheet.tsx`:
- `Clarify({ req })` builds `questions` (from `p.questions`, or one question from `p.question`/`p.choices`), keeps
  `answers` per `qid`, renders **all** questions in `.sheet-scroll` with `OneQuestion`, and has Skip / Answer
  (Answer enabled when every question has an answer). Multiple questions are answered with `{ answers }`, a single
  one with `{ answer }`.
- `OneQuestion({ q, value, onChange })`: choice buttons (`.choice`, `○`/`●`, or `☐`/`☑` for `multi_select`) and a
  textarea "Or type your own answer…".

Notification answers (plugin) are separate and don't change.

## Design

- Only when `questions.length > 1`:
  - A step header: `Question {i + 1} of {n}` and a row of `n` small dots (filled for answered questions, ring for the
    current one). The dots are buttons (aria-label `Go to question {k}`).
  - Only the current question is shown.
  - Picking a choice in a **single-choice** question (not `multi_select`) records it, then after 300 ms moves to the
    next unanswered question (or the next one if all are answered). Not on the last question. Typing in the textarea
    never auto-advances. A tap during the 300 ms on another choice restarts the timer with the new choice.
  - Buttons: **Back** (hidden on the first), **Next** (on all but the last; enabled always, so a question can be
    skipped and come back to), and on the last question **Answer** (enabled when all are answered, as today).
    **Skip** (send empty) stays on every step.
  - Android Back inside the sheet goes to the previous question when not on the first; on the first it does what it
    does today (check `RequestSheet`'s current Back behaviour and keep it).
- `haptic()` on each choice tap and each advance.
- Single question: unchanged.

## Implementation steps

1. In `Clarify`, add `const [step, setStep] = useState(0)` and a timer ref for the auto-advance; clear the timer on
   unmount and whenever `step` changes by hand.
2. Pass `onPicked?: () => void` to `OneQuestion`; call it after `onChange(c)` for single-choice taps only.
3. `next()` helper: first unanswered index after `step`, else `step + 1`, capped at `n - 1`.
4. Render the header, the current `OneQuestion`, and the step buttons when `n > 1`; keep today's markup when `n === 1`.
5. `useBackHandler(() => setStep(s => s - 1), n > 1 && step > 0)`, registered so it runs before the sheet's own
   handler (see `web/src/backstack.ts`: the most recently registered active handler wins; check that is the order).
6. CSS: `.clarify-steps`, `.clarify-dot`, `.clarify-dot.done`, `.clarify-dot.on`. Variables only.

## Tests

**Unit**: make `next(answers, questions, step)` a pure exported function (in `RequestSheet.tsx` or a small
`web/src/clarify.ts`) and test it: skips answered ones, wraps to the next index when all are answered, never past
the last.

**Mock**: prompt `/^ask me three$/` sending a `clarify` request with
`questions: [{ qid: 'a', question: 'Colour?', choices: ['Red', 'Blue'] }, { qid: 'b', question: 'Size?', choices: ['S', 'M'] }, { qid: 'c', question: 'Notes?', choices: null }]`
(id `srv-clarify-3`).

**E2E**:
1. `ask me three`: the sheet shows `Question 1 of 3` and `Colour?`, not `Size?`.
2. Tap `Blue`; within 1 s `Question 2 of 3` / `Size?` shows. Tap `M` → question 3.
3. `Back` → question 2 with `M` still selected (`.choice.on`).
4. Go to question 3, type `none`, tap `Answer`: the answer sent is
   `{ answers: { a: 'Blue', b: 'M', c: 'none' } }` (check the log like the existing clarify check does).
5. The existing single-question test (`ask me` → `Which colour?`) still passes unchanged.

## Spec and changelog

- `docs/SPEC.md` 3.6 "Request sheet" (the stepper, auto-advance, aria-label `Go to question {k}` written as it
  appears, Back behaviour).
- `CHANGELOG.md` entry.

## Out of scope

Digit keyboard shortcuts, changing how questions are answered from notifications.
