#!/usr/bin/env python3
"""Repeatable battery benchmark for Hermes on the phone (see docs/battery-report.md for the method).

    python3 tools/battery/bench.py idle  --secs 180 --tag before      # app as it is now
    python3 tools/battery/bench.py chat  --runs 3 --tag before        # app in front: new chat, fixed prompt
    python3 tools/battery/bench.py cron  --runs 3 --tag before        # temporary one-shot job, app in background
    python3 tools/battery/bench.py report out/battery/*.json

Needs ANDROID_SERIAL (when several devices are listed) and tools/phone working. Measures from the adb shell
user (tools/battery/hmsamp.sh), so the sampler's own CPU is not counted against Termux or the app. Results go to
out/battery/<tag>-<kind>-<n>.json (+ the raw capture). Chats and jobs it creates are deleted afterwards.
"""
import argparse
import datetime as dt
import json
import os
import re
import shlex
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = ROOT / "out" / "battery"
sys.path.insert(0, str(HERE))
import hmreport  # noqa: E402

PKG = "com.omarqaterge.hermesmobile"
RT = "/data/local/tmp"
ROOTFS = "$PREFIX/var/lib/proot-distro/containers/debian/rootfs"
CHAT_PROMPT = ("Battery benchmark: run the shell command uname -a with the terminal tool, then use write_file to save "
               "its output to /tmp/hm-bench.txt, then reply with one short sentence.")
CRON_PROMPT = ("Battery benchmark job: run the shell command uname -a with the terminal tool, then use write_file to "
               "save its output to /tmp/hm-cron-bench.txt, then reply with one short sentence.")
SLEEP_PROMPT = ("Battery benchmark: run the shell command sleep 45 with the terminal tool, then reply with the single "
                "word done.")
TAIL = 60  # seconds measured after the turn ends and the wake lock is gone


def sh(cmd, timeout=60, check=False):
    r = subprocess.run(["adb", "shell", cmd], capture_output=True, text=True, timeout=timeout)
    if check and r.returncode:
        raise RuntimeError(f"adb shell {cmd!r}: {r.stderr.strip()}")
    return r.stdout


def phone(cmd, timeout=60):
    return subprocess.run([str(ROOT / "tools" / "phone"), cmd], capture_output=True, text=True, timeout=timeout).stdout


def api(method, path, body=None):
    args = [str(ROOT / "tools" / "api"), method, path] + ([json.dumps(body)] if body is not None else [])
    r = subprocess.run(args, capture_output=True, text=True, timeout=90)
    try:
        return json.loads(r.stdout)
    except ValueError:
        return {"_raw": r.stdout, "_err": r.stderr}


def uids():
    out = sh("pm list packages -U")
    get = lambda p: int(re.search(rf"package:{re.escape(p)} uid:(\d+)", out).group(1))  # noqa: E731
    return get("com.termux"), get(PKG)


class Capture:
    def __init__(self, name):
        self.name = name
        self.tu, self.au = uids()

    def start(self):
        subprocess.run(["adb", "push", str(HERE / "hmsamp.sh"), str(HERE / "hmnet.sh"), RT + "/"], capture_output=True)
        self.net0 = self._net()
        sh(f"rm -f {RT}/{self.name}.stop {RT}/{self.name}.txt; "
           f"nohup sh {RT}/hmsamp.sh {RT}/{self.name}.txt {RT}/{self.name}.stop 1 {self.tu} {self.au} >/dev/null 2>&1 &")
        self.t0 = time.time()
        time.sleep(3)

    def lock(self):
        last = sh(f"grep '^T' {RT}/{self.name}.txt | tail -1").split()
        return bool(last) and last[-1] not in ("W0", "W")

    def stop(self):
        sh(f"touch {RT}/{self.name}.stop")
        time.sleep(4)
        self.net1 = self._net()
        OUT.mkdir(parents=True, exist_ok=True)
        self.path = OUT / f"{self.name}.txt"
        subprocess.run(["adb", "pull", f"{RT}/{self.name}.txt", str(self.path)], capture_output=True)
        sh(f"rm -f {RT}/{self.name}.txt {RT}/{self.name}.stop")
        return self.path

    def _net(self):
        out = sh(f"sh {RT}/hmnet.sh {self.tu} {self.au}", timeout=120)
        return {int(a): (int(b), int(c)) for a, b, c in (l.split() for l in out.splitlines() if l.strip())}

    def net(self):
        return {("termux" if u == self.tu else "app"): {"rx": self.net1[u][0] - self.net0[u][0],
                                                          "tx": self.net1[u][1] - self.net0[u][1]} for u in self.net0}


def wait(cond, secs, step=2.0):
    end = time.time() + secs
    while time.time() < end:
        if cond():
            return True
        time.sleep(step)
    return False


def status_log(since):
    """Plugin trace lines (HH:MM:SS, no date) since an epoch time, as (epoch, text): walks back from the end."""
    raw = phone(f"tail -n 400 {ROOTFS}/root/.hermes/logs/mobile-status.log")
    day = dt.datetime.fromtimestamp(since).date()
    out = []
    for line in reversed(raw.splitlines()):
        m = re.match(r"(\d\d):(\d\d):(\d\d) (.*)", line)
        if not m:
            continue
        t = dt.datetime.combine(day, dt.time(int(m[1]), int(m[2]), int(m[3]))).timestamp()
        if t < since - 1 or t > time.time() + 5:  # older, or yesterday's line
            break
        out.append((t, m[4]))
    return out[::-1]


def focus():
    return sh("dumpsys window | grep mCurrentFocus").strip()


def analyse(path, t_from=None, t_to=None):
    samples, rend = hmreport.parse(path)
    w = hmreport.window(samples, t_from, t_to)
    return hmreport.summarize(w, rend) if len(w) >= 2 else None


def save(name, data):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{name}.json").write_text(json.dumps(data, indent=1))
    print(f"→ {OUT / (name + '.json')}")


# ── scenarios ───────────────────────────────────────────────

def run_idle(a):
    cap = Capture(f"{a.tag}-idle")
    cap.start()
    time.sleep(a.secs)
    path = cap.stop()
    r = analyse(path)
    r.update(kind="idle", net=cap.net(), focus=focus())
    save(f"{a.tag}-idle", r)
    print(json.dumps({k: r[k] for k in ("wall", "cpu", "cpu_total", "lock_s")}, indent=1))


def send_button():
    """The composer's send button: bottom-right of the screen, above the gesture bar (from `wm size`)."""
    m = re.search(r"(\d+)x(\d+)", sh("wm size").splitlines()[-1])
    w, h = int(m[1]), int(m[2])
    return int(w * 0.912), int(h * 0.940)


def run_chat(a):
    """A new chat per run with a fixed prompt. --via ws: the gateway client tools/battery/wschat.py (works with the
    phone locked; the app is not drawing the reply). --via ui: the app's share intent + a tap on Send (unlocked phone,
    app in front), so the WebView's streaming cost is included."""
    for n in range(1, a.runs + 1):
        name = f"{a.tag}-chat-{n}"
        cap = Capture(name)
        cap.start()
        time.sleep(a.pre)
        marks, client, sid = {}, None, None
        if a.via == "ws":
            client = subprocess.Popen([sys.executable, str(HERE / "wschat.py"), a.prompt_text], stdin=subprocess.PIPE,
                                      stdout=subprocess.PIPE, text=True)
            for line in client.stdout:
                ev = json.loads(line)
                marks[ev["ev"]] = ev
                if ev["ev"] in ("complete", "error"):
                    break
            sid = marks.get("created", {}).get("stored")
            t_send, t_end = marks["sent"]["t"], (marks.get("complete") or marks.get("error"))["t"]
        else:
            x, y = (int(v) for v in a.send.split(",")) if a.send else send_button()
            t_send = time.time()
            sh(f"am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "
               f"{shlex.quote(a.prompt_text)} -n {PKG}/.MainActivity")
            wait(lambda: PKG in focus(), 15, 0.5)
            time.sleep(2.0)
            if "mInputShown=true" in sh("dumpsys input_method | grep mInputShown"):
                sh("input keyevent KEYCODE_BACK")  # the shared draft focuses the composer: close the keyboard first
                time.sleep(1.0)
            if PKG not in focus():
                raise RuntimeError(f"the app is not in front: {focus()}")
            sh(f"input tap {x} {y}")
            wait(cap.lock, 40, 1)
            wait(lambda: not cap.lock(), 600, 2)
            log = status_log(t_send)
            sid = next((re.search(r"stream_start (\S+)", t).group(1) for _, t in log if "stream_start" in t), None)
            ends = [t for t, s in log if sid and s.startswith(f"session_end {sid}") and "turn=None" not in s]
            t_end = ends[0] if ends else time.time()
        released = wait(lambda: not cap.lock(), 600, 2)
        t_unlock = time.time()
        time.sleep(TAIL)
        t_close = time.time()
        if client:
            client.stdin.write("done\n")
            client.stdin.flush()
            for line in client.stdout:
                ev = json.loads(line)
                marks[ev["ev"]] = ev
            client.wait(60)
            time.sleep(15)
        path = cap.stop()
        log = status_log(t_send - 5)
        r = analyse(path)
        r.update(kind="chat", via=a.via, run=n, session=sid, t_send=t_send, t_end=t_end, t_unlock=t_unlock,
                 t_close=t_close, released=released, net=cap.net(), marks=marks, turn_wall=t_end - t_send,
                 lock_after_reply=max(0.0, t_unlock - t_end),
                 turn=analyse(path, t_send - 1.5, t_end + 1.5),
                 after=analyse(path, t_end + 1.5, t_close),
                 close=analyse(path, t_close, None) if client else None,
                 log=[(round(t - t_send, 1), s) for t, s in log][:80])
        save(name, r)
        print(f"run {n}: chat {sid} turn {r['turn_wall']:.1f}s window cpu {r['cpu_total']:.1f}s "
              f"turn cpu {r['turn']['cpu_total']:.1f}s lock {r['lock_s']}s deleted={'deleted' in marks}")


def run_cron(a):
    """A temporary one-shot agent job per run (the alarm path: due in --lead s, app in the background)."""
    for n in range(1, a.runs + 1):
        name = f"{a.tag}-cron-{n}"
        due = dt.datetime.now().astimezone() + dt.timedelta(seconds=a.lead)
        job = api("POST", "/api/cron/jobs", {"name": f"battery-bench-{n}", "prompt": CRON_PROMPT,
                                              "schedule": due.isoformat(timespec="seconds"), "deliver": "local"})
        jid = job.get("id") or (job.get("job") or {}).get("id")
        if not jid:
            sys.exit(f"could not create the test job: {job}")
        print(f"run {n}: job {jid} due {due:%H:%M:%S}")
        cap = Capture(name)
        cap.start()
        try:
            wait(lambda: cap.lock(), a.lead + 120, 2)  # the alarm fires at the due time
            t_alarm = time.time()
            runs = {}

            def done():
                nonlocal runs
                runs = api("GET", f"/api/cron/jobs/{jid}/runs")
                items = runs if isinstance(runs, list) else runs.get("runs") or runs.get("items") or []
                return any((it.get("status") in ("completed", "failed", "ok", "error")) for it in items if isinstance(it, dict))
            wait(done, 600, 10)
            wait(lambda: not cap.lock(), 300, 2)
            t_unlock = time.time()
            time.sleep(TAIL)
        finally:
            path = cap.stop()
            api("DELETE", f"/api/cron/jobs/{jid}")
        r = analyse(path)
        r.update(kind="cron", run=n, job=jid, due=due.timestamp(), t_alarm=t_alarm, t_unlock=t_unlock, net=cap.net(),
                 runs=runs, run_window=analyse(path, due.timestamp() - 2, t_unlock + 1.5),
                 after=analyse(path, t_unlock + 1.5, None))
        save(name, r)
        print(f"run {n}: cpu {r['cpu_total']:.1f}s lock {r['lock_s']}s")


def run_report(a):
    rows = []
    for p in a.files:
        d = json.loads(Path(p).read_text())
        rows.append((Path(p).stem, d))
    for name, d in rows:
        t = d.get("turn") or d.get("run_window") or d
        print(f"{name:24} wall {d['wall']:6.1f}  cpu {d['cpu_total']:6.2f}  lock {d['lock_s']:6.1f}  "
              f"turn_wall {d.get('turn_wall') or 0:6.1f}  turn_cpu {t['cpu_total'] if t else 0:6.2f}  "
              f"net {json.dumps(d.get('net'))}")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("idle")
    p.add_argument("--secs", type=int, default=180)
    p.add_argument("--tag", default="run")
    p = sub.add_parser("chat")
    p.add_argument("--runs", type=int, default=3)
    p.add_argument("--tag", default="run")
    p.add_argument("--pre", type=float, default=10)
    p.add_argument("--send", help="x,y of the send button (default: from the screen size)")
    p.add_argument("--via", choices=("ws", "ui"), default="ws")
    p.add_argument("--prompt", choices=("tools", "sleep"), default="tools",
                   help="tools: a terminal call + a file write (default); sleep: one 45 s command (the UI's cost while it waits)")
    p = sub.add_parser("cron")
    p.add_argument("--runs", type=int, default=3)
    p.add_argument("--tag", default="run")
    p.add_argument("--lead", type=int, default=100)
    p = sub.add_parser("report")
    p.add_argument("files", nargs="+")
    a = ap.parse_args()
    a.prompt_text = SLEEP_PROMPT if getattr(a, "prompt", "") == "sleep" else CHAT_PROMPT
    {"idle": run_idle, "chat": run_chat, "cron": run_cron, "report": run_report}[a.cmd](a)


if __name__ == "__main__":
    main()
