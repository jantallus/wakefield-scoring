import csv, json, unicodedata, numpy as np, sys, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.environ.get("WAKEFIELD_OUT", os.path.join(ROOT, "out"))
OFF = os.path.join(ROOT, "data/gemona-2026/official")
def norm(s): return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().replace("'", "").strip()
def spearman(a, b):
    ra = np.argsort(np.argsort(a)); rb = np.argsort(np.argsort(b)); return np.corrcoef(ra, rb)[0, 1]
out = {}
for T in ["T2", "T3"]:
    off = {norm(r["name"]): r for r in csv.DictReader(open(os.path.join(OFF, "task%s.csv" % T[1:])))}
    res = json.load(open(os.path.join(OUT, "res_%s_0.15_8.0.json" % T)))["res"]
    mine = {norm(r["name"]): r for r in res if r["ess"]}
    common = [k for k in off if k in mine]
    miss_off = [off[k]["name"] for k in off if k not in mine]; miss_me = [mine[k]["name"] for k in mine if k not in off]
    # rankings restricted to common pilots
    real = sorted(common, key=lambda k: mine[k]["ess"]); cor = sorted(common, key=lambda k: mine[k]["final"])
    offr = sorted(common, key=lambda k: -float(off[k]["total"]))
    R = {k: {"real": real.index(k) + 1, "cor": cor.index(k) + 1, "off": offr.index(k) + 1,
             "lead": float(off[k]["lead"]), "credit": (mine[k]["ess"] - mine[k]["final"]) / 60, "auto": mine[k]["auto_km"],
             "name": off[k]["name"]} for k in common}
    L = np.array([R[k]["lead"] for k in common]); Cr = np.array([R[k]["credit"] for k in common])
    print("==", T, "pilotes comparés", len(common), "| absents chez moi:", miss_off, "| absents officiel:", miss_me)
    print("corr points leading GAP / mon crédit: Pearson %.2f, Spearman %.2f" % (np.corrcoef(L, Cr)[0, 1], spearman(L, Cr)))
    o = np.array([R[k]["off"] for k in common]); c = np.array([R[k]["cor"] for k in common]); r = np.array([R[k]["real"] for k in common])
    print("Spearman officiel/arrivée %.2f, officiel/corrigé %.2f, corrigé/arrivée %.2f" % (spearman(o, r), spearman(o, c), spearman(c, r)))
    print("écart moyen de place officiel vs corrigé %.1f, officiel vs arrivée %.1f" % (np.abs(o - c).mean(), np.abs(o - r).mean()))
    # disagreement: GAP lead rank vs my credit rank
    lr = {k: i + 1 for i, k in enumerate(sorted(common, key=lambda k: -R[k]["lead"]))}
    cr = {k: i + 1 for i, k in enumerate(sorted(common, key=lambda k: -R[k]["credit"]))}
    d = sorted(common, key=lambda k: lr[k] - cr[k])
    print("GAP les juge bien meilleurs leaders que moi:", [(R[k]["name"], lr[k], cr[k]) for k in d[:5]])
    print("moi je les juge bien meilleurs leaders que le GAP:", [(R[k]["name"], lr[k], cr[k]) for k in d[-5:]])
    print("top 5 officiel:", [(R[k]["name"], R[k]["off"], R[k]["cor"], R[k]["real"]) for k in offr[:5]])
    print("top 5 corrigé:", [(R[k]["name"], R[k]["off"], R[k]["cor"], R[k]["real"]) for k in cor[:5]])
    out[T] = dict(rows=[R[k] for k in common], lr=lr, cr=cr)
json.dump({T: out[T]["rows"] for T in out}, open(os.path.join(OUT, "compare.json"), "w"), ensure_ascii=False)
