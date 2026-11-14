# Local authentication: verify the local server, never send the key

**Decided:** 2026-11-10, by the owner: this work is built on a separate branch and merged as one run close to the
release that ships it. The other points below are how it was built; the ones marked **open** wait for the owner.

Hermux, the Hermes plugin and the phone's helper scripts talk to each other over local connections on the phone, and
share one internal key (`~/.hermes-mobile/key`, kept by the app in `LocalKey`). This records how they use it.

**So:**

- **Challenge-response.** A client sends a fresh nonce; the server answers with a proof (HMAC-SHA256 under the key) over
  that nonce, its own nonce, its listening address and its role; only then does the client send its one request,
  signed the same way (`hermux-local-v1`, spec 2.3). Every side checks against the same test vectors
  (`tools/local-auth-vectors.json`).
- **The key itself is never sent** by any new client, to any port. A server that doesn't prove itself gets nothing but
  the hello, and the user is told in plain words when it matters (spec 4.3).
- **A compatibility window.** After the update that brings this, the servers keep accepting the key itself for a while,
  so an older plugin or older helper scripts keep working until the plugin update has replaced them. Nothing new uses
  it. Don't make the window longer or reopen it.
- **The window ends by itself** (`LocalKey.tick`), once the app's own state says it can: the plugin is current and
  speaks the hello, the last plugin run copied Termux's scripts, a request verified under the current key came from
  Termux since then, and nothing is being updated. The key is then replaced (`key_rotated why=enforce`), the new key and
  `~/.hermes-mobile/enforced` are written to Termux in one command, and once Termux uses the new key the app's own
  listener refuses the key itself too. Each step is recorded so a crash in between is picked up again.
- **A cap of 14 days.** If those conditions don't arrive within 14 days of the window's start (a held or hand-changed
  plugin), the window ends anyway and, when the last plugin run did not copy Termux's scripts, the setup check shows
  "Phone scripts out of date" (its button replaces a hand-changed plugin) until one does. The 14 days are counted in the
  phone's real running time from the first look once the phone is set up, kept across later app versions and started
  again after a downgrade; the wall clock plays no part, so a wrong clock can't bring the cap early. Each look counts
  at most the real time since the one before, so the cap never comes before 14 days of real time. Time switched off
  and the time from the last look to a shutdown are not counted, so it comes later than that on a phone that is off
  or restarted: while the window is open the app looks about hourly, so a phone awake enough for those looks and
  restarted every night gets there in about 15 days (up to about 16 to 18 when the nightly restart lands while Doze
  holds the hourly look back), one that is off half the time in about four weeks, and every phone that keeps running
  gets there.
- **Key replacement** happens at the end of the window, after every app update, and when a server sees the key itself
  after the window (`legacy_seen`, at most once a day). It is limited (one every 5 minutes, at most two keys valid at
  once, never dropping a key Termux may still use) so no burst of events can churn it; with the cap's row on it stops
  after three such replacements in a row (a sender that can't change would only trigger more), until a day passes
  without one or the app is updated.
- **Rollback** is a release with `LocalKey.ENFORCE` off: its key share removes the `enforced` file, and it forgets the
  switch's saved steps and the window, so a later release with it on waits for the conditions (or a new cap) again.
- **Never a dead end.** Reinstalling the app, clearing its data or Termux's, an interrupted update or a held plugin each
  have a way back (spec 2.3, "The compatibility window"); keep it that way. A downgrade to an app from before this
  stays cut off from Hermes after the switch until the app is updated again (the plugin says "Update the Hermux
  app"). A plugin that can't be updated at all leaves the app unable to talk to Hermes until it is fixed, so each
  release checks the plugin on the oldest Hermes it supports (spec 7.5).
- **The way out by hand**, for a phone stuck that way: in Termux, `rm ~/.hermes-mobile/enforced`. The dashboard
  guard and the cron ticker then accept the key itself again for anything that can read the key file; the app's own
  listener does not, and the app writes the file again with its next key share. A recovery step, not a setting.

**Not covered.** Something else holding one of the local ports still blocks that connection (the user is told and can
restart the phone); anything that can already read Termux's files, the Shizuku shell or the agent itself can read the
key; the installer's progress channel and the SSH server keep their own rules.

**Open** (defaults used until the owner decides): a scheduled key replacement and a "Reset" row in Settings (none); a
line in Settings while the window lasts (none, only the diagnostic log); the keeper's hello every round (as built);
fallback ports (not built).
