// Run: node app/test/node_test.js <task QR text file> <folder of .igc files> [official csv]
const fs = require("fs"), path = require("path");
const W = require("../core.js");
const [qrFile, dir, offCsv] = process.argv.slice(2);
const task = W.parseXctsk(fs.readFileSync(qrFile, "utf8"));
console.log("SSS->ESS %s km, take-off->ESS %s km, gate %s, deadline %s, start %s", task.D.toFixed(2), task.Dtoff.toFixed(2), task.gate, task.deadline, task.dir);
const tracks = fs.readdirSync(dir).filter(f => /\.igc$/i.test(f)).sort().map(f => W.parseIGC(fs.readFileSync(path.join(dir, f), "latin1"), f));
let t0 = Date.now();
const st = W.prepare(task, tracks);
console.log("prepare %d ms, %d pilots, %d started, %d at ESS", Date.now() - t0, st.N, st.pilots.filter(p => p.start !== null).length, st.pilots.filter(p => p.ess).length);
t0 = Date.now();
const GV = W.computeField(st, {});
console.log("field %d ms", Date.now() - t0);
t0 = Date.now();
const clk = W.computeClock(st, GV, {});
console.log("clock %d ms, v_ref %s km/h, max credit %s min", Date.now() - t0, clk.vref.toFixed(1), (clk.maxCredit / 60).toFixed(1));
const f = s => { s = Math.round(s); return Math.floor(s / 3600) + ":" + String(Math.floor(s % 3600 / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
clk.ranking.slice(0, 6).forEach(r => console.log(r.rank, "(réel " + r.realRank + ")", r.name, "réel", f(r.ess), "corrigé", f(r.final), "crédit", (r.credit / 60).toFixed(1)));
const land = clk.ranking.filter(r => r.ess === null).slice(0, 3);
land.forEach(r => console.log(r.rank, r.name, "posé", r.dReal.toFixed(1), "->", r.dCorr.toFixed(1), "km, temps", f(r.final)));
const rp = W.buildReplay(st, GV, clk);
console.log("replay %d pilots, %d frames, %s MB", rp.pilots.length, rp.pilots[0].x.length, (JSON.stringify(rp).length / 1e6).toFixed(1));
if (offCsv) { const c = W.compare(st, clk, W.parseOfficialCsv(fs.readFileSync(offCsv, "utf8"))); console.log("compare n=%d off/wake %s top10/lead %s top10/credit %s", c.n, c.officialVsWakefield.toFixed(2), c.top10VsLead.toFixed(2), c.top10VsCredit.toFixed(2)); }
