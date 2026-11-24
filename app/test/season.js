// Run every task of a competition and compare it with the official results.
// Usage: node app/test/season.js data/gemona-2026 out.json
const fs = require("fs"), path = require("path");
const W = require("../core.js");
const JSZip = require("../vendor/jszip.min.js");
const [dir, outFile] = process.argv.slice(2);
const meta = JSON.parse(fs.readFileSync(path.join(dir, "tasks.json"), "utf8"));
(async () => {
  const out = [];
  for (const m of meta.tasks) {
    const spec = W.parseXctsk(fs.readFileSync(path.join(dir, "tasks", m.id + ".xctsk.txt"), "utf8"));
    const task = W.normaliseTask({ tps: spec.all, goalType: spec.goalType, gate: spec.gate, deadline: spec.deadline, stop: m.stopUtc ? hm(m.stopUtc) : null, dir: spec.dir });
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(dir, m.id + "-igc.zip")));
    const names = Object.keys(zip.files).filter(n => /\.igc$/i.test(n) && !zip.files[n].dir).sort();
    const tracks = [];
    for (const n of names) tracks.push(W.parseIGC(W.decodeBytes(await zip.files[n].async("uint8array")), n.split("/").pop().replace(/\.igc$/i, "")));
    const st = W.prepare(task, tracks.filter(Boolean));
    const off = W.parseOfficialCsv(fs.readFileSync(path.join(dir, "official", m.id + ".csv"), "utf8"));
    const goalFixed = W.applyOfficialGoal(st, off);
    const GV = W.computeField(st, {});
    const clk = W.computeClock(st, GV, {});
    const cmp = W.compare(st, clk, off);
    const offMap = new Map(off.map(o => [W.norm(o.name), o]));
    const offWinner = off.slice().sort((a, b) => b.total - a.total)[0];
    const ess = clk.ranking.filter(r => r.ess !== null && r.goal);
    const rows = clk.ranking.map(r => { const o = offMap.get(W.norm(r.name)); return { name: r.name, rank: r.rank, realRank: r.realRank || null, ess: r.ess, goal: !!r.goal, final: Math.round(r.final), credit: r.credit, dReal: r.dReal ?? null, dCorr: r.dCorr ?? null, top10: st.top10[r.i] / 60, offRank: o ? o.rank : null, offLead: o ? o.lead : null, offTotal: o ? o.total : null }; });
    const moved = ess.filter(r => r.rank !== r.realRank).length;
    const res = { id: m.id, label: m.label, date: m.date, stopped: !!m.stopUtc, D: clk.D, vref: clk.vref, maxCredit: clk.maxCredit, pilots: clk.ranking.length, ess: ess.length, essNoGoal: clk.ranking.filter(r => r.ess !== null && !r.goal).map(r => r.name), goalFixed,
      winnerOfficial: offWinner.name, winnerWakefield: ess[0] ? ess[0].name : null, firstAtEss: ess.slice().sort((a, b) => a.ess - b.ess)[0]?.name || null,
      spearmanOfficial: cmp.officialVsWakefield, spearmanOfficialArrival: cmp.officialVsArrival, top10VsLead: cmp.top10VsLead, top10VsCredit: cmp.top10VsCredit, compared: cmp.n, moved, rows };
    out.push(res);
    console.log("%s %s | D %s km | ESS %d/%d | vainqueur officiel %s | Wakefield %s | 1er à l'ESS %s | rang off/wake %s | top10~lead %s, top10~crédit %s | %d/%d déplacés",
      m.id, m.date, clk.D.toFixed(1), ess.length, clk.ranking.length, offWinner.name, res.winnerWakefield, res.firstAtEss, cmp.officialVsWakefield.toFixed(2), (cmp.top10VsLead ?? NaN).toFixed(2), (cmp.top10VsCredit ?? NaN).toFixed(2), moved, ess.length);
  }
  fs.writeFileSync(outFile, JSON.stringify(out));
})().catch(e => { console.error(e); process.exit(1); });
function hm(s) { const [h, m] = s.split(":").map(Number); return h * 3600 + m * 60; }
