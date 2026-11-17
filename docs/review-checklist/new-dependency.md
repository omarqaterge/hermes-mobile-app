# A new or raised dependency

- paths: `(^|/)(package\.json|package-lock\.json|requirements[^/]*\.txt|build\.sh)$`
- adds: `^\s*"[@\w./-]+": "[\^~]?\d|^\s*[\w.-]+[=><~]=|maven|\.jar\b|\.aar\b`

The app runs with wide access on someone's phone, so each package is a risk taken for every user. Say in the pull
request why it is needed and what it pulls in, keep the version pinned by the lockfile, and check it makes no
network call of its own (install scripts and telemetry: `OPENUI_TELEMETRY_DISABLED` exists for that reason).
