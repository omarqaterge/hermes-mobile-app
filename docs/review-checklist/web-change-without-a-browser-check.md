# A web change with no browser check

- paths: `^web/src/(?!.*\.test\.)`
- without: `^tools/web-e2e/checks/`

Each web change gets a browser check, at the end of its feature's file in `tools/web-e2e/checks/`. A unit test shows
a function works; the browser check shows the feature does, and it is the one a later change can't quietly break. If
the change truly has nothing a browser can see (a type, a comment, a rename), say so in the commit.
