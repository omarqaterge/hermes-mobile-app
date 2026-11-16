# Whether the installer still runs is checked, not timed

**Decided:** 2026-11-16.

An installer killed before it can send `FAIL` (Termux closed, Android stopping it, a restart) used to leave the app
reading "installing" for ever, which also paused plugin updates, automatic starts, the Shizuku keeper and the local-key
switch. A time limit was proposed and turned down: a limit can't tell a slow install from a dead one, so it would call
real installs on slow connections failed. Checking is preferred wherever the app can check.

**So:** the installer sends a beat (`ALIVE`, every 30 s) while it runs and the app reads a beating installer that goes
quiet as stopped (`SetupLines` `LOST`); the finished marker is removed when a run starts, so finding it means this run
finished; a copied command that sent nothing yet blocks nothing. Don't replace these with a fixed install time limit.
The only clock left is the beat's silence window (`LOST_MS`), which measures the installer's own signal, not install
length. Spec: 4.7 (`SetupLines`), 6.1 (`bootstrap.sh`).
