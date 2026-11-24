// Precompute a task's result (same object the worker sends) for a replay page.
// Usage: node app/test/export_replay.js <competition dir> <task id> <out.json>
const fs = require("fs"), path = require("path");
const W = require("../core.js"), JSZip = require("../vendor/jszip.min.js");
const [dir, id, outFile] = process.argv.slice(2);
(async () => {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "tasks.json"), "utf8")), m = meta.tasks.find(t => t.id === id);
  const sp = W.parseXctsk(fs.readFileSync(path.join(dir, "tasks", id + ".xctsk.txt"), "utf8"));
  const hm = s => { const [h, mi] = s.split(":").map(Number); return h * 3600 + mi * 60; };
  const task = W.normaliseTask({ tps: sp.all, goalType: sp.goalType, gate: sp.gate, deadline: sp.deadline, stop: m.stopUtc ? hm(m.stopUtc) : null, dir: sp.dir });
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(dir, id + "-igc.zip")));
  const tracks = [];
  for (const n of Object.keys(zip.files).filter(n => /\.igc$/i.test(n)).sort()) tracks.push(W.parseIGC(W.decodeBytes(await zip.files[n].async("uint8array")), n.split("/").pop().replace(/\.igc$/i, "")));
  const st = W.prepare(task, tracks.filter(Boolean));
  const off = W.parseOfficialCsv(fs.readFileSync(path.join(dir, "official", id + ".csv"), "utf8"));
  W.applyOfficialGoal(st, off);
  const opt = Object.assign({}, W.DEFAULTS), GV = W.computeField(st, opt), clk = W.computeClock(st, GV, opt);
  const replay = W.buildReplay(st, GV, clk);
  const ranking = clk.ranking.map(r => ({ i: r.i, name: r.name, rank: r.rank, realRank: r.realRank || null, ess: r.ess, goal: r.goal, final: r.final, credit: r.credit, auto: r.auto, fol: r.fol, dReal: r.dReal, dCorr: r.dCorr, remLand: r.remLand, top10: st.top10[r.i] / 60 }));
  const cmp = W.compare(st, clk, off); delete cmp.rows;
  fs.writeFileSync(outFile, JSON.stringify({ replay, ranking, vref: clk.vref, D: clk.D, maxCredit: clk.maxCredit, base: clk.base, compare: cmp, opt }));
  console.log(outFile, (fs.statSync(outFile).size / 1e6).toFixed(1), "MB");
})().catch(e => { console.error(e); process.exit(1); });
