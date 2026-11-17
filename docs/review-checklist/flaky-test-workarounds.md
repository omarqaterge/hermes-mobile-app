# A wait, skip or retry in a test

- paths: `(\.test\.(tsx?|js)$|^tools/test_(?!review_checklist)|^tools/web-e2e/)`
- adds: `\.skip\(|\.only\(|waitForTimeout\(|\bsleep\(\d|\bsleep \d|time\.sleep\(|xfail|unittest\.skip|retries\s*[:=]`

A test that sometimes fails is never skipped, slept or retried into passing: that teaches every later agent to
rerun instead of fix. Wait for the state (an element, a line in a log, a call in the mock's log), not for a time.
If the cause can't be found, delete the test and write the reason in the commit. A fixed wait that is really needed
(nothing must happen for a while) says so in a comment.
