# Review checklist: only the items a change touches

One file per rule that a reviewer (a person or an agent) should hold a change against and that no test enforces. Each
item names a trigger that can be read off the diff, so a change is checked against the few items it can break, not
all of them:

    python3 tools/review_checklist.py

`tools/check.sh` prints the same list after its summary. Nothing here fails a change: it is what to read before the
pull request, and what the pull request should answer.

## An item

`docs/review-checklist/<name>.md`: a `# Title`, the trigger lines, then what to check and why.

    - paths: `REGEX`      (required) a changed file's path matches
    - adds: `REGEX`       a line the change adds in such a file matches
    - removes: `REGEX`    a line the change removes from such a file matches
    - without: `REGEX`    no changed file's path matches (for "changed X but not Y")

`python3 tools/review_checklist.py --check` (CI) fails on an item without a title, a `paths` trigger or text, or with
a bad regular expression; `--all` lists every item with its trigger.

## Adding and removing items

- **Add one when the same miss happened twice:** something the owner had to point out in two pull requests, or two
  reverts with one cause, that a diff can show. Say in the item what went wrong.
- **Prefer a test.** A rule a check can enforce belongs in `tools/` or CI, not here; when one gets a check, delete
  its item.
- **Remove what never fires or always fires.** An item that matches most changes is noise and gets skipped; narrow
  its trigger or delete it.
