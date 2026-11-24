/* Wakefield core: task and IGC parsing, turnpoint validation, field and clock.
   Runs in a Web Worker (importScripts) and in Node (module.exports) for tests. */
(function (root) {
  "use strict";

  const DEFAULTS = {
    tol: 0.005,        // cylinder tolerance, share of the radius (FAI cat 2)
    sigA: 3.0,         // reach of the cone ahead, km
    sigL0: 0.6,        // cone width right behind a pilot, km
    sigLk: 0.22,       // cone widening, km per km
    sigB: 0.4,         // reach of a pilot behind you, km
    phi0: 8,           // field threshold: how much help counts as "helped"
    Tm: 240,           // wake memory, s
    thGap: 60,         // a thermal cycle ends when nobody has climbed in it for this long, s
    thR: 0.4,          // radius of a thermal: climbers closer than this to a marker keep it alive, km
    thMax: 3600,       // longest life of a thermal marker, s
    thFade: 180,       // after the cycle ends, the marker fades out over this time constant, s
    catchUp: 1,        // catching up: the share of your pace above the pace of the pilots helping you counts as your own; 0 = off
    paceWin: 600,      // window over which a pilot's pace (progress along the course) is measured, s
    keep: 720,         // how far back the trail is read, s
    trailW: 1,         // strength of the wake (trail points vs current positions)
    k: 2,              // angle exponent below the horizon (above: k / 2)
    climbW: 1,         // weight of a track point where the pilot was climbing
    sinkW: 0.35,       // weight of a track point where the pilot was not climbing
    eps: 0.15,         // price of risk
    follow: 0.1,       // follower in a marked thermal: while a pilot climbs in a thermal that someone else marked before he got there,
                       // his clock runs this much faster than real time (0 = off). Marking a thermal earns nothing, so it cannot be faked for credit.
    landedBase: "deadline" // or "lastEss"
  };
  const FIELD_KEYS = ["tol", "sigA", "sigL0", "sigLk", "sigB", "phi0", "Tm", "thGap", "thR", "thFade", "catchUp", "paceWin", "trailW", "k", "climbW", "sinkW"];
  const DT = 10, TR = 20, STEP = 20;

  /* ---------- task ---------- */
  function decodePolyline(s) {
    const out = []; let i = 0;
    while (i < s.length) {
      let r = 0, sh = 0, b;
      do { b = s.charCodeAt(i++) - 63; r |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20);
      out.push(r & 1 ? ~(r >> 1) : r >> 1);
    }
    return out;
  }
  function hms(s) { const m = /(\d+):(\d+):?(\d+)?/.exec(s || ""); return m ? +m[1] * 3600 + +m[2] * 60 + (+m[3] || 0) : null; }

  /* XCTrack task: QR text "XCTSK:{...}" (v2) or .xctsk JSON (v1). Returns a task object. */
  function parseXctsk(text) {
    text = String(text).trim();
    if (text.startsWith("XCTSK:")) text = text.slice(6);
    const j = JSON.parse(text);
    const tps = [];
    let gate = null, deadline = null, dir = null, goalType = null;
    if (j.version === 2 || j.t) {
      for (const p of j.t) {
        const z = decodePolyline(p.z);
        tps.push({ name: p.n || "", lon: z[0] / 1e5, lat: z[1] / 1e5, alt: z[2], radius: z[3] / 1000, type: p.t === 2 ? "SSS" : p.t === 3 ? "ESS" : "TURN" });
      }
      // the meaning of "d" (start direction) is not reliable across tools: the direction is deduced from the course
      if (j.s) gate = hms((j.s.g || [])[0]);
      if (j.g) { deadline = hms(j.g.d); goalType = j.g.t === 1 ? "LINE" : "CYLINDER"; }
    } else {
      for (const p of j.turnpoints) {
        const w = p.waypoint;
        tps.push({ name: w.name || "", lon: w.lon, lat: w.lat, alt: w.altSmoothed || 0, radius: p.radius / 1000, type: p.type === "SSS" ? "SSS" : p.type === "ESS" ? "ESS" : p.type === "TAKEOFF" ? "TAKEOFF" : "TURN" });
      }
      if (j.sss) { gate = hms((j.sss.timeGates || [])[0]); dir = j.sss.direction || null; }
      if (j.goal) { deadline = hms(j.goal.deadline); goalType = j.goal.type === "LINE" ? "LINE" : "CYLINDER"; }
    }
    // first point of a v2 task is take-off; a point after ESS is the goal
    if (tps.length && tps[0].type === "TURN" && j.version === 2) tps[0].type = "TAKEOFF";
    const e = tps.findIndex(p => p.type === "ESS");
    if (e >= 0) for (let q = e + 1; q < tps.length; q++) if (tps[q].type === "TURN") tps[q].type = "GOAL";
    return normaliseTask({ tps, gate, deadline, dir, goalType });
  }
  /* Keep take-off, then SSS ... ESS; points after ESS (goal) are ignored by the clock. */
  function normaliseTask(t) {
    const tps = t.tps.slice();
    let toff = tps.find(p => p.type === "TAKEOFF") || null;
    const si = tps.findIndex(p => p.type === "SSS"), ei = tps.findIndex(p => p.type === "ESS");
    if (si < 0 || ei < 0 || ei <= si) throw new Error("La manche doit contenir un SSS puis un ESS.");
    const course = tps.slice(si, ei + 1);
    if (!toff) toff = tps[0];
    const lat0 = course.reduce((a, p) => a + p.lat, 0) / course.length;
    const lon0 = course.reduce((a, p) => a + p.lon, 0) / course.length;
    // the goal: the first point after ESS (none: ESS is the goal)
    const goal = tps.slice(ei + 1).find(p => p.type === "GOAL" || p.type === "TURN") || null;
    const task = { course, toff, goal, goalType: t.goalType || "CYLINDER", gate: t.gate, deadline: t.deadline, stop: t.stop == null ? null : t.stop, dir: t.dir, lat0, lon0, all: tps };
    const KX = 111.32 * Math.cos(lat0 * Math.PI / 180), KY = 110.574;
    task.proj = (lat, lon) => [(lon - lon0) * KX, (lat - lat0) * KY];
    task.C = course.map(p => task.proj(p.lat, p.lon));
    task.R = course.map(p => p.radius);
    if (!task.dir) {
      // start direction: if the next turnpoint lies inside the start cylinder, the start is made by entering it, otherwise by leaving it
      const s = course[0], n = course[1];
      task.dir = geodist(s.lat, s.lon, n.lat, n.lon) < s.radius ? "ENTER" : "EXIT";
    }
    optimise(task);
    return task;
  }
  function optimise(task) {
    const C = task.C, R = task.R, n = C.length, NA = 1440;
    const T0 = task.proj(task.toff.lat, task.toff.lon);
    const P = C.map(c => c.slice());
    const ring = C.map((c, i) => { const a = []; for (let q = 0; q < NA; q++) { const an = 2 * Math.PI * q / NA; a.push([c[0] + R[i] * Math.cos(an), c[1] + R[i] * Math.sin(an)]); } return a; });
    for (let it = 0; it < 60; it++) for (let i = 0; i < n; i++) {
      const prev = i === 0 ? T0 : P[i - 1]; let best = 1e18, bp = null;
      for (const p of ring[i]) {
        let d = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
        if (i + 1 < n) d += Math.hypot(p[0] - P[i + 1][0], p[1] - P[i + 1][1]);
        if (d < best) { best = d; bp = p; }
      }
      P[i] = bp;
    }
    const pts = [T0].concat(P), legs = [];
    for (let i = 1; i < pts.length; i++) legs.push(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    task.P = P; task.T0 = T0;
    task.Dtoff = legs.reduce((a, b) => a + b, 0);
    task.D = legs.slice(1).reduce((a, b) => a + b, 0);
    task.AFTER = C.map((_, i) => legs.slice(i + 1).reduce((a, b) => a + b, 0));
    task.tails = C.map((c, k) => {
      if (k >= n - 1) return null;
      const ring2 = [], nxt = P[k + 1];
      for (let q = 0; q < 360; q++) { const an = 2 * Math.PI * q / 360, x = c[0] + R[k] * Math.cos(an), y = c[1] + R[k] * Math.sin(an); ring2.push([x, y, Math.hypot(x - nxt[0], y - nxt[1]) + task.AFTER[k + 1]]); }
      return ring2;
    });
  }
  function remDist(task, x, y, k) {
    const n = task.C.length;
    if (k >= n) return 0;
    if (k === n - 1) return Math.max(0, Math.hypot(x - task.C[k][0], y - task.C[k][1]) - task.R[k]);
    let best = 1e18;
    for (const r of task.tails[k]) { const d = Math.hypot(x - r[0], y - r[1]) + r[2]; if (d < best) best = d; }
    return best;
  }

  /* Distance on the WGS84 ellipsoid in km (Andoyer-Lambert, a few metres over 100 km). */
  function geodist(lat1, lon1, lat2, lon2) {
    const a = 6378.137, f = 1 / 298.257223563, rad = Math.PI / 180;
    const b1 = Math.atan((1 - f) * Math.tan(lat1 * rad)), b2 = Math.atan((1 - f) * Math.tan(lat2 * rad)), dl = (lon2 - lon1) * rad;
    const h = Math.sin((b2 - b1) / 2) ** 2 + Math.cos(b1) * Math.cos(b2) * Math.sin(dl / 2) ** 2;
    const sg = 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
    if (sg < 1e-12) return 0;
    const P = (b1 + b2) / 2, Q = (b2 - b1) / 2;
    const X = (sg - Math.sin(sg)) * Math.sin(P) ** 2 * Math.cos(Q) ** 2 / Math.cos(sg / 2) ** 2;
    const Y = (sg + Math.sin(sg)) * Math.cos(P) ** 2 * Math.sin(Q) ** 2 / Math.sin(sg / 2) ** 2;
    return a * (sg - f / 2 * (X + Y));
  }

  /* ---------- waypoints (CompeGPS .wpt) ---------- */
  function parseWpt(text) {
    const out = [];
    for (const line of String(text).split(/\r?\n/)) {
      const m = /^W\s+(\S+)\s+A\s+([\d.]+)\S*?([NS])\s+([\d.]+)\S*?([EW])\s+\S+\s+\S+\s+([-\d.]+)\s*(.*)$/.exec(line);
      if (m) out.push({ id: m[1], lat: (m[3] === "S" ? -1 : 1) * +m[2], lon: (m[5] === "W" ? -1 : 1) * +m[4], alt: +m[6], desc: m[7].trim() });
    }
    return out;
  }

  /* ---------- IGC ---------- */
  function parseIGC(text, fallbackName) {
    let name = fallbackName || "";
    const t = [], la = [], lo = [], za = [];
    for (const line of String(text).split(/\r?\n/)) {
      if (line.startsWith("HFPLT")) { const v = line.split(":").slice(1).join(":").trim(); if (v) name = v; }
      else if (line[0] === "B" && line.length >= 35) {
        const hh = +line.slice(1, 3), mm = +line.slice(3, 5), ss = +line.slice(5, 7);
        let lat = +line.slice(7, 9) + +line.slice(9, 14) / 60000; if (line[14] === "S") lat = -lat;
        let lon = +line.slice(15, 18) + +line.slice(18, 23) / 60000; if (line[23] === "W") lon = -lon;
        const pa = +line.slice(25, 30), ga = +line.slice(30, 35);
        if ([hh, mm, ss, lat, lon, pa, ga].some(Number.isNaN)) continue;
        t.push(hh * 3600 + mm * 60 + ss); la.push(lat); lo.push(lon); za.push(ga > 0 ? ga : pa);
      }
    }
    if (t.length < 100) return null;
    const idx = t.map((_, i) => i).sort((a, b) => t[a] - t[b] || a - b);
    const T = [], LA = [], LO = [], Z = [];
    let last = -1;
    for (const i of idx) { if (t[i] > last) { T.push(t[i]); LA.push(la[i]); LO.push(lo[i]); Z.push(za[i]); last = t[i]; } }
    return { name, t: T, lat: LA, lon: LO, z: Z };
  }

  /* IGC files are mostly ASCII; names may be UTF-8 or Latin-1. */
  function decodeBytes(u8) {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(u8); }
    catch (e) { let s = ""; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return s; }
  }

  function interp(xs, ys, x) {
    if (x <= xs[0]) return ys[0];
    const n = xs.length; if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
    const u = (x - xs[lo]) / (xs[hi] - xs[lo]);
    return ys[lo] + (ys[hi] - ys[lo]) * u;
  }

  /* Start, turnpoints, ESS, take-off and landing times for one pilot. */
  function analyse(task, trk, tol) {
    const n = trk.t.length, C = task.C, R = task.R, nc = C.length;
    const x = new Float64Array(n), y = new Float64Array(n);
    for (let i = 0; i < n; i++) { const p = task.proj(trk.lat[i], trk.lon[i]); x[i] = p[0]; y[i] = p[1]; }
    // cylinder validation on the WGS84 ellipsoid (the planar projection is only used for progress)
    const cs = task.course;
    const d = k => i => geodist(trk.lat[i], trk.lon[i], cs[k].lat, cs[k].lon) - R[k];
    const d0 = d(0);
    let start_i = null, g0 = 0;
    while (g0 < n && trk.t[g0] < task.gate) g0++;
    let flag = false;
    for (let j = g0; j < n; j++) {
      const v = d0(j);
      if (task.dir === "EXIT") { if (v < tol * R[0]) flag = true; else if (flag) { start_i = j; break; } }
      else { if (v > -tol * R[0]) flag = true; else if (flag) { start_i = j; break; } }
    }
    const tags = [];
    if (start_i !== null) {
      let k = 1;
      for (let j = start_i; j < n && k < nc; j++) {
        if (d(k)(j) <= tol * R[k]) { tags.push(trk.t[j]); k++; }
      }
    }
    // take-off / landing: first and last fix above 15 km/h
    let off = trk.t[0], land = trk.t[0], seen = false;
    for (let i = 1; i < n; i++) {
      const sp = Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]) / (trk.t[i] - trk.t[i - 1]) * 3600;
      if (sp > 15) { if (!seen) { off = trk.t[i]; seen = true; } land = trk.t[i]; }
    }
    const ess = tags.length === nc - 1 ? tags[tags.length - 1] : null;
    // goal: after ESS, the pilot must still reach the goal (no timing there). Without a goal point, ESS is the goal.
    let goal = ess !== null && !task.goal;
    if (ess !== null && task.goal) {
      const gl = task.goal, rg = gl.radius * (1 + tol);
      // the goal must be reached in flight: stop at the first minute spent on the ground after ESS
      // (ground speed under 5 km/h and climb or sink under 0.5 m/s for 60 s)
      let still = null;
      // a goal line is crossed (its length is twice the radius, across the last leg); a goal cylinder is entered
      const line = task.goalType === "LINE", G0 = task.proj(gl.lat, gl.lon), PL = task.P[task.P.length - 1];
      let ux = G0[0] - PL[0], uy = G0[1] - PL[1]; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
      const along = j => (x[j] - G0[0]) * ux + (y[j] - G0[1]) * uy, across = j => -(x[j] - G0[0]) * uy + (y[j] - G0[1]) * ux;
      for (let j = 1; j < n; j++) {
        if (trk.t[j] < ess) continue;
        if (line) {
          const a0 = along(j - 1), a1 = along(j);
          if (a0 < 0 && a1 >= 0) { const u = -a0 / (a1 - a0), c = across(j - 1) + (across(j) - across(j - 1)) * u; if (Math.abs(c) <= rg) { goal = true; break; } }
        } else if (geodist(trk.lat[j], trk.lon[j], gl.lat, gl.lon) <= rg) { goal = true; break; }
        const dt = trk.t[j] - trk.t[j - 1], sp = Math.hypot(x[j] - x[j - 1], y[j] - y[j - 1]) / dt * 3600, vz = Math.abs(trk.z[j] - trk.z[j - 1]) / dt;
        if (sp < 5 && vz < 0.5) { if (still === null) still = trk.t[j - 1]; if (trk.t[j] - still >= 60) break; } else still = null;
      }
    }
    return { name: trk.name, t: trk.t, x, y, z: trk.z, start: start_i === null ? null : trk.t[start_i], tags, ess, goal, tOff: off, tLand: land };
  }
  function kAt(p, time) { if (p.start === null || time < p.start) return 0; let k = 1; for (const tg of p.tags) if (tg <= time) k++; return k; }

  /* ---------- preparation: grid, progress, climbing ---------- */
  function prepare(task, tracks, opt, progress) {
    opt = Object.assign({}, DEFAULTS, opt || {});
    const pilots = [];
    // a stopped task: what was flown after the stop does not count
    if (task.stop !== null) tracks = tracks.map(trk => {
      if (!trk) return trk; let n = trk.t.length; while (n > 0 && trk.t[n - 1] > task.stop) n--;
      return n < 100 ? null : { name: trk.name, t: trk.t.slice(0, n), lat: trk.lat.slice(0, n), lon: trk.lon.slice(0, n), z: trk.z.slice(0, n) };
    });
    tracks.forEach((trk, i) => { if (trk) pilots.push(analyse(task, trk, opt.tol)); if (progress && i % 10 === 0) progress(i / tracks.length); });
    const started = pilots.filter(p => p.start !== null);
    if (!started.length) throw new Error("Aucun pilote n'a validé le start : vérifiez l'heure de la porte et le cylindre de start.");
    const KEEP = 3600; // the grid starts an hour before the gate, for the thermal markers
    const tEnd = Math.max(...started.map(p => p.tLand));
    const G = Math.floor((tEnd - (task.gate - KEEP)) / DT) + 2, N = pilots.length;
    const grid = new Float64Array(G); for (let g = 0; g < G; g++) grid[g] = task.gate - KEEP + g * DT;
    const mk = () => new Float32Array(N * G).fill(NaN);
    const X = mk(), Y = mk(), Z = mk(), S = mk(), AIR = new Uint8Array(N * G), CL = new Uint8Array(N * G);
    pilots.forEach((p, i) => {
      const lo = Math.max(p.t[0], p.tOff), hi = Math.min(p.t[p.t.length - 1], p.tLand);
      for (let g = 0; g < G; g++) {
        const tt = grid[g], o = i * G + g;
        const z20 = interp(p.t, p.z, tt - 20), zz = interp(p.t, p.z, tt);
        if (tt >= lo && tt <= hi) {
          AIR[o] = 1;
          const xx = interp(p.t, p.x, tt), yy = interp(p.t, p.y, tt);
          X[o] = xx; Y[o] = yy; Z[o] = zz;
          S[o] = task.D - remDist(task, xx, yy, kAt(p, tt));
          CL[o] = (zz - z20) / 20 > 0.3 ? 1 : 0;
        }
      }
      const li = Math.max(0, p.t.findIndex(v => v >= p.tLand));
      p.remLand = p.ess ? 0 : remDist(task, p.x[li], p.y[li], kAt(p, p.tLand)); // a pilot at ESS without goal: the whole distance, no more
      if (progress && i % 10 === 0) progress(0.5 + 0.5 * i / N);
    });
    const g0 = Math.round(KEEP / DT);
    // time spent in the race's top 5 / top 10 (for the comparison with official leading points)
    const top5 = new Float64Array(N), top10 = new Float64Array(N);
    for (let g = g0; g < G; g++) {
      const act = [];
      for (let i = 0; i < N; i++) { const p = pilots[i]; if (AIR[i * G + g] && p.start !== null && (!p.ess || grid[g] < p.ess)) act.push(i); }
      if (act.length < 10) continue;
      act.sort((a, b) => S[b * G + g] - S[a * G + g]);
      for (let q = 0; q < 10; q++) { top10[act[q]] += DT; if (q < 5) top5[act[q]] += DT; }
    }
    return { task, pilots, grid, G, N, g0, X, Y, Z, S, AIR, CL, top5, top10, keep: KEEP };
  }

  /* ---------- thermal cycles ----------
     A point where a pilot climbs marks a thermal. The marker lives as long as the thermal is occupied:
     each time step, if some pilot climbs within thR of it, it is still in use. Once nobody has climbed
     there for thGap, the cycle is over and the marker dies (a later climb there starts a new cycle).
     Returns, for each climbing grid point, the time its marker dies. */
  function thermalDeaths(st, opt) {
    const { G, N, X, Y, AIR, CL, grid } = st;
    const DEATH = new Float64Array(N * G).fill(-Infinity), r2 = opt.thR * opt.thR;
    let act = [];                 // active markers: [pilot index i, grid index g, x, y, lastSeen]
    for (let h = 0; h < G; h++) {
      const cx = [], cy = [];
      for (let i = 0; i < N; i++) { const o = i * G + h; if (AIR[o] && CL[o]) { cx.push(X[o]); cy.push(Y[o]); act.push([i, h, X[o], Y[o], grid[h]]); } }
      const keep = [];
      for (const a of act) {
        for (let q = 0; q < cx.length; q++) { const dx = cx[q] - a[2], dy = cy[q] - a[3]; if (dx * dx + dy * dy <= r2) { a[4] = grid[h]; break; } }
        if (grid[h] - a[4] > opt.thGap || grid[h] - grid[a[1]] > opt.thMax) DEATH[a[0] * G + a[1]] = Math.min(a[4] + opt.thGap, grid[a[1]] + opt.thMax);
        else keep.push(a);
      }
      act = keep;
    }
    for (const a of act) DEATH[a[0] * G + a[1]] = Infinity;
    return DEATH;
  }

  /* ---------- field ---------- */
  function computeField(st, opt, progress) {
    opt = Object.assign({}, DEFAULTS, opt || {});
    const { G, N, g0, X, Y, Z, S, AIR, CL, grid } = st;
    const DEATH = thermalDeaths(st, opt);
    // pace: progress along the course over the last paceWin seconds, km/h (NaN when unknown)
    const PACE = new Float32Array(N * G).fill(NaN), pw = Math.round(opt.paceWin / DT);
    for (let i = 0; i < N; i++) for (let g = pw; g < G; g++) { const o = i * G + g, p = o - pw; if (AIR[o] && AIR[p]) PACE[o] = (S[o] - S[p]) / opt.paceWin * 3600; }
    const lag = Math.round(TR / DT), keepTh = Math.max(opt.keep, opt.thMax), nlag = Math.round(keepTh / TR), nKeep = Math.round(opt.keep / TR);
    const GV = new Float32Array(N * G), FOL = new Float32Array(N * G);
    // start of each pilot's current climb in a thermal (a pause shorter than thGap continues the same climb)
    const CS = new Float64Array(N * G).fill(NaN);
    for (let i = 0; i < N; i++) {
      let start = NaN, last = -Infinity;
      for (let g = 0; g < G; g++) { const o = i * G + g; if (AIR[o] && CL[o]) { if (grid[g] - last > opt.thGap) start = grid[g]; last = grid[g]; CS[o] = start; } }
    }
    const thR2 = opt.thR * opt.thR;
    const sA2 = opt.sigA * opt.sigA, sB2 = opt.sigB * opt.sigB, rA = 3 * opt.sigA, rB2 = 9 * sB2;
    const kb = opt.k / 2, ka = opt.k / 4;
    const cap = N * (nlag + 1);
    const sx = new Float32Array(cap), sy = new Float32Array(cap), sz = new Float32Array(cap), ss = new Float32Array(cap), sw = new Float32Array(cap), so = new Int32Array(cap);
    const sth = new Float32Array(cap), st0 = new Float64Array(cap); // thermal marker strength (1 while its cycle lives, then the fade) and when it was laid
    for (let gi = g0; gi < G; gi++) {
      let m = 0;
      for (let j = 0; j <= nlag; j++) {
        const idx = gi - j * lag; if (idx < 0) break;
        const age = grid[gi] - grid[idx];
        // the wake (every point) fades with Tm over the last `keep` seconds; a climbing point also
        // keeps marking its thermal at full weight until that thermal's cycle ends (thermalDeaths).
        // Old markers are read one trail step in three, with three times the weight.
        const old = j > nKeep;
        if (old && j % 3) continue;
        const nrm = j === 0 ? 1 : (TR / opt.Tm) * opt.trailW * (old ? 3 : 1);
        const wake = old ? 0 : Math.exp(-age / opt.Tm);
        for (let i = 0; i < N; i++) {
          const o = i * G + idx; if (!AIR[o]) continue;
          let w, th = 0;
          if (CL[o]) {
            const dth = DEATH[o], t = grid[gi];
            const fade = dth > t ? 1 : opt.thFade > 0 && dth > -Infinity ? Math.exp(-(t - dth) / opt.thFade) : 0;
            w = nrm * opt.climbW * Math.max(wake, fade); th = fade;
          }
          else w = nrm * opt.sinkW * wake;
          if (w <= 0) continue;
          sx[m] = X[o]; sy[m] = Y[o]; sz[m] = Z[o]; ss[m] = S[o]; sw[m] = w; so[m] = i; sth[m] = th; st0[m] = grid[idx]; m++;
        }
      }
      for (let i = 0; i < N; i++) {
        const oo = i * G + gi; if (!AIR[oo]) continue;
        const ox = X[oo], oy = Y[oo], oz = Z[oo], os = S[oo], vo = PACE[oo];
        const cu = opt.catchUp > 0 && vo > 5;
        let phi = 0, hv = 0, hw = 0;
        for (let q = 0; q < m; q++) {
          if (so[q] === i) continue;
          const dx = ss[q] - os, dxg = sx[q] - ox, dyg = sy[q] - oy, dh2 = dxg * dxg + dyg * dyg;
          let K;
          if (dx > 0) {
            if (dx > rA) continue;
            const lat2 = Math.max(0, dh2 - dx * dx), sl = opt.sigL0 + opt.sigLk * dx;
            if (lat2 > 9 * sl * sl) continue;
            const dz = (sz[q] - oz) / 1000;
            K = Math.exp(-(dx * dx) / sA2 - lat2 / (sl * sl) - dz * dz);
            const r2 = dh2 + dz * dz;
            const h = K * (r2 > 1e-6 ? Math.pow(dh2 / r2, dz > 0 ? ka : kb) : 1) * sw[q];
            phi += h;
            if (cu) { const vs = PACE[so[q] * G + gi]; if (!Number.isNaN(vs)) { hv += h * vs; hw += h; } }
          } else {
            if (dh2 > rB2) continue;
            const dz = (sz[q] - oz) / 1000, r2 = dh2 + dz * dz;
            K = Math.exp(-r2 / sB2);
            const h = K * (r2 > 1e-6 ? Math.pow(dh2 / r2, dz > 0 ? ka : kb) : 1) * sw[q];
            phi += h;
            if (cu) { const vs = PACE[so[q] * G + gi]; if (!Number.isNaN(vs)) { hv += h * vs; hw += h; } }
          }
        }
        let g = 1 - Math.exp(-phi / opt.phi0);
        // catching up: progress beyond the pace of the pilots who help you is your own.
        // e = share of your pace above theirs; the help left is g x (1 - catchUp x e).
        if (cu && hw > 0) { const e = Math.max(0, (vo - hv / hw) / vo); g *= Math.max(0, 1 - opt.catchUp * e); }
        GV[oo] = g;
        // follower: climbing in a thermal that another pilot marked before this climb began
        if (CL[oo]) {
          const cs = CS[oo]; let f = 0;
          for (let q = 0; q < m; q++) {
            if (so[q] === i || sth[q] <= f || st0[q] >= cs) continue;
            const dxg = sx[q] - ox, dyg = sy[q] - oy;
            if (dxg * dxg + dyg * dyg <= thR2) f = sth[q];
          }
          FOL[oo] = f;
        }
      }
      if (progress && (gi - g0) % 25 === 0) progress((gi - g0) / (G - g0));
    }
    GV.death = DEATH; // kept for the replay
    GV.fol = FOL;     // follower weight while climbing in someone else's thermal (0..1)
    return GV;
  }

  /* ---------- clock, ranking ---------- */
  function median(a) { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; }
  function computeClock(st, GV, opt) {
    opt = Object.assign({}, DEFAULTS, opt || {});
    const { task, pilots, G, N, g0, S, AIR, CL, grid } = st, D = task.D, gate = task.gate;
    let vref;
    const essP = pilots.filter(p => p.ess);
    if (essP.length) vref = median(essP.map(p => D / ((p.ess - gate) / 3600)));
    else {
      const best = pilots.filter(p => p.start !== null).sort((a, b) => a.remLand - b.remLand).slice(0, 10);
      vref = median(best.map(p => (D - p.remLand) / Math.max(0.1, (p.tLand - gate) / 3600)));
    }
    const PROJ = new Float32Array(N * G).fill(NaN), RATE = new Float32Array(N * G).fill(NaN);
    const res = pilots.map((p, i) => {
      if (p.start === null) return null;
      let tau = 0, auto = 0, fol = 0;
      const tStop = p.ess || p.tLand;
      for (let gi = g0; gi < G; gi++) {
        const a = gi > g0 ? grid[gi - 1] : gate, t1 = grid[gi];
        if (a >= tStop) break;
        const b = Math.min(t1, tStop), o = i * G + gi;
        const ds = AIR[o] && AIR[o - 1] ? Math.max(0, S[o] - S[o - 1]) : 0;
        const v = ds / DT * 3600, g = AIR[o] ? GV[o] : 1;
        let rate = 1 - opt.eps * (1 - g) * v / vref;
        rate = Math.max(0, rate);
        if (opt.follow > 0 && GV.fol && AIR[o] && GV.fol[o] > 0) { const fr = opt.follow * GV.fol[o]; rate += fr; fol += fr * (b - a); }
        tau += rate * (b - a);
        auto += (1 - g) * ds * (b - a) / DT;
        RATE[o] = rate;
        const rem = AIR[o] ? Math.max(0, D - S[o]) : p.remLand;
        PROJ[o] = tau + rem / vref * 3600;
      }
      return { i, name: p.name, ess: p.ess ? p.ess - gate : null, goal: p.goal, tau, auto, fol, remLand: p.remLand, tStop };
    });
    const ok = res.filter(Boolean);
    // only pilots in goal keep their time; a pilot at ESS who did not reach goal is ranked with the landed pilots
    const essR = ok.filter(r => r.ess !== null && r.goal);
    essR.forEach(r => { r.final = r.tau; });
    const lastEss = essR.length ? Math.max(...essR.map(r => r.final)) : null;
    const close = task.stop !== null ? task.stop : task.deadline; // a stopped task closes at the stop
    const base = opt.landedBase === "lastEss" && lastEss !== null ? lastEss : (close !== null ? close - gate : (lastEss || 0));
    const notGoal = ok.filter(r => !(r.ess !== null && r.goal));
    notGoal.forEach(r => {
      r.dReal = Math.max(0, D - r.remLand);
      // the follower's lost time, turned into distance at v_ref
      r.dCorr = Math.max(0, Math.min(D, r.dReal + opt.eps * r.auto - r.fol / 3600 * vref));
      r.final = base + (D - r.dCorr) / vref * 3600;
    });
    ok.forEach(r => { r.credit = r.ess !== null && r.goal ? r.ess - r.final : null; });
    // freeze projections after the stop
    ok.forEach(r => { for (let gi = 0; gi < G; gi++) if (grid[gi] >= r.tStop) PROJ[r.i * G + gi] = r.final; });
    const ranking = essR.slice().sort((a, b) => a.final - b.final)
      .concat(notGoal.sort((a, b) => (b.dCorr - a.dCorr) || (b.dReal - a.dReal) || (a.tau - b.tau)));
    ranking.forEach((r, k) => { r.rank = k + 1; });
    essR.slice().sort((a, b) => a.ess - b.ess).forEach((r, k) => { r.realRank = k + 1; });
    return { vref, D, base, lastEss, ranking, PROJ, RATE, maxCredit: opt.eps * D / vref * 3600 };
  }

  /* Replay frames every STEP seconds. Positions in 10 m, altitude in 10 m, g and rate in %. */
  function buildReplay(st, GV, clk) {
    const { task, pilots, G, grid, X, Y, Z, AIR } = st;
    const byI = new Map(clk.ranking.map(r => [r.i, r]));
    const tEnd = Math.max(...clk.ranking.map(r => r.tStop)) + 300;
    const frames = []; for (let t = task.gate; t < tEnd; t += STEP) frames.push(t);
    const gIdx = frames.map(t => Math.min(G - 1, Math.max(0, Math.round((t - grid[0]) / DT))));
    const out = [];
    pilots.forEach((p, i) => {
      const r = byI.get(i); if (!r) return;
      const P = { n: p.name, x: [], y: [], z: [], g: [], r: [], p: [], s: [], th: [], goal: !!p.goal, ess: r.goal ? r.ess : null, essNoGoal: r.ess !== null && !r.goal ? r.ess : null, fin: Math.round(r.final), auto: +r.auto.toFixed(1), rem: +r.remLand.toFixed(1), dReal: r.dReal, dCorr: r.dCorr };
      let last = [p.x[0], p.y[0], p.z[0]];
      gIdx.forEach((g, k) => {
        const o = i * G + g, t = frames[k];
        let s = AIR[o] ? 1 : 3;
        if (p.ess && t >= p.ess && (p.goal || t <= p.tLand)) s = 2; else if (t > p.tLand) s = 3;
        if (AIR[o]) last = [X[o], Y[o], Z[o]];
        P.x.push(Math.round(last[0] * 100)); P.y.push(Math.round(last[1] * 100)); P.z.push(Math.round(last[2] / 10));
        P.g.push(Math.round((AIR[o] ? GV[o] : 1) * 100));
        P.r.push(s === 1 && !Number.isNaN(clk.RATE[o]) ? Math.round(clk.RATE[o] * 100) : 0);
        const pr = clk.PROJ[o]; P.p.push(Math.round(Number.isNaN(pr) ? r.final : pr)); P.s.push(s);
        // thermal marker: -1 if not climbing, else the frame where its cycle ends
        const dth = GV.death ? GV.death[o] : -Infinity;
        P.th.push(AIR[o] && st.CL[o] && dth > -Infinity ? (dth === Infinity ? 1e6 : Math.round((dth - task.gate) / STEP)) : -1);
      });
      out.push(P);
    });
    return { t0: task.gate, step: STEP, vref: clk.vref, D: clk.D, pilots: out,
      task: { cyl: task.course.map((c, k) => ({ n: c.type === "SSS" ? "SSS " + c.name : c.type === "ESS" ? "ESS " + c.name : c.name, x: task.C[k][0], y: task.C[k][1], r: task.R[k] })), route: task.P } };
  }

  /* When the official results are known, take the official goal status of each pilot at ESS:
     goal lines are judged with tolerances the track alone cannot always settle. */
  function applyOfficialGoal(st, official) {
    const nf = alignNames(st, official); if (nf && typeof process !== "undefined" && process.env.WF_DEBUG) console.error("aligned", nf);
    const off = new Map(official.filter(o => o.status).map(o => [norm(o.name), o.status]));
    let changed = 0;
    for (const p of st.pilots) { if (!p.ess) continue; const s = off.get(norm(p.name)); if (!s) continue; const g = s === "GOAL"; if (g !== p.goal) { p.goal = g; changed++; } }
    return changed;
  }

  /* A track's pilot name can differ from the official one ("felix rodriguez" for "Felix Rodriguez Fernandez"):
     when the name has no exact match, take the only official name whose words contain all of its words (or the reverse). */
  function alignNames(st, official) {
    const offNames = official.map(o => o.name), exact = new Set(offNames.map(norm));
    const words = s => norm(s).split(" ").filter(Boolean), sub = (a, b) => a.every(w => b.includes(w));
    let fixed = 0;
    for (const p of st.pilots) {
      if (exact.has(norm(p.name))) continue;
      const w = words(p.name); if (w.length < 2) continue;
      const hits = offNames.filter(o => { const v = words(o); return sub(w, v) || sub(v, w); });
      if (hits.length === 1 && !st.pilots.some(q => q !== p && norm(q.name) === norm(hits[0]))) { p.name = hits[0]; fixed++; }
    }
    return fixed;
  }

  /* ---------- comparison with official results ---------- */
  // letters that have no accent to strip (ı ł ø đ ß æ œ) are spelled out, so "Tanrıverdi" matches "Tanriverdi"
  const SPELL = { "ı": "i", "ł": "l", "ø": "o", "đ": "d", "ð": "d", "ß": "ss", "æ": "ae", "œ": "oe", "þ": "th" };
  function norm(s) { return String(s).toLowerCase().replace(/[ıłøđðßæœþ]/g, c => SPELL[c]).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/['’]/g, "").replace(/\s+/g, " ").trim(); }
  function parseOfficialCsv(text) {
    const lines = String(text).trim().split(/\r?\n/); const head = lines.shift().split(/[,;\t]/).map(h => h.trim().toLowerCase());
    const col = re => head.findIndex(h => re.test(h));
    const cn = col(/name|nom|pilot/), cl = col(/lead/), ct = col(/total/), cr = col(/rank|^#|^no$|place/), cs = col(/status|statut/);
    if (cn < 0) throw new Error("Le CSV officiel doit avoir une colonne name (nom du pilote).");
    return lines.map(l => l.split(/[,;\t]/)).filter(c => c[cn]).map((c, k) => ({ name: c[cn].trim(), lead: cl >= 0 ? +c[cl] : null, total: ct >= 0 ? +c[ct] : null, rank: cr >= 0 ? +c[cr] : k + 1, status: cs >= 0 ? c[cs].trim().toUpperCase() : null }));
  }
  function spearman(a, b) {
    const rk = v => { const o = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]); const r = new Array(v.length); o.forEach((p, k) => { r[p[1]] = k; }); return r; };
    const ra = rk(a), rb = rk(b), n = a.length, ma = (n - 1) / 2;
    let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - ma); da += (ra[i] - ma) ** 2; db += (rb[i] - ma) ** 2; }
    return num / Math.sqrt(da * db);
  }
  function compare(st, clk, official) {
    // compare the pilots at ESS on both sides (when the official file gives a status)
    const off = new Map(official.filter(o => !o.status || o.status === "GOAL").map(o => [norm(o.name), o]));
    const rows = clk.ranking.filter(r => r.ess !== null && r.goal && off.has(norm(r.name)));
    if (rows.length < 5) return { n: rows.length };
    const o = rows.map(r => off.get(norm(r.name)));
    const offRank = rows.map((r, k) => o[k].total !== null && !Number.isNaN(o[k].total) ? -o[k].total : o[k].rank);
    const out = { n: rows.length,
      officialVsWakefield: spearman(offRank, rows.map(r => r.final)),
      officialVsArrival: spearman(offRank, rows.map(r => r.ess)) };
    if (o.every(x => x.lead !== null && !Number.isNaN(x.lead))) {
      const t10 = rows.map(r => st.top10[r.i]);
      out.top10VsLead = spearman(t10, o.map(x => x.lead));
      out.top10VsCredit = spearman(t10, rows.map(r => r.credit));
    }
    out.rows = rows.map((r, k) => ({ name: r.name, official: o[k], top10: st.top10[r.i] / 60 }));
    return out;
  }

  const api = { DEFAULTS, FIELD_KEYS, DT, parseXctsk, normaliseTask, parseWpt, parseIGC, prepare, computeField, computeClock, buildReplay, parseOfficialCsv, compare, norm, spearman, decodePolyline, geodist, thermalDeaths, decodeBytes, applyOfficialGoal, alignNames };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Wakefield = api;
})(typeof self !== "undefined" ? self : this);
