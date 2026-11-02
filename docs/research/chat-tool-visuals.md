# Showing agent work in chat: patterns, and what we took

Notes written 2026-11-02 on how a chat can show an agent's tool calls so they read at a glance. The ideas below were
written for Hermes's tool names in `web/src/toolsay.ts`.

## Patterns that work

- **One quiet line per tool call.** No card around a tool: a 24 px row, a muted icon, a truncated label and a chevron.
  The label is a verb with the object: "Ran git" (the program, with `bash -lc` and `sudo` wrappers stripped),
  "Running npm", "Failed git", a read file's path, a search's query. Opening a row shows the command, details and
  output in a height-capped, scrolling monospace block; output is fetched when opened.
- **Groups summed up in words.** Consecutive calls fold into one row: "Ran 2 commands and changed 3 files", "Read 3
  files", "Searched code 2 times", with "performed N other actions" for the rest. Edits count files, not calls. At
  most two kinds are named, commands and edits first. A group of one shows the call itself.
- **Finished turns fold away.** Everything between the question and the final answer hides behind "Worked for 1m 12s"
  ("You stopped after 12s" when interrupted).
- **One live row while working.** Only the running call shows, with a shimmer and the latest thought's heading or
  first sentence; "Working for 12s" ticks without re-rendering React.
- **Thinking in one line.** A closed thought shows its first line; open, the full Markdown. Reasoning-only groups read
  "Thought (×3)".
- **Changed files card** under the answer: "N changed files +A −D" (counts compacted, `1.2k`), a folder tree, tap a
  file for its diff in a side panel.
- **Task lists** as one line per step with ✓ / ◉ / ○; proposed plans as a Markdown card that collapses past 20 lines.
- **Small things:** failures dim the icon and add a small ✕ (not a red label) and say "tool call failed" to screen
  readers; timestamps only on hover; expanded state remembered per row.

## What Hermes Mobile already had

Most of the structure: tool cards that open on tap ([3.3](../spec/03-03-messages.md)), runs of 3+ calls folded into
"Ran 7 tools · 42s", a changed-files card per turn with per-file diffs, the turn's duration in the reply's stats, a
live elapsed timer in the status bar, a reasoning block with a live peek, and the task list in the status bar.

## What fits a phone, and what we took

| Idea | Taken? | Why |
|---|---|---|
| Plain-words card titles ("Ran git", "Read", "Edited", "Searched the web") | **Yes** (`toolTitle`) | Raw names like `search_files` mean little to most Hermes users. The raw name stays next to "Arguments" in the open card. |
| Commands without their shell wrapper as the card's label | **Yes** (`commandText`, `programName`) | Saves width on a 380 px screen. Hermes's own context line still wins when it sends one. |
| Run summary in words ("Ran 2 commands and read 1 file · 6s") | **Yes** (`runSummary`) | Says what happened without opening the run. |
| A closed thought's first heading or sentence on one line | **Yes** (`thoughtLine`) | One glance tells whether a thought is worth opening. The live peek shows the latest heading or sentence instead of the last 160 characters. |
| Task-list calls as steps with ✓ / ◐ / ○ and "1/2 done" | **Yes** (`todoSteps`) | The card used to show the same list as JSON twice. |
| Compact, aligned diff counts (`+1.2k`) | **Yes** (`compactCount`, tabular figures) | Big rewrites no longer push the row wider. |
| "failed" for screen readers on a failed call | **Yes** | Cheap accessibility. |
| Fold a whole finished turn behind "Worked for 1m 12s" | Not now | Our folding is per run and message search finds items by position; folding text replies too needs a design pass on the revamp. The duration is already in the stats line. |
| Borderless 24 px rows instead of cards | No | 24 px is below a comfortable touch target; our cards are 40 px and the folded run line 44 px. |
| Shimmer on the live row | No | An always-running animation costs battery; the spinner stops with the call. |
| Folder tree of changed files, side diff panel | No | Desktop layouts. Our flat list with short paths and a full-screen diff sheet fits a phone better. |
| Hover timestamps | No | No hover on a phone; we show times on tap. |
