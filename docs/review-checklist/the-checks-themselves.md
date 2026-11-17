# A change to what judges changes

- paths: `^(tools/(check|check_spec|check-attribution|check-verified|ci-changes|changelog|review_checklist|release-gate|java-check|api-check)\.(sh|py)$|\.github/workflows/|tools/web-e2e/(run\.sh|test\.cjs|lib\.cjs)$|docs/review-checklist/)`

A change must not loosen its own judge. Keep a change to a check, to CI or to this checklist in its own pull
request, apart from the code it would judge, and say in the pull request what the check now lets through that it
didn't before (or "nothing looser"). A check that started failing on correct code is fixed there, not switched off
here.
