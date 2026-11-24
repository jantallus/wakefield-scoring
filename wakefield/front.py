import os, json, csv, unicodedata, numpy as np
os.environ.setdefault("TASKID","T2")
from parse import OUT, ROOT, GATE, TID
J = lambda n: os.path.join(OUT, n)
def norm(s): return unicodedata.normalize("NFKD", s).encode("ascii","ignore").decode().lower().replace("'","").strip()
sp=lambda a,b: np.corrcoef(np.argsort(np.argsort(a)),np.argsort(np.argsort(b)))[0,1]
d=np.load(J('field_%s_0.15_8.0.npz'%TID))
S,AIR,grid=d['S'],d['AIR'],d['grid'];P=list(np.load(J('pilots_%s.npy'%TID),allow_pickle=True));N,G=S.shape
top5=np.zeros(N);top10=np.zeros(N)
for gi in range(int(np.searchsorted(grid, GATE)),G):
    act=[i for i in range(N) if AIR[i,gi] and P[i]['start'] and (not P[i]['ess'] or grid[gi]<P[i]['ess'])]
    if len(act)<10: continue
    o=np.array(act)[np.argsort(-S[act,gi])]
    top5[o[:5]]+=10;top10[o[:10]]+=10
off={norm(r['name']):r for r in csv.DictReader(open(os.path.join(ROOT,'data/gemona-2026/official/task%s.csv'%TID[1:])))}
res=json.load(open(J('res_%s_0.15_8.0.json'%TID)))['res']
rows=[(r,off[norm(r['name'])]) for r in res if r['ess'] and norm(r['name']) in off]
rows.sort(key=lambda x:x[0]['ess'])
for npk in [20,40,len(rows)]:
    sub=rows[:npk]
    L=[float(o['lead']) for r,o in sub];C=[(r['ess']-r['final']) for r,o in sub];T5=[top5[r['i']] for r,o in sub];T10=[top10[r['i']] for r,o in sub]
    print(TID,'%3d premiers arrivés | temps top10 vs GAP lead %.2f, vs mon crédit %.2f | temps top5 vs GAP %.2f, vs crédit %.2f'%(npk,sp(T10,L),sp(T10,C),sp(T5,L),sp(T5,C)))
json.dump({r['name']:[top5[r['i']]/60,top10[r['i']]/60] for r,o in rows},open(J('front_%s.json'%TID),'w'))
