"""Check that the Python pipeline and the JavaScript core (the reference) agree.

Usage: python3 tests/check_consistency.py <python res_*.json> <js results .json>

The two implementations compute remaining distances slightly differently
(the Python one interpolates along the track, the JS one on the 10 s grid),
so small differences are expected. The check fails if:
- the set of pilots at ESS differs;
- a corrected time at ESS differs by more than TIME_TOL seconds;
- a landed pilot's corrected distance differs by more than DIST_TOL km;
- the rank correlation of the corrected ranking falls below RANK_MIN.
"""
import json, sys, unicodedata
import numpy as np

TIME_TOL, DIST_TOL, RANK_MIN = 15.0, 0.3, 0.995
EPS = 0.15

def norm(s):
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().strip()

def spearman(a, b):
    ra, rb = np.argsort(np.argsort(a)), np.argsort(np.argsort(b))
    return float(np.corrcoef(ra, rb)[0, 1])

py = json.load(open(sys.argv[1])); js = json.load(open(sys.argv[2]))
D = js["D"]
P = {norm(r["name"]): r for r in py["res"]}
J = {norm(r["name"]): r for r in js["ranking"]}
errors = []
pe = {k for k, r in P.items() if r["ess"] is not None}; je = {k for k, r in J.items() if r["ess"] is not None}
if pe != je:
    errors.append("pilots at ESS differ: only Python %s, only JS %s" % (sorted(pe - je), sorted(je - pe)))
common = sorted(pe & je)
worst_t = max((abs(P[k]["final"] - J[k]["tau"]), k) for k in common)   # corrected time at ESS (the JS ranks pilots who miss goal with the landed ones)
if worst_t[0] > TIME_TOL:
    errors.append("corrected time of %s differs by %.1f s" % (worst_t[1], worst_t[0]))
rho = spearman([P[k]["final"] for k in common], [J[k]["tau"] for k in common])
if rho < RANK_MIN:
    errors.append("rank correlation at ESS %.4f < %.3f" % (rho, RANK_MIN))
landed = sorted(k for k in P if k in J and P[k]["ess"] is None and J[k]["ess"] is None)
worst_d = (0.0, None)
for k in landed:
    d_py = min(D, max(0.0, py["D"] - P[k]["rem"]) + EPS * P[k]["auto_km"])
    worst_d = max(worst_d, (abs(d_py - J[k]["dCorr"]), k))
if worst_d[0] > DIST_TOL:
    errors.append("corrected distance of %s differs by %.2f km" % (worst_d[1], worst_d[0]))
print("%s: %d at ESS (max time gap %.1f s, rank correlation %.4f), %d landed (max distance gap %.2f km)"
      % (sys.argv[2], len(common), worst_t[0], rho, len(landed), worst_d[0]))
if errors:
    print("FAIL\n- " + "\n- ".join(errors)); sys.exit(1)
print("OK")
