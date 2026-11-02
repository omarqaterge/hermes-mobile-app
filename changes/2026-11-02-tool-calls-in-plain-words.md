---
rank: normal
---
- **Tool calls in plain words.** Tool cards say what Hermes did ("Ran git", "Read", "Edited", "Searched the web") instead of the tool's internal name, commands show without their `bash -lc` wrapper, and a folded run reads "Ran 2 commands and read 1 file · 6s" instead of "Ran 3 tools". A closed thought shows its first line, a task-list call shows its steps with ✓ / ◐ / ○ and "1/2 done" instead of JSON, and large diff counts are shortened (`+1.2k`). Checked in the browser tests; not yet seen on a phone.
