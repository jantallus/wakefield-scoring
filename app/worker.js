/* Wakefield worker: heavy computation off the page's thread. */
importScripts("core.js");
const W = self.Wakefield;
let st = null, GV = null, tracks = null, taskSpec = null, official = null;
const post = (type, data) => self.postMessage(Object.assign({ type }, data || {}));
function clockAndReplay(opt) {
  if (official) W.applyOfficialGoal(st, official);
  const clk = W.computeClock(st, GV, opt);
  const replay = W.buildReplay(st, GV, clk);
  const ranking = clk.ranking.map(r => ({ i: r.i, name: r.name, rank: r.rank, realRank: r.realRank || null, ess: r.ess, goal: r.goal, final: r.final, credit: r.credit, auto: r.auto, disc: r.disc, dReal: r.dReal, dCorr: r.dCorr, remLand: r.remLand, top10: st.top10[r.i] / 60 }));
  const cmp = official ? W.compare(st, clk, official) : null;
  if (cmp) delete cmp.rows;
  post("result", { replay, ranking, vref: clk.vref, D: clk.D, maxCredit: clk.maxCredit, base: clk.base, compare: cmp, opt });
}
self.onmessage = e => {
  const m = e.data;
  try {
    if (m.cmd === "load") {
      taskSpec = m.task;
      tracks = m.tracks.map(f => W.parseIGC(f.text, f.name.replace(/\.igc$/i, "")));
      official = m.official || null;
      post("loaded", { tracks: tracks.filter(Boolean).length, skipped: tracks.filter(t => !t).length });
    } else if (m.cmd === "prepare") {
      const task = W.normaliseTask(JSON.parse(JSON.stringify(taskSpec)));
      st = W.prepare(task, tracks.filter(Boolean), m.opt, p => post("progress", { stage: "Lecture des traces", p }));
      post("prepared", { D: task.D, Dtoff: task.Dtoff, dir: task.dir, n: st.N, started: st.pilots.filter(p => p.start !== null).length, ess: st.pilots.filter(p => p.ess).length });
    } else if (m.cmd === "field") {
      GV = W.computeField(st, m.opt, p => post("progress", { stage: "Calcul du champ", p }));
      clockAndReplay(m.opt);
    } else if (m.cmd === "clock") {
      clockAndReplay(m.opt);
    } else if (m.cmd === "official") {
      official = m.official;
      if (st && GV) clockAndReplay(m.opt);
    }
  } catch (err) { post("error", { message: err.message || String(err) }); }
};
