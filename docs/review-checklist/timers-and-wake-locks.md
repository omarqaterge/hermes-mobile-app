# A timer, loop or wake lock

- paths: `^(android/src/|web/src/|hermes-plugin/|phone/)`
- adds: `setInterval\(|WakeLock|scheduleAtFixedRate|scheduleWithFixedDelay|postDelayed\(|AlarmManager|while (true|True|:)|time\.sleep\(`

Battery: no periodic loop or wake lock without a bound. Name what stops it (a count, a deadline, the screen going
off, the page being hidden) and check that it does stop on that path, including after an error. `docs/battery.md`
has how to measure when the change runs in the background.
