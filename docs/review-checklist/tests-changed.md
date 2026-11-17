# A test removed or loosened

- paths: `(\.test\.(tsx?|js)$|^tools/test_|^tools/web-e2e/checks/|^tools/hermes-contract/)`
- removes: `\b(check|expect|assert\w*|ok|fail|eq|it|test)\(|^\s*(check|assert|fail|ok)\b`

A change that edits the test judging it needs a reason a reviewer can check. Say in the commit which expectation
went and why it was wrong (the behaviour changed on purpose, with the decision or spec line), not only that the test
now passes.
