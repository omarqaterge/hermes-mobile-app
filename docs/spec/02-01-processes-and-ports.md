### 2.1 Processes and ports

```mermaid
flowchart LR
  subgraph app["Hermux app (Android, app uid)"]
    page["WebView page<br/>web/src (React)<br/>file:///android_asset/www/index.html"]
    act["MainActivity<br/>JS bridge HermesAndroid<br/>REST + media proxy"]
    svc["HermesService<br/>foreground service<br/>listener 127.0.0.1:9121"]
    page <-->|"bridge calls (keyed)<br/>window.__hm* callbacks"| act
    act <--> svc
  end
  subgraph termux["Termux (Termux uid)"]
    sup["~/bin/hermes-services<br/>run_loop restart loops"]
    keeper["app-keeper loop<br/>(every 300 s)"]
    hmsh["~/bin/hm-shizuku"]
    rish["~/bin/rish"]
    subgraph debian["proot Debian"]
      dash["hermes dashboard<br/>127.0.0.1:9119<br/>REST /api/* + WebSocket /api/ws (tui_gateway)"]
      plug["hermes-mobile plugin<br/>hooks + tools + /api/plugins/hermes-mobile/*"]
      tick["cron_ticker.py<br/>poke listener 127.0.0.1:9122"]
      msync["hermes_memory_sync.py<br/>(optional, every ~10 min)"]
      dash --- plug
    end
    sup --> dash
    sup --> tick
    sup --> msync
    sup --> keeper
  end
  subgraph shell["Shizuku server (shell uid)"]
    shz["Shizuku server"]
    bghost["BgHost<br/>127.0.0.1:(kernel-picked port, per-start token)"]
  end
  llm[("Model provider (HTTPS)")]

  page <-->|"JSON-RPC over ws://127.0.0.1:9119/api/ws?token=…"| dash
  act -->|"HTTP 127.0.0.1:9119 /api/*<br/>X-Hermes-Session-Token"| dash
  act -->|"RUN_COMMAND intent"| sup
  svc -->|"RUN_COMMAND: writes ~/.hermes-mobile/key"| termux
  plug -->|"hello, then POST /event signed (X-Hermux-Auth)"| svc
  tick -->|"POST /event wake_at / cron_idle"| svc
  svc -->|"key + newline (poke)"| tick
  hmsh -->|"POST /event shizuku-auto"| svc
  keeper -->|"am broadcast StartReceiver<br/>(only when 9121 is closed)"| svc
  plug -->|"rish → app_process"| bghost
  act -->|"HTTP + X-HM-Token (frames, close, hand over)"| bghost
  rish --> shz
  shz -->|"sendBinder → ShizukuProvider"| act
  dash -->|"HTTPS"| llm
```

| Process / endpoint | Runs as | Started by | Listens on | Who talks to it | Detail in |
|---|---|---|---|---|---|
| WebView page (`web/src`, entry `main.tsx`) | app uid, WebView renderer | `MainActivity.onCreate` → `loadUrl("file:///android_asset/www/index.html")` | nothing | `MainActivity` (bridge callbacks), Hermes (WebSocket) | 3, 2.6 |
| `MainActivity` (Java shell) | app uid, main process | the launcher, a notification tap, a share, a shortcut (`singleTask`) | nothing; intercepts `https://hm-media.invalid/m` requests inside the WebView | the page through the bridge | 4.1, 4.5 |
| `HermesService` (foreground service, type `specialUse`) | app uid, main process | `MainActivity.onCreate`/`onResume`, `BootReceiver` (boot / app update), `StartReceiver` (Termux app-keeper) | `127.0.0.1:9121` (`EventsListener`, role `events`): `POST /event` and `POST /phonedata` (the key: after the local authentication hello `GET /hermux/hello`, one request signed with `X-Hermux-Auth` on the same connection, or the raw key header while it is accepted), `POST /setup` (installer token), `GET /plugin-bundle/<token>` (one-time token) | the plugin, `cron_ticker.py`, `hm-shizuku`, `phone/bootstrap.sh` | 4.1, 4.3, 4.4 |
| Termux supervisor `~/bin/hermes-services` (`phone/hermes-services`) | Termux uid | `MainActivity.startHermesNow` (Termux `RUN_COMMAND`), Termux:Boot (`~/.termux/boot/10-hermes`), by hand | nothing | — | 6.1, 6.2 |
| Hermes dashboard (`hermes dashboard --host 127.0.0.1 --port 9119 --no-open`) | Termux uid inside proot Debian | the `dashboard` restart loop (10 s pause after a run of a minute or more, longer after quick exits, and no start while another dashboard answers: 6.2) | `127.0.0.1:9119`: HTML page with the session token, REST `/api/*`, WebSocket `/api/ws`; the plugin's `_TokenGuard` answers `GET /hermux/hello` and `GET /hermux/token` itself (local authentication, 2.3) and adds `X-Hermux-Proof` to `/api/` answers asked with `X-Hermux-Nonce` | the page (WebSocket), `MainActivity` and `HermesService` (the token by local authentication, then REST with `X-Hermux-Nonce`), the plugin's own `/approve` and `/stop` (WebSocket) | 6.2 |
| `tui_gateway` WebSocket `/api/ws` | inside the dashboard process | the dashboard | `ws://127.0.0.1:9119/api/ws?token=<session token>` | the page's `JsonRpcGatewayClient` (`gateway.ts`) | 2.2 (flows), table "Gateway RPCs" below |
| Hermux plugin (`hermes-plugin/hermes-mobile`) | inside every Hermes process (dashboard, agent runtimes) | Hermes's plugin loader | its REST routes are mounted at `/api/plugins/hermes-mobile/*` on 9119 | Hermes (hooks/tools), the app (REST) | 5 |
| Cron ticker (`hermes-plugin/hermes-mobile/cron_ticker.py`) | Termux uid inside proot Debian | the `cron-ticker` restart loop | `127.0.0.1:9122`, a poke by local authentication's line protocol (`HELLO`, `HERMUX`, `POKE`; 2.3) or, until `~/.hermes-mobile/enforced` exists, the event key plus a newline; retried with a back-off while the port is in use | `HermesService.pokeTicker` | 6.1 |
| Memory sync (`phone/hermes_memory_sync.py`) | Termux uid inside proot Debian | the `memory-sync` loop, only if `/root/.hermes/scripts/hermes_memory_sync.py` exists | nothing | — | 6.1 |
| app-keeper loop | Termux uid | `hermes-services` | nothing; probes `127.0.0.1:9121` with bash `/dev/tcp` every 300 s, then verifies it with `hm-local hello events` | sends `am broadcast -n com.omarqaterge.hermesmobile/.StartReceiver -f 32` only when 9121 doesn't answer or doesn't verify | 6.2 |
| `sshd` | Termux uid | `hermes-services`, if Termux has `sshd` and none runs | Termux's default SSH port | the user | 6.2 |
| Shizuku server + `rish` | shell uid | the Shizuku app; restarted by `ShizukuKeeper` + `hm-shizuku` | Shizuku's binder | `rish` (Hermes's phone commands), `ShizukuProvider` (gets its binder) | 4.7, 6.1 |
| `BgHost` (`android/src/com/omarqaterge/hermesmobile/bg/BgHost.java`) | shell uid via `rish` → `app_process` | the plugin's `phone_app` tool, on demand; exits after 2 idle minutes | `127.0.0.1:<port>`: the port argument (`0` from `phone_app`: the kernel picks one, printed in `LISTENING <port> <kid>`; `9131` without one, for `tools/test_bghost.sh`); a hello then one request with `X-Hermux-Auth` (`LocalServer`, role `bghost`, the per-start token as the key), or one request with `X-HM-Token` unless it was started with `HM_AUTH=mac` | the plugin, `MainActivity.bgRequest`, `HermesService.fetchBgThumb` (a hello first when the `bgapp` event says `"auth":"mac"`) | 4.7, 5.2 |

Other helpers on the phone: Termux:API (the `termux-*` commands, linked into Debian; the plugin's fallback
notification uses `termux-notification`) and Termux:Boot (runs `~/.termux/boot/10-hermes` after a reboot). Both
are installed by the installer (6.3).

One Hermes dashboard serves every Hermes profile. The page adds the open profile to every gateway call
(`rpc` in `gateway.ts` sends `{ profile, ...params }`) and to every REST call (`api` in `api.ts` appends
`profile=` unless told not to).
