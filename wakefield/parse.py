import os as _os
ROOT = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
OUT = _os.environ.get("WAKEFIELD_OUT", _os.path.join(ROOT, "out"))
_os.makedirs(OUT, exist_ok=True)
"""Parse IGC tracks, build task geometry, compute progress for each pilot."""
import glob, os, json, math, sys
import numpy as np

LAT0, LON0 = 46.2, 13.1
KX = 111.32 * math.cos(math.radians(LAT0)); KY = 110.574
def proj(lat, lon):
    return (np.asarray(lon) - LON0) * KX, (np.asarray(lat) - LAT0) * KY

TOL = 0.005  # FAI cat 2 cylinder tolerance
TID = os.environ.get("TASKID", "T2")
TASKS = {
 "T2": dict(gate=11*3600+15*60, dir=_os.path.join(ROOT, "data/gemona-2026/task2-igc.zip"), toff=(46.27383, 13.17566),
            task=[("SSS H51", 46.08332, 13.41666, 26.0), ("H32", 46.12500, 13.37500, 3.5), ("W11", 46.18299, 12.67699, 20.0),
                  ("H51", 46.08332, 13.41666, 19.5), ("H59", 46.26240, 13.08115, 2.0), ("ESS A31", 46.30698, 13.11229, 2.5)]),
 "T3": dict(gate=11*3600+25*60, dir=_os.path.join(ROOT, "data/gemona-2026/task3-igc.zip"), toff=(46.27383, 13.17566),
            task=[("SSS H54", 46.17365, 12.54802, 45.0), ("H54", 46.17365, 12.54802, 9.5), ("H50", 46.08332, 13.33333, 23.0),
                  ("ESS A31", 46.30698, 13.11229, 2.5)]),
}
_T = TASKS[TID]
GATE = _T["gate"]; TASK = _T["task"]; TOFF = _T["toff"]; IGCDIR = _T["dir"]
C = np.array([proj(la, lo) for _, la, lo, _ in TASK], float)
R = np.array([r for *_, r in TASK])

def optimise(start):
    """Touch points on each cylinder minimising route length start -> ... -> last."""
    ang = np.linspace(0, 2 * np.pi, 1440, endpoint=False)
    ring = [C[i] + R[i] * np.c_[np.cos(ang), np.sin(ang)] for i in range(len(C))]
    P = C.copy()
    for _ in range(60):
        for i in range(len(C)):
            prev = start if i == 0 else P[i - 1]
            pts = ring[i]
            d = np.hypot(*(pts - prev).T)
            if i + 1 < len(C):
                d = d + np.hypot(*(pts - P[i + 1]).T)
            P[i] = pts[np.argmin(d)]
    return P

T0 = np.array(proj(*TOFF))
P = optimise(T0)
legs = np.hypot(*np.diff(np.vstack([T0, P]), axis=0).T)
print("take-off -> ESS optimised: %.2f km" % legs.sum())
D = legs[1:].sum()  # SSS point -> ESS point
print("SSS -> ESS: %.2f km" % D)
AFTER = np.array([legs[i + 1:].sum() for i in range(len(C))])  # length from P[i] to ESS point

def geodist(lat1, lon1, lat2, lon2):
    """Distance on the WGS84 ellipsoid in km (Andoyer-Lambert, a few metres over 100 km)."""
    a, f = 6378.137, 1 / 298.257223563
    b1 = np.arctan((1 - f) * np.tan(np.radians(lat1))); b2 = np.arctan((1 - f) * np.tan(np.radians(lat2)))
    dl = np.radians(np.asarray(lon2) - np.asarray(lon1))
    h = np.sin((b2 - b1) / 2) ** 2 + np.cos(b1) * np.cos(b2) * np.sin(dl / 2) ** 2
    sg = 2 * np.arcsin(np.sqrt(np.clip(h, 0, 1)))
    P, Q = (b1 + b2) / 2, (b2 - b1) / 2
    with np.errstate(divide="ignore", invalid="ignore"):
        X = (sg - np.sin(sg)) * np.sin(P) ** 2 * np.cos(Q) ** 2 / np.cos(sg / 2) ** 2
        Y = (sg + np.sin(sg)) * np.cos(P) ** 2 * np.sin(Q) ** 2 / np.sin(sg / 2) ** 2
        d = a * (sg - f / 2 * (X + Y))
    return np.where(sg > 1e-12, d, 0.0)

def parse(fn, lines=None):
    name = os.path.basename(fn)[:-4]
    t, la, lo, za = [], [], [], []
    for line in (lines if lines is not None else open(fn, errors="ignore")):
        if line.startswith("HFPLT"):
            name = line.split(":", 1)[-1].strip() or name
        if line.startswith("B") and len(line) >= 35:
            try:
                hh, mm, ss = int(line[1:3]), int(line[3:5]), int(line[5:7])
                lat = int(line[7:9]) + int(line[9:14]) / 60000.0
                if line[14] == "S": lat = -lat
                lon = int(line[15:18]) + int(line[18:23]) / 60000.0
                if line[23] == "W": lon = -lon
                pa, ga = int(line[25:30]), int(line[30:35])
            except ValueError:
                continue
            t.append(hh * 3600 + mm * 60 + ss); la.append(lat); lo.append(lon); za.append(ga if ga > 0 else pa)
    t = np.array(t, float)
    if len(t) < 100: return None
    o = np.argsort(t, kind="stable"); t = t[o]
    keep = np.r_[True, np.diff(t) > 0]
    lat, lon = np.array(la)[o][keep], np.array(lo)[o][keep]
    x, y = proj(lat, lon)
    return dict(id=os.path.basename(fn)[:-4], name=name, t=t[keep], x=x, y=y, lat=lat, lon=lon, z=np.array(za, float)[o][keep])

def rem_dist(x, y, k):
    """Remaining optimised distance to ESS from (x,y) when next cylinder index is k."""
    if k >= len(C): return np.zeros_like(x)
    if k == len(C) - 1:
        return np.maximum(0, np.hypot(x - C[k, 0], y - C[k, 1]) - R[k])
    ang = np.linspace(0, 2 * np.pi, 360, endpoint=False)
    ring = C[k] + R[k] * np.c_[np.cos(ang), np.sin(ang)]
    nxt = P[k + 1]
    tail = np.hypot(*(ring - nxt).T) + AFTER[k + 1]
    out = np.empty_like(x)
    for a in range(0, len(x), 4000):
        dx = x[a:a + 4000, None] - ring[None, :, 0]; dy = y[a:a + 4000, None] - ring[None, :, 1]
        out[a:a + 4000] = (np.hypot(dx, dy) + tail[None, :]).min(1)
    inside = np.hypot(x - C[k, 0], y - C[k, 1]) <= R[k]
    # already inside a cylinder not yet validated (only possible for SSS before entry) -> distance via exit is irrelevant
    return out

def analyse(p):
    t, x, y = p["t"], p["x"], p["y"]
    # cylinder validation on the WGS84 ellipsoid (the planar projection is only used for progress)
    d = np.stack([geodist(p["lat"], p["lon"], TASK[k][1], TASK[k][2]) for k in range(len(C))], 1) - R[None, :]
    tol = TOL * R[None, :]
    inside = d <= tol
    k = 0; tag = []; kidx = np.zeros(len(t), int)
    i = 0; n = len(t)
    # SSS: first entry (outside -> inside) after gate
    start_i = None
    # start: from the gate on, pilot is first seen outside the inner tolerance edge, then crosses it
    g0 = np.searchsorted(t, GATE)
    was_out = False
    for j in range(g0, n):
        if d[j, 0] > -TOL * R[0]: was_out = True
        elif was_out:
            start_i = j; break
    p["start"] = None if start_i is None else float(t[start_i])
    k = 0
    if start_i is not None:
        k = 1; kidx[:start_i] = 0
        for j in range(start_i, n):
            if k < len(C) and inside[j, k]:
                tag.append((TASK[k][0], float(t[j])))
                k += 1
            kidx[j] = k
    p["tags"] = tag; p["kidx"] = kidx
    p["ess"] = tag[-1][1] if len(tag) == len(C) - 1 and tag[-1][0].startswith("ESS") else None
    rem = np.empty(n)
    for kk in np.unique(kidx):
        m = kidx == kk
        rem[m] = rem_dist(x[m], y[m], kk)
    p["rem"] = rem
    # take-off: first fix above 15 km/h; landing: the first minute after the start (or the highest point) in which the track covers less than 150 m
    # (so that a retrieve car ride recorded afterwards is not flight); else the last fix above 15 km/h
    sp = np.r_[0, np.hypot(np.diff(x), np.diff(y)) / np.diff(t) * 3600]
    mv = np.where(sp > 15)[0]
    t_off = float(t[mv[0]]) if len(mv) else float(t[0])
    land = float(t[mv[-1]]) if len(mv) else float(t[0])
    if len(mv):
        seg = np.r_[np.hypot(np.diff(x), np.diff(y)), 0]          # seg[k]: k -> k+1
        cum = np.r_[0, np.cumsum(seg[:-1])]                      # path length from fix 0 to fix k
        # from a moment the pilot is surely flying: the start, or else the highest point (not standing on launch)
        anchor = p["start"] if p.get("start") is not None else float(t[int(np.argmax(p["z"]))])
        for i in range(len(t)):
            if t[i] <= max(t_off, anchor): continue
            j = np.searchsorted(t, t[i] + 60, side="right") - 1
            if t[j] - t[i] >= 55 and cum[j] - cum[i] < 0.15:
                land = min(land, float(t[i])); break
    p["t_off"] = t_off
    p["t_land"] = land
    # turnpoints reached after the landing were reached on foot or by car: they do not count
    p["tags"] = [tg for tg in p["tags"] if tg[1] <= land]
    if p["ess"] is not None and p["ess"] > land: p["ess"] = None
    return p

if __name__ == "__main__":
    import zipfile
    zf = zipfile.ZipFile(IGCDIR)
    files = sorted(n for n in zf.namelist() if n.lower().endswith(".igc"))
    pilots = []
    for fn in files:
        p = parse(fn, zf.read(fn).decode("latin-1").splitlines())
        if p is None: print("skip", fn); continue
        pilots.append(analyse(p))
    np.save(_os.path.join(OUT, "pilots_%s.npy" % TID), np.array(pilots, dtype=object), allow_pickle=True)
    ess = [p for p in pilots if p["ess"]]
    st = [p for p in pilots if p["start"]]
    print(len(pilots), "pilotes,", len(st), "partis,", len(ess), "à l'ESS")
    times = sorted((p["ess"] - GATE) / 60 for p in ess)
    print("temps ESS min: %.1f, médian: %.1f, max: %.1f min" % (times[0], times[len(times)//2], times[-1]))
    def hm(s): s = int(s); return "%d:%02d:%02d" % (s // 3600 + 2, s % 3600 // 60, s % 60)
    for p in sorted(ess, key=lambda p: p["ess"])[:5]:
        print(p["name"], hm(p["start"]), [ (a, hm(b)) for a,b in p["tags"]])
    for p in sorted([p for p in pilots if not p["ess"]], key=lambda p: p["rem"][-1])[:5]:
        print("non ESS", p["name"], "reste %.1f km" % p["rem"][-1], "tags", len(p["tags"]))
