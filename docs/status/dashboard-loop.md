# Dashboard loop beside another dashboard

**State (2026-11-04):** fixed in `phone/hermes-services` (spec 6.2), tested with a stand-in for Hermes in
`tools/test_service_logs.sh`. What started the spin seen on a phone: its log showed 272 `loop_exit name=dashboard code=0`
lines, one about every 14 s for an hour. File times on that phone: `~/bin/hermes-services` was replaced by hand or by
`install.sh` (no `services.sha`), and a minute later every loop's pid file and start time are the same second, the second
before the first exit. No `dashboard-restart.log`, so not `hermes update`. So all loops were stopped while their dashboard
lived, and a new run started new loops. Who stopped them is inferred from that, not seen: replacing the script by hand
and stopping the loops to load it fits, and a loop's program survives if only the loop is killed.

On that phone `dash_answers` alone was run against the live dashboard: a reply in 15 ms, and no answer from a closed port.
The changed loop has not run on a phone.

**Next:** `hermes-debian --restart` matches the dashboard's command line. A dashboard started detached by `hermes update`
may not match it under proot (not tried), so a restart may leave that one running: check when working on `--restart`.

**Needs a real phone:**
- With a dashboard running and its loop killed, run `~/bin/hermes-services`: no new proot process, one line in
  `~/logs/dashboard.log`, no new `loop_exit`. Kill that dashboard: Hermes is back within about a minute plus its start.
- `hermes-debian --restart` and a plugin update still bring Hermes back as quickly as before.
- A dashboard busy for over 5 s reads as no reply: expect one extra Debian start and "already running", then the wait.

**Links:** [spec 6.2](../spec/06-02-hermes-services-the-supervisor-loops.md), `phone/hermes-services`.
