import os as _os
"""Field Φ, clock τ and projected time for the real task."""
import numpy as np, json, math, sys
from parse import OUT, ROOT, GATE, D, C, R, TASK, P, TID
pilots = list(np.load(_os.path.join(OUT, "pilots_%s.npy" % TID), allow_pickle=True))

EPS = float(sys.argv[1]) if len(sys.argv) > 1 else 0.15
PHI0 = float(sys.argv[2]) if len(sys.argv) > 2 else 0.8
PHI0_DEF, SIG_A, SIG_L0, SIG_LK, SIG_B, TM, KEEP = 0.8, 3.0, 0.6, 0.22, 0.4, 240.0, 720.0
DT, TR = 10.0, 20.0      # grid step, trail step (s)
LANDPEN = 2.0

ess_times = [p["ess"] - GATE for p in pilots if p["ess"]]
VREF = float(np.median([D / (s / 3600) for s in ess_times]))  # km/h
t_end = max(p["t_land"] for p in pilots if p["start"])
grid = np.arange(GATE - KEEP, t_end + DT, DT)
G = len(grid); N = len(pilots)
X = np.full((N, G), np.nan, np.float32); Y = X.copy(); Z = X.copy(); S = X.copy(); CL = np.zeros((N, G), bool)
AIR = np.zeros((N, G), bool)
for i, p in enumerate(pilots):
    t = p["t"]
    m = (grid >= max(t[0], p["t_off"])) & (grid <= min(t[-1], p["t_land"]))
    AIR[i] = m
    X[i, m] = np.interp(grid[m], t, p["x"]); Y[i, m] = np.interp(grid[m], t, p["y"])
    Z[i, m] = np.interp(grid[m], t, p["z"]); S[i, m] = D - np.interp(grid[m], t, p["rem"])
    z20 = np.interp(grid - 20, t, p["z"])
    CL[i] = (Z[i] - z20) / 20 > 0.3

g0 = int(KEEP / DT)                     # index of GATE in grid
lag = int(TR / DT); nlag = int(KEEP / TR)
GV = np.zeros((N, G), np.float32)       # g per pilot per step
for gi in range(g0, G):
    idx = gi - np.arange(nlag + 1) * lag    # current + trail
    idx = idx[idx >= 0]
    age = (grid[gi] - grid[idx]).astype(np.float32)
    sx, sy, sz, ss = X[:, idx], Y[:, idx], Z[:, idx], S[:, idx]
    ok = AIR[:, idx]
    w = np.where(age == 0, 1.0, TR / TM).astype(np.float32) * np.exp(-age / TM).astype(np.float32)
    w = w[None, :] * np.where(CL[:, idx], 1.0, 0.35) * ok
    obs = np.where(AIR[:, gi])[0]
    if len(obs) == 0: continue
    src = ok.ravel()
    sx, sy, sz, ss, w = sx.ravel()[src], sy.ravel()[src], sz.ravel()[src], ss.ravel()[src], w.ravel()[src]
    own = np.repeat(np.arange(N), len(idx))[src]
    ox, oy, oz, os_ = X[obs, gi][:, None], Y[obs, gi][:, None], Z[obs, gi][:, None], S[obs, gi][:, None]
    dx = ss[None] - os_
    dxg, dyg = sx[None] - ox, sy[None] - oy
    dh2 = dxg * dxg + dyg * dyg
    dz = (sz[None] - oz) / 1000.0
    lat2 = np.maximum(0, dh2 - dx * dx)
    sl = SIG_L0 + SIG_LK * np.maximum(dx, 0)
    Ka = np.exp(-(dx * dx) / SIG_A**2 - lat2 / (sl * sl) - dz * dz)
    Kb = np.exp(-(dh2 + dz * dz) / SIG_B**2)
    K = np.where(dx > 0, Ka, Kb)
    r2 = dh2 + dz * dz
    A = np.where(r2 > 1e-6, np.where(dz > 0, np.sqrt(dh2 / np.maximum(r2, 1e-9)), dh2 / np.maximum(r2, 1e-9)), 1.0)
    phi = (K * A * w[None])
    phi[own[None, :] == obs[:, None]] = 0
    GV[obs, gi] = 1 - np.exp(-phi.sum(1) / PHI0)

# clocks
res = []
TAU = np.full((N, G), np.nan, np.float32); PROJ = TAU.copy()
for i, p in enumerate(pilots):
    if not p["start"]:
        res.append(None); continue
    tau = 0.0; t_stop = p["ess"] or p["t_land"]
    auto_km = 0.0; final = None
    for gi in range(g0, G):
        t0, t1 = grid[gi - 1] if gi > g0 else GATE, grid[gi]
        if t0 >= t_stop: break
        a, b = t0, min(t1, t_stop)
        if AIR[i, gi] and AIR[i, gi - 1]:
            ds = max(0.0, float(S[i, gi] - S[i, gi - 1]))
        else: ds = 0.0
        v = ds / DT * 3600
        g = float(GV[i, gi]) if AIR[i, gi] else 1.0
        rate = 1 - EPS * (1 - g) * v / VREF
        tau += rate * (b - a)
        auto_km += (1 - g) * ds * (b - a) / DT
        TAU[i, gi] = tau
        remk = D - float(S[i, gi]) if AIR[i, gi] else float(p["rem"][-1])
        PROJ[i, gi] = tau + max(0.0, remk) / VREF * 3600
    if p["ess"]:
        final = tau
    else:
        final = tau + p["rem"][min(np.searchsorted(p["t"], p["t_land"]), len(p["t"]) - 1)] / VREF * 3600 * LANDPEN
    res.append(dict(tau=tau, final=final, auto_km=auto_km))

# freeze projections after stop
for i, p in enumerate(pilots):
    if res[i] is None: continue
    t_stop = p["ess"] or p["t_land"]
    after = grid >= t_stop
    PROJ[i, after] = res[i]["final"]

np.savez_compressed(_os.path.join(OUT, "field_%s_%.2f_%.1f.npz" % (TID, EPS, PHI0)), grid=grid, X=X, Y=Y, Z=Z, S=S, GV=GV, PROJ=PROJ, AIR=AIR, CL=CL)
out = []
for i, p in enumerate(pilots):
    if res[i] is None: continue
    out.append(dict(i=i, id=p["id"], name=p["name"], ess=(p["ess"] - GATE) if p["ess"] else None,
                    rem=float(p["rem"][min(np.searchsorted(p["t"], p["t_land"]), len(p["t"]) - 1)]),
                    tags=len(p["tags"]), **res[i]))
json.dump(dict(vref=VREF, D=D, eps=EPS, phi0=PHI0, res=out), open(_os.path.join(OUT, "res_%s_%.2f_%.1f.json" % (TID, EPS, PHI0)), "w"))
print("v_ref %.1f km/h, D %.2f km, max credit %.1f min" % (VREF, D, EPS * D / VREF * 60))
ess = sorted([r for r in out if r["ess"]], key=lambda r: r["final"])
real = sorted(ess, key=lambda r: r["ess"]); rr = {r["i"]: k + 1 for k, r in enumerate(real)}
def f(s): s = int(round(s)); return "%d:%02d:%02d" % (s // 3600, s % 3600 // 60, s % 60)
for k, r in enumerate(ess):
    print("%2d (réel %2d) %-28s réel %s corrigé %s crédit %4.1f min  autonome %4.1f km" % (k + 1, rr[r["i"]], r["name"][:28], f(r["ess"]), f(r["final"]), (r["ess"] - r["final"]) / 60, r["auto_km"]))
