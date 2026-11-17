# The Hermes protocol or its mock

- paths: `^(web/src/gateway\.ts|web/vendor/hermes-shared/|tools/web-e2e/mock\.cjs)`

The browser tests run against `tools/web-e2e/mock.cjs`, so they only prove what the mock gets right. A changed or
new call needs the mock and the real pinned Hermes to agree: `tools/hermes-contract/run.sh` checks it, in CI only,
so look at that job's result before merging rather than at the local summary.
