// Compute a task with the JavaScript core and write its ranking as JSON.
// Usage: node app/test/export_results.js <task .xctsk or QR text> <igc zip> <out.json>
const fs = require("fs");
const W = require("../core.js");
const JSZip = require("../vendor/jszip.min.js");
const [taskFile, zipFile, outFile] = process.argv.slice(2);
(async () => {
  const task = W.parseXctsk(fs.readFileSync(taskFile, "utf8"));
  const zip = await JSZip.loadAsync(fs.readFileSync(zipFile));
  const names = Object.keys(zip.files).filter(n => /\.igc$/i.test(n) && !zip.files[n].dir).sort();
  const tracks = [];
  for (const n of names) tracks.push(W.parseIGC(await zip.files[n].async("binarystring"), n.split("/").pop().replace(/\.igc$/i, "")));
  const st = W.prepare(task, tracks.filter(Boolean));
  const GV = W.computeField(st, {});
  const clk = W.computeClock(st, GV, {});
  const ranking = clk.ranking.map(r => ({ name: r.name, ess: r.ess, goal: !!r.goal, tau: r.tau, final: r.final, auto: r.auto, dReal: r.dReal ?? null, dCorr: r.dCorr ?? null }));
  fs.writeFileSync(outFile, JSON.stringify({ D: clk.D, vref: clk.vref, ranking }));
  console.log("%s: %d pilots, %d at ESS, D %s km, v_ref %s km/h", outFile, ranking.length, ranking.filter(r => r.ess !== null).length, clk.D.toFixed(2), clk.vref.toFixed(1));
})().catch(e => { console.error(e); process.exit(1); });
