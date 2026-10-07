#!/usr/bin/env python3
"""Summarise a hmsamp.sh capture: CPU seconds per group (Debian processes, proot, other Termux, app, WebView
renderer), the busiest threads, how long `hermes:working` was held, and a CPU timeline.

    python3 tools/battery/hmreport.py capture.txt [--from EPOCH] [--to EPOCH] [--timeline] [--json]

CPU per process = utime+stime+cutime+cstime (children reaped by a sampled parent land in its cutime). A process
that appears during the window counts in full; one that appears and dies between samples counts through its
parent. 100 ticks = 1 CPU second.
"""
import argparse
import json
import sys
from collections import defaultdict

HZ = 100


def parse(path):
    samples, rend = [], None
    cur = None
    for line in open(path, errors="replace"):
        kind, _, rest = line.rstrip("\n").partition(" ")
        if kind == "R":
            rend = rest.strip() or None
        elif kind == "T":
            up, epoch, w = rest.split()
            cur = {"up": float(up), "t": float(epoch), "lock": w == "W1" or (w.startswith("W") and w[1:] not in ("", "0")),
                   "p": {}, "h": {}}
            samples.append(cur)
        elif kind == "P" and cur is not None:
            st = stat(rest)
            if st:
                cur["p"][st["pid"]] = st
        elif kind == "H" and cur is not None:
            owner, _, s = rest.partition(" ")
            st = stat(s)
            if st:
                cur["h"][(int(owner), st["pid"])] = st
    # A capture pulled while running ends with a half-written sample.
    if len(samples) > 2 and len(samples[-1]["p"]) < 0.8 * len(samples[-2]["p"]):
        samples.pop()
    return samples, rend


def stat(s):
    try:
        l, r = s.index("("), s.rindex(")")
        pid, comm, f = int(s[:l]), s[l + 1:r], s[r + 2:].split()
        # f[0]=state f[1]=ppid ... utime=f[11] stime=f[12] cutime=f[13] cstime=f[14] starttime=f[19]
        return {"pid": pid, "comm": comm, "ppid": int(f[1]), "u": int(f[11]), "s": int(f[12]), "cu": int(f[13]),
                "cs": int(f[14]), "start": int(f[19])}
    except (ValueError, IndexError):
        return None


def total(st):
    return st["u"] + st["s"] + st["cu"] + st["cs"]


def root_proot(st, procs):
    seen, p, found = set(), st, None
    while p and p["pid"] not in seen:
        seen.add(p["pid"])
        if p["comm"] == "proot":
            found = p["pid"]  # keep walking: the outermost proot is the session
        p = procs.get(p["ppid"])
    return found


def labels(samples):
    """proot pid -> 'dash' (runs `hermes dashboard`, main thread named hermes) / 'ticker' (has a cron-ticker thread)."""
    procs, out = {}, {}
    for s in samples:
        procs.update(s["p"])
    for s in samples:
        for pid, st in s["p"].items():
            if st["comm"] == "hermes":
                out[root_proot(st, procs)] = "dash"
        for (owner, _tid), st in s["h"].items():
            if st["comm"] == "cron-ticker" and owner in procs:
                out[root_proot(procs[owner], procs)] = "ticker"
    return out


def group(st, rend, procs, lab=None):
    if rend and str(st["pid"]) == rend:
        return "app.renderer"
    if st["comm"].endswith("hermesmobile"):  # the kernel keeps the last 15 chars of the package name
        return "app.main"
    root = root_proot(st, procs)
    if root is None:
        return "termux.other"
    name = (lab or {}).get(root, "transient")  # memory sync, tools, anything started by hand
    return f"{name}.{'proot' if st['comm'] == 'proot' else 'py'}"


def window(samples, t0=None, t1=None):
    a = [s for s in samples if t0 is None or s["t"] >= t0]
    a = [s for s in a if t1 is None or s["t"] <= t1]
    return a


def summarize(samples, rend):
    first, last = samples[0], samples[-1]
    allp = {}
    for s in samples:
        allp.update(s["p"])
    groups = defaultdict(int)
    per = defaultdict(int)
    lab = labels(samples)
    for pid, st in last["p"].items():
        g = group(st, rend, allp, lab)
        if pid in first["p"] and first["p"][pid]["start"] == st["start"]:
            d = total(st) - total(first["p"][pid])
        else:
            d = total(st)  # new during the window
        groups[g] += d
        per[(g, st["comm"], pid)] += d
    # Debian python vs its children: python's cutime is the children
    threads = defaultdict(int)
    for key, st in last["h"].items():
        if key in first["h"] and first["h"][key]["start"] == st["start"]:
            d = st["u"] + st["s"] - first["h"][key]["u"] - first["h"][key]["s"]
        else:
            d = st["u"] + st["s"]
        owner = last["p"].get(key[0], {}).get("comm", "?")
        threads[f"{owner}/{key[0]}:{st['comm']}"] += d
    children = defaultdict(int)
    for pid, st in last["p"].items():
        if pid in first["p"] and first["p"][pid]["start"] == st["start"]:
            children[f"{st['comm']}/{pid}"] = (st["cu"] + st["cs"]) - (first["p"][pid]["cu"] + first["p"][pid]["cs"])
    lock = 0.0
    lock_on = [s["t"] for s in samples if s["lock"]]
    for a, b in zip(samples, samples[1:]):
        if a["lock"] and b["lock"]:
            lock += b["t"] - a["t"]
        elif a["lock"] != b["lock"]:
            lock += (b["t"] - a["t"]) / 2
    return {
        "wall": last["t"] - first["t"],
        "cpu": {g: v / HZ for g, v in sorted(groups.items())},
        "cpu_total": sum(groups.values()) / HZ,
        "lock_s": round(lock, 1),
        "lock_first": lock_on[0] if lock_on else None,
        "lock_last": lock_on[-1] if lock_on else None,
        "threads": sorted(((k, v / HZ) for k, v in threads.items() if v), key=lambda kv: -kv[1])[:15],
        "children": sorted(((k, v / HZ) for k, v in children.items() if v), key=lambda kv: -kv[1])[:6],
        "procs": sorted(((f"{g} {c}/{p}", v / HZ) for (g, c, p), v in per.items() if v), key=lambda kv: -kv[1])[:12],
    }


def timeline(samples, rend):
    allp = {}
    for s in samples:
        allp.update(s["p"])
    lab = labels(samples)
    out = []
    for a, b in zip(samples, samples[1:]):
        g = defaultdict(int)
        for pid, st in b["p"].items():
            prev = a["p"].get(pid)
            d = total(st) - total(prev) if prev and prev["start"] == st["start"] else total(st)
            g[group(st, rend, allp, lab)] += d
        out.append((b["t"], b["lock"], dict(g)))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("capture")
    ap.add_argument("--from", dest="t0", type=float)
    ap.add_argument("--to", dest="t1", type=float)
    ap.add_argument("--timeline", action="store_true")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    samples, rend = parse(a.capture)
    samples = window(samples, a.t0, a.t1)
    if len(samples) < 2:
        sys.exit("not enough samples")
    r = summarize(samples, rend)
    if a.json:
        print(json.dumps(r))
        return
    print(f"wall {r['wall']:.1f}s  cpu {r['cpu_total']:.2f}s  lock {r['lock_s']}s")
    for g, v in r["cpu"].items():
        print(f"  {g:14} {v:7.2f}s")
    print("threads:")
    for k, v in r["threads"]:
        print(f"  {v:7.2f}s  {k}")
    print("reaped children (cutime):")
    for k, v in r["children"]:
        print(f"  {v:7.2f}s  {k}")
    if a.timeline:
        t0 = samples[0]["t"]
        for t, lock, g in timeline(samples, rend):
            print(f"  +{t - t0:6.1f}s {'L' if lock else ' '} " + " ".join(f"{k.split('.')[-1]}={v}" for k, v in sorted(g.items()) if v))


if __name__ == "__main__":
    main()
