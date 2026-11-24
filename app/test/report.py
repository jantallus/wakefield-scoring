"""Build the competition report page from app/test/season.js output.

Usage: python3 app/test/report.py <season.json> <data dir> <out.html>
"""
import json, sys, csv, html, unicodedata, os

season, data, out = sys.argv[1:4]
S = json.load(open(season))
meta = json.load(open(os.path.join(data, "tasks.json")))
n = lambda s: unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().replace("'", "").strip()
e = html.escape
fmt = lambda s: "%d:%02d:%02d" % (s // 3600, s % 3600 // 60, s % 60) if s is not None else "—"
num = lambda v, d=2: ("%.*f" % (d, v)).replace(".", ",")

# official overall and validities
overall = list(csv.DictReader(open(os.path.join(data, "official", "overall.csv"))))
offrank = {n(o["name"]): int(o["rank"]) for o in overall}
display = {n(o["name"]): o["name"] for o in overall}
VAL = meta.get("validity", {})
FTV = meta.get("ftv", 0.25)

# --- overall in time ---
# For each task, a pilot's delay is r = corrected time / winner's corrected time - 1 (share behind the winner),
# counted as DQ x r, where DQ is the task's day quality (official validity). Shown in minutes on a
# reference task of REF_MIN minutes won in REF_MIN (1 % = REF_MIN / 100 minutes).
# FTV: a pilot's tasks are sorted by r (best first) and added until their validities reach
# (1 - FTV) x the sum of validities; the last task counts in part. Absent: the task's largest r.
REF_MIN = 120
tasks = [T["id"] for T in S]
W = {t: VAL.get(t, 1.0) for t in tasks}
rel = {}
for T in S:
    win = min(r["final"] for r in T["rows"])
    worst = max(r["final"] for r in T["rows"]) / win - 1
    for k in offrank: rel.setdefault(k, {})[T["id"]] = worst
    for r in T["rows"]: rel.setdefault(n(r["name"]), {})[T["id"]] = r["final"] / win - 1
def ftv(g):
    budget = sum(W.values()) * (1 - FTV); s = 0.0; kept = {}
    for t in sorted(tasks, key=lambda t: g[t]):
        take = min(W[t], budget)
        if take <= 0: break
        s += take * g[t]; kept[t] = take / W[t]; budget -= take
    return s * REF_MIN, kept          # minutes on the reference task
names = [k for k in rel if k in offrank]
tot = {k: ftv(rel[k]) for k in names}
order = sorted(names, key=lambda k: tot[k][0])
cum = {k: i + 1 for i, k in enumerate(sorted(names, key=lambda k: sum(W[t] * rel[k][t] for t in tasks)))}
# first try, for comparison: raw delays in seconds, tasks sorted by raw delay
raw = {}
for T in S:
    win = min(r["final"] for r in T["rows"]); worst = max(r["final"] for r in T["rows"]) - win
    for k in offrank: raw.setdefault(k, {})[T["id"]] = worst
    for r in T["rows"]: raw.setdefault(n(r["name"]), {})[T["id"]] = r["final"] - win
def ftv_raw(g):
    budget = sum(W.values()) * (1 - FTV); s = 0.0
    for t in sorted(tasks, key=lambda t: g[t]):
        take = min(W[t], budget)
        if take <= 0: break
        s += g[t] * take / W[t]; budget -= take
    return s
first = {k: i + 1 for i, k in enumerate(sorted(names, key=lambda k: ftv_raw(raw[k])))}
def spear(a, b):
    import numpy as np
    ks = list(a); x = np.argsort(np.argsort([a[k] for k in ks])); y = np.argsort(np.argsort([b[k] for k in ks])); return float(np.corrcoef(x, y)[0, 1])
rk = {k: i + 1 for i, k in enumerate(order)}
offs = {k: offrank[k] for k in names}
sp_ftv = spear(offs, rk); sp_cum = spear(offs, cum); sp_first = spear(offs, first)
mean_abs = sum(abs(rk[k] - offrank[k]) for k in names) / len(names)
same_top10 = len(set(order[:10]) & set(sorted(names, key=lambda k: offrank[k])[:10]))
lead = tot[order[0]][0]

# --- page ---
rows = "".join(f"""<tr><td>{e(T['label'])}{' <span class="tag">arrêtée</span>' if T['stopped'] else ''}</td><td>{e(T['date'][5:].replace('-', '/'))}</td>
<td class="n">{num(T['D'], 1)} km</td><td class="n">{T['ess']}</td><td>{e(T['winnerOfficial'])}</td><td>{e(T['winnerWakefield'])}</td><td>{e(T['firstAtEss'])}</td>
<td class="n">{num(T['spearmanOfficial'])}</td><td class="n">{num(T['spearmanOfficialArrival'])}</td></tr>""" for T in S)
bars = "".join(f"""<div class="bt">{e(T['label'])}</div>
<div class="br"><span class="bl">Leading GAP</span><span class="bw"><i class="gap" style="width:{max(0, T['top10VsLead']) * 100:.0f}%"></i></span><b>{num(T['top10VsLead'])}</b></div>
<div class="br"><span class="bl">Wakefield</span><span class="bw"><i class="wf" style="width:{max(0, T['top10VsCredit']) * 100:.0f}%"></i></span><b>{num(T['top10VsCredit'])}</b></div>""" for T in S)
mean = lambda k: sum(T[k] for T in S) / len(S)
details = ""
for T in S:
    ess = [r for r in T["rows"] if r["ess"] is not None and r.get("goal", True)][:12]
    details += f"""<details><summary>{e(T['label'])} · {e(T['date'])} : les 12 premiers en temps corrigé</summary><div class="scroll"><table class="stack"><thead><tr><th class="n">Wakefield</th><th class="n">Officiel</th><th class="n">Arrivée</th><th>Pilote</th><th class="n">Temps réel</th><th class="n">Temps corrigé</th><th class="n">Crédit</th><th class="n">Min dans le top 10</th></tr></thead><tbody>
{''.join(f"<tr><td class='n'>{r['rank']}</td><td class='n'>{r['offRank'] or '—'}</td><td class='n'>{r['realRank']}</td><td>{e(r['name'])}</td><td class='n'>{fmt(r['ess'])}</td><td class='n'>{fmt(r['final'])}</td><td class='n'>{num(r['credit'] / 60, 1)} min</td><td class='n'>{r['top10']:.0f}</td></tr>" for r in ess)}
</tbody></table></div></details>"""
ov = "".join(f"<tr><td class='n'>{i + 1}</td><td class='n'>{offrank[k]}</td><td class='n'>{first[k]}</td><td>{e(display[k])}</td><td class='n'>{'—' if i == 0 else '+' + num((tot[k][0] - lead), 1) + ' min'}</td><td>{', '.join(t.replace('task', 'M') + ('' if tot[k][1].get(t, 0) < 1e-9 else ' (' + str(round((1 - tot[k][1][t]) * 100)) + ' %)') for t in tasks if tot[k][1].get(t, 0) < 0.999)}</td></tr>" for i, k in enumerate(order[:20]))

page = f"""<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wakefield, Gemona 2026</title><link rel="icon" href="data:,">
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@600&display=swap" rel="stylesheet">
<style>
/* VOICE: rapport d'analyse sobre. IDEA: le bilan d'un directeur d'épreuve. PICTURE: les barres GAP / Wakefield par manche.
   COLOUR and TYPE: blanc, encre, magenta pour Wakefield, gris pour le GAP ; Barlow. LAYOUT: constat, barres, tableau, détail, général. */
:root{{color-scheme:light dark;--bg:light-dark(#fff,#0c1216);--ink:light-dark(#10161c,#e8edf1);--mut:light-dark(#5a6670,#93a0aa);--line:light-dark(#e3e7ea,#1f2a31);--card:light-dark(#f5f7f8,#121b21);--acc:#e0408f}}
:root[data-theme=light]{{color-scheme:light}}:root[data-theme=dark]{{color-scheme:dark}}
*{{box-sizing:border-box;min-width:0}}body{{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 Barlow,system-ui,sans-serif;overflow-x:clip}}
.wrap{{max-width:1100px;margin:0 auto;padding:clamp(20px,4vw,48px) max(4vw,14px)}}
h1{{font:600 clamp(30px,4.6vw,46px)/1.05 'Barlow Condensed',Barlow,sans-serif;margin:0 0 10px;text-wrap:balance}}
h2{{font:600 26px/1.1 'Barlow Condensed',Barlow,sans-serif;margin:40px 0 10px}}
.lead{{color:var(--mut);max-width:72ch;margin:0 0 14px}}
.kpi{{display:flex;flex-wrap:wrap;gap:12px 34px;margin:18px 0}}.kpi div{{color:var(--mut);font-size:14px}}.kpi b{{display:block;font-size:34px;color:var(--ink);font-variant-numeric:tabular-nums}}.kpi .w b{{color:var(--acc)}}
.bars{{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:4px 34px;background:var(--card);border-radius:10px;padding:16px}}
.bt{{grid-column:1/-1;font-weight:600;margin-top:8px}}.bars .bt:first-child{{margin-top:0}}
.br{{display:grid;grid-template-columns:7.5em minmax(0,1fr) 3em;gap:10px;align-items:center;font-size:14px}}.bl{{color:var(--mut)}}.br b{{text-align:right;font-variant-numeric:tabular-nums}}
.bw{{height:12px;background:var(--line);border-radius:6px;overflow:hidden}}.bw i{{display:block;height:100%}}.gap{{background:#9aa5ae}}.wf{{background:var(--acc)}}
table{{width:100%;border-collapse:collapse;font-size:15px}}th{{font-weight:500;color:var(--mut);text-align:left;padding:5px 6px;font-size:13px}}td{{padding:6px;border-top:1px solid var(--line);white-space:nowrap}}td.n,th.n{{text-align:right;font-variant-numeric:tabular-nums}}
.scroll{{overflow-x:auto}}details{{background:var(--card);border-radius:10px;padding:10px 14px;margin:8px 0}}summary{{cursor:pointer;font-weight:600;min-height:28px}}
.tag{{font-size:12px;background:var(--line);border-radius:4px;padding:1px 6px;margin-left:4px}}
.notes{{color:var(--mut);font-size:15px;max-width:80ch}}.notes li{{margin:6px 0}}
@media(max-width:600px){{table{{font-size:13px}}.stack thead{{display:none}}.stack tr{{display:grid;padding-block:10px}}.stack td{{display:flow-root;border:0;padding:3px 0;padding-inline-start:9em;text-align:start;white-space:normal}}.stack td::before{{content:attr(data-l);float:inline-start;width:8.5em;margin-inline-start:-9em;color:var(--mut)}}}}
</style><script>new MutationObserver(()=>{{for(const c of document.querySelectorAll('.stack td:not([data-l])')){{let i=0,p=c;while(p=p.previousElementSibling)i+=p.colSpan;c.dataset.l=c.closest('table').rows[0].cells[i]?.textContent||''}}}}).observe(document,{{childList:true,subtree:true}})</script></head><body><div class="wrap">
<h1>Gemona 2026 : dans les {len(S)} manches, le crédit Wakefield suit mieux que le leading GAP qui a vraiment mené</h1>
<p class="lead">Chaque manche valide de la PWC Gemona 2026 rejouée avec Wakefield (réglages par défaut) à partir des traces publiques, et comparée au classement officiel GAP. Pour juger qui a mené, on mesure le temps passé par chaque pilote parmi les 10 premiers de la course, et on regarde s'il suit les points de leading GAP ou le crédit Wakefield.</p>
<div class="kpi"><div class="w"><b>{num(mean('top10VsCredit'))}</b>corrélation moyenne temps en tête / crédit Wakefield</div><div><b>{num(mean('top10VsLead'))}</b>corrélation moyenne temps en tête / leading GAP</div><div><b>{sum(T['winnerOfficial'] == T['winnerWakefield'] for T in S)} / {len(S)}</b>vainqueurs identiques</div><div><b>{num(mean('spearmanOfficial'))}</b>corrélation de rang moyenne avec le classement officiel</div></div>
<h2>Qui a mené : le temps en tête suit mieux le crédit Wakefield dans les six manches</h2>
<p class="lead">Corrélation de rang (pilotes à l'ESS) entre le temps passé parmi les 10 premiers de la course et, d'un côté les points de leading GAP, de l'autre le crédit Wakefield. 1 = même ordre.</p>
<div class="bars">{bars}</div>
<h2>Manche par manche</h2>
<div class="scroll"><table class="stack"><thead><tr><th>Manche</th><th>Date</th><th class="n">Start → ESS</th><th class="n">Au but</th><th>Vainqueur officiel</th><th>Vainqueur Wakefield</th><th>Premier à l'ESS</th><th class="n">Rang officiel / Wakefield</th><th class="n">Rang officiel / arrivée</th></tr></thead><tbody>{rows}</tbody></table></div>
<p class="notes">Les deux dernières colonnes sont des corrélations de rang chez les pilotes à l'ESS. En manche 4, le classement officiel s'écarte lui-même de l'ordre d'arrivée (0,78), d'où un écart plus grand avec Wakefield aussi.</p>
{details}
<h2>Classement général : retards en pourcentage, day quality et FTV officiels</h2>
<p class="lead">Dans chaque manche, le retard d'un pilote est mesuré en pourcentage du temps corrigé du vainqueur, puis multiplié par la day quality officielle de la manche. Il est affiché en minutes sur une manche de référence de 2 h : 1 % de retard = 1,2 min. Comme le FTV de la PWC ({FTV * 100:.0f} %), chaque pilote garde ses meilleures manches jusqu'à {(1 - FTV) * 100:.0f} % de la validité totale, la dernière en partie. Un posé entre avec son temps estimé, un absent avec le plus gros retard de la manche.</p>
<div class="kpi"><div class="w"><b>{num(sp_ftv)}</b>corrélation de rang avec le général officiel</div><div><b>{same_top10} / 10</b>pilotes en commun dans le top 10</div><div><b>{num(mean_abs, 1)}</b>places d'écart en moyenne</div><div><b>{num(sp_first)}</b>premier essai (retards bruts en minutes)</div><div><b>{num(sp_cum)}</b>sans FTV</div></div>
<div class="scroll"><table class="stack"><thead><tr><th class="n">Wakefield</th><th class="n">Officiel</th><th class="n">1er essai</th><th>Pilote</th><th class="n">Retard</th><th>Manches écartées</th></tr></thead><tbody>{ov}</tbody></table></div>
<p class="notes">Manches écartées : celles qui ne comptent pas, ou seulement en partie, au titre du FTV.</p>
<h2>Méthode et limites</h2>
<ul class="notes">
<li>Données : traces IGC, QR codes des manches et résultats publiés par la PWCA ({e(meta['source'])}). La manche 1, arrêtée et déclarée invalide, n'est pas prise en compte.</li>
<li>Manche 6, arrêtée à 16:41 : les traces sont coupées à l'arrêt et la manche est considérée comme close à ce moment, sans temps de recul (score-back) ni bonus d'altitude comme dans le GAP.</li>
<li>Le sens du start (en entrant ou en sortant du cylindre) est déduit du parcours ; les temps à l'ESS calculés correspondent aux temps officiels à la seconde pour tous les pilotes comparés.</li>
<li>Le temps passé parmi les 10 premiers est un juge imparfait, proche de la logique de Wakefield : l'avantage mesuré est sans doute un peu flatteur.</li>
</ul>
<p class="notes">Généré par <code>app/test/season.js</code> et <code>app/test/report.py</code> du dépôt <a href="https://github.com/jantallus/wakefield-scoring">wakefield-scoring</a>.</p>
</div></body></html>"""
open(out, "w").write(page)
print("written", out, "ftv corr %.2f (first try %.2f, no ftv %.2f), top10 common %d, mean abs %.1f" % (sp_ftv, sp_first, sp_cum, same_top10, mean_abs))
for i, k in enumerate(order[:12]): print(i + 1, display[k], "off", offrank[k], "first", first[k], "%.1f" % (tot[k][0] - lead))
print("Funiati", rk.get(n("Flavio Funiati")), offrank.get(n("Flavio Funiati")))
