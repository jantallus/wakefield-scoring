import os as _os
import numpy as np, json
from parse import OUT, ROOT, GATE, D, C, R, TASK, P, TID
EPS, PHI0 = 0.15, 8.0
d = np.load(_os.path.join(OUT, "field_%s_%.2f_%.1f.npz" % (TID, EPS, PHI0))); res = json.load(open(_os.path.join(OUT, "res_%s_%.2f_%.1f.json" % (TID, EPS, PHI0))))
pilots = list(np.load(_os.path.join(OUT, "pilots_%s.npy" % TID), allow_pickle=True))
grid, X, Y, Z, S, GV, PROJ, AIR = d["grid"], d["X"], d["Y"], d["Z"], d["S"], d["GV"], d["PROJ"], d["AIR"]
VREF = res["vref"]; byi = {r["i"]: r for r in res["res"]}
STEP = 20
t_end = max((p["ess"] or p["t_land"]) for p in pilots if p["start"]) + 300
fr = np.arange(GATE, t_end, STEP)
gi = np.minimum(np.searchsorted(grid, fr), len(grid) - 1)
out = []
for i, p in enumerate(pilots):
    if not p["start"]: continue
    r = byi[i]
    st = np.where(AIR[i, gi], 1, 3)
    if p["ess"]: st[fr >= p["ess"]] = 2
    st[(fr > p["t_land"]) & (st != 2)] = 3
    x = np.nan_to_num(X[i, gi], nan=np.nan); y = Y[i, gi]
    # keep last known position after landing
    last = None
    xs, ys, zs = [], [], []
    for k in range(len(fr)):
        if np.isfinite(x[k]): last = (x[k], y[k], Z[i, gi[k]])
        if last is None: last = (float(p["x"][0]), float(p["y"][0]), float(p["z"][0]))
        xs.append(int(round(last[0] * 100))); ys.append(int(round(last[1] * 100))); zs.append(int(round(last[2] / 10)))
    v = np.r_[0, np.maximum(0, np.diff(np.nan_to_num(S[i])))][gi] / 10 * 3600
    rate = 1 - EPS * (1 - GV[i, gi]) * v / VREF
    pr = np.nan_to_num(PROJ[i, gi], nan=r["final"])
    out.append(dict(n=p["name"], x=xs, y=ys, z=zs, g=[int(round(a * 100)) for a in GV[i, gi]],
                    r=[int(round(a * 100)) if s == 1 else 0 for a, s in zip(rate, st)],
                    p=[int(round(a)) for a in pr], s=[int(a) for a in st],
                    ess=r["ess"], fin=round(r["final"]), auto=round(r["auto_km"], 1), rem=round(r["rem"], 1)))
task = dict(cyl=[dict(n=TASK[k][0], x=round(float(C[k, 0]), 3), y=round(float(C[k, 1]), 3), r=float(R[k])) for k in range(len(C))],
            route=[[round(float(a), 3), round(float(b), 3)] for a, b in P])
json.dump(dict(t0=int(GATE), step=STEP, vref=round(VREF, 2), D=round(D, 2), eps=EPS, phi0=PHI0, task=task, pilots=out),
          open(_os.path.join(OUT, "replay_%s.json" % TID), "w"), separators=(",", ":"))
import os; print("frames", len(fr), "pilots", len(out), "size %.1f MB" % (os.path.getsize(_os.path.join(OUT, "replay_%s.json" % TID)) / 1e6))
# sensitivity summary
for ph in [0.8, 3.0, 8.0, 20.0]:
    rr = json.load(open(_os.path.join(OUT, "res_%s_%.2f_%.1f.json" % (TID, EPS, ph))))["res"]
    e = [x for x in rr if x["ess"]]
    real = {x["i"]: k for k, x in enumerate(sorted(e, key=lambda x: x["ess"]))}
    cor = {x["i"]: k for k, x in enumerate(sorted(e, key=lambda x: x["final"]))}
    moves = sum(abs(real[k] - cor[k]) for k in real)
    win = min(e, key=lambda x: x["ess"])
    cr = [(x["ess"] - x["final"]) / 60 for x in e]
    print("phi0", ph, "credit vainqueur %.1f" % ((win["ess"] - win["final"]) / 60), "credit min %.1f max %.1f moyen %.1f" % (min(cr), max(cr), np.mean(cr)), "pilotes déplacés", sum(real[k] != cor[k] for k in real), "places cumulées", moves)
