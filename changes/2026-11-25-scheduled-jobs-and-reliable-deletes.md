---
rank: normal
---
- **Scheduled jobs now check your schedule before saving and confirm deletes.** The new-job and edit sheets show a live
  plain-words preview of when the job will run right above the Save button (staying visible above the keyboard), block
  unrecognised schedules instead of sending them, replace the unsupported "tomorrow 9am" chip with "in 30m", cancel the
  job if Hermux ever schedules a different time than requested, and confirm that deleted jobs are gone before saying
  "Deleted" while updating the side panel right away. Deleting a chat also closes detached sessions when needed, updates
  the saved chat list cache immediately, and ignores stale list refreshes so deleted chats do not come back. Verified
  with unit tests and browser end-to-end checks; not yet tried on a real phone.
